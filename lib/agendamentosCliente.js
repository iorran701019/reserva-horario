import { supabase } from "@/lib/supabaseClient";

// Agendamentos ATIVOS (pendente ou confirmado) de um cliente num salão,
// identificado pelo telefone (dígitos). Usado pelo PainelCliente no fluxo
// público para mostrar o que já está marcado antes de abrir um novo wizard.
// Erro de rede/consulta não quebra a tela: devolve lista vazia.
export async function buscarAgendamentosAtivos(estabelecimentoId, telefoneDigitos) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, status, servico_id, servicos(nome)")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .in("status", ["pendente", "confirmado"])
    .order("data")
    .order("horario");

  if (error) return [];
  return data ?? [];
}
