import { supabase } from "@/lib/supabaseClient";
import { buscarAgendamentosAtivos } from "@/lib/agendamentosCliente";
import { classificarAgendamento } from "@/lib/particao";
import { buscarRespostasPorAgendamento } from "@/lib/agendamentoRespostas";

// Lista de clientes do salão (aba "Clientes" do /admin), particionada por
// estabelecimento_id e ordenada por nome. Erro de rede/consulta não quebra a
// tela: devolve lista vazia.
export async function buscarClientes(estabelecimentoId) {
  const { data, error } = await supabase
    .from("clientes")
    .select(
      // etiquetas_cliente vem embedado pela FK clientes.etiqueta_id (ver
      // buscarEtiquetasAtivas abaixo). Traz a etiqueta mesmo se ela estiver
      // DESATIVADA (ativa=false): quem já foi marcado antes continua
      // mostrando o rótulo — desativar tira a etiqueta das escolhas novas,
      // não reescreve o passado.
      "id, nome, whatsapp, nascimento, instagram, cidade, bairro, endereco, estado, contato_emergencia, etiqueta_id, etiquetas_cliente(nome, emoji)"
    )
    .eq("estabelecimento_id", estabelecimentoId)
    .order("nome", { ascending: true });

  if (error) return [];
  return data ?? [];
}

// Agendamentos CONFIRMADOS futuros do cliente, do mais próximo ao mais
// distante. Reaproveita buscarAgendamentosAtivos (já filtra pendente/
// confirmado/aguardando_sinal, traz duracao_min e ordena por data/horário)
// mas o status cru não muda sozinho quando o horário passa — por isso filtra
// com classificarAgendamento, que só devolve "confirmado" pro que ainda está
// no futuro. Pendente/aguardando_sinal ficam de fora de propósito: a lista é
// do que já está fechado com a cliente. [] se não sobrar nenhum ou a consulta
// falhar (o helper já devolve [] em erro).
async function buscarProximosAgendamentos(estabelecimentoId, telefoneDigitos) {
  const lista = await buscarAgendamentosAtivos(estabelecimentoId, telefoneDigitos);
  const confirmados = lista.filter((item) => classificarAgendamento(item) === "confirmado");
  if (confirmados.length === 0) return [];

  // Respostas do popup de perguntas do serviço (ver lib/agendamentoRespostas),
  // pros cards de "Próximos agendamentos" da ficha do cliente — uma busca em
  // bulk pra lista toda, não uma por item.
  const respostas = await buscarRespostasPorAgendamento(confirmados.map((item) => item.id));
  return confirmados.map((item) => ({ ...item, respostas: respostas.get(item.id) ?? [] }));
}

// Último atendimento CONCLUÍDO do cliente. Busca os 5 confirmados mais
// recentes e filtra em JS com classificarAgendamento (só "historico" já
// terminou de fato) — o primeiro da lista é o concluído mais recente.
// Erro de consulta devolve null.
async function buscarUltimoAtendimento(estabelecimentoId, telefoneDigitos) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, status, servico_id, servicos(nome)")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .eq("status", "confirmado")
    .order("data", { ascending: false })
    .order("horario", { ascending: false })
    .limit(5);

  if (error) return null;

  const concluidos = (data ?? []).filter(
    (item) => classificarAgendamento(item) === "historico"
  );
  return concluidos[0] ?? null;
}

// Anamnese mais recente do cliente (só o carimbo criado_em). null se nunca
// preenchida ou a consulta falhar.
async function buscarAnamneseMaisRecente(clienteId, estabelecimentoId) {
  const { data, error } = await supabase
    .from("anamnese_respostas")
    .select("criado_em")
    .eq("cliente_id", clienteId)
    .eq("estabelecimento_id", estabelecimentoId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

// Resumo do cliente exibido no "modo detalhe" da aba Clientes: próximo
// agendamento, último atendimento concluído e a anamnese mais recente, todos
// buscados em paralelo. Cada busca trata o próprio erro (devolve null) — uma
// falha isolada não derruba as outras.
export async function buscarResumoCliente(clienteId, estabelecimentoId, telefoneDigitos) {
  const [proximosAgendamentos, ultimoAtendimento, anamneseData] = await Promise.all([
    buscarProximosAgendamentos(estabelecimentoId, telefoneDigitos),
    buscarUltimoAtendimento(estabelecimentoId, telefoneDigitos),
    buscarAnamneseMaisRecente(clienteId, estabelecimentoId),
  ]);

  return { proximosAgendamentos, ultimoAtendimento, anamneseData };
}

// Histórico completo do cliente (confirmados e cancelados), mais recente
// primeiro. Erro de consulta devolve [].
export async function buscarHistoricoCompleto(estabelecimentoId, telefoneDigitos) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, status, servico_id, expirado_automaticamente, servicos(nome)")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .in("status", ["confirmado", "cancelado"])
    .order("data", { ascending: false })
    .order("horario", { ascending: false });

  if (error) return [];
  const lista = data ?? [];

  // Respostas do popup de perguntas do serviço (ver lib/agendamentoRespostas),
  // pros itens de "Histórico" da ficha do cliente — uma busca em bulk pra
  // toda a lista, não uma por item.
  const respostas = await buscarRespostasPorAgendamento(lista.map((item) => item.id));
  return lista.map((item) => ({ ...item, respostas: respostas.get(item.id) ?? [] }));
}

// Anamnese mais recente do cliente com o modelo de perguntas usado no
// preenchimento. { resposta: null, modelo: null } se nunca preenchida ou se
// alguma das duas consultas falhar.
export async function buscarAnamneseDetalhe(clienteId, estabelecimentoId) {
  const { data: resposta, error: erroResposta } = await supabase
    .from("anamnese_respostas")
    .select("id, respostas, observacoes, termos_aceitos, criado_em, modelo_id")
    .eq("cliente_id", clienteId)
    .eq("estabelecimento_id", estabelecimentoId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erroResposta || !resposta) return { resposta: null, modelo: null };

  const { data: modelo, error: erroModelo } = await supabase
    .from("anamnese_modelos")
    .select("titulo, secoes, declaracoes")
    .eq("id", resposta.modelo_id)
    .maybeSingle();

  if (erroModelo) return { resposta, modelo: null };
  return { resposta, modelo: modelo ?? null };
}

// Agendamentos do cliente que têm observação registrada, mais recente
// primeiro. Erro de consulta devolve [].
export async function buscarObservacoes(estabelecimentoId, telefoneDigitos) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, status, observacao")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .not("observacao", "is", null)
    .order("data", { ascending: false })
    .order("horario", { ascending: false });

  if (error) return [];
  return data ?? [];
}

// Anotações livres do cliente (tabela `anotacoes_clientes`, sem vínculo com
// um agendamento), mais recente primeiro. Erro de consulta devolve [].
export async function buscarAnotacoesLivres(clienteId, estabelecimentoId) {
  const { data, error } = await supabase
    .from("anotacoes_clientes")
    .select("id, texto, criado_em")
    .eq("cliente_id", clienteId)
    .eq("estabelecimento_id", estabelecimentoId)
    .order("criado_em", { ascending: false });

  if (error) return [];
  return data ?? [];
}

// Cria uma anotação livre para o cliente. Devolve { data, error } cru pra
// quem chama decidir a UI (diferente das buscas acima, que só leem).
export async function criarAnotacaoLivre(clienteId, estabelecimentoId, texto) {
  const { data, error } = await supabase
    .from("anotacoes_clientes")
    .insert({ cliente_id: clienteId, estabelecimento_id: estabelecimentoId, texto })
    .select()
    .single();

  return { data, error };
}

// ---------------------------------------------------------------------------
// Etiquetas de cliente (tabela `etiquetas_cliente` + coluna
// `clientes.etiqueta_id`). Informação EXCLUSIVA do /admin: nada no fluxo
// público lê estas funções.
// ---------------------------------------------------------------------------

// Etiquetas ATIVAS do salão, na ordem de exibição definida pela dona.
// Alimenta o popover do SeletorEtiquetaRapido. Erro de consulta devolve [] —
// o popover mostra "nenhuma etiqueta cadastrada" em vez de quebrar a tela.
export async function buscarEtiquetasAtivas(estabelecimentoId) {
  const { data, error } = await supabase
    .from("etiquetas_cliente")
    .select("id, nome, emoji, ordem")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("ativa", true)
    .order("ordem", { ascending: true });

  if (error) return [];
  return data ?? [];
}

// TODAS as etiquetas do salão (ativas e desativadas), pro bloco de CRUD da
// aba Clientes — lá a dona precisa ver as desativadas pra poder reativá-las.
// Erro de consulta devolve [].
export async function buscarTodasEtiquetas(estabelecimentoId) {
  const { data, error } = await supabase
    .from("etiquetas_cliente")
    .select("id, nome, emoji, ordem, ativa")
    .eq("estabelecimento_id", estabelecimentoId)
    .order("ordem", { ascending: true });

  if (error) return [];
  return data ?? [];
}

// Etiqueta (e id do cliente) de cada telefone da lista, pros cards do inbox de
// Pendentes — UMA query pra tela toda, no mesmo molde de
// buscarPendentesPorTelefones/buscarConfirmadosPorTelefones
// (lib/agendamentosCliente.js): normaliza os telefones ANTES de consultar,
// deduplica, e devolve um Map em vez de disparar uma busca por card.
//
// Devolve Map<telefoneDigitos, { clienteId, etiqueta }>, com `etiqueta` =
// { nome, emoji } ou null. A entrada existe pra todo cliente ENCONTRADO,
// tenha etiqueta ou não — o `clienteId` é o que o SeletorEtiquetaRapido usa
// como alvo do update, e o inbox não tem essa informação (os cards vêm de
// `agendamentos`, que só guarda nome_cliente/telefone).
//
// Telefone AUSENTE do Map significa "não existe cliente cadastrado com esse
// número" — e aí o card não mostra badge nem chip, porque não haveria linha
// pra gravar. Diferente de estar presente com etiqueta null, que é o caso do
// chip "Sem etiqueta". Cabe aqui um caveat conhecido: `clientes.whatsapp` tem
// registros legados gravados COM máscara (ver comentário de
// buscarConfirmadosPorTelefones), e esses não casam com o `.in()` de dígitos —
// caem no caso "ausente", isto é, somem da UI em vez de aparecer errados como
// "Sem etiqueta".
//
// Erro de rede/consulta não quebra a tela: devolve Map vazio.
export async function buscarEtiquetasPorTelefones(estabelecimentoId, telefones) {
  const alvos = [...new Set(
    (telefones ?? []).map((t) => String(t ?? "").replace(/\D/g, "")).filter(Boolean)
  )];
  if (alvos.length === 0) return new Map();

  const { data, error } = await supabase
    .from("clientes")
    .select("id, whatsapp, etiqueta_id, etiquetas_cliente(nome, emoji)")
    .eq("estabelecimento_id", estabelecimentoId)
    .in("whatsapp", alvos);

  if (error) return new Map();

  const resultado = new Map();
  for (const cliente of data ?? []) {
    const chave = String(cliente.whatsapp ?? "").replace(/\D/g, "");
    if (!chave) continue;
    resultado.set(chave, {
      clienteId: cliente.id,
      etiqueta: cliente.etiquetas_cliente ?? null,
    });
  }

  return resultado;
}

// Quantos agendamentos CONFIRMADOS o cliente já tem no salão. Alimenta o gate
// de etiqueta do inbox de Pendentes (ver page.js): uma cliente marcada como
// "Cliente Nova" que já tem 1+ confirmado está prestes a fazer o 2º
// atendimento, e o rótulo ficou velho.
//
// A chave é o TELEFONE, não o clienteId: `agendamentos` não tem coluna
// cliente_id — o vínculo agendamento↔cliente no projeto inteiro é por telefone
// normalizado (mesma razão de buscarEtiquetasPorTelefones acima). Quem chama
// já tem o telefone do card em mãos, então nada se perde.
//
// Filtro igual ao de buscarConfirmadosPorTelefones (lib/agendamentosCliente.js):
// status confirmado + finalizado, pra não contar reserva antecipada abandonada
// no meio do wizard. A diferença é que aqui NÃO há corte por
// ehAgendamentoConfirmadoFuturo: a pergunta é "já teve algum?", e um confirmado
// futuro conta tanto quanto um passado — os dois significam que a cliente não é
// mais nova. Por isso também não busca as linhas: `head: true` traz só o número.
//
// Erro de rede/consulta devolve 0, que é o valor que NÃO dispara o popup — uma
// falha de leitura não pode virar um aviso inventado na cara da dona.
export async function contarAgendamentosConfirmados(estabelecimentoId, telefone) {
  const digitos = String(telefone ?? "").replace(/\D/g, "");
  if (!digitos) return 0;

  const { count, error } = await supabase
    .from("agendamentos")
    .select("id", { count: "exact", head: true })
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", digitos)
    .eq("status", "confirmado")
    .eq("finalizado", true);

  if (error) return 0;
  return count ?? 0;
}
