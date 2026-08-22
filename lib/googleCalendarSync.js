// Sincroniza UM agendamento com o Google Calendar do salão dono da conta
// conectada (ver app/api/google-calendar/callback/route.js). Extraído de
// app/api/google-calendar/sync/route.js pra ser reusado também na sync em
// massa disparada logo após a primeira conexão (callback/route.js).
//
// status "confirmado" sem google_event_id  -> cria evento
// status "confirmado" com google_event_id  -> atualiza evento (reagendamento)
// qualquer outro status com google_event_id -> apaga evento
// qualquer outro caso                       -> não faz nada

import { antesDoParentese } from "./googleCalendarImportacao";

const EVENTOS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// colorId fixo (7 = "Peacock" na paleta do Google Calendar) pra todos os
// tenants — só um jeito consistente de diferenciar visualmente os eventos
// criados pelo app dos demais compromissos da agenda da dona.
const COLOR_ID_EVENTO = "7";

// Título do evento: por padrão "Nome · Serviço", mas o tenant pode inverter
// pra "Serviço - Nome" via estabelecimentos.google_calendar_ordem_titulo
// (ver toggle em ConfiguracoesSalao.js). Quando invertido, o nome do serviço
// é cortado antes do primeiro "(" — mesmo critério de antesDoParentese em
// googleCalendarImportacao.js, que descarta a parte parentética/observação
// do nome cadastrado.
function montarSummary(agendamento, nomeServico, ordemTitulo) {
  if (ordemTitulo === "servico_cliente") {
    const servicoResumido = antesDoParentese(nomeServico).trim();
    return `${servicoResumido} - ${agendamento.nome_cliente}`;
  }
  return `${agendamento.nome_cliente} · ${nomeServico}`;
}

// `data` é "YYYY-MM-DD" e `horario` volta do Postgres como "HH:MM:SS" —
// normaliza pra "HH:MM" antes de montar o ISO local, senão sobra um ":00" a
// mais. Sem offset, porque o fim depende só de somar duracao_min em cima do
// início.
function corpoEvento(agendamento, nomeServico, ordemTitulo) {
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
    summary: montarSummary(agendamento, nomeServico, ordemTitulo),
    colorId: COLOR_ID_EVENTO,
    start: { dateTime: paraISOLocal(inicio), timeZone: "America/Sao_Paulo" },
    end: { dateTime: paraISOLocal(fim), timeZone: "America/Sao_Paulo" },
  };
}

export async function sincronizarEventoComGoogle({ agendamento, accessToken, supabaseAdmin }) {
  // Agendamento importado do Google Calendar ainda sem cliente vinculado
  // (telefone null — ver POST em app/api/google-calendar/importar/route.js):
  // pula silenciosamente. Sem isso, este mesmo sync de SAÍDA sobrescreveria o
  // evento original da dona no Google com nome_cliente/serviço vazios. A
  // guarda solta sozinha assim que o dono vincula um cliente (telefone deixa
  // de ser null, ver botão "Vincular cliente" no Painel).
  if (!agendamento.telefone) {
    return { acao: "ignorado" };
  }

  const nomeServico = agendamento.servicos?.nome ?? agendamento.servico_livre ?? "serviço";
  const ordemTitulo = agendamento.estabelecimentos?.google_calendar_ordem_titulo;

  async function salvarGoogleEventId(googleEventId) {
    await supabaseAdmin
      .from("agendamentos")
      .update({ google_event_id: googleEventId })
      .eq("id", agendamento.id);
  }

  if (agendamento.status === "confirmado") {
    const corpo = corpoEvento(agendamento, nomeServico, ordemTitulo);

    if (!agendamento.google_event_id) {
      console.log("Chamando POST de criação de evento no Google Calendar", agendamento.id, corpo);
      const respostaCriar = await fetch(EVENTOS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpo),
      });
      const eventoCriado = await respostaCriar.json();
      console.log("Resposta do POST de criação", agendamento.id, respostaCriar.status, eventoCriado);

      if (!respostaCriar.ok || !eventoCriado.id) {
        console.error("Falha ao criar evento no Google Calendar", agendamento.id, eventoCriado);
        return { acao: "ignorado" };
      }

      await salvarGoogleEventId(eventoCriado.id);
      return { acao: "criado" };
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
      return { acao: "ignorado" };
    }

    if (!respostaAtualizar.ok) {
      const erro = await respostaAtualizar.json().catch(() => ({}));
      console.error("Falha ao atualizar evento no Google Calendar", agendamento.id, erro);
      return { acao: "ignorado" };
    }

    return { acao: "atualizado" };
  }

  if (agendamento.google_event_id) {
    const respostaApagar = await fetch(`${EVENTOS_URL}/${agendamento.google_event_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!respostaApagar.ok && respostaApagar.status !== 404) {
      const erro = await respostaApagar.json().catch(() => ({}));
      console.error("Falha ao apagar evento no Google Calendar", agendamento.id, erro);
      return { acao: "ignorado" };
    }

    await salvarGoogleEventId(null);
    return { acao: "apagado" };
  }

  return { acao: "ignorado" };
}
