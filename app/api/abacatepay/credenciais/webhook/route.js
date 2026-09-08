import { createClient } from "@supabase/supabase-js";
import { autorizarAdminEstabelecimento } from "@/lib/apiAuth";
import { configurarWebhookAbacatepay } from "@/lib/abacatepay/configurarWebhook";

// Refaz SÓ a etapa do webhook pra um salão que já tem a api_key gravada — é o
// que o botão "Configurar webhook" da tela de configurações chama quando a
// conexão parou no meio (chave salva, webhook não cadastrado).
//
// A rota existe porque o browser não tem como refazer isso sozinho: depois de
// conectada, a api_key nunca mais volta pro client (ver o irmão
// ../route.js), então quem precisa dela pra falar com a AbacatePay é o
// service role daqui. A alternativa seria pedir a chave de novo pra dona a
// cada tentativa — pior de usar e sem ganho nenhum de segurança.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  const estabelecimentoId = Number(corpo?.estabelecimentoId);

  if (!estabelecimentoId || Number.isNaN(estabelecimentoId)) {
    return new Response("estabelecimentoId ausente.", { status: 400 });
  }

  const autorizado = await autorizarAdminEstabelecimento(request, estabelecimentoId);
  if (!autorizado) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseAdmin = supabaseServiceRole();

  const { data: credencial, error } = await supabaseAdmin
    .from("abacatepay_credenciais")
    .select("api_key, webhook_id")
    .eq("estabelecimento_id", estabelecimentoId)
    .maybeSingle();

  if (error) {
    console.error("Falha ao buscar credencial pra recriar o webhook", estabelecimentoId, error);
    return Response.json({ erro: "Não foi possível configurar o webhook." }, { status: 500 });
  }

  // Sem chave não há o que reconfigurar: a tela nem mostra este botão nesse
  // estado, então chegar aqui significa que a credencial foi apagada em outra
  // aba enquanto esta ficou aberta.
  if (!credencial?.api_key) {
    return Response.json(
      { erro: "Conecte a conta AbacatePay antes de configurar o webhook." },
      { status: 409 }
    );
  }

  const { ok } = await configurarWebhookAbacatepay(
    estabelecimentoId,
    credencial.api_key,
    supabaseAdmin,
    credencial.webhook_id ?? null
  );

  if (!ok) {
    return Response.json({ erro: "Não foi possível configurar o webhook." }, { status: 502 });
  }

  return Response.json({ sucesso: true });
}
