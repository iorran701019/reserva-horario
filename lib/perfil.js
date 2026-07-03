import { supabase } from "@/lib/supabaseClient";

// Resolução do PERFIL do usuário autenticado (tabela `perfis`), que decide QUAL
// salão o admin enxerga conforme o papel:
//   - 'global' → pode navegar entre salões pelo slug do PATH (comportamento
//     atual do /[salon]/admin); o estabelecimento do perfil é só o salão-casa,
//     usado como destino padrão do redirect pós-login.
//   - 'dono'   → preso ao próprio salão (perfis.estabelecimento_id), ignorando
//     qualquer slug da URL.
//
// A linha é filtrada por user_id = auth.uid() e traz o estabelecimento vinculado
// por join (id, nome, whatsapp, slug). O slug alimenta o redirect pós-login e o
// link de reagendamento do WhatsApp (que deve apontar pro salão REAL do perfil,
// não pro slug digitado na URL).

// Busca o perfil do usuário autenticado. Devolve:
//   - undefined → sem sessão (nenhum usuário autenticado)
//   - null      → autenticado, porém SEM linha em perfis (conta órfã)
//   - { papel, estabelecimento } → perfil resolvido; `estabelecimento` pode ser
//     null se o vínculo apontar pra salão inexistente.
export async function buscarPerfil() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return undefined;

  const { data, error } = await supabase
    .from("perfis")
    .select("papel, estabelecimentos(id, nome, whatsapp, slug)")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return null;

  return {
    papel: data.papel,
    estabelecimento: data.estabelecimentos ?? null,
  };
}
