import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { STATUS_SUCESSO } from "@/lib/particao";

// Gravações da conclusão de um atendimento, feitas pela dona no /admin (aba
// Pendentes > "Aguardando Conclusão" e botão "Editar" dos concluídos no Histórico — ver
// components/CardConclusaoAtendimento.js). O caminho automático não passa por
// aqui: o cron (concluir_agendamentos_confirmados_vencidos, jobid 5) grava
// sozinho status "concluido" + concluido_automaticamente=true depois de
// estabelecimentos.confirmado_expira_horas.
//
// Desde a aba Financeiro o cron também grava valor_cobrado_centavos:
// servicos.preco_centavos + os ajustes das perguntas respondidas
// (agendamento_respostas -> servico_pergunta_opcoes.ajuste_preco_centavos),
// e NULL quando o agendamento não tem servico_id (servico_livre, sem preço de
// referência nenhum — nunca inventa valor). Duas ressalvas que valem pra
// quem for mexer aqui:
//   - o cron só preenche o valor quando ele ainda está NULL, então nada do
//     que for gravado por este arquivo é sobrescrito por ele depois;
//   - o valor cheio de manutenção vencida (calcularPrecoManutencao) não é
//     reconstruível em SQL e fica de fora da conta do cron, do mesmo jeito
//     que já fica de fora do valor padrão do card.
//
// Todas devolvem { ok, erro }, com `erro` já pronto pra tela. .select("id")
// + checagem de 0 linhas pelo mesmo motivo de sempre (ver lib/erroSalvar):
// um UPDATE barrado por RLS volta com error null e ZERO linhas, e sem a
// contagem a tela diria "salvo" em cima de um banco que não gravou nada.
//
// O filtro de status nas duas primeiras (confirmado ou concluido) também
// serve de trava: se o agendamento foi cancelado em outra aba no meio do
// caminho, a gravação não acha a linha e a dona vê o erro em vez de
// "ressuscitar" um cancelado.

// `extras` (opcional, nas três gravações) são campos que o card grava no MESMO
// UPDATE da ação, nunca numa gravação separada:
//   sinal_declarado_pago – a resposta de "A cliente pagou mesmo o sinal Pix?",
//     quando o agendamento teve sinal. sinal_valor_centavos não é mandado pelo
//     card: o valor fica preservado mesmo com a resposta "não".
//   forma_pagamento_servico – 'pix' | 'dinheiro' | 'credito' | 'debito' ou
//     null (não informada; os relatórios tratam null como pix).
// Chave ausente = coluna não tocada; o spread só leva o que veio.

function resultado(error, linhas) {
  if (error || !linhas?.length) {
    return { ok: false, erro: `Não foi possível salvar: ${mensagemFalhaSalvar(error)}` };
  }
  return { ok: true, erro: null };
}

// "Sim, concluiu normalmente" ANTES do cron: grava a conclusão manual e o
// valor cobrado num UPDATE só. concluido_automaticamente não é tocado — fica
// false, que é justamente o que distingue a conclusão manual da automática.
// Se o cron já tiver concluído no meio do caminho, a linha ainda casa com o
// filtro (concluido) e só o valor é atualizado — sobrescrevendo, de
// propósito, o valor que o cron tiver calculado: a palavra da dona vale mais
// que o preço de tabela.
export async function concluirAgendamento(agendamentoId, valorCentavos, extras = {}) {
  const { data, error } = await supabase
    .from("agendamentos")
    .update({ ...extras, status: "concluido", valor_cobrado_centavos: valorCentavos })
    .eq("id", agendamentoId)
    .in("status", STATUS_SUCESSO)
    .select("id");

  return resultado(error, data);
}

// "Não compareceu": a falta vira cancelamento (status cancelado +
// nao_compareceu=true). cancelado_por_cliente não é tocado, então nem o
// trigger de pendência de cancelamento nem o push da rota de notificações
// disparam — quem registra a falta é a própria dona.
// Aqui só os campos do sinal fazem sentido em `extras` (sinal não pago de
// verdade não pode virar "sinal retido" nos Relatórios).
export async function marcarNaoCompareceu(agendamentoId, extras = {}) {
  const { data, error } = await supabase
    .from("agendamentos")
    .update({ ...extras, nao_compareceu: true, status: "cancelado" })
    .eq("id", agendamentoId)
    .in("status", STATUS_SUCESSO)
    .select("id");

  return resultado(error, data);
}

// Corrige só o valor cobrado de um atendimento já concluído (botão "Editar"
// do Histórico, inclusive depois de concluido_automaticamente=true).
// `valorCentavos` null limpa o valor.
export async function registrarValorCobrado(agendamentoId, valorCentavos, extras = {}) {
  const { data, error } = await supabase
    .from("agendamentos")
    .update({ ...extras, valor_cobrado_centavos: valorCentavos })
    .eq("id", agendamentoId)
    .select("id");

  return resultado(error, data);
}
