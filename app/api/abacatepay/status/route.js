import { createClient } from "@supabase/supabase-js";
import { confirmarPagamentoPix } from "@/lib/abacatepay/confirmarPagamento";

// Consulta o status de pagamento da cobrança Pix de um agendamento. Rota
// PÚBLICA pelo mesmo motivo da gerar-cobranca: quem chama é a tela do QR Code
// no /agendar, ainda sem sessão. O escopo é o que a torna segura — o único
// parâmetro é o id de um agendamento que o próprio cliente acabou de criar, e
// a resposta é só o status dele. A api_key vive em `abacatepay_credenciais`
// (tabela sem RLS, só service role) e NUNCA volta pro browser nem entra em
// log — nem aqui, nem no console.error dos catches.
//
// Esta rota é UM dos dois caminhos que fazem o agendamento sair de
// "aguardando_sinal" e virar "pendente" — o equivalente automático do gesto
// manual (marcar a caixa / anexar comprovante) do BlocoConfirmacaoPix. O outro
// é o webhook (app/api/abacatepay/webhook/route.js), que cobre a cliente que
// fecha o navegador depois de pagar. O polling daqui continua existindo porque
// é ele que faz a TELA avançar na hora, sem depender da entrega do webhook.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const ABACATEPAY_CHECK = "https://api.abacatepay.com/v2/transparents/check";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const agendamentoId = searchParams.get("agendamentoId");

  if (!agendamentoId) {
    return new Response("agendamentoId ausente.", { status: 400 });
  }

  const supabaseAdmin = supabaseServiceRole();

  const { data: agendamento, error: erroAgendamento } = await supabaseAdmin
    .from("agendamentos")
    .select("id, estabelecimento_id, status, abacatepay_cobranca_id, abacatepay_pago_em")
    .eq("id", agendamentoId)
    .maybeSingle();

  if (erroAgendamento) {
    console.error("Falha ao buscar agendamento pro status do Pix", agendamentoId, erroAgendamento);
    return Response.json({ erro: "Não foi possível consultar o pagamento agora." }, { status: 500 });
  }

  if (!agendamento) {
    return new Response("Agendamento não encontrado.", { status: 404 });
  }

  // Atalho de terminal: pagamento já registrado, ou linha que já saiu de
  // "aguardando_sinal" por qualquer outro caminho (o /admin confirmou na mão,
  // a cliente cancelou, o pg_cron expirou a reserva). Em todos esses casos
  // não há o que perguntar pro Abacate — e perguntar mesmo assim gastaria uma
  // chamada de rede a cada 5s do polling. Responder o status do banco cru é o
  // bastante: o componente só olha se é diferente de "aguardando_sinal" pra
  // parar de perguntar.
  if (agendamento.abacatepay_pago_em || agendamento.status !== "aguardando_sinal") {
    return Response.json({ status: agendamento.status });
  }

  const { data: credencial, error: erroCredencial } = await supabaseAdmin
    .from("abacatepay_credenciais")
    .select("api_key")
    .eq("estabelecimento_id", agendamento.estabelecimento_id)
    .maybeSingle();

  if (erroCredencial) {
    console.error("Falha ao buscar credencial da AbacatePay", agendamentoId, erroCredencial);
    return Response.json({ erro: "Não foi possível consultar o pagamento agora." }, { status: 500 });
  }

  if (!credencial?.api_key) {
    return Response.json(
      { erro: "Cobrança Pix não configurada para este salão." },
      { status: 500 }
    );
  }

  let statusAbacate;
  try {
    const resposta = await fetch(
      `${ABACATEPAY_CHECK}?id=${encodeURIComponent(agendamento.abacatepay_cobranca_id)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credencial.api_key}`,
          "Content-Type": "application/json",
        },
      }
    );
    const json = await resposta.json();

    if (json?.error || json?.success === false) throw json?.error || json;

    statusAbacate = (json?.data ?? json)?.status;
    if (!statusAbacate) throw json;
  } catch (erro) {
    console.error("Falha ao consultar cobrança Pix na AbacatePay", agendamentoId, erro);
    return Response.json({ erro: "Não foi possível consultar o pagamento agora." }, { status: 500 });
  }

  // PENDING e EXPIRED não mexem no banco. Em especial o EXPIRED: quem devolve
  // o horário pra grade é a expiração automática que já existe
  // (expirar_reservas_pendentes no pg_cron, pela mesma janela
  // reserva_provisoria_expira_horas que governa o expiresIn da cobrança).
  // Cancelar aqui duplicaria essa regra em dois lugares.
  if (statusAbacate !== "PAID") {
    return Response.json({ status: "aguardando_sinal" });
  }

  // A gravação em si mora em lib/abacatepay/confirmarPagamento.js, porque o
  // webhook (app/api/abacatepay/webhook/route.js) confirma o MESMO pagamento
  // pelo mesmo conjunto de campos — os dois caminhos podem chegar juntos
  // quando a cliente paga com a tela aberta, e a idempotência de lá é que
  // impede o segundo de reescrever pendente_desde.
  await confirmarPagamentoPix(agendamento.id, supabaseAdmin);

  return Response.json({ status: "pendente" });
}
