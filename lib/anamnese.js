import { supabase } from "@/lib/supabaseClient";

// Decide se o cliente precisa preencher (ou repetir) a anamnese antes de
// agendar. A regra (não existe resposta dele NESSE estabelecimento, ou a mais
// recente tem mais de 12 meses) vive na função `anamnese_precisa` do banco —
// aqui só repassamos. Erro de rede/consulta também conta como "precisa" —
// mais seguro pedir de novo do que pular.
export async function precisaAnamnese(clienteId, estabelecimentoId) {
  if (!clienteId || !estabelecimentoId) return true;

  const { data, error } = await supabase.rpc("anamnese_precisa", {
    p_cliente_id: clienteId,
    p_estabelecimento_id: estabelecimentoId,
  });

  if (error) return true;
  return data;
}

// Existe modelo de anamnese ATIVO pro estabelecimento? Mesma condição que
// FormularioAnamnese.js já usa pra decidir se há o que preencher (ver o
// fetch de `modelo` lá) — extraída aqui pra quem só precisa saber
// "existe ou não" sem carregar o modelo inteiro (ex.: GerenciarClientes,
// decidindo se mostra a seção "Anamnese" do detalhe do cliente).
export async function existeModeloAtivo(estabelecimentoId) {
  if (!estabelecimentoId) return false;

  const { data, error } = await supabase
    .from("anamnese_modelos")
    .select("id")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();

  return !error && !!data;
}

// Última resposta de anamnese de cada cliente do estabelecimento, em lote
// (pra aba Clientes do admin decidir a tag "Anamnese não preenchida" sem uma
// consulta por cliente). Mesmo dado usado por precisaAnamnese (carimbo
// `criado_em`), só que pra todos os clientes de uma vez — quem chama decide
// "vencida"/"em dia" (ver situacaoAnamnese em GerenciarClientes.js).
// Map<cliente_id, criado_em>; cliente ausente do Map == nunca preencheu.
// Erro de consulta devolve Map vazio (mesma cautela de precisaAnamnese:
// melhor mostrar a tag do que esconder).
export async function buscarUltimasAnamnesesPorCliente(estabelecimentoId) {
  const mapa = new Map();
  if (!estabelecimentoId) return mapa;

  const { data, error } = await supabase
    .from("anamnese_respostas")
    .select("cliente_id, criado_em")
    .eq("estabelecimento_id", estabelecimentoId)
    .order("criado_em", { ascending: false });

  if (error) return mapa;

  for (const item of data ?? []) {
    if (!mapa.has(item.cliente_id)) mapa.set(item.cliente_id, item.criado_em);
  }
  return mapa;
}
