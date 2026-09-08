import { createClient } from "@supabase/supabase-js";

// Consulta o status de pagamento da cobrança Pix de um agendamento. Rota
// PÚBLICA pelo mesmo motivo da gerar-cobranca: quem chama é a tela do QR Code
// no /agendar, ainda sem sessão. O escopo é o que a torna segura — o único
// parâmetro é o id de um agendamento que o próprio cliente acabou de criar, e
// a resposta é só o status dele. A api_key vive em `abacatepay_credenciais`
// (tabela sem RLS, só service role) e NUNCA volta pro browser nem entra em
// log — nem aqui, nem no console.error dos catches.
//
// É esta rota que faz o agendamento sair de "aguardando_sinal" e virar
// "pendente" quando o Abacate confirma o pagamento — o equivalente automático
// do gesto manual (marcar a caixa / anexar comprovante) do
// BlocoConfirmacaoPix. O webhook do Abacate ainda não existe; enquanto isso, o
// polling do BlocoQrCodeAbacatePay é o único caminho de confirmação.
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

  // Mesmos campos que o gesto manual grava em marcarPendente
  // (components/BlocoConfirmacaoPix.js) — pendente_desde inclusive, que é de
  // onde sai a janela de protocolo de 24h. `abacatepay_pago_em` é o que faz o
  // atalho de terminal lá em cima valer nas próximas chamadas.
  //
  // .select("id") + checagem de 0 linhas é o padrão do projeto: um update que
  // não pega linha nenhuma volta com error null. Aqui, como na gerar-cobranca,
  // isso NÃO derruba a resposta — o dinheiro já saiu da conta da cliente e ela
  // precisa ver a tela avançar. A falha vai pro log pro salão resolver na mão.
  const agora = new Date().toISOString();
  const { data: linhas, error: erroUpdate } = await supabaseAdmin
    .from("agendamentos")
    .update({
      status: "pendente",
      sinal_declarado_pago: true,
      pendente_desde: agora,
      abacatepay_pago_em: agora,
    })
    .eq("id", agendamento.id)
    .select("id");

  if (erroUpdate || !linhas || linhas.length === 0) {
    console.error(
      "Pagamento Pix confirmado mas agendamento NÃO atualizado",
      agendamentoId,
      erroUpdate
    );
  }

  return Response.json({ status: "pendente" });
}
