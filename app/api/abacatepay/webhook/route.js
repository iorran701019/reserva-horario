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
// chega.
//
// O segredo é POR SALÃO: `abacatepay_credenciais.webhook_secret`, gerado no
// momento em que a dona conecta a conta (lib/abacatepay/configurarWebhook.js).
// A env global ABACATEPAY_WEBHOOK_SECRET que essa rota usava antes não servia
// pra mais de um tenant — todo salão assinaria com o mesmo segredo, e um deles
// conseguiria forjar evento dos outros.
//
// ORDEM INVERTIDA em relação à versão da env: pra saber QUAL secret usar é
// preciso descobrir de quem é o evento, e isso só está dentro do corpo. Então
// o corpo é lido e interpretado ANTES da assinatura ser conferida. O que
// mantém isso seguro é que nada acontece nesse trecho além de parse e dois
// SELECTs — nenhuma escrita, nenhuma resposta que diferencie um evento real de
// um forjado. A validação continua sendo pré-requisito absoluto pra
// confirmarPagamentoPix.
//
// Fora a assinatura inválida, a rota é DELIBERADAMENTE tolerante: tudo
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
// quebra o HMAC. Por isso o corpo bruto continua sendo guardado inteiro, mesmo
// agora que ele é interpretado antes da conferência.
function assinaturaConfere(cabecalhoAssinatura, mensagem, segredo) {
  const esperada = Buffer.from(
    createHmac("sha256", segredo).update(mensagem).digest("base64")
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

  // Parse de corpo AINDA NÃO CONFIÁVEL — serve só pra achar de quem é o
  // evento. O catch existe pra não transformar um payload torto num 500 que os
  // faria reentregar em loop.
  let corpo;
  try {
    corpo = JSON.parse(corpoBruto);
  } catch (erro) {
    console.error("Webhook da AbacatePay com corpo que não é JSON", webhookId, erro);
    return Response.json({ recebido: true });
  }

  const transparent = corpo?.data?.transparent;

  // A AbacatePay manda mais de um tipo de evento na mesma URL. Só o pagamento
  // confirmado nos interessa; o resto é recebido e descartado — comportamento
  // idêntico ao de antes. Note que esse descarte acontece SEM conferir a
  // assinatura, porque um evento que não é de pagamento não tem cobrança e
  // portanto não tem dono conhecido. É inofensivo: o corpo é jogado fora sem
  // tocar em nada.
  //
  // O nome do evento vem em `event` na RAIZ do corpo, não em `type`. Confirmado
  // com uma entrega real em Dev mode (08/09). Só a estrutura interna
  // `data.transparent` já estava certa antes: a raiz continuava no formato
  // antigo, então `corpo?.type` era sempre undefined e TODO evento caía neste
  // early return — o webhook respondia 200 sem nunca confirmar pagamento.
  if (corpo?.event !== "transparent.completed" || transparent?.status !== "PAID") {
    return Response.json({ recebido: true });
  }

  const cobrancaId = transparent?.id;

  // Log enxuto pra auditoria: o suficiente pra cruzar um evento do painel deles
  // com uma linha nossa, sem despejar os headers internos da infraestrutura.
  console.log("Webhook da AbacatePay", webhookId, corpo?.event, cobrancaId);

  if (!cobrancaId) {
    console.error("Webhook da AbacatePay com transparent.completed sem id de cobrança", webhookId);
    return Response.json({ recebido: true });
  }

  const supabaseAdmin = supabaseServiceRole();

  try {
    // Mesma cadeia indireta do status/route.js: o payload do Abacate não
    // carrega nada nosso, então o único elo entre cobrança e salão é
    // `abacatepay_cobranca_id`, gravado na criação
    // (app/api/abacatepay/gerar-cobranca/route.js).
    const { data: agendamento, error } = await supabaseAdmin
      .from("agendamentos")
      .select("id, estabelecimento_id")
      .eq("abacatepay_cobranca_id", cobrancaId)
      .maybeSingle();

    if (error) throw error;

    // Cobrança paga que não bate com agendamento nenhum: a chave do salão foi
    // usada fora do app, ou o update da gerar-cobranca falhou e o QR Code saiu
    // órfão. Não é erro do lado do Abacate — reentregar não faria a linha
    // aparecer —, mas alguém precisa devolver esse dinheiro ou marcar o
    // horário na mão, então fica registrado.
    //
    // É também o que responde a um id de cobrança inventado por quem tentar
    // forjar evento: para aqui, antes de qualquer escrita, sem nunca ter
    // chegado perto de confirmarPagamentoPix.
    if (!agendamento) {
      console.error("Webhook da AbacatePay sem agendamento correspondente", cobrancaId);
      return Response.json({ recebido: true });
    }

    const { data: credencial, error: erroCredencial } = await supabaseAdmin
      .from("abacatepay_credenciais")
      .select("webhook_secret")
      .eq("estabelecimento_id", agendamento.estabelecimento_id)
      .maybeSingle();

    if (erroCredencial) throw erroCredencial;

    // Salão sem webhook_secret é salão que nunca completou o cadastro do
    // webhook (ou que desconectou a conta depois da cobrança ter sido criada).
    // Sem segredo não há como validar nada, e validar contra string vazia
    // aceitaria qualquer assinatura calculada com "" — que é exatamente o que
    // um atacante faria. Rejeita.
    if (!credencial?.webhook_secret) {
      console.error(
        "Webhook da AbacatePay para salão sem webhook_secret",
        agendamento.estabelecimento_id,
        cobrancaId
      );
      return new Response("Unauthorized", { status: 401 });
    }

    // A partir daqui, e só a partir daqui, o evento é confiável.
    if (
      !assinaturaConfere(
        webhookSignature,
        `${webhookId}.${webhookTimestamp}.${corpoBruto}`,
        credencial.webhook_secret
      )
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    await confirmarPagamentoPix(agendamento.id, supabaseAdmin);

    return Response.json({ recebido: true });
  } catch (erro) {
    console.error("Falha ao processar webhook da AbacatePay", cobrancaId, erro);
    return Response.json({ recebido: true });
  }
}
