import { createClient } from "@supabase/supabase-js";

// Autoriza um pedido de API feito pelo /admin autenticado (rotas que
// precisam do refresh_token do tenant, então não podem rodar direto no
// client — ver app/api/google-calendar/calendarios e .../importar). Espelha
// a MESMA regra usada nas policies de RLS do projeto (ver
// sql/estabelecimentos_update_policy.sql, sql/pendencias_admin.sql etc.):
// perfil 'global' acessa qualquer salão, os demais ficam presos ao próprio
// perfis.estabelecimento_id.
//
// O client manda o access_token da própria sessão Supabase (header
// Authorization: Bearer <token>, obtido via supabase.auth.getSession() no
// browser) — validado aqui contra o Auth do Supabase com a publishable key,
// nunca com o service role. Devolve true/false, nunca lança.
export async function autorizarAdminEstabelecimento(request, estabelecimentoId) {
  const cabecalho = request.headers.get("authorization") ?? "";
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : null;
  if (!token) return false;

  // Headers globais com o token da sessão — sem isso, a consulta a `perfis`
  // abaixo iria como anônima e a RLS (que depende de auth.uid()) bloquearia.
  const supabaseUsuario = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: erroUser } = await supabaseUsuario.auth.getUser(token);
  if (erroUser || !userData?.user) return false;

  const { data: perfil, error: erroPerfil } = await supabaseUsuario
    .from("perfis")
    .select("papel, estabelecimento_id")
    .eq("user_id", userData.user.id)
    .single();

  if (erroPerfil || !perfil) return false;

  return perfil.papel === "global" || perfil.estabelecimento_id === estabelecimentoId;
}

// Variante só-global: valida o Bearer token (auth.getUser) e lê o perfil com o
// token do usuário (RLS). Devolve { ok: true, userId } só para papel 'global';
// senão { ok: false, status } com 401 (sem sessão válida) ou 403 (outro papel,
// sem perfil ou perfil ilegível). Nunca lança.
export async function autorizarGlobal(request) {
  const cabecalho = request.headers.get("authorization") ?? "";
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : null;
  if (!token) return { ok: false, status: 401 };

  const supabaseUsuario = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: erroUser } = await supabaseUsuario.auth.getUser(token);
  if (erroUser || !userData?.user) return { ok: false, status: 401 };

  const { data: perfil, error: erroPerfil } = await supabaseUsuario
    .from("perfis")
    .select("papel")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (erroPerfil || perfil?.papel !== "global") return { ok: false, status: 403 };
  return { ok: true, userId: userData.user.id };
}
