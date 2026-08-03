import { createClient } from "@supabase/supabase-js";

// Callback do fluxo OAuth "authorization code" do Google Calendar, disparado
// pelo redirect que o Google faz depois do dono autorizar (ver botão
// "Conectar Google Calendar" em app/[salon]/admin/ConfiguracoesSalao.js).
// `state` carrega o estabelecimento_id (setado na URL de autorização) —
// não usamos sessão/cookie aqui porque o navegador some pro domínio do
// Google no meio do fluxo.

function urlAdmin(slug) {
  const base = process.env.NEXT_PUBLIC_URL_BASE;
  return slug ? `${base}/${slug}/admin` : base;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const estabelecimentoId = Number(searchParams.get("state"));

  if (!code || !estabelecimentoId || Number.isNaN(estabelecimentoId)) {
    return new Response("Parâmetros inválidos (code/state ausentes).", {
      status: 400,
    });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: estabelecimento } = await supabaseAdmin
    .from("estabelecimentos")
    .select("slug")
    .eq("id", estabelecimentoId)
    .single();

  if (!estabelecimento) {
    return new Response("Estabelecimento não encontrado.", { status: 404 });
  }

  const destinoAdmin = urlAdmin(estabelecimento.slug);

  // Redireciono de volta pro /admin do salão com um erro legível na query
  // string — não há UI dedicada pra isso ainda, mas evita deixar a dona
  // presa numa tela em branco/erro genérico do Google.
  function redirecionarComErro(mensagem) {
    const destino = new URL(destinoAdmin);
    destino.searchParams.set("google_calendar_erro", mensagem);
    return Response.redirect(destino.toString(), 302);
  }

  // Precisa ser idêntico ao redirect_uri usado ao montar a URL de autorização
  // (ver ConfiguracoesSalao.js), senão o Google recusa a troca do code.
  const redirectUri = `${process.env.NEXT_PUBLIC_URL_BASE}/api/google-calendar/callback`;

  const respostaToken = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const tokens = await respostaToken.json();

  if (!respostaToken.ok || !tokens.access_token) {
    console.error("Falha ao trocar code por tokens do Google Calendar", tokens);
    return redirecionarComErro(
      "Não foi possível conectar ao Google Calendar. Tente novamente."
    );
  }

  // Só vem em duas situações: primeira autorização, ou reautorização com
  // prompt=consent (que sempre forçamos na URL de autorização). Se ainda
  // assim faltar, é porque a conta já tinha um acesso concedido antes fora
  // desse fluxo — pedimos pra revogar manualmente e tentar de novo.
  if (!tokens.refresh_token) {
    return redirecionarComErro(
      "Essa conta Google já tinha autorizado o acesso antes. Remova o acesso em myaccount.google.com/permissions e conecte novamente."
    );
  }

  const respostaUserinfo = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );
  const userinfo = await respostaUserinfo.json();

  if (!respostaUserinfo.ok || !userinfo.email) {
    console.error(
      "Falha ao buscar e-mail da conta Google Calendar",
      userinfo
    );
    return redirecionarComErro(
      "Não foi possível confirmar a conta Google conectada. Tente novamente."
    );
  }

  const { error: erroToken } = await supabaseAdmin
    .from("google_calendar_tokens")
    .upsert({
      estabelecimento_id: estabelecimentoId,
      refresh_token: tokens.refresh_token,
      updated_at: new Date().toISOString(),
    });

  if (erroToken) {
    console.error("Falha ao salvar refresh_token do Google Calendar", erroToken);
    return redirecionarComErro("Não foi possível salvar a conexão. Tente novamente.");
  }

  await supabaseAdmin
    .from("estabelecimentos")
    .update({
      google_calendar_ativo: true,
      google_calendar_email: userinfo.email,
    })
    .eq("id", estabelecimentoId);

  return Response.redirect(destinoAdmin, 302);
}
