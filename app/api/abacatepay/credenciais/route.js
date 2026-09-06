import { createClient } from "@supabase/supabase-js";
import { autorizarAdminEstabelecimento } from "@/lib/apiAuth";

// Credenciais da AbacatePay (api_key por salão) ficam em
// `abacatepay_credenciais`, tabela SEM nenhuma policy de RLS — ou seja,
// inacessível pro client anônimo e pro próprio /admin autenticado. Só o
// service role chega nela, e só através destas rotas, que autorizam pelo
// mesmo critério das policies do resto do projeto (ver lib/apiAuth.js).
//
// Regra que justifica a rota existir: a api_key NUNCA volta pro browser.
// O GET responde só um booleano de "conectado", e o POST confirma a
// gravação sem ecoar o que foi gravado.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Grava (ou substitui) a api_key do salão. Upsert com on conflict em
// estabelecimento_id: uma linha por salão, reconectar sobrescreve a chave
// antiga em vez de duplicar.
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

  try {
    const { error } = await supabaseAdmin.from("abacatepay_credenciais").upsert(
      {
        estabelecimento_id: estabelecimentoId,
        api_key: apiKey,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "estabelecimento_id" }
    );

    if (error) throw error;

    return Response.json({ sucesso: true });
  } catch (erro) {
    console.error("Falha ao salvar credencial da AbacatePay", estabelecimentoId, erro);
    return Response.json({ erro: "Não foi possível salvar a credencial." }, { status: 500 });
  }
}

// Só diz se existe credencial gravada. O select é de estabelecimento_id de
// propósito: nem a api_key nem o hash dela saem daqui, então nem um bug de
// log nem a aba de rede do browser conseguem vazar a chave.
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
      .select("estabelecimento_id")
      .eq("estabelecimento_id", estabelecimentoId)
      .maybeSingle();

    if (error) throw error;

    return Response.json({ conectado: Boolean(data) });
  } catch (erro) {
    console.error("Falha ao consultar credencial da AbacatePay", estabelecimentoId, erro);
    return Response.json({ erro: "Não foi possível consultar a credencial." }, { status: 500 });
  }
}

// Desconectar: apaga a linha inteira. Idempotente — desconectar um salão que
// já não tinha credencial responde sucesso do mesmo jeito.
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
