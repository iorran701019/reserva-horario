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
