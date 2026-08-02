import { supabase } from "@/lib/supabaseClient";
import { classificarAgendamento, inicioDoAtendimento } from "@/lib/particao";
import { buscarClientes } from "@/lib/clientesAdmin";

// Tipo reservado em pendencias_admin pro card de brinde de fidelidade
// disponível (ver TIPOS_PENDENCIA em app/[salon]/admin/page.js).
const TIPO_PENDENCIA_FIDELIDADE = "fidelidade_disponivel";

// Verifica o programa de fidelidade (ver sql/estabelecimentos_fidelidade.sql)
// de todo o salão e cria as pendências novas. Chamada ao carregar a aba
// Pendentes do /admin, mesmo ponto onde buscarPendenciasAdmin roda — o INSERT
// sai pela sessão autenticada do dono, coberto pela mesma policy
// "pendencias_admin_admin_all" (ver sql/pendencias_admin.sql).
//
// Fidelidade é 100% DERIVADA: nenhum contador persistido. Pra cada cliente,
// conta quantos agendamentos "concluídos" — status confirmado E já passou do
// horário, nunca um status gravado (ver classificarAgendamento em
// lib/particao.js, mesma regra de buscarUltimoAtendimento em
// lib/clientesAdmin.js) — ele teve desde o último fidelidade_resgates (ou
// desde sempre, se nunca resgatou). Com fidelidade_conta_manutencao=false,
// serviços com eh_manutencao=true ficam de fora dessa contagem. Bateu
// fidelidade_meta_servicos e ainda não existe uma pendência
// 'fidelidade_disponivel' em aberto pra essa cliente? Cria uma nova.
//
// Sem fidelidade_ativa ou sem fidelidade_meta_servicos configurada, não faz
// nada. Todas as buscas são EM BULK (uma query por tabela, agrupada em JS) —
// mesmo padrão de buscarRespostasPorAgendamento, nunca uma query por cliente.
export async function verificarFidelidadeClientes(estabelecimentoId) {
  const { data: estab, error: erroEstab } = await supabase
    .from("estabelecimentos")
    .select(
      "fidelidade_ativa, fidelidade_conta_manutencao, fidelidade_meta_servicos, fidelidade_descricao_brinde"
    )
    .eq("id", estabelecimentoId)
    .single();

  if (erroEstab || !estab?.fidelidade_ativa || !estab.fidelidade_meta_servicos) return;

  const clientes = await buscarClientes(estabelecimentoId);
  if (clientes.length === 0) return;

  const [{ data: resgates }, { data: agendamentos }, { data: pendenciasAbertas }] =
    await Promise.all([
      supabase
        .from("fidelidade_resgates")
        .select("cliente_id, criado_em")
        .eq("estabelecimento_id", estabelecimentoId)
        .order("criado_em", { ascending: false }),
      supabase
        .from("agendamentos")
        .select("telefone, data, horario, duracao_min, status, servicos(eh_manutencao)")
        .eq("estabelecimento_id", estabelecimentoId)
        .eq("status", "confirmado"),
      supabase
        .from("pendencias_admin")
        .select("cliente_id")
        .eq("estabelecimento_id", estabelecimentoId)
        .eq("tipo", TIPO_PENDENCIA_FIDELIDADE)
        .eq("resolvido", false),
    ]);

  // Query já vem mais-recente-primeiro: a primeira ocorrência de cada
  // cliente_id é o último resgate dele.
  const ultimoResgatePorCliente = new Map();
  for (const resgate of resgates ?? []) {
    if (!ultimoResgatePorCliente.has(resgate.cliente_id)) {
      ultimoResgatePorCliente.set(resgate.cliente_id, new Date(resgate.criado_em));
    }
  }

  const clientesComPendenciaAberta = new Set(
    (pendenciasAbertas ?? []).map((item) => item.cliente_id)
  );

  // Só os concluídos de fato (status confirmado + já passou do horário —
  // exclui pendente caducado e cancelado).
  const concluidos = (agendamentos ?? []).filter(
    (item) => classificarAgendamento(item) === "historico"
  );

  for (const cliente of clientes) {
    if (!cliente.whatsapp || clientesComPendenciaAberta.has(cliente.id)) continue;

    const desde = ultimoResgatePorCliente.get(cliente.id) ?? null;

    const contagem = concluidos.filter((item) => {
      if (item.telefone !== cliente.whatsapp) return false;
      if (!estab.fidelidade_conta_manutencao && item.servicos?.eh_manutencao) return false;
      if (desde && inicioDoAtendimento(item) <= desde) return false;
      return true;
    }).length;

    if (contagem < estab.fidelidade_meta_servicos) continue;

    const { error: erroInsert } = await supabase.from("pendencias_admin").insert({
      estabelecimento_id: estabelecimentoId,
      tipo: TIPO_PENDENCIA_FIDELIDADE,
      titulo: `${cliente.nome} completou ${estab.fidelidade_meta_servicos} serviços`,
      descricao: estab.fidelidade_descricao_brinde || null,
      cliente_id: cliente.id,
    });

    if (erroInsert) {
      console.error("verificarFidelidadeClientes: falha ao criar pendência", erroInsert);
    }
  }
}
