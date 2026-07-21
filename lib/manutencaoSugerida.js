import { supabase } from "@/lib/supabaseClient";
import { classificarAgendamento } from "@/lib/particao";

const DIA_EM_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" + N dias -> Date à meia-noite local. Monta a data
// componente-a-componente (nunca new Date("YYYY-MM-DD"), que seria
// interpretada como UTC) — mesma convenção de lib/horarios.js e lib/particao.js.
function somarDias(iso, dias) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  data.setDate(data.getDate() + dias);
  return data;
}

function hojeLocal() {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

// Manutenção sugerida pro cliente identificado no painel público (ver
// PainelCliente). `agendamentos` não tem coluna cliente_id (mesma limitação de
// lib/agendamentosCliente.js e lib/clientesAdmin.js), então a busca é por
// telefone (dígitos), não por clienteId.
//
// Procura o último agendamento CONCLUÍDO cujo serviço tem prazo_manutencao_dias
// preenchido, calcula o vencimento (data do atendimento + prazo) e confere se
// ainda vale sugerir: dentro do prazo original, OU vencido mas ainda dentro da
// caducidade do salão (manutencao_caducidade_dias; null = nunca caduca, sempre
// sugere mesmo vencido). Devolve null se não houver correspondência, se o
// serviço de manutenção vinculado (eh_manutencao=true, servico_origem_id
// apontando pro serviço original) não existir/estiver inativo, ou se já
// passou da caducidade.
export async function buscarManutencaoSugerida(estabelecimentoId, telefoneDigitos) {
  const { data: ultimos, error: erroUltimos } = await supabase
    .from("agendamentos")
    .select(
      "id, data, horario, duracao_min, status, servico_id, servicos!inner(prazo_manutencao_dias)"
    )
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .eq("status", "confirmado")
    .not("servicos.prazo_manutencao_dias", "is", null)
    .order("data", { ascending: false })
    .order("horario", { ascending: false })
    .limit(5);

  if (erroUltimos) return null;

  // Mesmo padrão de lib/clientesAdmin.js (buscarUltimoAtendimento): "concluído"
  // não é um status gravado, é status "confirmado" cujo horário já passou —
  // reaproveita classificarAgendamento em vez de duplicar a regra aqui.
  const concluido = (ultimos ?? []).find(
    (item) => classificarAgendamento(item) === "historico"
  );
  if (!concluido) return null;

  const prazoDias = concluido.servicos.prazo_manutencao_dias;
  const vencimento = somarDias(concluido.data, prazoDias);
  const diffDias = Math.round((vencimento - hojeLocal()) / DIA_EM_MS);
  const vencido = diffDias < 0;

  if (vencido) {
    const { data: estab, error: erroEstab } = await supabase
      .from("estabelecimentos")
      .select("manutencao_caducidade_dias")
      .eq("id", estabelecimentoId)
      .single();

    if (erroEstab) return null;

    const caducidade = estab?.manutencao_caducidade_dias;
    if (caducidade != null && -diffDias > caducidade) return null;
  }

  // Serviço de manutenção vinculado ao original recém-encontrado. Filtrar
  // ativo=true na própria query já resolve "não existir/estiver inativo" —
  // sem correspondência, servicoManutencao vem null.
  const { data: servicoManutencao, error: erroManutencao } = await supabase
    .from("servicos")
    .select(
      "id, nome, duracao_min, preco_centavos, categoria_id, ocultar_preco, ocultar_duracao, alerta_mensagem, servico_origem_id"
    )
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("servico_origem_id", concluido.servico_id)
    .eq("eh_manutencao", true)
    .eq("ativo", true)
    .maybeSingle();

  if (erroManutencao || !servicoManutencao) return null;

  return {
    servico: servicoManutencao,
    vencido,
    dias: Math.abs(diffDias),
  };
}
