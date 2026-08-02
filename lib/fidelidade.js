import { supabase } from "@/lib/supabaseClient";
import { classificarAgendamento, inicioDoAtendimento } from "@/lib/particao";
import { buscarClientes } from "@/lib/clientesAdmin";

// Tipo reservado em pendencias_admin pro card de brinde de fidelidade
// disponível (ver TIPOS_PENDENCIA em app/[salon]/admin/page.js).
const TIPO_PENDENCIA_FIDELIDADE = "fidelidade_disponivel";

// Conta quantos agendamentos "concluídos" — status confirmado E já passou do
// horário, nunca um status gravado (ver classificarAgendamento em
// lib/particao.js, mesma regra de buscarUltimoAtendimento em
// lib/clientesAdmin.js) — a cliente teve desde o último fidelidade_resgates
// (ou desde sempre, se nunca resgatou). Com fidelidade_conta_manutencao=false
// no estabelecimento, serviços com eh_manutencao=true ficam de fora dessa
// contagem. Usada tanto pelo card de progresso (buscarProgressoFidelidade)
// quanto por verificarFidelidadeClientes, que chama isso pra cada cliente do
// salão.
export async function contarServicosFidelidade(clienteId, estabelecimentoId) {
  const [{ data: cliente }, { data: estab }, { data: resgates }] = await Promise.all([
    supabase.from("clientes").select("whatsapp").eq("id", clienteId).single(),
    supabase
      .from("estabelecimentos")
      .select("fidelidade_conta_manutencao")
      .eq("id", estabelecimentoId)
      .single(),
    supabase
      .from("fidelidade_resgates")
      .select("resgatado_em")
      .eq("estabelecimento_id", estabelecimentoId)
      .eq("cliente_id", clienteId)
      .order("resgatado_em", { ascending: false })
      .limit(1),
  ]);

  if (!cliente?.whatsapp) return 0;

  const { data: agendamentos } = await supabase
    .from("agendamentos")
    .select("data, horario, duracao_min, status, servicos(eh_manutencao)")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", cliente.whatsapp)
    .eq("status", "confirmado");

  const desde = resgates?.[0]?.resgatado_em ? new Date(resgates[0].resgatado_em) : null;

  return (agendamentos ?? []).filter((item) => {
    if (classificarAgendamento(item) !== "historico") return false;
    if (!estab?.fidelidade_conta_manutencao && item.servicos?.eh_manutencao) return false;
    if (desde && inicioDoAtendimento(item) <= desde) return false;
    return true;
  }).length;
}

// Progresso do programa de fidelidade pra uma cliente (card exibido no
// público e no /admin — ver components/BadgeFidelidade.js). null quando o
// programa está desligado pro salão ou a cliente ainda não tem nenhum
// serviço contado (nada pra mostrar).
export async function buscarProgressoFidelidade(clienteId, estabelecimento) {
  if (!estabelecimento?.fidelidade_ativa) return null;

  const atual = await contarServicosFidelidade(clienteId, estabelecimento.id);
  if (atual === 0) return null;

  return {
    atual,
    meta: estabelecimento.fidelidade_meta_servicos,
    descricaoBrinde: estabelecimento.fidelidade_descricao_brinde,
  };
}

// Verifica o programa de fidelidade (ver sql/estabelecimentos_fidelidade.sql)
// de todo o salão e cria as pendências novas. Chamada ao carregar a aba
// Pendentes do /admin, mesmo ponto onde buscarPendenciasAdmin roda — o INSERT
// sai pela sessão autenticada do dono, coberto pela mesma policy
// "pendencias_admin_admin_all" (ver sql/pendencias_admin.sql).
//
// Fidelidade é 100% DERIVADA: nenhum contador persistido (ver
// contarServicosFidelidade). Bateu fidelidade_meta_servicos e ainda não
// existe uma pendência 'fidelidade_disponivel' em aberto pra essa cliente?
// Cria uma nova.
//
// Sem fidelidade_ativa ou sem fidelidade_meta_servicos configurada, não faz
// nada. A lista de clientes elegíveis (com whatsapp, sem pendência já aberta)
// vem em bulk, mas a contagem em si roda uma consulta por cliente candidato
// (via contarServicosFidelidade, em paralelo) — reaproveitando a mesma regra
// usada pelo card de progresso, em vez de duplicá-la aqui.
export async function verificarFidelidadeClientes(estabelecimentoId) {
  const { data: estab, error: erroEstab } = await supabase
    .from("estabelecimentos")
    .select("fidelidade_ativa, fidelidade_meta_servicos, fidelidade_descricao_brinde")
    .eq("id", estabelecimentoId)
    .single();

  if (erroEstab || !estab?.fidelidade_ativa || !estab.fidelidade_meta_servicos) return;

  const clientes = await buscarClientes(estabelecimentoId);
  if (clientes.length === 0) return;

  const { data: pendenciasAbertas } = await supabase
    .from("pendencias_admin")
    .select("cliente_id")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("tipo", TIPO_PENDENCIA_FIDELIDADE)
    .eq("resolvido", false);

  const clientesComPendenciaAberta = new Set(
    (pendenciasAbertas ?? []).map((item) => item.cliente_id)
  );

  const candidatos = clientes.filter(
    (cliente) => cliente.whatsapp && !clientesComPendenciaAberta.has(cliente.id)
  );

  const contagens = await Promise.all(
    candidatos.map((cliente) => contarServicosFidelidade(cliente.id, estabelecimentoId))
  );

  for (let i = 0; i < candidatos.length; i++) {
    const cliente = candidatos[i];
    const contagem = contagens[i];

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
