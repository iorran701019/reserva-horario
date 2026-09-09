import { createClient } from "@supabase/supabase-js";

// "Este salão tem a conta AbacatePay conectada?" — UM booleano, sem auth.
//
// Por que a rota precisa existir: `abacatepay_credenciais` não tem NENHUMA
// policy de RLS (ver app/api/abacatepay/credenciais/route.js), então o browser
// simplesmente não enxerga a tabela. E o modo como o PostgREST nega é o
// perigo: um join embutido a partir de `estabelecimentos` NÃO dá erro, devolve
// `abacatepay_credenciais: null` — indistinguível de "não tem credencial".
// Hidratar a cascata por join client-side leria TODO salão 'abacatepay' como
// desconectado e rebaixaria todos eles pro manual no primeiro deploy. Por isso
// a leitura é obrigatoriamente server-side, com service role.
//
// Por que SEM autenticação, diferente da irmã /api/abacatepay/credenciais: o
// consumidor principal é o wizard público (cliente anônima), que precisa saber
// qual bloco de sinal montar antes de existir qualquer sessão. O que vaza aqui
// é um booleano de configuração de negócio que a própria tela pública já
// revela na prática — se aparece QR Code do Abacate, a conta está conectada.
// Nem a api_key nem o webhook_secret nem o webhook_id passam por aqui, e o
// select traz só `estabelecimento_id`. Mesma postura das outras rotas públicas
// do fluxo de Pix (gerar-cobranca, status), que também respondem a anônimo.
//
// Deliberadamente NÃO responde sobre o webhook: quem decide a cascata é só a
// presença da api_key (ver lib/sinalPix.js). O estado "chave conectada,
// webhook pendente" é assunto da tela de Configurações, que o lê pela rota
// autenticada.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const estabelecimentoId = Number(searchParams.get("estabelecimentoId"));

  if (!estabelecimentoId || Number.isNaN(estabelecimentoId)) {
    return new Response("estabelecimentoId ausente.", { status: 400 });
  }

  const supabaseAdmin = supabaseServiceRole();

  try {
    const { data, error } = await supabaseAdmin
      .from("abacatepay_credenciais")
      .select("estabelecimento_id, api_key")
      .eq("estabelecimento_id", estabelecimentoId)
      .maybeSingle();

    if (error) throw error;

    // A api_key é lida pra ser convertida em booleano AQUI e morrer nesta
    // função — nunca entra na resposta nem em log. Linha existente com
    // api_key vazia conta como desconectado: é o mesmo corte que
    // gerar-cobranca aplica antes de chamar a AbacatePay, então a cascata e a
    // rota de cobrança concordam sobre quem consegue cobrar.
    return Response.json({ conectado: Boolean(data?.api_key) });
  } catch (erro) {
    console.error("Falha ao consultar conexão AbacatePay", estabelecimentoId, erro);
    return Response.json({ erro: "Não foi possível consultar a conexão." }, { status: 500 });
  }
}
