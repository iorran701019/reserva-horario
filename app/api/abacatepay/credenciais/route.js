import { createClient } from "@supabase/supabase-js";
import { autorizarAdminEstabelecimento } from "@/lib/apiAuth";
import {
  configurarWebhookAbacatepay,
  removerWebhookAbacatepay,
} from "@/lib/abacatepay/configurarWebhook";

// Credenciais da AbacatePay (api_key por salão) ficam em
// `abacatepay_credenciais`, tabela SEM nenhuma policy de RLS — ou seja,
// inacessível pro client anônimo e pro próprio /admin autenticado. Só o
// service role chega nela, e só através destas rotas, que autorizam pelo
// mesmo critério das policies do resto do projeto (ver lib/apiAuth.js).
//
// Regra que justifica a rota existir: nem a api_key nem o webhook_secret
// NUNCA voltam pro browser. O GET responde só dois booleanos ("conectado" e
// "webhookOk"), e o POST confirma a gravação sem ecoar o que foi gravado.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Conectar a conta são DUAS etapas: gravar a api_key e cadastrar o webhook de
// pagamento na conta do salão (lib/abacatepay/configurarWebhook.js). Só a
// primeira decide o sucesso da rota — a segunda pode falhar sozinha, e nesse
// caso a resposta sai com `webhook: false` pra tela mostrar o estado
// intermediário "chave conectada, webhook pendente" em vez de fingir que
// deu tudo certo.
//
// Upsert com on conflict em estabelecimento_id: uma linha por salão,
// reconectar sobrescreve a chave antiga em vez de duplicar.
export async function POST(request) {
  const corpo = await request.json();
  const estabelecimentoId = Number(corpo?.estabelecimentoId);
  const apiKey = typeof corpo?.apiKey === "string" ? corpo.apiKey.trim() : "";

  if (!estabelecimentoId || Number.isNaN(estabelecimentoId)) {
    return new Response("estabelecimentoId ausente.", { status: 400 });
  }

  if (!apiKey) {
    return new Response("apiKey ausente.", { status: 400 });
  }

  const autorizado = await autorizarAdminEstabelecimento(request, estabelecimentoId);
  if (!autorizado) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseAdmin = supabaseServiceRole();

  let webhookIdAnterior = null;

  try {
    // O webhook velho é lido ANTES do upsert porque o upsert vai zerar as duas
    // colunas: reconectar com uma chave nova não pode deixar para trás um
    // webhook_secret que não corresponde a webhook nenhum, senão o GET
    // continuaria dizendo "tudo certo" pra um cadastro morto.
    const { data: anterior } = await supabaseAdmin
      .from("abacatepay_credenciais")
      .select("webhook_id")
      .eq("estabelecimento_id", estabelecimentoId)
      .maybeSingle();

    webhookIdAnterior = anterior?.webhook_id ?? null;

    const { error } = await supabaseAdmin.from("abacatepay_credenciais").upsert(
      {
        estabelecimento_id: estabelecimentoId,
        api_key: apiKey,
        webhook_id: null,
        webhook_secret: null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "estabelecimento_id" }
    );

    if (error) throw error;
  } catch (erro) {
    console.error("Falha ao salvar credencial da AbacatePay", estabelecimentoId, erro);
    return Response.json({ erro: "Não foi possível salvar a credencial." }, { status: 500 });
  }

  // A partir daqui a chave JÁ está salva. Falha no webhook não desfaz nada e
  // não vira erro HTTP: a conexão é real (o QR Code do /agendar já funciona,
  // ele só precisa da api_key), o que falta é a confirmação automática de
  // pagamento. Quem avisa a dona disso é a tela, pelo `webhook: false`.
  //
  // A remoção do webhook anterior vai com a chave NOVA. Se for a mesma conta
  // — o caso normal, recolar a chave depois de uma falha — funciona; se for
  // outra conta, a remoção falha e só loga, e o webhook velho fica órfão lá
  // sem conseguir entregar nada (o secret dele já saiu da nossa tabela).
  const { ok } = await configurarWebhookAbacatepay(
    estabelecimentoId,
    apiKey,
    supabaseAdmin,
    webhookIdAnterior
  );

  return Response.json({ sucesso: true, webhook: ok });
}

// Diz se existe credencial gravada e se o webhook daquele salão foi
// cadastrado. O select traz só `estabelecimento_id` e `webhook_id`, e a
// resposta é dois booleanos: nem a api_key nem o webhook_secret saem daqui,
// então nem um bug de log nem a aba de rede do browser conseguem vazar
// qualquer um dos dois. `webhook_id` sozinho não é segredo — é o identificador
// que aparece no painel deles —, mas mesmo ele não é ecoado, só convertido em
// booleano.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const estabelecimentoId = Number(searchParams.get("estabelecimentoId"));

  if (!estabelecimentoId || Number.isNaN(estabelecimentoId)) {
    return new Response("estabelecimentoId ausente.", { status: 400 });
  }

  const autorizado = await autorizarAdminEstabelecimento(request, estabelecimentoId);
  if (!autorizado) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseAdmin = supabaseServiceRole();

  try {
    const { data, error } = await supabaseAdmin
      .from("abacatepay_credenciais")
      .select("estabelecimento_id, webhook_id")
      .eq("estabelecimento_id", estabelecimentoId)
      .maybeSingle();

    if (error) throw error;

    return Response.json({
      conectado: Boolean(data),
      webhookOk: Boolean(data?.webhook_id),
    });
  } catch (erro) {
    console.error("Falha ao consultar credencial da AbacatePay", estabelecimentoId, erro);
    return Response.json({ erro: "Não foi possível consultar a credencial." }, { status: 500 });
  }
}

// Desconectar: tenta remover o webhook lá e apaga a linha inteira aqui.
// Idempotente — desconectar um salão que já não tinha credencial responde
// sucesso do mesmo jeito.
//
// A remoção do webhook é BEST EFFORT de propósito: se a AbacatePay estiver
// fora do ar, a dona ainda precisa conseguir desconectar. O pior caso de
// deixar o webhook lá é ele seguir entregando eventos que a gente rejeita com
// 401 (o secret sai do banco junto com a linha), o que é barulho no painel
// deles, não risco pra nós.
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const estabelecimentoId = Number(searchParams.get("estabelecimentoId"));

  if (!estabelecimentoId || Number.isNaN(estabelecimentoId)) {
    return new Response("estabelecimentoId ausente.", { status: 400 });
  }

  const autorizado = await autorizarAdminEstabelecimento(request, estabelecimentoId);
  if (!autorizado) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseAdmin = supabaseServiceRole();

  try {
    // Precisa ler a api_key: remover o webhook exige autenticar na conta dele,
    // e essa é a última chance de fazer isso antes da linha sumir. A chave não
    // sai desta função — não é ecoada na resposta nem entra em log.
    const { data: credencial } = await supabaseAdmin
      .from("abacatepay_credenciais")
      .select("api_key, webhook_id")
      .eq("estabelecimento_id", estabelecimentoId)
      .maybeSingle();

    if (credencial?.webhook_id && credencial?.api_key) {
      await removerWebhookAbacatepay(credencial.api_key, credencial.webhook_id);
    }

    const { error } = await supabaseAdmin
      .from("abacatepay_credenciais")
      .delete()
      .eq("estabelecimento_id", estabelecimentoId);

    if (error) throw error;

    return Response.json({ sucesso: true });
  } catch (erro) {
    console.error("Falha ao remover credencial da AbacatePay", estabelecimentoId, erro);
    return Response.json({ erro: "Não foi possível remover a credencial." }, { status: 500 });
  }
}
