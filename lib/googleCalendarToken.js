// Troca de refresh_token por access_token do Google Calendar, compartilhada
// por toda rota que precisa falar com a Calendar API em nome de um tenant
// (sync, listagem de calendários, importação). Extraído de
// app/api/google-calendar/sync/route.js.

export async function tokenDeAcesso(refreshToken) {
  const resposta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await resposta.json();
  return { ok: resposta.ok && !!tokens.access_token, accessToken: tokens.access_token, tokens };
}

// Busca o refresh_token do tenant e troca por um access_token válido. Se o
// token foi revogado fora do app (myaccount.google.com/permissions), desliga
// a integração pra não ficar tentando pra sempre com token morto — mesma
// limpeza que já rodava em sync/route.js. null cobre tanto "nunca conectou"
// quanto "token morto".
export async function obterAccessTokenDoTenant(estabelecimentoId, supabaseAdmin) {
  const { data: tokenRow } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("refresh_token")
    .eq("estabelecimento_id", estabelecimentoId)
    .single();

  if (!tokenRow?.refresh_token) return null;

  const { ok, accessToken, tokens } = await tokenDeAcesso(tokenRow.refresh_token);

  if (!ok) {
    console.error(
      "Refresh token do Google Calendar inválido, desligando integração",
      estabelecimentoId,
      tokens
    );
    await supabaseAdmin
      .from("estabelecimentos")
      .update({ google_calendar_ativo: false })
      .eq("id", estabelecimentoId);
    await supabaseAdmin
      .from("google_calendar_tokens")
      .delete()
      .eq("estabelecimento_id", estabelecimentoId);
    return null;
  }

  return accessToken;
}
