// Meses de calendário "YYYY-MM", usados pela navegação mensal da lista de
// Ausências (ver components/NavegacaoMes.js e lib/useNavegacaoMes.js).
// Mesmo princípio de lib/trimestre.js (Histórico), só que por mês em vez de
// trimestre — arquivo separado pra não mexer no trimestre usado lá.

// Chave estável e ordenável (string) do mês de uma data "YYYY-MM-DD" — os 7
// primeiros caracteres ("YYYY-MM") já comparam lexicograficamente na ordem
// cronológica certa, sem precisar decompor ano/mês.
export function chaveMes(dataStr) {
  return dataStr.slice(0, 7);
}

function partesChave(chave) {
  const [ano, mes] = chave.split("-").map(Number);
  return { ano, mes };
}

// Chave do mês corrente, pela data de hoje (ou `agora` injetado em teste).
export function mesDeHoje(agora = new Date()) {
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

// Rótulo exibido (ex: "agosto", ou "agosto de 2025" quando o ano não é o ano
// corrente — mesma ideia de rotuloTrimestre, evita ambiguidade sem poluir o
// caso comum de navegar dentro do ano atual).
export function rotuloMes(chave, agora = new Date()) {
  const { ano, mes } = partesChave(chave);
  const nomeMes = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
  });
  return ano === agora.getFullYear() ? nomeMes : `${nomeMes} de ${ano}`;
}

// Rótulo POR EXTENSO de um mês por (ano, mes) — "setembro", ou "setembro/26"
// quando o ano não é o corrente. Mesma assinatura e mesma regra de ano de
// rotuloMesCurto (abaixo); existe porque o card de meses do Painel mostra o
// nome inteiro, e "setembro de 2027" (o formato de rotuloMes) não cabe numa
// pílula de 1/3 da largura no celular. Sai em minúsculas — quem exibe
// capitaliza no CSS.
export function rotuloMesLongo(ano, mes, agora = new Date()) {
  const nome = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
  });
  return Number(ano) === agora.getFullYear()
    ? nome
    : `${nome}/${String(ano).slice(-2)}`;
}

// Rótulo curto de um mês por (ano, mes) — "set", ou "set/26" quando o ano não
// é o corrente. Assinatura por ano/mês (e não pela chave "YYYY-MM" das outras
// funções daqui) porque quem usa é a fileira de meses do status mensal da
// agenda, que trabalha com ano/mês numéricos (ver mesesDoAlcance em
// lib/janelaAgendamento.js). Sai em minúsculas, como o pt-BR pede — quem
// quiser capitalizar usa `capitalize` no CSS.
export function rotuloMesCurto(ano, mes, agora = new Date()) {
  const nome = new Date(ano, mes - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "");
  return Number(ano) === agora.getFullYear()
    ? nome
    : `${nome}/${String(ano).slice(-2)}`;
}
