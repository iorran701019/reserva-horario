// Importação em massa de eventos do Google Calendar pro reserva-horario
// (ver app/api/google-calendar/calendarios/route.js,
// app/api/google-calendar/importar/route.js e
// components/ModalImportarGoogleCalendar.js). Tudo aqui é puro/server-only:
// recebe um accessToken já trocado (ver lib/googleCalendarToken.js) ou dados
// já carregados do Supabase, nunca lida com o refresh_token em si.

const CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const EVENTOS_URL = "https://www.googleapis.com/calendar/v3/calendars";

// Ruído conhecido de calendários sincronizados por apps terceiros (Todoist,
// Family Google, Contacts, Tasks, aniversários) — nunca são o calendário de
// atendimento real. Comparação é por summary exato (case-insensitive); é uma
// heurística por nome, não estrutural, já que a API não sinaliza de forma
// confiável "calendário de negócio real" vs "sincronizado por app terceiro".
// Fácil de estender aqui se aparecer ruído novo em algum tenant futuro.
const CALENDARIOS_RUIDO = ["todoist", "family", "contacts", "tasks", "aniversários", "birthdays"];

// Só calendários onde a conta pode pelo menos escrever — filtra de cara
// calendários assinados só-leitura (feriados nacionais, aniversários), que
// nunca são o calendário de atendimento real que a dona vai escolher. O
// calendário primário (item.primary) vem sempre primeiro na lista, pra ficar
// pré-selecionado por padrão no dropdown.
export async function listarCalendarios(accessToken) {
  const resposta = await fetch(`${CALENDAR_LIST_URL}?minAccessRole=writer`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const corpo = await resposta.json();
  if (!resposta.ok) {
    throw new Error(corpo?.error?.message ?? "Falha ao listar calendários do Google");
  }

  const calendarios = (corpo.items ?? [])
    .filter((item) => !CALENDARIOS_RUIDO.includes((item.summary ?? "").trim().toLowerCase()))
    .map((item) => ({ id: item.id, summary: item.summary, primary: Boolean(item.primary) }));

  calendarios.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
  return calendarios;
}

// Todos os eventos do calendário a partir de agora, sem limite de data
// final — pagina até esgotar o nextPageToken. singleEvents=true expande
// recorrências em instâncias reais (senão viria só a regra de recorrência).
export async function listarEventosFuturos(accessToken, calendarId) {
  const eventos = [];
  let pageToken;
  const agora = new Date().toISOString();

  do {
    const params = new URLSearchParams({
      timeMin: agora,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const resposta = await fetch(
      `${EVENTOS_URL}/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const corpo = await resposta.json();
    if (!resposta.ok) {
      throw new Error(corpo?.error?.message ?? "Falha ao listar eventos do Google Calendar");
    }

    eventos.push(...(corpo.items ?? []));
    pageToken = corpo.nextPageToken;
  } while (pageToken);

  return eventos;
}

// Sem acento/case, pra comparar título de evento com nome de serviço/cliente
// sem depender de digitação idêntica.
function normalizarTexto(texto) {
  return (texto ?? "")
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
}

// Casa um texto (nome dentro do parêntese, ou o próprio título) contra o
// catálogo de serviços: match exato primeiro, senão substring em qualquer
// direção (cobre "Corte" vs "Corte Masculino"). null sem nenhum match.
function resolverServicoPorTexto(texto, servicos) {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return null;

  const exato = servicos.find((s) => normalizarTexto(s.nome) === normalizado);
  if (exato) return exato.id;

  const parcial = servicos.find((s) => {
    const nomeNormalizado = normalizarTexto(s.nome);
    return (
      nomeNormalizado && (normalizado.includes(nomeNormalizado) || nomeNormalizado.includes(normalizado))
    );
  });
  return parcial?.id ?? null;
}

// Heurística sobre o título do evento:
//   - tem parêntese -> nome = antes do "(", serviço = texto dentro dele
//   - sem parêntese -> procura o nome de algum serviço do catálogo dentro do
//     texto (nomes mais longos primeiro, pra "Corte Infantil" não perder pra
//     "Corte") e corta ali; sem match, serviço fica vazio e o título inteiro
//     é o nome
// Em qualquer um dos dois casos, se a parte do NOME (antes do corte de
// serviço) tiver o padrão "Nome e Nome2", sugere só o primeiro nome e sinaliza
// possivelMaisDeUmCliente — a dona revisa manualmente o resto.
export function interpretarTitulo(tituloBruto, servicos) {
  const titulo = (tituloBruto ?? "").trim();
  const indiceAbre = titulo.indexOf("(");

  let parteNome = titulo;
  let servicoIdSugerido = null;

  if (indiceAbre !== -1) {
    parteNome = titulo.slice(0, indiceAbre).trim();
    const indiceFecha = titulo.indexOf(")", indiceAbre);
    const textoServico = titulo.slice(indiceAbre + 1, indiceFecha === -1 ? undefined : indiceFecha).trim();
    servicoIdSugerido = resolverServicoPorTexto(textoServico, servicos);
  } else {
    const normalizado = normalizarTexto(titulo);
    const porNomeMaisLongo = [...servicos].sort((a, b) => (b.nome?.length ?? 0) - (a.nome?.length ?? 0));

    for (const servico of porNomeMaisLongo) {
      const nomeNormalizado = normalizarTexto(servico.nome);
      if (!nomeNormalizado) continue;
      const indice = normalizado.indexOf(nomeNormalizado);
      if (indice !== -1) {
        parteNome = titulo.slice(0, indice).trim();
        servicoIdSugerido = servico.id;
        break;
      }
    }
  }

  let nomeSugerido = parteNome;
  let possivelMaisDeUmCliente = false;
  const doisNomes = parteNome.match(/^(.+?)\s+e\s+.+$/i);
  if (doisNomes) {
    nomeSugerido = doisNomes[1].trim();
    possivelMaisDeUmCliente = true;
  }

  return {
    nomeSugerido: nomeSugerido || titulo,
    servicoIdSugerido,
    possivelMaisDeUmCliente,
  };
}

// Casa o nome sugerido com um cliente já cadastrado: exato primeiro, senão
// "Maria" casa com cliente cadastrada como "Maria Silva" (prefixo + espaço,
// evita casar "Maria" com "Mariana"). null sugere "cliente novo".
export function resolverClienteId(nomeSugerido, clientes) {
  const normalizado = normalizarTexto(nomeSugerido);
  if (!normalizado) return null;

  const exato = clientes.find((c) => normalizarTexto(c.nome) === normalizado);
  if (exato) return exato.id;

  const porPrefixo = clientes.find((c) => normalizarTexto(c.nome).startsWith(`${normalizado} `));
  return porPrefixo?.id ?? null;
}

// Data/horário do evento em horário de Brasília, a partir do instante real
// (dateTime do Google já vem com offset/"Z"). Precisa de Intl com
// timeZone explícito — diferente de corpoEvento (lib/googleCalendarSync.js),
// que só reformata uma string ingênua sem fuso; aqui o Date representa um
// instante absoluto de verdade, então getHours()/getDate() locais dariam o
// horário do servidor (Vercel roda em UTC), não o de Brasília.
function paraDataHorarioBrasilia(instante) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));

  return {
    data: `${mapa.year}-${mapa.month}-${mapa.day}`,
    horario: `${mapa.hour}:${mapa.minute}`,
  };
}

// Monta a lista de candidatos a importar: eventos do calendário menos os que
// já têm agendamento (google_event_id) ou já foram descartados antes
// (calendar_import_ignorados). Sem heurística de nome/serviço/cliente — a
// importação agora é direta (ver POST em app/api/google-calendar/importar),
// então só interessa data/horário/duração/título bruto. Eventos cancelados ou
// de dia inteiro (sem horário) são ignorados — o schema de agendamentos exige
// um horário específico.
export function montarCandidatos({ eventos, idsExcluidos }) {
  return eventos
    .filter((evento) => evento.status !== "cancelled")
    .filter((evento) => Boolean(evento.start?.dateTime && evento.end?.dateTime))
    .filter((evento) => !idsExcluidos.has(evento.id))
    .map((evento) => {
      const inicio = new Date(evento.start.dateTime);
      const fim = new Date(evento.end.dateTime);
      const duracaoMin = Math.round((fim.getTime() - inicio.getTime()) / 60000);
      const { data, horario } = paraDataHorarioBrasilia(inicio);

      return {
        google_event_id: evento.id,
        titulo_original: evento.summary ?? "",
        data,
        horario,
        duracao_min: duracaoMin > 0 ? duracaoMin : 30,
      };
    });
}
