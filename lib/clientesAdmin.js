import { supabase } from "@/lib/supabaseClient";
import { buscarAgendamentosAtivos } from "@/lib/agendamentosCliente";
import { classificarAgendamento } from "@/lib/particao";

// Lista de clientes do salão (aba "Clientes" do /admin), particionada por
// estabelecimento_id e ordenada por nome. Erro de rede/consulta não quebra a
// tela: devolve lista vazia.
export async function buscarClientes(estabelecimentoId) {
  const { data, error } = await supabase
    .from("clientes")
    .select(
      "id, nome, whatsapp, nascimento, instagram, cidade, bairro, endereco, estado"
    )
    .eq("estabelecimento_id", estabelecimentoId)
    .order("nome", { ascending: true });

  if (error) return [];
  return data ?? [];
}

// Próximo agendamento ATIVO do cliente. Reaproveita buscarAgendamentosAtivos
// (já filtra pendente/confirmado/aguardando_sinal e ordena por data/horário) e
// pega o primeiro. null se não houver nenhum ou a consulta falhar (o helper já
// devolve [] em erro).
async function buscarProximoAgendamento(estabelecimentoId, telefoneDigitos) {
  const lista = await buscarAgendamentosAtivos(estabelecimentoId, telefoneDigitos);
  return lista[0] ?? null;
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
  const [proximoAgendamento, ultimoAtendimento, anamneseData] = await Promise.all([
    buscarProximoAgendamento(estabelecimentoId, telefoneDigitos),
    buscarUltimoAtendimento(estabelecimentoId, telefoneDigitos),
    buscarAnamneseMaisRecente(clienteId, estabelecimentoId),
  ]);

  return { proximoAgendamento, ultimoAtendimento, anamneseData };
}

// Histórico completo do cliente (confirmados e cancelados), mais recente
// primeiro. Erro de consulta devolve [].
export async function buscarHistoricoCompleto(estabelecimentoId, telefoneDigitos) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, data, horario, status, servico_id, servicos(nome)")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("telefone", telefoneDigitos)
    .in("status", ["confirmado", "cancelado"])
    .order("data", { ascending: false })
    .order("horario", { ascending: false });

  if (error) return [];
  return data ?? [];
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
