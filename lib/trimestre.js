// Trimestres fixos de calendário (jan/fev/mar, abr/mai/jun, jul/ago/set,
// out/nov/dez), usados pela navegação por trimestre do Histórico (admin
// geral e ficha do cliente — ver components/NavegacaoTrimestre.js e
// lib/useNavegacaoTrimestre.js). Independem de ano fiscal: sempre os 4
// blocos de 3 meses do calendário civil.
const ROTULOS_TRIMESTRE = ["jan/fev/mar", "abr/mai/jun", "jul/ago/set", "out/nov/dez"];

// Chave estável e ordenável (string) do trimestre de uma data "YYYY-MM-DD".
// Comparação lexicográfica já dá a ordem cronológica correta: o índice do
// trimestre é sempre 1 dígito (0-3), então "2026-2" < "2026-3" < "2027-0"
// funciona como comparação de string direto, sem parsing.
export function chaveTrimestre(dataStr) {
  const ano = Number(dataStr.slice(0, 4));
  const mes = Number(dataStr.slice(5, 7));
  const indice = Math.floor((mes - 1) / 3);
  return `${ano}-${indice}`;
}

function partesChave(chave) {
  const [ano, indice] = chave.split("-").map(Number);
  return { ano, indice };
}

// Chave do trimestre corrente, pela data de hoje (ou `agora` injetado em teste).
export function trimestreDeHoje(agora = new Date()) {
  const indice = Math.floor(agora.getMonth() / 3);
  return `${agora.getFullYear()}-${indice}`;
}

// Rótulo exibido (ex: "jul/ago/set", ou "jul/ago/set de 2025" quando o ano
// não é o ano corrente — evita ambiguidade em histórico de cliente antigo,
// sem poluir o caso comum de navegar dentro do ano atual).
export function rotuloTrimestre(chave, agora = new Date()) {
  const { ano, indice } = partesChave(chave);
  const meses = ROTULOS_TRIMESTRE[indice];
  return ano === agora.getFullYear() ? meses : `${meses} de ${ano}`;
}
