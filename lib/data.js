// "YYYY-MM-DD" -> "dd/mm · dia da semana".
//
// Morava em components/FormularioAgendamento.js (que continua reexportando,
// pros importadores antigos). Foi pra cá quando BlocoConfirmacaoPix passou a
// precisar dela pro resumo do agendamento: o bloco é importado PELO
// FormularioAgendamento, então importar de volta de lá fecharia um ciclo de
// módulos — mesmo motivo que trouxe formatarPreco pra lib/preco.js.
const DIAS_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

// Parse manual pra evitar o deslocamento de fuso que new Date("YYYY-MM-DD")
// sofre (vira UTC).
export function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")} · ${DIAS_SEMANA[d.getDay()]}`;
}
