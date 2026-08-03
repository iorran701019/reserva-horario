import { createClient } from "@supabase/supabase-js";
import { sincronizarEventoComGoogle } from "@/lib/googleCalendarSync";

// Sincroniza um agendamento com o Google Calendar do salão dono da conta
// conectada em app/api/google-calendar/callback/route.js. Chamada
// server-side (o gatilho de banco que vai disparar isso ainda não existe —
// por ora é testada direto via curl), protegida pelo mesmo segredo de
// app/api/notificacoes/route.js.

async function tokenDeAcesso(refreshToken) {
  const resposta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await resposta.json();
  return { ok: resposta.ok && !!tokens.access_token, accessToken: tokens.access_token, tokens };
}

export async function POST(request) {
  const segredoRecebido = request.headers.get("x-webhook-secret");
  if (!segredoRecebido || segredoRecebido !== process.env.NOTIFICACAO_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { agendamento_id: agendamentoId } = await request.json();
  if (!agendamentoId) {
    return new Response("agendamento_id ausente.", { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: agendamento } = await supabaseAdmin
    .from("agendamentos")
    .select(
      "id, nome_cliente, data, horario, duracao_min, status, servico_livre, google_event_id, estabelecimento_id, servicos(nome), estabelecimentos(google_calendar_ativo)"
    )
    .eq("id", agendamentoId)
    .single();

  if (!agendamento || !agendamento.estabelecimentos?.google_calendar_ativo) {
    return Response.json({ acao: "ignorado" });
  }

  const { data: tokenRow } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("refresh_token")
    .eq("estabelecimento_id", agendamento.estabelecimento_id)
    .single();

  if (!tokenRow?.refresh_token) {
    return Response.json({ acao: "ignorado" });
  }

  const { ok: tokenOk, accessToken, tokens } = await tokenDeAcesso(tokenRow.refresh_token);

  if (!tokenOk) {
    // refresh_token revogado fora do app (myaccount.google.com/permissions) —
    // desliga a integração pra não ficar tentando pra sempre com token morto.
    console.error(
      "Refresh token do Google Calendar inválido, desligando integração",
      agendamento.estabelecimento_id,
      tokens
    );
    await supabaseAdmin
      .from("estabelecimentos")
      .update({ google_calendar_ativo: false })
      .eq("id", agendamento.estabelecimento_id);
    await supabaseAdmin
      .from("google_calendar_tokens")
      .delete()
      .eq("estabelecimento_id", agendamento.estabelecimento_id);
    return Response.json({ acao: "ignorado" });
  }

  const resultado = await sincronizarEventoComGoogle({ agendamento, accessToken, supabaseAdmin });
  return Response.json(resultado);
}
