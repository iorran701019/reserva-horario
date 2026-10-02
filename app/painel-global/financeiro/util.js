// Helpers da aba Financeiro do /painel-global. Tudo aqui é puro (sem React).
//
// Datas "YYYY-MM-DD" do banco (competencia, vencimento, inicio_cobranca) nunca
// passam por new Date('YYYY-MM-DD') — isso interpreta como UTC e, em
// America/Sao_Paulo, cai no dia anterior. Sempre new Date(ano, mes - 1, dia).

const FUSO = "America/Sao_Paulo";

export const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

// Primeiro mês permitido para início de cobrança e de condição (check no banco).
export const MES_MINIMO = "2026-09-01";

function dd(n) {
  return String(n).padStart(2, "0");
}

// Hoje em America/Sao_Paulo (e não no fuso do navegador de quem abre o painel).
export function hojeSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const pega = (tipo) => Number(partes.find((p) => p.type === tipo).value);
  return { ano: pega("year"), mes: pega("month"), dia: pega("day") };
}

// "YYYY-MM-DD" de hoje em São Paulo — compara lexicograficamente com vencimento.
export function hojeStr(agora = new Date()) {
  const { ano, mes, dia } = hojeSaoPaulo(agora);
  return `${ano}-${dd(mes)}-${dd(dia)}`;
}

// Competência (dia 1) do mês corrente, "YYYY-MM-01".
export function competenciaAtual(agora = new Date()) {
  const { ano, mes } = hojeSaoPaulo(agora);
  return `${ano}-${dd(mes)}-01`;
}

// Soma `n` meses a uma competência "YYYY-MM-01" (aritmética de ano/mês, sem Date).
export function somarMeses(competencia, n) {
  const [ano, mes] = competencia.split("-").map(Number);
  const total = ano * 12 + (mes - 1) + n;
  return `${Math.floor(total / 12)}-${dd((total % 12) + 1)}-01`;
}

// Quantos meses à frente as faturas são geradas automaticamente.
export const MESES_A_FRENTE = 3;

// Até onde gerar automaticamente: o maior entre (mês corrente + 3) e (início
// da cobrança do salão + 3), para que um início futuro não fique sem faturas.
export function horizonteGeracao(inicioCobranca) {
  const base = somarMeses(competenciaAtual(), MESES_A_FRENTE);
  if (!inicioCobranca) return base;
  const doInicio = somarMeses(inicioCobranca, MESES_A_FRENTE);
  return doInicio > base ? doInicio : base;
}

// "YYYY-MM-DD" -> Date local (meio-dia não é necessário: só formatamos).
export function dataLocal(str) {
  const [ano, mes, dia] = str.slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

export function formatarData(str) {
  if (!str) return "—";
  return dataLocal(str).toLocaleDateString("pt-BR");
}

// "outubro/2026"
export function rotuloCompetencia(str) {
  const [ano, mes] = str.split("-").map(Number);
  return `${MESES[mes - 1]}/${ano}`;
}

// Timestamp (timestamptz) -> "dd/mm/aaaa" no fuso de São Paulo.
export function formatarInstante(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO });
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarBRL(centavos) {
  return brl.format((centavos ?? 0) / 100);
}

// Centavos -> texto de input ("100,00"), sem o símbolo da moeda.
export function centavosParaInput(centavos) {
  return ((centavos ?? 0) / 100).toFixed(2).replace(".", ",");
}

// Texto digitado em R$ -> centavos inteiros, ou null se inválido.
// Aceita "100", "100,5", "1.000,50", "1000.50".
export function inputParaCentavos(texto) {
  let t = String(texto ?? "").replace(/[^\d,.]/g, "");
  if (!t) return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// Valor vigente para uma competência: condição que a cobre, senão o padrão.
// Períodos podem se sobrepor: vale a cadastrada por último (maior id).
export function valorDaCompetencia(competencia, assinatura, condicoes) {
  const cond = condicoes
    .filter(
      (c) =>
        c.competencia_inicio <= competencia &&
        (!c.competencia_fim || c.competencia_fim >= competencia)
    )
    .reduce((a, c) => (!a || c.id > a.id ? c : a), null);
  return cond ? cond.valor_centavos : assinatura.valor_padrao_centavos;
}

export function faturaVencida(fatura, hoje) {
  return fatura.status === "aberta" && fatura.vencimento < hoje;
}

export const ROTULO_STATUS = {
  aberta: "Aberta",
  paga: "Paga",
  isenta: "Isenta",
  cancelada: "Cancelada",
};

// Classes de badge por status (tokens de cor do tema, sem hex).
export function classeBadge(fatura, hoje) {
  if (faturaVencida(fatura, hoje)) return "bg-red-50 text-red-700 ring-red-200";
  if (fatura.status === "paga") return "bg-green-50 text-green-700 ring-green-200";
  if (fatura.status === "aberta") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (fatura.status === "isenta") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-surface text-muted ring-border";
}
