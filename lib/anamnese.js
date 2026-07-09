import { supabase } from "@/lib/supabaseClient";

// Decide se o cliente precisa preencher (ou repetir) a anamnese antes de
// agendar: busca a resposta mais recente dele NESSE estabelecimento e
// devolve true se não existir nenhuma, ou se a mais recente tiver mais de 12
// meses (comparando `criado_em` com a data atual). Erro de rede/consulta
// também conta como "precisa" — mais seguro pedir de novo do que pular.
export async function precisaAnamnese(clienteId, estabelecimentoId) {
  if (!clienteId || !estabelecimentoId) return true;

  const { data, error } = await supabase
    .from("anamnese_respostas")
    .select("criado_em")
    .eq("cliente_id", clienteId)
    .eq("estabelecimento_id", estabelecimentoId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return true;

  const limite = new Date();
  limite.setMonth(limite.getMonth() - 12);
  return new Date(data.criado_em) < limite;
}
