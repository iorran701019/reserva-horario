import { supabase } from "@/lib/supabaseClient";
import { classificarAgendamento } from "@/lib/particao";

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
    .select("id, data, horario, status, servico_id, expirado_automaticamente, servicos(nome)")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .in("status", ["pendente", "confirmado", "aguardando_sinal", "cancelado"])
    .gte("data", dataLimite)
    .order("data", { ascending: false })
    .order("horario", { ascending: false });

  if (error) return [];
  return data ?? [];
}

// Quais dos `telefones` (dígitos) têm agendamento PENDENTE ativo no salão.
// Devolve um Set com os telefones que têm — os demais simplesmente não
// aparecem. Usada pela busca de cliente por nome do admin (ver
// IdentificacaoClienteAdmin) pra marcar o resultado com o selo "pendente"
// antes da dona escolher, em UMA query pros até 8 nomes do dropdown, em vez
// de uma por linha.
//
// Aplica a MESMA regra do inbox da aba Pendentes (ver `inbox` em
// app/[salon]/admin/page.js): status pendente/aguardando_sinal + finalizado
// (exclui reserva antecipada abandonada no meio do wizard) + telefone
// preenchido (exclui importado do Google Calendar sem cliente vinculado) +
// classificarAgendamento === "inbox" (o status cru não vira histórico sozinho
// quando o horário passa, então um pendente caducado ainda vem do banco como
// "pendente" e precisa ser descartado aqui). Se as duas regras divergirem, o
// selo passa a prometer uma pendência que a aba Pendentes não mostra.
//
// duracao_min sai do serviço quando houver (mesmo "elevar ao topo" de
// buscarAgendamentos no admin), com a coluna do próprio agendamento como
// segunda opção — é o que classificarAgendamento lê pra saber se o
// atendimento já terminou.
//
// Erro de rede/consulta não quebra a tela: devolve Set vazio (nenhum selo, o
// fluxo segue como era antes).
export async function buscarPendentesPorTelefones(estabelecimentoId, telefones) {
  const alvos = [...new Set((telefones ?? []).filter(Boolean))];
  if (alvos.length === 0) return new Set();

  const { data, error } = await supabase
    .from("agendamentos")
    .select("telefone, data, horario, status, duracao_min, servicos(duracao_min)")
    .eq("estabelecimento_id", estabelecimentoId)
    .in("telefone", alvos)
    .in("status", ["pendente", "aguardando_sinal"])
    .eq("finalizado", true);

  if (error) return new Set();

  // Um único `agora` pra classificar a lista toda, igual ao render do inbox.
  const agora = new Date();
  const comPendencia = new Set();

  for (const item of data ?? []) {
    // Sem data/horário não dá pra classificar (fimDoAtendimento parseia as
    // duas) — mesmo guard do PainelCalendario.
    if (!item.data || !item.horario) continue;

    const duracao_min = item.servicos?.duracao_min ?? item.duracao_min ?? null;
    if (classificarAgendamento({ ...item, duracao_min }, agora) === "inbox") {
      comPendencia.add(item.telefone);
    }
  }

  return comPendencia;
}
