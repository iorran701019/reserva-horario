import { createClient } from "@supabase/supabase-js";

// Sincroniza um agendamento com o Google Calendar do salão dono da conta
// conectada em app/api/google-calendar/callback/route.js. Chamada
// server-side (o gatilho de banco que vai disparar isso ainda não existe —
// por ora é testada direto via curl), protegida pelo mesmo segredo de
// app/api/notificacoes/route.js.
//
// status "confirmado" sem google_event_id  -> cria evento
// status "confirmado" com google_event_id  -> atualiza evento (reagendamento)
// qualquer outro status com google_event_id -> apaga evento
// qualquer outro caso                       -> não faz nada

const EVENTOS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

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

// `data` é "YYYY-MM-DD" e `horario` volta do Postgres como "HH:MM:SS" —
// normaliza pra "HH:MM" antes de montar o ISO local, senão sobra um ":00" a
// mais. Sem offset, porque o fim depende só de somar duracao_min em cima do
// início.
function corpoEvento(agendamento, nomeServico) {
  const horarioNormalizado = agendamento.horario.slice(0, 5);
  const inicio = new Date(`${agendamento.data}T${horarioNormalizado}:00`);
  const fim = new Date(inicio.getTime() + (agendamento.duracao_min ?? 30) * 60000);
  const paraISOLocal = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}:00`;

  return {
    summary: `${agendamento.nome_cliente} · ${nomeServico}`,
    start: { dateTime: paraISOLocal(inicio), timeZone: "America/Sao_Paulo" },
    end: { dateTime: paraISOLocal(fim), timeZone: "America/Sao_Paulo" },
  };
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

  const nomeServico = agendamento.servicos?.nome ?? agendamento.servico_livre ?? "serviço";

  async function salvarGoogleEventId(googleEventId) {
    await supabaseAdmin
      .from("agendamentos")
      .update({ google_event_id: googleEventId })
      .eq("id", agendamento.id);
  }

  if (agendamento.status === "confirmado") {
    const corpo = corpoEvento(agendamento, nomeServico);

    if (!agendamento.google_event_id) {
      const respostaCriar = await fetch(EVENTOS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpo),
      });
      const eventoCriado = await respostaCriar.json();

      if (!respostaCriar.ok || !eventoCriado.id) {
        console.error("Falha ao criar evento no Google Calendar", agendamento.id, eventoCriado);
        return Response.json({ acao: "ignorado" });
      }

      await salvarGoogleEventId(eventoCriado.id);
      return Response.json({ acao: "criado" });
    }

    const respostaAtualizar = await fetch(`${EVENTOS_URL}/${agendamento.google_event_id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
    });

    // Evento já foi apagado manualmente pela dona direto no Calendar — trata
    // como sucesso, só limpa o vínculo pra próxima sync recriar do zero.
    if (respostaAtualizar.status === 404) {
      await salvarGoogleEventId(null);
      return Response.json({ acao: "ignorado" });
    }

    if (!respostaAtualizar.ok) {
      const erro = await respostaAtualizar.json().catch(() => ({}));
      console.error("Falha ao atualizar evento no Google Calendar", agendamento.id, erro);
      return Response.json({ acao: "ignorado" });
    }

    return Response.json({ acao: "atualizado" });
  }

  if (agendamento.google_event_id) {
    const respostaApagar = await fetch(`${EVENTOS_URL}/${agendamento.google_event_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!respostaApagar.ok && respostaApagar.status !== 404) {
      const erro = await respostaApagar.json().catch(() => ({}));
      console.error("Falha ao apagar evento no Google Calendar", agendamento.id, erro);
      return Response.json({ acao: "ignorado" });
    }

    await salvarGoogleEventId(null);
    return Response.json({ acao: "apagado" });
  }

  return Response.json({ acao: "ignorado" });
}
