import { supabase } from "@/lib/supabaseClient";
// STATUS_SUCESSO saiu dos imports: o filtro de status mudou de casa junto com
// as queries (ver agendamentos_cliente_ultimos_sucesso e
// agendamentos_cliente_por_servico em sql/rpcs_leitura_cliente.sql). Só
// classificarAgendamento — a régua de "isto já é histórico" — continua aqui.
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
// O "<> cancelado" da RPC já traz "concluido" junto, e ele nunca conta
// como ativo: classificarAgendamento manda concluido direto pro histórico.
//
// Leitura pela RPC `agendamentos_cliente_por_servico`
// (sql/rpcs_leitura_cliente.sql) em vez de select direto: a policy de SELECT
// anon em `agendamentos` cai na Etapa 8, e sem ela esta consulta voltaria
// vazia — a sugestão de manutenção reapareceria pra quem já tem uma marcada.
// Mesmas colunas, mesmo filtro; a classificação continua aqui embaixo.
async function existeManutencaoAtiva(estabelecimentoId, telefoneDigitos, servicoManutencaoId) {
  const { data, error } = await supabase.rpc("agendamentos_cliente_por_servico", {
    p_estabelecimento_id: estabelecimentoId,
    p_telefone: telefoneDigitos,
    p_servico_id: servicoManutencaoId,
  });

  if (error) return false;
  return (data ?? []).some((item) => classificarAgendamento(item) !== "historico");
}

// Último agendamento CONCLUÍDO da cliente para um servico_id específico —
// mesma regra de "concluído" de buscarManutencaoSugerida (STATUS_SUCESSO +
// classificarAgendamento === "historico"), mas mirada num serviço já
// conhecido em vez de varrer todos os serviços com prazo_manutencao_dias.
// Usada por calcularPrecoManutencao, que já sabe o servico_origem_id da
// manutenção escolhida no wizard.
//
// Leitura pela RPC `agendamentos_cliente_ultimos_sucesso`
// (sql/rpcs_leitura_cliente.sql), a MESMA que buscarManutencaoSugerida usa
// logo abaixo — lá com `p_servico_id` nulo (varredura ampla), aqui com o
// serviço já conhecido. As duas queries só diferiam nesse filtro, então
// viraram uma função só no banco. O `limit 5` é dela, e é o que dá folga pro
// primeiroConcluido abaixo pular um 'confirmado' ainda no futuro.
async function buscarUltimoConcluidoDoServico(estabelecimentoId, telefoneDigitos, servicoId) {
  const { data, error } = await supabase.rpc("agendamentos_cliente_ultimos_sucesso", {
    p_estabelecimento_id: estabelecimentoId,
    p_telefone: telefoneDigitos,
    p_servico_id: servicoId,
  });

  if (error) return null;
  return primeiroConcluido(data);
}

// Manutenção sugerida pro cliente identificado no painel público (ver
// PainelCliente). `agendamentos` não tem coluna cliente_id (mesma limitação de
// lib/agendamentosCliente.js e lib/clientesAdmin.js), então a busca é por
// telefone (dígitos), não por clienteId.
//
// Busca o último agendamento CONCLUÍDO da cliente (qualquer serviço) e todas
// as manutenções ATIVAS vinculadas a esse serviço (servico_origem_id, várias
// permitidas — a trava de unicidade foi removida no banco). Cada manutenção
// tem sua própria faixa de dias (prazo_inicio_dias/prazo_fim_dias, ambos
// opcionais): calcula quantos dias se passaram desde o atendimento e procura
// a faixa que contempla esse número — (prazo_inicio_dias null OU dias >=
// prazo_inicio_dias) E dias <= prazo_fim_dias. Sem prazo_fim_dias, a faixa
// nunca é considerada preenchida (nunca bate). Devolve null se não houver
// nenhuma manutenção vinculada, se nenhuma faixa contemplar os dias já
// passados (inclusive quando ultrapassa todas — nesse caso, se o salão tiver
// manutencao_valor_cheio_apos_prazo=true, o comportamento de "vira serviço de
// valor cheio" assume em vez de sugestão, ver calcularPrecoManutencao), ou se
// a cliente já tem essa manutenção marcada (ativa) no futuro.
export async function buscarManutencaoSugerida(estabelecimentoId, telefoneDigitos) {
  // Mesma RPC de buscarUltimoConcluidoDoServico, com `p_servico_id` nulo:
  // aqui a varredura é ampla (qualquer serviço), porque o que se procura é o
  // último atendimento da cliente, seja ele qual for.
  const { data: ultimos, error: erroUltimos } = await supabase.rpc(
    "agendamentos_cliente_ultimos_sucesso",
    {
      p_estabelecimento_id: estabelecimentoId,
      p_telefone: telefoneDigitos,
      p_servico_id: null,
    }
  );

  if (erroUltimos) return null;

  // Mesmo padrão de lib/clientesAdmin.js (buscarUltimoAtendimento): "concluído"
  // é status concluido, ou confirmado cujo horário já passou e ainda não teve
  // a conclusão gravada — reaproveita classificarAgendamento em vez de
  // duplicar a regra aqui.
  const concluido = primeiroConcluido(ultimos);
  if (!concluido) return null;

  // Todas as manutenções ATIVAS vinculadas ao serviço do último atendimento.
  const { data: manutencoes, error: erroManutencoes } = await supabase
    .from("servicos")
    .select(
      "id, nome, duracao_min, preco_centavos, categoria_id, alerta_mensagem, servico_origem_id, prazo_inicio_dias, prazo_fim_dias"
    )
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("servico_origem_id", concluido.servico_id)
    .eq("eh_manutencao", true)
    .eq("ativo", true);

  if (erroManutencoes || !manutencoes || manutencoes.length === 0) return null;

  const dias = Math.round((hojeLocal() - somarDias(concluido.data, 0)) / DIA_EM_MS);

  const manutencaoEncontrada = manutencoes.find(
    (m) =>
      m.prazo_fim_dias != null &&
      (m.prazo_inicio_dias == null || dias >= m.prazo_inicio_dias) &&
      dias <= m.prazo_fim_dias
  );
  if (!manutencaoEncontrada) return null;

  // Cliente já tem essa manutenção marcada (pendente/aguardando_sinal/
  // confirmada, ainda no futuro): não sugere de novo.
  const jaAgendada = await existeManutencaoAtiva(
    estabelecimentoId,
    telefoneDigitos,
    manutencaoEncontrada.id
  );
  if (jaAgendada) return null;

  const diasParaFim = manutencaoEncontrada.prazo_fim_dias - dias;

  return {
    servico: manutencaoEncontrada,
    vencido: diasParaFim < 0,
    dias: Math.abs(diasParaFim),
  };
}

// Onde a data escolhida cai em relação à faixa da PRÓPRIA manutenção
// (prazo_inicio_dias/prazo_fim_dias, ambos opcionais), contando os dias desde
// o último atendimento concluído do serviço de origem. Fonte única do prazo —
// o antigo servicos.prazo_manutencao_dias do original não é mais lido.
//   "sem-info" – sem concluído, sem manutenção, data anterior ao concluído, ou
//                faixa sem início E sem fim: nada a colorir nem a bloquear.
//   "antes"    – dias < prazo_inicio_dias (cedo demais pra esta manutenção).
//   "dentro"   – na faixa (sem fim = sem teto; sem início = sem piso).
//   "depois"   – dias > prazo_fim_dias.
// Datas em "YYYY-MM-DD"; a conta usa somarDias (nunca new Date("YYYY-MM-DD")).
export function classificarDiasManutencao(ultimoConcluidoISO, dataISO, manutencao) {
  if (!ultimoConcluidoISO || !dataISO || !manutencao) return "sem-info";

  const inicio = manutencao.prazo_inicio_dias ?? null;
  const fim = manutencao.prazo_fim_dias ?? null;
  if (inicio == null && fim == null) return "sem-info";

  const dias = Math.round(
    (somarDias(dataISO, 0) - somarDias(ultimoConcluidoISO, 0)) / DIA_EM_MS
  );
  if (dias < 0) return "sem-info";

  if (inicio != null && dias < inicio) return "antes";
  if (fim != null && dias > fim) return "depois";
  return "dentro";
}

// Entre as manutenções do mesmo serviço de origem, a OUTRA (diferente da
// atual) cuja faixa contempla `dias`. Pura: recebe a lista de serviços já
// carregada. Usada pelo preço — se existe uma manutenção da faixa seguinte, a
// cliente é de manutenção, não de valor cheio.
export function acharManutencaoDaFaixa(servicos, manutencaoAtual, dias) {
  if (!manutencaoAtual?.servico_origem_id || dias == null) return null;
  return (
    (servicos ?? []).find(
      (m) =>
        m.id !== manutencaoAtual.id &&
        m.eh_manutencao &&
        m.ativo !== false &&
        m.servico_origem_id === manutencaoAtual.servico_origem_id &&
        (m.prazo_inicio_dias != null || m.prazo_fim_dias != null) &&
        (m.prazo_inicio_dias == null || dias >= m.prazo_inicio_dias) &&
        (m.prazo_fim_dias == null || dias <= m.prazo_fim_dias)
    ) ?? null
  );
}

// Preço a cobrar por uma manutenção ESCOLHIDA no wizard (FormularioAgendamento
// — card de sugestão em destaque ou popup "Selecione a manutenção"). Diferente
// de buscarManutencaoSugerida (varre todos os serviços pra ACHAR uma
// manutenção pra sugerir), aqui o serviço já é conhecido: só falta decidir se
// cobra o valor normal da manutenção ou o valor cheio do serviço de origem.
//
// Regra: cobra o preco_centavos do serviço de ORIGEM só se, CONTANDO A PARTIR
// DA DATA ESCOLHIDA NO WIZARD (não da data atual) e DO ÚLTIMO CONCLUÍDO DA
// APLICAÇÃO OU DE QUALQUER MANUTENÇÃO DO MESMO SERVIÇO, a data cai DEPOIS da faixa
// da própria manutenção (classificarDiasManutencao === "depois"), NÃO existe
// outra manutenção ativa do mesmo original cuja faixa contemple esses dias
// (acharManutencaoDaFaixa) E o salão tiver manutencao_valor_cheio_apos_prazo
// ligado. Caso contrário (antes/dentro/sem-info, há manutenção da faixa
// seguinte, sem histórico, flag desligada ou o serviço nem é manutenção),
// cobra o preco_centavos normal da manutenção.
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

  const [resOrigem, resEstab, resIrmas] = await Promise.all([
    supabase
      .from("servicos")
      .select("preco_centavos")
      .eq("id", servicoManutencao.servico_origem_id)
      .single(),
    supabase
      .from("estabelecimentos")
      .select("manutencao_valor_cheio_apos_prazo")
      .eq("id", estabelecimentoId)
      .single(),
    supabase
      .from("servicos")
      .select("id, servico_origem_id, eh_manutencao, ativo, prazo_inicio_dias, prazo_fim_dias")
      .eq("estabelecimento_id", estabelecimentoId)
      .eq("servico_origem_id", servicoManutencao.servico_origem_id)
      .eq("eh_manutencao", true)
      .eq("ativo", true),
  ]);

  if (resOrigem.error || resEstab.error || resIrmas.error) {
    console.error(
      "calcularPrecoManutencao: falha ao buscar dados pra decidir o preço — caindo no valor normal da manutenção.",
      {
        estabelecimentoId,
        servicoOrigemId: servicoManutencao.servico_origem_id,
        erroServicoOrigem: resOrigem.error?.message,
        erroEstabelecimento: resEstab.error?.message,
        erroManutencoesIrmas: resIrmas.error?.message,
      }
    );
    return precoNormal;
  }

  const servicoOrigem = resOrigem.data;
  const cobraValorCheio = Boolean(resEstab.data?.manutencao_valor_cheio_apos_prazo);

  if (!cobraValorCheio) return precoNormal;

  const ultimoConcluidoISO = await buscarUltimoConcluidoManutencao(
    estabelecimentoId,
    telefoneDigitos,
    servicoManutencao
  );
  if (!ultimoConcluidoISO) return precoNormal;

  const hoje = hojeLocal();
  const dataBaseISO =
    dataNovoAgendamento ||
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

  if (classificarDiasManutencao(ultimoConcluidoISO, dataBaseISO, servicoManutencao) !== "depois") {
    return precoNormal;
  }

  const dias = Math.round(
    (somarDias(dataBaseISO, 0) - somarDias(ultimoConcluidoISO, 0)) / DIA_EM_MS
  );
  if (acharManutencaoDaFaixa(resIrmas.data, servicoManutencao, dias)) {
    return precoNormal;
  }

  return { centavos: servicoOrigem.preco_centavos, valorCheio: true };
}

// Data ISO ("YYYY-MM-DD") do último atendimento CONCLUÍDO da cliente pro
// serviço da manutenção ESCOLHIDA no wizard: o MAIS RECENTE entre a aplicação
// (serviço de origem) e qualquer manutenção desse mesmo origem. Alimenta o
// calendário da etapa "Data" (ver CalendarioDias em FormularioAgendamento.js,
// via classificarDiasManutencao) e o preço (calcularPrecoManutencao). O prazo
// em si vem da faixa da própria manutenção, não de uma consulta ao original.
//
// As manutenções do mesmo origem são buscadas SEM filtro de `ativo`: um
// atendimento antigo pode ser de uma manutenção hoje inativa. Se essa busca
// falhar, cai no comportamento antigo (só o origem).
//
// Devolve null quando o serviço não é manutenção ou a cliente nunca concluiu
// nem o origem nem nenhuma manutenção dele (nada pra colorir — calendário no
// comportamento padrão).
export async function buscarUltimoConcluidoManutencao(
  estabelecimentoId,
  telefoneDigitos,
  servicoManutencao
) {
  const origemId = servicoManutencao?.servico_origem_id;
  if (!origemId) return null;

  const { data: manutencoes, error } = await supabase
    .from("servicos")
    .select("id")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("servico_origem_id", origemId)
    .eq("eh_manutencao", true);

  const ids = [origemId, ...(error ? [] : (manutencoes ?? []).map((m) => m.id))];

  const concluidos = await Promise.all(
    [...new Set(ids)].map((id) =>
      buscarUltimoConcluidoDoServico(estabelecimentoId, telefoneDigitos, id)
    )
  );

  // "YYYY-MM-DD" ordena lexicograficamente igual à ordem cronológica.
  let maisRecente = null;
  for (const concluido of concluidos) {
    const data = concluido?.data ?? null;
    if (data && (!maisRecente || data > maisRecente)) maisRecente = data;
  }
  return maisRecente;
}
