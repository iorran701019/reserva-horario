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
