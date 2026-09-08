import { createClient } from "@supabase/supabase-js";
import { confirmarPagamentoPix } from "@/lib/abacatepay/confirmarPagamento";

// Recebe o webhook de pagamento da AbacatePay. Resolve o buraco que o polling
// da tela não cobre: a cliente que paga o Pix e fecha o navegador antes do
// BlocoQrCodeAbacatePay perguntar de novo ficava presa em `aguardando_sinal`
// até reabrir a tela ou a reserva expirar — ou seja, pagava e perdia o
// horário.
//
// Autenticação por QUERY PARAM, não pelo header `x-webhook-secret` usado em
// app/api/notificacoes e app/api/google-calendar/sync: quem dita o formato
// aqui é a AbacatePay, que só sabe chamar a URL que a dona cadastrou no painel
// dela. O segredo vive em ABACATEPAY_WEBHOOK_SECRET e faz parte da URL
// cadastrada lá.
//
// A rota é DELIBERADAMENTE tolerante: fora o segredo errado, tudo responde
// 200. Gateway que recebe erro reentrega o mesmo evento em backoff, e nenhum
// dos nossos modos de falha (evento que não interessa, cobrança que não bate
// com agendamento nenhum, update que não pegou linha) melhora com reentrega —
// só viraria ruído. O que precisa de olho humano vai pro console.error.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const segredoRecebido = searchParams.get("webhookSecret");

  if (!segredoRecebido || segredoRecebido !== process.env.ABACATEPAY_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const corpo = await request.json().catch(() => null);
  const evento = corpo?.event;
  const dados = corpo?.data;

  // A AbacatePay manda mais de um tipo de evento na mesma URL. Só o pagamento
  // confirmado nos interessa; o resto é recebido e descartado.
  if (evento !== "billing.paid" || dados?.status !== "PAID") {
    return Response.json({ recebido: true });
  }

  const cobrancaId = dados?.id;
  if (!cobrancaId) {
    console.error("Webhook da AbacatePay com billing.paid sem id de cobrança", corpo);
    return Response.json({ recebido: true });
  }

  const supabaseAdmin = supabaseServiceRole();

  try {
    // O elo entre cobrança e agendamento é só `abacatepay_cobranca_id`, gravado
    // na criação (app/api/abacatepay/gerar-cobranca/route.js) — o payload do
    // Abacate não carrega nada nosso, então o lookup é por aqui.
    const { data: agendamento, error } = await supabaseAdmin
      .from("agendamentos")
      .select("id")
      .eq("abacatepay_cobranca_id", cobrancaId)
      .maybeSingle();

    if (error) throw error;

    // Cobrança paga que não bate com agendamento nenhum: a chave do salão foi
    // usada fora do app, ou o update da gerar-cobranca falhou e o QR Code saiu
    // órfão. Não é erro do lado do Abacate — reentregar não faria a linha
    // aparecer —, mas alguém precisa devolver esse dinheiro ou marcar o
    // horário na mão, então fica registrado.
    if (!agendamento) {
      console.error("Webhook da AbacatePay sem agendamento correspondente", cobrancaId);
      return Response.json({ recebido: true });
    }

    await confirmarPagamentoPix(agendamento.id, supabaseAdmin);

    return Response.json({ recebido: true });
  } catch (erro) {
    console.error("Falha ao processar webhook da AbacatePay", cobrancaId, erro);
    return Response.json({ recebido: true });
  }
}
