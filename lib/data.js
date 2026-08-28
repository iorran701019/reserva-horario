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


// "YYYY-MM-DD" (date do Postgres) -> "DD/MM/AAAA". Monta o Date por partes
// (nunca new Date("YYYY-MM-DD"), que seria interpretada como UTC e desloca o
// dia em GMT-3) — mesma convenção do resto do projeto.
//
// Morava em components/GerenciarClientes.js. Veio pra cá quando
// CarrosselAgendamentos passou a precisar dela: o carrossel é importado PELO
// GerenciarClientes, então importar de volta de lá fecharia um ciclo de
// módulos — mesmo motivo de formatarData acima.
export function formatarDataBR(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// "HH:MM:SS"/"HH:MM" -> "HH:MM". Mesma origem de formatarDataBR acima.
export function formatarHorario(horario) {
  return horario ? String(horario).slice(0, 5) : "";
}
