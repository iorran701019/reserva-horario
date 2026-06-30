import { supabase } from "@/lib/supabaseClient";

// Resolução do estabelecimento (salão) ativo a partir de ?salon=<slug> na URL.
//
// ?salon= é um SELETOR DE TESTE multi-tenant, não isolamento de segurança: ele
// só escolhe por qual estabelecimento_id as queries de /agendar e /admin vão
// filtrar. A partição de slots/ocupados continua igual — nada disso é mexido
// aqui.

// Slug usado quando a URL não traz ?salon= — cai no salão padrão.
export const SLUG_PADRAO = "valeria";

// Lê o slug de ?salon= da URL. DEVE ser chamado DENTRO de um useEffect (só roda
// no browser): usa window.location direto em vez de useSearchParams de
// next/navigation de propósito, pra não forçar Suspense/bailout de static.
// Ausente ou vazio => SLUG_PADRAO.
export function lerSlug() {
  const slug = new URLSearchParams(window.location.search).get("salon");
  return slug || SLUG_PADRAO;
}

// Busca o estabelecimento ativo pelo slug. Devolve { id, nome, whatsapp } ou
// null (slug inexistente, inativo ou erro). Quem chama decide entre "loading",
// "não encontrado" e seguir com os dados.
export async function buscarEstabelecimento(slug) {
  const { data, error } = await supabase
    .from("estabelecimentos")
    .select("id, nome, whatsapp")
    .eq("slug", slug)
    .eq("ativo", true)
    .single();

  if (error || !data) return null;
  return data;
}
