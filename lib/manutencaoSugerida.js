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

// Primeiro item CONCLUÍDO (ver classificarAgendamento) de uma lista já
// ordenada mais-recente-primeiro. Extraído pra ser reaproveitado tanto por
// buscarManutencaoSugerida (varredura ampla) quanto por
// buscarUltimoConcluidoDoServico (mirado num servico_id já conhecido).
function primeiroConcluido(lista) {
  return (lista ?? []).find((item) => classificarAgendamento(item) === "historico") ?? null;
}

// Existe algum agendamento ATIVO (não histórico — ver classificarAgendamento)
// pra essa manutenção específica (servicoManutencaoId) já marcado por essa
// cliente? Usada por buscarManutencaoSugerida pra não sugerir de novo uma
// manutenção que ela já tem pendente/aguardando_sinal/confirmada no futuro.
async function existeManutencaoAtiva(estabelecimentoId, telefoneDigitos, servicoManutencaoId) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, duracao_min, status")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .eq("servico_id", servicoManutencaoId)
    .neq("status", "cancelado");

  if (error) return false;
  return (data ?? []).some((item) => classificarAgendamento(item) !== "historico");
}

// Último agendamento CONCLUÍDO da cliente para um servico_id específico —
// mesma regra de "concluído" de buscarManutencaoSugerida (status confirmado +
// classificarAgendamento === "historico"), mas mirada num serviço já
// conhecido em vez de varrer todos os serviços com prazo_manutencao_dias.
// Usada por calcularPrecoManutencao, que já sabe o servico_origem_id da
// manutenção escolhida no wizard.
async function buscarUltimoConcluidoDoServico(estabelecimentoId, telefoneDigitos, servicoId) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, duracao_min, status")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .eq("servico_id", servicoId)
    .eq("status", "confirmado")
    .order("data", { ascending: false })
    .order("horario", { ascending: false })
    .limit(5);

  if (error) return null;
  return primeiroConcluido(data);
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
  const concluido = primeiroConcluido(ultimos);
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

  // Cliente já tem essa manutenção marcada (pendente/aguardando_sinal/
  // confirmada, ainda no futuro): não sugere de novo.
  const jaAgendada = await existeManutencaoAtiva(
    estabelecimentoId,
    telefoneDigitos,
    servicoManutencao.id
  );
  if (jaAgendada) return null;

  return {
    servico: servicoManutencao,
    vencido,
    dias: Math.abs(diffDias),
  };
}

// Preço a cobrar por uma manutenção ESCOLHIDA no wizard (FormularioAgendamento
// — card de sugestão em destaque ou popup "Selecione a manutenção"). Diferente
// de buscarManutencaoSugerida (varre todos os serviços pra ACHAR uma
// manutenção pra sugerir), aqui o serviço já é conhecido: só falta decidir se
// cobra o valor normal da manutenção ou o valor cheio do serviço de origem.
//
// Regra: se o último atendimento CONCLUÍDO da cliente pro serviço de origem
// já passou de servicos.prazo_manutencao_dias (dele), CONTANDO A PARTIR DA
// DATA ESCOLHIDA NO WIZARD pro novo agendamento (não da data atual do
// sistema), E o salão tiver manutencao_valor_cheio_apos_prazo=true, cobra o
// preco_centavos do serviço de ORIGEM. Caso contrário (dentro do prazo, sem
// histórico, salão não exige valor cheio, ou o serviço nem é manutenção),
// cobra o preco_centavos normal da manutenção — comportamento de hoje,
// inalterado.
//
// Devolve { centavos, valorCheio }. `valorCheio` avisa a UI pra deixar claro
// que não é o valor de manutenção (evita parecer erro de cobrança).
export async function calcularPrecoManutencao(
  estabelecimentoId,
  telefoneDigitos,
  servicoManutencao,
  dataNovoAgendamento
) {
  const precoNormal = {
    centavos: servicoManutencao?.preco_centavos ?? 0,
    valorCheio: false,
  };

  if (!servicoManutencao?.servico_origem_id) return precoNormal;

  const [resOrigem, resEstab] = await Promise.all([
    supabase
      .from("servicos")
      .select("preco_centavos, prazo_manutencao_dias")
      .eq("id", servicoManutencao.servico_origem_id)
      .single(),
    supabase
      .from("estabelecimentos")
      .select("manutencao_valor_cheio_apos_prazo")
      .eq("id", estabelecimentoId)
      .single(),
  ]);

  if (resOrigem.error || resEstab.error) {
    console.error(
      "calcularPrecoManutencao: falha ao buscar dados pra decidir o preço — caindo no valor normal da manutenção.",
      {
        estabelecimentoId,
        servicoOrigemId: servicoManutencao.servico_origem_id,
        erroServicoOrigem: resOrigem.error?.message,
        erroEstabelecimento: resEstab.error?.message,
      }
    );
    return precoNormal;
  }

  const servicoOrigem = resOrigem.data;
  const cobraValorCheio = Boolean(resEstab.data?.manutencao_valor_cheio_apos_prazo);

  if (!cobraValorCheio || servicoOrigem.prazo_manutencao_dias == null) {
    return precoNormal;
  }

  const concluido = await buscarUltimoConcluidoDoServico(
    estabelecimentoId,
    telefoneDigitos,
    servicoManutencao.servico_origem_id
  );

  if (!concluido) return precoNormal;

  const dataBase = dataNovoAgendamento
    ? somarDias(dataNovoAgendamento, 0)
    : hojeLocal();
  const diasDecorridos = Math.round(
    (dataBase - somarDias(concluido.data, 0)) / DIA_EM_MS
  );

  if (diasDecorridos > servicoOrigem.prazo_manutencao_dias) {
    return { centavos: servicoOrigem.preco_centavos, valorCheio: true };
  }

  return precoNormal;
}

// Data de vencimento (Date à meia-noite local) da manutenção ESCOLHIDA no
// wizard, pra colorir o calendário da etapa "Data" (ver CalendarioDias em
// FormularioAgendamento.js): último atendimento CONCLUÍDO da cliente pro
// serviço de origem + prazo_manutencao_dias DELE. Reaproveita
// buscarUltimoConcluidoDoServico (mesma busca usada por
// calcularPrecoManutencao) em vez de duplicar a query.
//
// Devolve null quando o serviço não é manutenção, o serviço de origem não
// tem prazo_manutencao_dias configurado, ou a cliente nunca concluiu o
// serviço de origem (nada pra colorir — calendário fica no comportamento
// padrão).
export async function buscarVencimentoManutencao(
  estabelecimentoId,
  telefoneDigitos,
  servicoManutencao
) {
  if (!servicoManutencao?.servico_origem_id) return null;

  const { data: servicoOrigem, error } = await supabase
    .from("servicos")
    .select("prazo_manutencao_dias")
    .eq("id", servicoManutencao.servico_origem_id)
    .single();

  if (error || servicoOrigem.prazo_manutencao_dias == null) return null;

  const concluido = await buscarUltimoConcluidoDoServico(
    estabelecimentoId,
    telefoneDigitos,
    servicoManutencao.servico_origem_id
  );
  if (!concluido) return null;

  return somarDias(concluido.data, servicoOrigem.prazo_manutencao_dias);
}
