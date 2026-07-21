import { supabase } from "@/lib/supabaseClient";

// Agendamentos ATIVOS (pendente ou confirmado) de um cliente num salão,
// identificado pelo telefone (dígitos). Usado pelo PainelCliente no fluxo
// público para mostrar o que já está marcado antes de abrir um novo wizard.
// finalizado = true exclui reservas provisórias (ver `agendamentoId` em
// FormularioAgendamento): a reserva antecipada do clique no horário grava
// finalizado false, e só vira true quando a cliente conclui a etapa "Dados".
// Erro de rede/consulta não quebra a tela: devolve lista vazia.
export async function buscarAgendamentosAtivos(estabelecimentoId, telefoneDigitos) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, duracao_min, status, servico_id, servicos(nome)")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .in("status", ["pendente", "confirmado", "aguardando_sinal"])
    .eq("finalizado", true)
    .order("data")
    .order("horario");

  if (error) return [];
  return data ?? [];
}

// Histórico recente (cancelado, ou ativo cujo horário já passou) de um
// cliente num salão, dos últimos `diasLimite` dias. Traz também pendente/
// confirmado/aguardando_sinal porque o status cru não muda sozinho quando o
// atendimento termina — quem decide se já "virou histórico" é
// classificarAgendamento, aplicado pelo chamador (ver PainelCliente). "Hoje
// menos diasLimite" é montado componente-a-componente (nunca
// new Date("YYYY-MM-DD"), que seria interpretada como UTC) — mesma convenção
// de lib/horarios.js e lib/particao.js.
// Erro de rede/consulta não quebra a tela: devolve lista vazia.
export async function buscarHistoricoRecente(
  estabelecimentoId,
  telefoneDigitos,
  diasLimite = 30
) {
  const agora = new Date();
  const limite = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate() - diasLimite
  );
  const ano = limite.getFullYear();
  const mes = String(limite.getMonth() + 1).padStart(2, "0");
  const dia = String(limite.getDate()).padStart(2, "0");
  const dataLimite = `${ano}-${mes}-${dia}`;

  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, status, servico_id, servicos(nome)")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .in("status", ["pendente", "confirmado", "aguardando_sinal", "cancelado"])
    .gte("data", dataLimite)
    .order("data", { ascending: false })
    .order("horario", { ascending: false });

  if (error) return [];
  return data ?? [];
}
