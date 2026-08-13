// Importação em massa de eventos do Google Calendar pro reserva-horario
// (ver app/api/google-calendar/calendarios/route.js,
// app/api/google-calendar/importar/route.js e
// components/ModalImportarGoogleCalendar.js). Tudo aqui é puro/server-only:
// recebe um accessToken já trocado (ver lib/googleCalendarToken.js) ou dados
// já carregados do Supabase, nunca lida com o refresh_token em si.

const CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const EVENTOS_URL = "https://www.googleapis.com/calendar/v3/calendars";

// Horizonte máximo pra frente na busca de eventos futuros — sem isso,
// instâncias de eventos recorrentes sem data de fim se estendem
// indefinidamente (confirmado em produção: instâncias alcançando outubro de
// 2031). Ajustável aqui se algum tenant precisar de um horizonte diferente.
const HORIZONTE_FUTURO_DIAS = 180;

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

// Todos os eventos do calendário a partir de agora, até HORIZONTE_FUTURO_DIAS
// à frente — pagina até esgotar o nextPageToken. singleEvents=true expande
// recorrências em instâncias reais (senão viria só a regra de recorrência).
export async function listarEventosFuturos(accessToken, calendarId) {
  const eventos = [];
  let pageToken;
  const agora = new Date();
  const timeMin = agora.toISOString();
  const timeMax = new Date(agora.getTime() + HORIZONTE_FUTURO_DIAS * 24 * 60 * 60 * 1000).toISOString();

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
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

// Título vazio (ou só espaço) ou que é só um horário cru ("13:00", "13h",
// "1300") — bloqueio de agenda sem nenhuma informação real, não vira
// candidato.
function ehTituloSoHora(titulo) {
  const normalizado = (titulo ?? "").trim();
  if (!normalizado) return true;
  return /^(\d{1,2}:\d{2}|\d{1,2}h(\d{2})?|\d{3,4})$/i.test(normalizado);
}

// Stopwords comuns em português — descartadas antes de entrar no conjunto de
// palavras do catálogo/título (ver palavrasSignificativas), senão uma
// preposição qualquer no meio de um título pessoal ("de", "com"...) casaria
// à toa com o mesmo conectivo dentro de um nome de serviço composto. Lista
// curta, fácil de estender se aparecer ruído novo ("pra" entrou depois de
// aparecer como falso-positivo em produção).
const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "com", "sem", "ou", "para", "pra", "em", "no", "na", "a", "o", "por", "um", "uma",
]);

// Corta um texto antes do primeiro "(" — mesmo critério de indiceAbre em
// interpretarTitulo, reaproveitado aqui pra descartar a parte
// parentética/observação de um nome de serviço ("Manutenção – Fibra de
// Vidro (sem decoração ou com decoração simples.)" -> "Manutenção – Fibra de
// Vidro") antes de extrair palavras — sem isso o texto de observação polui
// o Set do catálogo com palavras genéricas (valor, válido, necessário...).
export function antesDoParentese(texto) {
  const indiceAbre = (texto ?? "").indexOf("(");
  return indiceAbre === -1 ? texto : texto.slice(0, indiceAbre);
}

// Palavras significativas de um texto: normaliza (normalizarTexto), remove
// pontuação (mantém só letras/números/espaço — "Molde F1" vira "molde f1")
// e quebra em palavras, descartando só stopwords — sem filtro de tamanho,
// pra não derrubar código de serviço curto tipo "f1".
function palavrasSignificativas(texto) {
  const semPontuacao = normalizarTexto(texto).replace(/[^\p{L}\p{N}\s]/gu, " ");
  return semPontuacao
    .split(/\s+/)
    .filter((palavra) => palavra && !STOPWORDS.has(palavra));
}

// Categoria do candidato: 'servico' se QUALQUER palavra significativa do
// título do evento também aparece no conjunto de palavras significativas de
// algum serviço cadastrado do tenant (ex.: título "aplicação fibra maria"
// bate com o serviço "Fibra de Vidro..." pela palavra "fibra"), senão
// 'pessoal'. colorId foi abandonado como sinal: dado real de produção
// mostrou o mesmo evento recorrente repetido com colorId inconsistente entre
// instâncias — o catálogo de serviços do próprio tenant é uma fonte estável.
function categoriaPorTitulo(tituloBruto, palavrasCatalogo) {
  const palavrasTitulo = palavrasSignificativas(tituloBruto);
  const bateServico = palavrasTitulo.some((palavra) => palavrasCatalogo.has(palavra));
  return bateServico ? "servico" : "pessoal";
}

// Monta a lista de candidatos a importar: eventos do calendário menos os que
// já têm agendamento (google_event_id) ou já foram descartados antes
// (calendar_import_ignorados). Sem heurística de nome/cliente — a importação
// agora é direta (ver POST em app/api/google-calendar/importar), então só
// interessa data/horário/duração/título bruto. `servicos` é o catálogo ativo
// do tenant (mesmo formato de interpretarTitulo: [{ nome }, ...]). Eventos
// cancelados, de dia inteiro (sem horário) ou com título "só hora" (ver
// ehTituloSoHora) são descartados de cara — o schema de agendamentos exige um
// horário específico e título "só hora" não carrega nenhuma informação real
// de cliente/serviço. Dos elegíveis, só quem bate com o catálogo
// (categoriaPorTitulo === 'servico') vira candidato de fato — quem não bate
// ('pessoal') nem aparece na lista, só entra na contagem de ignoradosPorCatalogo
// (ver GET em app/api/google-calendar/importar), pra dar um sinal caso um
// atendimento real mal escrito tenha sumido silenciosamente.
export function montarCandidatos({ eventos, idsExcluidos, servicos }) {
  const palavrasCatalogo = new Set(
    (servicos ?? []).flatMap((s) => palavrasSignificativas(antesDoParentese(s.nome)))
  );

  const elegiveis = eventos
    .filter((evento) => evento.status !== "cancelled")
    .filter((evento) => Boolean(evento.start?.dateTime && evento.end?.dateTime))
    .filter((evento) => !idsExcluidos.has(evento.id))
    .filter((evento) => !ehTituloSoHora(evento.summary));

  const candidatos = [];
  let ignoradosPorCatalogo = 0;

  for (const evento of elegiveis) {
    if (categoriaPorTitulo(evento.summary, palavrasCatalogo) !== "servico") {
      ignoradosPorCatalogo += 1;
      continue;
    }

    const inicio = new Date(evento.start.dateTime);
    const fim = new Date(evento.end.dateTime);
    const duracaoMin = Math.round((fim.getTime() - inicio.getTime()) / 60000);
    const { data, horario } = paraDataHorarioBrasilia(inicio);

    candidatos.push({
      google_event_id: evento.id,
      titulo_original: evento.summary ?? "",
      data,
      horario,
      duracao_min: duracaoMin > 0 ? duracaoMin : 30,
    });
  }

  return { candidatos, ignoradosPorCatalogo };
}
