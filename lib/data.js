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

// Resumo de uma linha do agendamento: "Nome · Serviço · com Fulana · 27/08 ·
// quarta-feira às 14:00". Nasceu dentro de BlocoConfirmacaoPix (topo da tela
// de Pix) e veio pra cá quando a etapa "dados" do /admin passou a mostrar o
// mesmo resumo antes do botão de confirmar — os dois consumidores montam a
// MESMA string, então a formatação mora num lugar só.
//
// Data e horário andam JUNTOS num único trecho porque formatarData já traz um
// "·" dentro (dd/mm · dia da semana) e separar os dois com outro "·" viraria
// uma fileira de pontos. Cada trecho ausente é descartado em vez de virar
// vazio — daí o filter, e não um template fixo; o "às" também só entra se
// houver data, senão sobraria um "às 14:00" solto.
//
// profissionalNome é OPCIONAL e sai prefixado por "com " (sem isso ele seria
// só mais um nome solto entre pontos, indistinguível do nome da cliente).
// Vazio/undefined => a string sai idêntica à de antes deste parâmetro existir,
// que é o caso do fluxo público (ver BlocoConfirmacaoPix).
export function montarResumoAgendamento({
  nomeCliente = "",
  servicoNome = "",
  data = "",
  horario = "",
  profissionalNome = "",
} = {}) {
  const dataFormatada = formatarData(data);
  const horarioCurto = formatarHorario(horario);
  const horarioTrecho = dataFormatada ? `às ${horarioCurto}` : horarioCurto;
  const quando = [dataFormatada, horarioCurto && horarioTrecho]
    .filter(Boolean)
    .join(" ");

  return [
    nomeCliente,
    servicoNome,
    profissionalNome && `com ${profissionalNome}`,
    quando,
  ]
    .filter(Boolean)
    .join(" · ");
}
