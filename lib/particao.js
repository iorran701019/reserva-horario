// Partição DERIVADA dos agendamentos. NÃO existe status novo no banco: a aba
// onde um item aparece é SEMPRE calculada aqui, a partir do status atual + do
// fim do atendimento comparado ao "agora". Regra num lugar só — quem renderiza
// (lista, calendário) importa daqui, não reimplementa.

import { DURACAO_MINUTOS } from "@/lib/horarios";

// Status gravados que significam "atendimento fechado com sucesso".
// "confirmado" e "concluido" são IRMÃOS, não etapas: todo filtro que antes
// só reconhecia "confirmado" (fidelidade, manutenção sugerida, último
// atendimento, histórico, Google Calendar...) usa esta lista, pra um
// agendamento não "sumir" dessas regras quando o cron (ou a dona) grava a
// conclusão. Fonte única — não repetir o par à mão em cada query.
export const STATUS_SUCESSO = ["confirmado", "concluido"];

export function ehStatusSucesso(status) {
  return STATUS_SUCESSO.includes(status);
}

// Este agendamento teve sinal pago (ou declarado)? Fonte única — não repetir
// a checagem à mão. Basta `sinal_declarado_pago`: TODO caminho que registra o
// sinal grava true nele — o Pix confirmado pela AbacatePay
// (confirmarPagamentoPix, que grava junto abacatepay_pago_em), o gesto manual
// do BlocoConfirmacaoPix (checkbox ou comprovante) e a remarcação de reserva
// paga —, e nada volta ele pra false depois. Ressalva: no fluxo manual sem
// comprovante, true é a palavra da cliente, não um pagamento conferido.
export function temSinal(item) {
  return item.sinal_declarado_pago === true;
}

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

// Instante a partir do qual um agendamento `confirmado` deve ser tratado como
// CONCLUÍDO — o mesmo relógio do cron concluir_agendamentos_confirmados_vencidos,
// que é quem de fato grava o status. Fonte única: quem monta relatório importa
// daqui em vez de comparar fimDoAtendimento com "agora" na mão.
//
// Depende do salão, não só do item:
//   conclusao_manual_ativa = false — não existe janela de revisão (a dona nem
//     vê a aba "Conclusão"), então o atendimento vira concluído assim que
//     TERMINA. confirmado_expira_horas não entra na conta.
//   conclusao_manual_ativa = true  — a dona tem confirmado_expira_horas horas
//     depois do fim pra dizer se concluiu ou se a cliente faltou. Antes desse
//     prazo o desfecho ainda não está decidido e o item não conta em lugar
//     nenhum.
//
// Ressalva do prazo ausente: com a revisão ligada e confirmado_expira_horas
// nulo/inválido (o select de Configurações mostra "Não configurado"), cai em
// carência ZERO — mesmo resultado do caminho automático. É deliberadamente o
// comportamento que o app já tinha antes deste helper, pra um salão mal
// configurado não sumir dos relatórios pra sempre.
export function fimDaRevisaoDeConclusao(item, estabelecimento) {
  const fim = fimDoAtendimento(item);

  if (!estabelecimento?.conclusao_manual_ativa) return fim;

  const horas = Number(estabelecimento?.confirmado_expira_horas);
  if (!(horas > 0)) return fim;

  return new Date(fim.getTime() + horas * 60 * 60 * 1000);
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
//   "historico"  — cancelado, concluido, OU já terminou (fim < agora). O
//                  status ORIGINAL não muda; quem renderiza decide o rótulo.
//   "inbox"      — pendente e ainda no futuro (precisa de ação do dono).
//   "confirmado" — confirmado e ainda no futuro.
//
// "concluido" é status IRMÃO de "confirmado" (não sequencial): gravado pelo
// cron depois de confirmado_expira_horas, ou pela dona na aba "Aguardando
// confirmação". Por construção é sempre passado, mas vai direto pro
// histórico sem depender do relógio — mesmo tratamento de "cancelado".
export function classificarAgendamento(item, agora = new Date()) {
  if (item.status === "cancelado" || item.status === "concluido") return "historico";

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
//   concluido                             -> "concluido" (gravado no banco)
//   pendente (ou desconhecido)            -> "caducado" (passou sem confirmar)
// SEM branch pra "confirmado", de propósito: nenhum Histórico recebe
// confirmado (futuro é Painel, passado sem decisão é "Aguardando
// confirmação"). Mapear confirmado -> "concluido" aqui foi o que escondeu um
// confirmado rotulado como atendido; se um voltar a vazar, cai em "caducado"
// e fica visível como erro em vez de passar por Concluído.
export function rotuloHistorico(item) {
  if (item.status === "cancelado") {
    return item.expirado_automaticamente ? "expirado" : "cancelado";
  }
  if (item.status === "concluido") return "concluido";
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
