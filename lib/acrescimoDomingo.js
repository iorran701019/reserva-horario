import { somarPreco } from "./servicoAgregado.js";

// Parte PURA do "Domingo com acréscimo" das liberações de horário (aba
// Exceções de Horário). Fica fora do componente pra ser testável sem React.

// "YYYY-MM-DD" cai num domingo? Date por partes (nunca new Date("YYYY-MM-DD"),
// que é UTC e pode voltar um dia em GMT-3).
export function ehDomingoISO(iso) {
  if (!iso) return false;
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia).getDay() === 0;
}

// Conjunto de dias da semana (0–6) que a liberação por período usa. No modo
// "Vários domingos num período" só existem domingos; nos demais valem os dias
// escolhidos. coletarLinhas e o resumo ao vivo usam esta MESMA função, pra
// nunca divergirem.
export function diasDoPeriodoDeLiberacao(soDomingos, diasEscolhidos) {
  return soDomingos ? new Set([0]) : new Set(diasEscolhidos);
}

const hhmm = (h) => String(h ?? "").slice(0, 5);

function diaSemanaISO(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia).getDay();
}

function ddmm(iso) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

// Primeira data de ini..fim (ISO, inclusive) que cai em `dow`, ou null.
function primeiraDataNoDia(ini, fim, dow) {
  const [ano, mes, dia] = ini.split("-").map(Number);
  for (let i = 0; i < 7; i++) {
    const d = new Date(ano, mes - 1, dia + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (iso > fim) return null;
    if (d.getDay() === dow) return iso;
  }
  return null;
}

// A liberação existente `e` cobre a nova `n` (mesmo horário e data que casa)?
// Devolve { data } (data da cobertura, null se só há recorrência) ou null.
// Linha 'periodo' vale pelo intervalo data_inicio..data_fim (data_fim nulo =
// data_inicio), como o motor (lib/disponibilidade.js); `hoje` é
// "YYYY-MM-DD" e intervalo já encerrado não conta.
function cobre(e, n, hoje) {
  if ((e.tipo_registro ?? "ausencia") !== "liberacao") return null;
  if (hhmm(e.hora_inicio) !== hhmm(n.hora_inicio)) return null;
  const fimE = e.data_fim ?? e.data_inicio;
  if (e.tipo === "periodo" && fimE < hoje) return null;

  if (n.tipo === "recorrente") {
    if (e.tipo === "recorrente") return e.dia_semana === n.dia_semana ? { data: null } : null;
    if (e.tipo !== "periodo") return null;
    const ini = e.data_inicio < hoje ? hoje : e.data_inicio;
    const data = primeiraDataNoDia(ini, fimE, n.dia_semana);
    return data ? { data } : null;
  }
  if (n.tipo !== "periodo" || !n.data_inicio) return null;
  if (e.tipo === "periodo") {
    return e.data_inicio <= n.data_inicio && n.data_inicio <= fimE ? { data: n.data_inicio } : null;
  }
  if (e.tipo === "recorrente" && e.dia_semana === diaSemanaISO(n.data_inicio)) {
    return { data: n.data_inicio };
  }
  return null;
}

// PURA. Procura a primeira liberação nova que repete horário já liberado de
// um jeito que anula ou duplica o acréscimo de domingo (o motor faz o
// acréscimo sumir quando uma liberação sem marca cobre o mesmo horário).
// Sem marca x sem marca NÃO é conflito. Devolve null ou
// { tipo, data, hora, mensagem }. Também compara as novas entre si.
export function conflitoDeHorario(novas, existentes, hoje) {
  const marcada = (a) => a.acrescimo_domingo === true;

  function avaliar(n, e) {
    if (!marcada(n) && !marcada(e)) return null;
    const cob = cobre(e, n, hoje);
    if (!cob) return null;

    const hora = hhmm(n.hora_inicio);
    const data = cob.data;
    const quando = data ? `Em ${ddmm(data)} às ${hora}` : `Todo domingo às ${hora}`;

    if (marcada(n) && !marcada(e)) {
      return {
        tipo: "sem_marca",
        data,
        hora,
        mensagem: `${quando} já existe uma liberação sem acréscimo. Exclua essa liberação antes, senão o acréscimo não vale.`,
      };
    }
    if (!marcada(n)) {
      return {
        tipo: "com_marca",
        data,
        hora,
        mensagem: `${quando} já existe um domingo com acréscimo. Exclua o acréscimo antes de liberar este horário.`,
      };
    }
    if (e.tipo === "recorrente") {
      return {
        tipo: "marcada_recorrente",
        data,
        hora,
        mensagem: `Todos os domingos já estão liberados com acréscimo às ${hora}.`,
      };
    }
    return {
      tipo: "marcada_data",
      data,
      hora,
      mensagem: `${quando} já existe um domingo com acréscimo.`,
    };
  }

  const lista = existentes ?? [];
  for (let i = 0; i < novas.length; i++) {
    for (const e of lista) {
      const c = avaliar(novas[i], e);
      if (c) return c;
    }
    for (let j = 0; j < i; j++) {
      const c = avaliar(novas[i], { ...novas[j], tipo_registro: "liberacao" });
      if (c) return c;
    }
  }
  return null;
}

// --- Calendário do wizard (/agendar e Agendar do /admin) ---
// Regras PURAS que decidem quais liberações abrem/pintam um dia no calendário.
// Só o domingo recorrente MARCADO (dia_semana 0 + acrescimo_domingo) entra:
// liberação recorrente sem marca, ou marcada em outro dia da semana, segue
// ignorada pelo calendário, como sempre foi.

function ehDomingoRecorrenteMarcado(a) {
  return a.tipo === "recorrente" && a.acrescimo_domingo === true && a.dia_semana === 0;
}

// A linha da consulta de liberações do wizard deve ser considerada pelo
// calendário? 'periodo' sempre; 'recorrente' só se for domingo com acréscimo.
export function liberacaoEntraNoCalendario(a) {
  return a.tipo === "recorrente" ? ehDomingoRecorrenteMarcado(a) : true;
}

// A liberação cobre a data `iso` ("YYYY-MM-DD")? 'periodo' vale por
// data_inicio..data_fim; o domingo recorrente marcado vale em todo domingo.
export function liberacaoCobreDia(a, iso) {
  if (a.tipo === "recorrente") return ehDomingoRecorrenteMarcado(a) && ehDomingoISO(iso);
  return a.data_inicio <= iso && iso <= a.data_fim;
}

// Ainda há (ou haverá) dia coberto a partir de `hoje`? O domingo recorrente
// marcado tem data_fim nula = sem fim; as demais seguem por data_fim.
export function liberacaoAindaVale(a, hoje) {
  return ehDomingoRecorrenteMarcado(a) || a.data_fim >= hoje;
}

// O dia `iso` tem acréscimo de domingo em alguma das liberações?
export function diaTemAcrescimo(liberacoes, iso) {
  return (liberacoes ?? []).some((a) => a.acrescimo_domingo === true && liberacaoCobreDia(a, iso));
}

// --- Aviso do percentual (admin) ---
// Texto do acréscimo cobrado sobre o valor total do agendamento. Percentual
// inválido (null, NaN, zero, negativo) cai na versão sem número.
export function percentualValido(percentual) {
  return typeof percentual === "number" && Number.isFinite(percentual) && percentual > 0;
}

export function textoAcrescimo(percentual) {
  return percentualValido(percentual)
    ? `Acréscimo de ${percentual}% sobre o valor total do agendamento`
    : "Acréscimo sobre o valor total do agendamento";
}

// Texto fixo da cliente no wizard: sem percentual e sem valor. O /admin segue
// usando textoAcrescimo (com o percentual) pra dona.
export function textoAcrescimoCliente() {
  return "Acréscimo de Domingo no valor total do serviço";
}

// --- Preço no wizard (/agendar) ---
// Total com acréscimo = base + floor(base * percentual / 100). Arredonda para
// BAIXO uma única vez, só aqui. Percentual inválido ou base que não seja
// inteiro >= 0 devolve a base como veio. O app nunca manda o percentual ao
// banco (ele lê do salão); isto só serve pra mostrar o valor à cliente.
export function precoComAcrescimo(baseCentavos, percentual) {
  if (!percentualValido(percentual)) return baseCentavos;
  if (!Number.isInteger(baseCentavos) || baseCentavos < 0) return baseCentavos;
  // toFixed corta o ruído de ponto flutuante (ex.: 1000 * 7.1 / 100) sem mexer
  // em frações reais como .5.
  return baseCentavos + Math.floor(Number(((baseCentavos * percentual) / 100).toFixed(6)));
}

// --- Valor cobrado do agendamento ---
// Mesmo número do cron: base = preço do serviço + agregado (nulo conta 0) +
// ajustes das respostas; total = base + floor(base * percentual / 100), com
// percentual nulo = 0. O arredondamento mora só em precoComAcrescimo. Sem
// preço de serviço (linha?.servicos?.preco_centavos nulo) devolve null.
export function valorTotalAgendamento(linha, ajustesCentavos = 0) {
  const preco = linha?.servicos?.preco_centavos;
  if (preco == null) return null;
  const base = somarPreco(preco, linha.agregado_preco_centavos, ajustesCentavos);
  return precoComAcrescimo(base, linha.acrescimo_percentual_aplicado);
}

// A linha gravada leva acréscimo de domingo? (percentual do banco, 1 a 100)
export function agendamentoTemAcrescimo(linha) {
  return percentualValido(linha?.acrescimo_percentual_aplicado);
}

// Texto SÓ da dona (com percentual). A cliente nunca vê o número: o texto
// dela é textoAcrescimoCliente.
export function textoAcrescimoDona(percentual) {
  return percentualValido(percentual)
    ? `Agendamento com acréscimo de domingo (${percentual}%)`
    : "Agendamento com acréscimo de domingo sem número";
}

// Compara o acréscimo que a linha tem (temAtual) com o do novo horário
// (temNovo). Quem decide temNovo é horarioTemAcrescimo sobre o mapa CRU de
// vagas, nunca outra heurística.
export function comparaAcrescimo({ temAtual, temNovo }) {
  if (temNovo && !temAtual) return "ligar";
  if (temAtual && !temNovo) return "desligar";
  return "manter";
}

// O horário escolhido tem acréscimo de domingo? Lê o mapa CRU de vagas
// (calcularVagasPorHorario, contexto público): lista de profissionais livres
// por horário + `acrescimoPorHorario` (Map horário -> Set de profissionais
// livres que o abrem com acréscimo). Com profissional escolhido vale a marca
// dele; sem escolha (encaixe automático) só vale se TODOS os livres tiverem.
export function horarioTemAcrescimo(mapa, horario, profissionalId) {
  if (!mapa || !horario) return false;
  const marcados = mapa.acrescimoPorHorario?.get(horario);
  if (!marcados || marcados.size === 0) return false;
  if (profissionalId != null) return marcados.has(profissionalId);
  const entrada = mapa[horario];
  const livres = Array.isArray(entrada) ? entrada : entrada?.livres;
  if (!Array.isArray(livres) || livres.length === 0) return false;
  return livres.every((id) => marcados.has(id));
}

// Decisão ÚNICA de "este agendamento leva acréscimo?", usada pela RPC e pela
// tela pra nunca divergirem. Só o fluxo público de um evento só carrega o
// acréscimo (par, /admin e remarcação paga não têm RPC que o grave).
// `decididoNaReserva` é o boolean gravado quando a reserva foi criada: enquanto
// existe reserva, ele manda — a marca sumir do mapa depois (recarga de vagas,
// voltar de etapa) não muda o que a linha já tem. Sem ele, vale o mapa cru.
export function acrescimoAplicavel({
  modoLivre,
  ehPar,
  percentual,
  mapa,
  horario,
  profissionalId,
  temReserva,
  decididoNaReserva,
}) {
  if (modoLivre || ehPar || !percentualValido(percentual)) return false;
  if (temReserva && typeof decididoNaReserva === "boolean") return decididoNaReserva;
  return horarioTemAcrescimo(mapa, horario, profissionalId);
}

// Remarcação com sinal pago (rota /api/agendamentos/remarcar): o navegador só
// diz sim ou não; o percentual é o do salão, lido pela rota. Só grava com
// `querAcrescimo` EXATAMENTE true (nada de "true"/1), em domingo e com
// percentual válido; senão null. A checagem de domingo repete a constraint do
// banco de propósito, pra um sim forjado não derrubar o insert com 23514.
export function acrescimoParaGravarRemarcacao({ querAcrescimo, data, percentual }) {
  return querAcrescimo === true && ehDomingoISO(data) && percentualValido(percentual)
    ? percentual
    : null;
}

// Mesma decisão, para o Agendar do /admin (modoLivre). A checagem de domingo
// é proteção do consumidor e repete a regra do banco de propósito (constraint
// agendamentos_acrescimo_somente_domingo_check): um percentual fora de domingo
// voltaria com erro 23514 no insert. `mapa` é o mapa CRU de vagas.
export function acrescimoDoAdmin({ data, ehPar, percentual, mapa, horario, profissionalId }) {
  return (
    ehDomingoISO(data) &&
    !ehPar &&
    percentualValido(percentual) &&
    horarioTemAcrescimo(mapa, horario, profissionalId)
  );
}

// Chave do quadrado da grade do admin: horário livre (ou aberto por
// liberação) com acréscimo vira "acrescimo"; qualquer outro estado (ocupado,
// antecedência, fora do expediente...) segue como está.
export function chaveGradeComAcrescimo(chaveBase, temAcrescimo) {
  return temAcrescimo && (chaveBase === "livre" || chaveBase === "liberacao")
    ? "acrescimo"
    : chaveBase;
}

// Valor padrão do CardConclusaoAtendimento quando a dona ainda não substituiu:
//   etapa anterior de um par -> 0
//   valor_cobrado_centavos   -> ele mesmo (já é o total, agregado incluso)
//   serviço sem preço (null) -> null: o card não inventa valor
//   senão a MESMA conta do cron (valorTotalAgendamento): serviço + agregado +
//   ajustes das perguntas + acréscimo de domingo gravado.
// `ajustesCentavos` vem de somarAjustesPreco (lib/agendamentoRespostas.js),
// buscado pelo card ao abrir; ausente vale 0.
export function precoPadraoConclusao(agendamento, ajustesCentavos = 0) {
  if (agendamento?.papel_reserva === "anterior") return 0;
  if (agendamento?.valor_cobrado_centavos != null) return agendamento.valor_cobrado_centavos;
  return valorTotalAgendamento(agendamento, ajustesCentavos);
}

// Valor mostrado no card de Pendentes, em centavos, ou null quando não há
// número confiável pra mostrar: etapa anterior avulsa de um par (o valor é o
// da principal), ajustes ainda carregando/com erro (não-número) ou serviço sem
// preço. Mesma conta do cron, via valorTotalAgendamento.
export function valorCardPendente(linha, ajustesCentavos) {
  if (linha?.papel_reserva === "anterior") return null;
  if (typeof ajustesCentavos !== "number" || !Number.isFinite(ajustesCentavos)) return null;
  return valorTotalAgendamento(linha, ajustesCentavos);
}

// Texto da tag de acréscimo do card de Pendentes (com o percentual da dona).
export function textoTagAcrescimo(percentual) {
  return percentualValido(percentual) ? `Domingo +${percentual}%` : "Domingo com acréscimo";
}

// --- Caixa de acréscimo do /admin (Agendar e Alterar) ---

// Mesmo visual do dia com acréscimo no calendário (borda escura + âmbar 100);
// a grade do Agendar e a do Alterar usam esta constante.
export const CLASSE_GRADE_ACRESCIMO = "border-2 border-heading/60 bg-amber-100 text-on-card";

// A caixa "Acréscimo de domingo (N%)" aparece? Só em domingo, fora de par, com
// percentual do salão válido e quando o domingo tem marca no calendário
// (diaTemAcrescimo) OU a reserva já leva acréscimo gravado (temAtual).
export function caixaAcrescimoVisivel({ data, ehPar, percentual, domingoTemMarca, temAtual }) {
  return (
    ehDomingoISO(data) &&
    !ehPar &&
    percentualValido(percentual) &&
    Boolean(domingoTemMarca || temAtual)
  );
}

// Valor inicial da caixa no Alterar. Invisível = sem acréscimo. Data/horário
// mudados: vale a regra do novo horário (mapa CRU); senão mantém o que a linha
// já tem.
export function inicialAcrescimoAlterar({
  ag,
  visivel,
  dataOuHorarioMudou,
  data,
  percentual,
  mapa,
  horario,
}) {
  if (!visivel) return false;
  if (dataOuHorarioMudou) {
    return acrescimoDoAdmin({
      data,
      ehPar: false,
      percentual,
      mapa,
      horario,
      profissionalId: ag?.profissional_id,
    });
  }
  return agendamentoTemAcrescimo(ag);
}

// p_acrescimo_domingo de agendamento_alterar_com_acrescimo: true liga, false
// limpa, null não mexe (igual ao que a linha já tem).
export function parametroAcrescimoAlterar({ temAtual, aplicar }) {
  const acao = comparaAcrescimo({ temAtual, temNovo: aplicar });
  if (acao === "ligar") return true;
  if (acao === "desligar") return false;
  return null;
}

// Há algo a gravar no modal Alterar? Serviço novo, data/horário novos ou só a
// caixa de acréscimo (parametro true/false; null = a caixa não muda nada).
export function haAlteracaoNoModal({ temServicoNovo, dataMudou, parametro }) {
  return Boolean(temServicoNovo) || Boolean(dataMudou) || parametro === true || parametro === false;
}

// Escolha manual da dona só vale para a chave em que foi feita (data|horário|
// profissional); mudou a chave, volta ao automático sem precisar de efeito.
export function escolhaVigente({ escolha, chave, automatico }) {
  return escolha?.chave === chave ? escolha.valor : automatico;
}
