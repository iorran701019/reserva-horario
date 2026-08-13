import { createClient } from "@supabase/supabase-js";
import { sincronizarEventoComGoogle } from "@/lib/googleCalendarSync";
import { obterAccessTokenDoTenant } from "@/lib/googleCalendarToken";

// Sincroniza um agendamento com o Google Calendar do salão dono da conta
// conectada em app/api/google-calendar/callback/route.js. Chamada
// server-side (o gatilho de banco que vai disparar isso ainda não existe —
// por ora é testada direto via curl), protegida pelo mesmo segredo de
// app/api/notificacoes/route.js.

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
      "id, nome_cliente, telefone, data, horario, duracao_min, status, servico_livre, google_event_id, estabelecimento_id, servicos(nome), estabelecimentos(google_calendar_ativo, google_calendar_ordem_titulo)"
    )
    .eq("id", agendamentoId)
    .single();

  if (!agendamento || !agendamento.estabelecimentos?.google_calendar_ativo) {
    return Response.json({ acao: "ignorado" });
  }

  const accessToken = await obterAccessTokenDoTenant(agendamento.estabelecimento_id, supabaseAdmin);
  if (!accessToken) {
    return Response.json({ acao: "ignorado" });
  }

  const resultado = await sincronizarEventoComGoogle({ agendamento, accessToken, supabaseAdmin });
  return Response.json(resultado);
}
