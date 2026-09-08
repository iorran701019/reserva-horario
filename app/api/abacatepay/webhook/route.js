import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { confirmarPagamentoPix } from "@/lib/abacatepay/confirmarPagamento";

// Recebe o webhook de pagamento da AbacatePay. Resolve o buraco que o polling
// da tela não cobre: a cliente que paga o Pix e fecha o navegador antes do
// BlocoQrCodeAbacatePay perguntar de novo ficava presa em `aguardando_sinal`
// até reabrir a tela ou a reserva expirar — ou seja, pagava e perdia o
// horário.
//
// Autenticação por ASSINATURA HMAC nos headers `webhook-id`,
// `webhook-timestamp` e `webhook-signature`, não pelo `x-webhook-secret` usado
// em app/api/notificacoes e app/api/google-calendar/sync: quem dita o formato
// aqui é a AbacatePay. O formato abaixo foi confirmado inspecionando uma
// chamada real — a doc deles também descreve query param, que NÃO é o que
// chega. O segredo vive em ABACATEPAY_WEBHOOK_SECRET.
//
// A rota é DELIBERADAMENTE tolerante: fora a assinatura inválida, tudo
// responde 200. Gateway que recebe erro reentrega o mesmo evento em backoff, e
// nenhum dos nossos modos de falha (evento que não interessa, cobrança que não
// bate com agendamento nenhum, update que não pegou linha) melhora com
// reentrega — só viraria ruído. O que precisa de olho humano vai pro
// console.error.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// A mensagem assinada é `id.timestamp.corpo` com o corpo em TEXTO BRUTO: um
// JSON.parse seguido de re-serialização muda espaços e ordem de chaves e
// quebra o HMAC, então o corpo só vira objeto depois da validação.
function assinaturaConfere(cabecalhoAssinatura, mensagem) {
  const esperada = Buffer.from(
    createHmac("sha256", process.env.ABACATEPAY_WEBHOOK_SECRET ?? "")
      .update(mensagem)
      .digest("base64")
  );

  // O header pode trazer várias assinaturas separadas por espaço (rotação de
  // segredo do lado deles); basta uma bater. O prefixo "v1," identifica a
  // versão do esquema — as outras versões, se existirem, são ignoradas.
  return cabecalhoAssinatura
    .split(" ")
    .filter((parte) => parte.startsWith("v1,"))
    .some((parte) => {
      const recebida = Buffer.from(parte.slice("v1,".length));
      // timingSafeEqual lança se os buffers tiverem tamanhos diferentes — o
      // tamanho não é segredo, então comparar antes é seguro e necessário.
      return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
    });
}

export async function POST(request) {
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return new Response("Unauthorized", { status: 401 });
  }

  const corpoBruto = await request.text();

  if (!assinaturaConfere(webhookSignature, `${webhookId}.${webhookTimestamp}.${corpoBruto}`)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Corpo com assinatura válida é JSON por construção; o catch existe só pra
  // não transformar um payload torto num 500 que os faria reentregar em loop.
  let corpo;
  try {
    corpo = JSON.parse(corpoBruto);
  } catch (erro) {
    console.error("Webhook da AbacatePay com corpo que não é JSON", webhookId, erro);
    return Response.json({ recebido: true });
  }

  const transparent = corpo?.data?.transparent;

  // A AbacatePay manda mais de um tipo de evento na mesma URL. Só o pagamento
  // confirmado nos interessa; o resto é recebido e descartado.
  if (corpo?.type !== "transparent.completed" || transparent?.status !== "PAID") {
    return Response.json({ recebido: true });
  }

  const cobrancaId = transparent?.id;

  // Log enxuto pra auditoria: o suficiente pra cruzar um evento do painel deles
  // com uma linha nossa, sem despejar os headers internos da infraestrutura.
  console.log("Webhook da AbacatePay", webhookId, corpo?.type, cobrancaId);

  if (!cobrancaId) {
    console.error("Webhook da AbacatePay com transparent.completed sem id de cobrança", webhookId);
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
