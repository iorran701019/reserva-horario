// Configuração da loja e cálculo de horários.
//
// A disponibilidade NÃO é guardada no banco: os horários possíveis de um dia
// são SEMPRE calculados por gerarSlots(). O que vem do banco é só quais desses
// horários já estão ocupados.

// --- Constantes da loja (mexa aqui pra mudar a operação) ---

export const HORA_ABERTURA = "09:00";
export const HORA_FECHAMENTO = "18:00";
export const DURACAO_MINUTOS = 40;

// Dias de funcionamento no padrão de Date.getDay(): 0=domingo ... 6=sábado.
// Hoje: segunda a sábado. Domingo (0) fica de fora => loja fechada.
export const DIAS_FUNCIONAMENTO = [1, 2, 3, 4, 5, 6];

// --- Helpers internos ---

// "09:00" -> 540 (minutos desde a meia-noite).
function horaParaMinutos(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// 540 -> "09:00".
function minutosParaHora(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Lê "YYYY-MM-DD" e devolve o dia da semana em horário LOCAL.
// Construir a partir dos componentes evita o deslocamento de fuso que
// new Date("YYYY-MM-DD") sofre ao interpretar a string como UTC.
function diaDaSemana(data) {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(ano, mes - 1, dia).getDay();
}

// --- API pública ---

// A loja abre nesse dia? (true para segunda a sábado, false no domingo.)
export function estaAberto(data) {
  if (!data) return false;
  return DIAS_FUNCIONAMENTO.includes(diaDaSemana(data));
}

// Função PURA: dado "YYYY-MM-DD", retorna os horários "HH:MM" do dia.
// Parte de HORA_ABERTURA e soma DURACAO_MINUTOS enquanto
// (slot + DURACAO_MINUTOS) <= HORA_FECHAMENTO. Domingo (fechado) => [].
export function gerarSlots(data) {
  if (!estaAberto(data)) return [];

  const slots = [];
  const abertura = horaParaMinutos(HORA_ABERTURA);
  const fechamento = horaParaMinutos(HORA_FECHAMENTO);

  for (
    let minutos = abertura;
    minutos + DURACAO_MINUTOS <= fechamento;
    minutos += DURACAO_MINUTOS
  ) {
    slots.push(minutosParaHora(minutos));
  }

  return slots;
}
