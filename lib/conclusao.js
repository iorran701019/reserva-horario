import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { STATUS_SUCESSO } from "@/lib/particao";

// Gravações da conclusão de um atendimento, feitas pela dona no /admin (aba
// Pendentes > "Aguardando Conclusão" e botão "Editar" dos concluídos no Histórico — ver
// components/CardConclusaoAtendimento.js). O caminho automático não passa por
// aqui: o cron grava status "concluido" + concluido_automaticamente=true
// sozinho depois de estabelecimentos.confirmado_expira_horas.
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
// filtro (concluido) e só o valor é atualizado.
export async function concluirAgendamento(agendamentoId, valorCentavos) {
  const { data, error } = await supabase
    .from("agendamentos")
    .update({ status: "concluido", valor_cobrado_centavos: valorCentavos })
    .eq("id", agendamentoId)
    .in("status", STATUS_SUCESSO)
    .select("id");

  return resultado(error, data);
}

// "Não compareceu": a falta vira cancelamento (status cancelado +
// nao_compareceu=true). cancelado_por_cliente não é tocado, então nem o
// trigger de pendência de cancelamento nem o push da rota de notificações
// disparam — quem registra a falta é a própria dona.
export async function marcarNaoCompareceu(agendamentoId) {
  const { data, error } = await supabase
    .from("agendamentos")
    .update({ nao_compareceu: true, status: "cancelado" })
    .eq("id", agendamentoId)
    .in("status", STATUS_SUCESSO)
    .select("id");

  return resultado(error, data);
}

// Corrige só o valor cobrado de um atendimento já concluído (botão "Editar"
// do Histórico, inclusive depois de concluido_automaticamente=true).
// `valorCentavos` null limpa o valor.
export async function registrarValorCobrado(agendamentoId, valorCentavos) {
  const { data, error } = await supabase
    .from("agendamentos")
    .update({ valor_cobrado_centavos: valorCentavos })
    .eq("id", agendamentoId)
    .select("id");

  return resultado(error, data);
}
