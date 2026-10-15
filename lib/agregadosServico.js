import { supabase } from "@/lib/supabaseClient";
import { agregadoSomaTempo, servicoAceitaAgregado } from "@/lib/servicoAgregado";

// Consultas do serviço agregado que dependem do supabase: ficam fora de
// lib/servicoAgregado.js, que é puro e roda em `node --test`. Usadas pelo
// wizard (components/FormularioAgendamento.js) e pelo modo "agregado" do
// /admin (components/ModalAlterarAgregado.js).

// Serviços agregados oferecidos para um serviço (servico_agregados): só as
// linhas ativas cujo serviço agregado continua ativo e presente em
// `servicosLista` (a lista de serviços ativos já carregada pelo wizard).
// Devolve { ...linha, nome } ordenadas por `ordem`. Erro de consulta = lista
// vazia: sem oferta, o fluxo segue como antes do agregado existir.
export async function buscarAgregadosDoServico(servicoId, servicosLista, estabelecimento) {
  const { data, error } = await supabase
    .from("servico_agregados")
    .select("id, servico_id, servico_agregado_id, preco_centavos, duracao_min, ordem")
    .eq("servico_id", servicoId)
    .eq("ativo", true)
    .order("ordem", { ascending: true });

  if (error) return [];

  return (data ?? [])
    .map((linha) => {
      const agregado = servicosLista.find((s) => s.id === linha.servico_agregado_id);
      // Destino que não aceita agregado (manutenção, duas datas, manutenção de
      // outro salão — servicoAceitaAgregado) simplesmente não é oferecido.
      return agregado && servicoAceitaAgregado(agregado, estabelecimento)
        ? { ...linha, nome: agregado.nome }
        : null;
    })
    .filter(Boolean);
}

// O tempo do agregado só soma quando nenhum profissional ativo do serviço tem
// agenda fixa (agregadoSomaTempo). No instante da oferta `profissionaisDoServico`
// do wizard ainda é o do serviço ANTERIOR, então os modos são lidos aqui, pelo
// mesmo vínculo servico_profissional. null = não deu pra saber (a oferta mostra
// só o preço, nunca um tempo que pode não valer).
export async function buscarSomaTempoAgregado(servicoId, estabelecimentoId) {
  const { data, error } = await supabase
    .from("servico_profissional")
    .select("profissionais!inner(ativo, estabelecimento_id, modo_horario)")
    .eq("servico_id", servicoId)
    .eq("profissionais.ativo", true)
    .eq("profissionais.estabelecimento_id", estabelecimentoId);

  if (error) return null;
  return agregadoSomaTempo((data ?? []).map((v) => v.profissionais).filter(Boolean));
}
