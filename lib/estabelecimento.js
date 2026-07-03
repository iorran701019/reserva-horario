import { supabase } from "@/lib/supabaseClient";

// Resolução do estabelecimento (salão) ativo a partir do slug do PATH
// (rota dinâmica /[salon] — ver useParams nas páginas client).
//
// O slug é um SELETOR DE TESTE multi-tenant, não isolamento de segurança: ele
// só escolhe por qual estabelecimento_id as queries de cliente e admin vão
// filtrar. A partição de slots/ocupados continua igual — nada disso é mexido
// aqui.

// Busca o estabelecimento ativo pelo slug. Devolve { id, nome, whatsapp, slug }
// ou null (slug inexistente, inativo ou erro). Quem chama decide entre
// "loading", "não encontrado" e seguir com os dados. O `slug` volta no objeto
// pra que quem resolve o salão (por path OU por perfil) tenha uma fonte única
// do slug ativo, sem depender de re-ler o path.
export async function buscarEstabelecimento(slug) {
  const { data, error } = await supabase
    .from("estabelecimentos")
    .select("id, nome, whatsapp, slug")
    .eq("slug", slug)
    .eq("ativo", true)
    .single();

  if (error || !data) return null;
  return data;
}
