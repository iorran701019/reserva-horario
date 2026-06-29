// Configuração da loja e cálculo de horários.
//
// A disponibilidade NÃO é guardada no banco: os horários possíveis de um dia
// são SEMPRE calculados por gerarSlots(). O que vem do banco é só quais desses
// horários já estão ocupados.

// --- Constantes da loja (mexa aqui pra mudar a operação) ---

export const HORA_ABERTURA = "09:00";
export const HORA_FECHAMENTO = "18:00";
export const DURACAO_MINUTOS = 40;

// Passo fixo da grade de horários: os candidatos saem de GRANULARIDADE_MIN em
// GRANULARIDADE_MIN (09:00, 09:30, 10:00...), independente da duração do
// serviço. (Constante por enquanto; vira config do dono no DB depois.)
export const GRANULARIDADE_MIN = 30;

// Dias de funcionamento no padrão de Date.getDay(): 0=domingo ... 6=sábado.
// Hoje: segunda a sábado. Domingo (0) fica de fora => loja fechada.
export const DIAS_FUNCIONAMENTO = [1, 2, 3, 4, 5, 6];

// WhatsApp da barbearia em formato internacional (DDI + DDD + número).
// Valor vem da variável de ambiente NEXT_PUBLIC_WHATSAPP_LOJA.
export const WHATSAPP_LOJA = process.env.NEXT_PUBLIC_WHATSAPP_LOJA;

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
// A grade é FIXA: candidatos saem de HORA_ABERTURA até HORA_FECHAMENTO com
// passo GRANULARIDADE_MIN (09:00, 09:30, ...), independente da duração do
// serviço. Só emite o candidato `m` se o serviço ainda termina dentro do
// expediente, ou seja, m + duracaoMin <= HORA_FECHAMENTO — assim um serviço
// longo (ex.: 2h) não é oferecido em horários que ultrapassam o fechamento.
// Domingo (fechado) => []. duracaoMin cai em DURACAO_MINUTOS se ausente.
export function gerarSlots(data, duracaoMin = DURACAO_MINUTOS) {
  if (!estaAberto(data)) return [];

  // Duração inválida (0, negativa, NaN) cairia no padrão da loja.
  const duracao = Number(duracaoMin) > 0 ? Number(duracaoMin) : DURACAO_MINUTOS;

  const slots = [];
  const abertura = horaParaMinutos(HORA_ABERTURA);
  const fechamento = horaParaMinutos(HORA_FECHAMENTO);

  for (
    let minutos = abertura;
    minutos + duracao <= fechamento;
    minutos += GRANULARIDADE_MIN
  ) {
    slots.push(minutosParaHora(minutos));
  }

  return slots;
}
