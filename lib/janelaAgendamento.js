// Janela de agendamento: cada salão tem uma data fixa
// (estabelecimentos.janela_agendamento_fim) além da qual nenhum dia pode ser
// agendado, no fluxo público E no /admin. Fonte única da checagem — qualquer
// lugar que decide se um dia é selecionável (calendário do wizard,
// calcularVagasPorHorario) chama a MESMA função, pra nunca divergir.
//
// null/undefined em janela_agendamento_fim = salão ainda não configurou (ou
// migração recente) => SEM restrição, nenhum dia é bloqueado por aqui. A UI
// de configuração (ConfiguracoesSalao) trata o campo como obrigatório pra
// GRAVAR, mas a ausência de valor no banco não pode travar o fluxo de quem
// ainda não configurou.

// "YYYY-MM-DD" -> dentro da janela? Comparação lexicográfica ISO, mesmo
// padrão usado no resto do app pra datas nesse formato (ex.: lib/disponibilidade.js).
export function dentroDaJanelaAgendamento(data, estabelecimento) {
  const fim = estabelecimento?.janela_agendamento_fim;
  if (!fim || !data) return true;
  return data <= fim;
}

// Dias restantes até o fim da janela (pode ser negativo, se já passou).
// null quando a janela não está configurada — quem chama decide o que fazer
// (banner/popup só aparecem com um valor numérico).
export function diasRestantesJanela(janelaFim) {
  if (!janelaFim) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const [ano, mes, dia] = janelaFim.split("-").map(Number);
  const fim = new Date(ano, mes - 1, dia);

  const diffMs = fim.getTime() - hoje.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
