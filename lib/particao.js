// Partição DERIVADA dos agendamentos. NÃO existe status novo no banco: a aba
// onde um item aparece é SEMPRE calculada aqui, a partir do status atual + do
// fim do atendimento comparado ao "agora". Regra num lugar só — quem renderiza
// (lista, calendário) importa daqui, não reimplementa.

import { DURACAO_MINUTOS } from "@/lib/horarios";

// Date do FIM do atendimento, em horário LOCAL. Monta o início a partir de
// item.data ("YYYY-MM-DD") + item.horario ("HH:MM" ou "HH:MM:SS") com os
// componentes locais — NUNCA new Date("YYYY-MM-DD"), que seria interpretada
// como UTC e deslocaria o dia em GMT-3 (mesma convenção de lib/horarios.js e
// dataLocalISO). Soma item.duracao_min minutos; duração ausente/inválida cai
// no padrão da loja (DURACAO_MINUTOS), igual a gerarSlots.
export function fimDoAtendimento(item) {
  const [ano, mes, dia] = item.data.split("-").map(Number);
  const [h, m] = item.horario.slice(0, 5).split(":").map(Number);

  const duracao =
    Number(item.duracao_min) > 0 ? Number(item.duracao_min) : DURACAO_MINUTOS;

  // Somar minutos no construtor do Date normaliza virada de hora/dia.
  return new Date(ano, mes - 1, dia, h, m + duracao);
}

// Função PURA: em qual partição derivada o item se encaixa.
//   "historico"  — cancelado, OU já terminou (fim < agora). O status ORIGINAL
//                  não muda; quem renderiza decide o rótulo.
//   "inbox"      — pendente e ainda no futuro (precisa de ação do dono).
//   "confirmado" — confirmado e ainda no futuro.
export function classificarAgendamento(item, agora = new Date()) {
  if (item.status === "cancelado") return "historico";

  if (fimDoAtendimento(item) < agora) return "historico";

  if (item.status === "pendente" || item.status === "aguardando_sinal") return "inbox";

  return "confirmado";
}
