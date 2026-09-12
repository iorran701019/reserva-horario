import { createClient } from "@supabase/supabase-js";

// Gera (ou recupera) a cobrança Pix da AbacatePay pro sinal de reserva de um
// agendamento. Rota PÚBLICA: quem chama é o /agendar, ainda sem sessão — não
// tem token pra autorizar, então NÃO usa lib/apiAuth.js como as rotas de
// credencial. O que a torna segura é o escopo: o único parâmetro é o id de um
// agendamento que o próprio cliente acabou de criar, e a resposta é só o QR
// Code daquele agendamento. A api_key vive em `abacatepay_credenciais`
// (tabela sem RLS, só service role) e NUNCA volta pro browser nem entra em
// log — nem aqui, nem no console.error dos catches.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const ABACATEPAY_BASE = "https://api.abacatepay.com/v2/transparents";

// Validade do QR Code Pix, em horas. É uma constante do projeto, NÃO uma
// configuração por salão: a dona não tem por que decidir quanto tempo um QR
// Code vive. Antes isso vinha de `estabelecimentos.reserva_provisoria_expira_horas`,
// mas aquela coluna só serve pra limpar rascunho abandonado no meio do wizard
// (finalizado = false, bloco (a) de expirar_pendentes_vencidos) — nunca teve
// relação real com o Pix, era coincidência de usarem a mesma coluna.
const EXPIRACAO_PIX_HORAS = 24;

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  const agendamentoId = corpo?.agendamentoId;

  if (!agendamentoId) {
    return new Response("agendamentoId ausente.", { status: 400 });
  }

  const supabaseAdmin = supabaseServiceRole();

  const { data: agendamento, error: erroAgendamento } = await supabaseAdmin
    .from("agendamentos")
    .select(
      "id, estabelecimento_id, abacatepay_cobranca_id, abacatepay_expira_em, abacatepay_br_code, abacatepay_br_code_base64, status, abacatepay_pago_em"
    )
    .eq("id", agendamentoId)
    .maybeSingle();

  if (erroAgendamento) {
    console.error("Falha ao buscar agendamento pra cobrança Pix", agendamentoId, erroAgendamento);
    return Response.json({ erro: "Não foi possível gerar o Pix agora." }, { status: 500 });
  }

  if (!agendamento) {
    return new Response("Agendamento não encontrado.", { status: 404 });
  }

  // Sinal JÁ pago: não existe cobrança a gerar, e criar uma aqui seria cobrar
  // duas vezes pela mesma reserva. Acontece em dois caminhos reais — a cliente
  // reabre a tela de pagamento depois de já ter pago (reload, volta do app do
  // banco), e a remarcação que carrega o sinal pago pra linha nova (ver
  // app/api/agendamentos/remarcar/route.js, que copia `abacatepay_pago_em`).
  //
  // A guarda é `abacatepay_pago_em`, o MESMO campo que já serve de atalho de
  // terminal na rota de status e de idempotência em confirmarPagamentoPix —
  // não o `status`, que sai de "aguardando_sinal" também por caminhos que não
  // são pagamento (o salão cancelou, o pg_cron expirou a reserva) e onde uma
  // cobrança nova ainda faria sentido.
  //
  // Devolve o status CRU do banco junto, igual à rota de status: quem chama é
  // o mesmo BlocoQrCodeAbacatePay, que já sabe distinguir pagamento
  // confirmado dos outros desfechos (ver ehPagamentoConfirmado lá).
  if (agendamento.abacatepay_pago_em) {
    return Response.json({ pago: true, status: agendamento.status });
  }

  // Só o valor do sinal e o método de cobrança: a validade do QR Code é a
  // constante EXPIRACAO_PIX_HORAS lá em cima, não vem do salão.
  const { data: estabelecimento, error: erroEstabelecimento } = await supabaseAdmin
    .from("estabelecimentos")
    .select("sinal_valor_centavos, metodo_cobranca_pix")
    .eq("id", agendamento.estabelecimento_id)
    .maybeSingle();

  if (erroEstabelecimento || !estabelecimento) {
    console.error(
      "Falha ao buscar estabelecimento pra cobrança Pix",
      agendamentoId,
      erroEstabelecimento
    );
    return Response.json({ erro: "Não foi possível gerar o Pix agora." }, { status: 500 });
  }

  if (estabelecimento.metodo_cobranca_pix !== "abacatepay") {
    return new Response(
      "Este salão não usa cobrança automática via AbacatePay.",
      { status: 400 }
    );
  }

  const { data: credencial, error: erroCredencial } = await supabaseAdmin
    .from("abacatepay_credenciais")
    .select("api_key")
    .eq("estabelecimento_id", agendamento.estabelecimento_id)
    .maybeSingle();

  if (erroCredencial) {
    console.error("Falha ao buscar credencial da AbacatePay", agendamentoId, erroCredencial);
    return Response.json({ erro: "Não foi possível gerar o Pix agora." }, { status: 500 });
  }

  if (!credencial?.api_key) {
    return Response.json(
      { erro: "Cobrança Pix não configurada para este salão." },
      { status: 500 }
    );
  }

  const cabecalhos = {
    Authorization: `Bearer ${credencial.api_key}`,
    "Content-Type": "application/json",
  };

  // Cobrança que já existe e ainda não venceu é REAPROVEITADA. Sem isso, um
  // reload da tela de pagamento (ou o cliente voltando do app do banco) criaria
  // uma cobrança nova a cada visita, e o cliente poderia acabar pagando um QR
  // Code órfão que o /admin não reconhece. O QR Code fica gravado no próprio
  // agendamento junto com o id da cobrança, então reaproveitar é leitura de
  // banco pura — nenhuma chamada de rede neste ramo. Linha com cobranca_id mas
  // sem br_code (dado antigo de teste, ou um
  // update que gravou pela metade) NÃO é reaproveitável: cai no fluxo de
  // criação abaixo, que gera uma cobrança nova e regrava as quatro colunas.
  const aindaValida =
    agendamento.abacatepay_cobranca_id &&
    agendamento.abacatepay_expira_em &&
    agendamento.abacatepay_br_code &&
    new Date(agendamento.abacatepay_expira_em).getTime() > Date.now();

  if (aindaValida) {
    return Response.json({
      brCode: agendamento.abacatepay_br_code,
      brCodeBase64: agendamento.abacatepay_br_code_base64,
      expiresAt: agendamento.abacatepay_expira_em,
    });
  }

  const expiresIn = EXPIRACAO_PIX_HORAS * 3600;

  let dados;
  try {
    const resposta = await fetch(`${ABACATEPAY_BASE}/create`, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({
        method: "PIX",
        data: {
          amount: estabelecimento.sinal_valor_centavos,
          description: "Sinal de reserva",
          expiresIn,
        },
      }),
    });
    const json = await resposta.json();

    if (json?.error || json?.success === false) throw json?.error || json;

    dados = json?.data ?? json;
    if (!dados?.brCode) throw json;
  } catch (erro) {
    console.error("Falha ao criar cobrança Pix na AbacatePay", agendamentoId, erro);
    return Response.json({ erro: "Não foi possível gerar o Pix agora." }, { status: 500 });
  }

  // .select("id") + checagem de 0 linhas é o padrão do projeto (ver
  // components/BlocoConfirmacaoPix.js): um update que não pega linha nenhuma
  // volta com error null. Aqui, porém, isso NÃO bloqueia a resposta — a
  // cobrança já existe na AbacatePay e o cliente precisa do QR Code. O custo
  // de não ter gravado é só a reutilização da linha 5 (a próxima visita cria
  // outra cobrança), não vale segurar o pagamento por isso.
  //
  // `sinal_valor_centavos` é o MESMO valor mandado como `amount` acima,
  // gravado já na criação e não na confirmação: o valor da cobrança não muda
  // depois de criada, e a config do salão pode mudar (ou ser apagada) antes do
  // atendimento — sem esta cópia o valor do sinal ficaria irrecuperável.
  const { data: linhas, error: erroUpdate } = await supabaseAdmin
    .from("agendamentos")
    .update({
      abacatepay_cobranca_id: dados.id,
      abacatepay_expira_em: dados.expiresAt,
      abacatepay_br_code: dados.brCode,
      abacatepay_br_code_base64: dados.brCodeBase64,
      sinal_valor_centavos: estabelecimento.sinal_valor_centavos,
    })
    .eq("id", agendamento.id)
    .select("id");

  if (erroUpdate || !linhas || linhas.length === 0) {
    console.error(
      "Cobrança Pix criada mas NÃO gravada no agendamento",
      agendamentoId,
      erroUpdate
    );
  }

  return Response.json({
    brCode: dados.brCode,
    brCodeBase64: dados.brCodeBase64,
    expiresAt: dados.expiresAt,
  });
}
