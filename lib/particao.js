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

// Date do INÍCIO do atendimento, em horário LOCAL. Mesma construção
// componente-a-componente de fimDoAtendimento acima (item.data + item.horario),
// só que sem somar a duração — usada por quem precisa saber quanto falta até o
// horário marcado (ver PainelCliente, prazo de cancelamento).
export function inicioDoAtendimento(item) {
  const [ano, mes, dia] = item.data.split("-").map(Number);
  const [h, m] = item.horario.slice(0, 5).split(":").map(Number);

  return new Date(ano, mes - 1, dia, h, m);
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

// Este item é um agendamento CONFIRMADO que ainda vai acontecer? Regra pura,
// fonte única das tags "Agendado"/"Sem agenda" (lista de Clientes e cards do
// Histórico). Não basta olhar o status cru: ele não vira histórico sozinho
// quando o horário passa — quem sabe disso é classificarAgendamento.
export function ehAgendamentoConfirmadoFuturo(item, agora) {
  return item.status === "confirmado" && classificarAgendamento(item, agora) === "confirmado";
}

// Categoria de exibição de um item já em "historico" (ver classificarAgendamento
// acima). O status ORIGINAL não muda no banco — isto é só rótulo derivado.
// Fonte única: admin geral (aba Histórico) e ficha do cliente (GerenciarClientes)
// importam daqui em vez de reimplementar a regra cada um do seu jeito.
//   cancelado (expirado_automaticamente) -> "expirado" (cron de reserva provisória)
//   cancelado (demais)                    -> "cancelado"
//   confirmado                            -> "concluido" (atendido)
//   pendente (ou desconhecido)            -> "caducado" (passou sem confirmar)
export function rotuloHistorico(item) {
  if (item.status === "cancelado") {
    return item.expirado_automaticamente ? "expirado" : "cancelado";
  }
  if (item.status === "confirmado") return "concluido";
  return "caducado";
}

// Prioridade de exibição dentro de um trimestre do Histórico: Expirado
// primeiro, depois Cancelado (manual), depois Concluído/Vencido (mesmo
// grupo — a ordem cronológica entre os dois é preservada pelo sort estável).
const PRIORIDADE_HISTORICO = { expirado: 0, cancelado: 1, concluido: 2, caducado: 2 };

// Reordena por status (ver PRIORIDADE_HISTORICO acima), preservando a ordem
// cronológica relativa dentro de cada grupo. Array.prototype.sort é estável,
// então basta ordenar só pela prioridade sobre uma lista que já chegou na
// ordem cronológica desejada (mais recente primeiro, ou o padrão de quem chama).
export function ordenarHistoricoPorStatus(lista) {
  return [...lista].sort(
    (a, b) => PRIORIDADE_HISTORICO[rotuloHistorico(a)] - PRIORIDADE_HISTORICO[rotuloHistorico(b)]
  );
}
