// Transição única de "pagamento Pix confirmado" pro agendamento: é o que faz a
// reserva sair de `aguardando_sinal` e virar `pendente`, entrando na fila de
// avaliação da dona como qualquer outro agendamento.
//
// Existe como lib porque agora tem DOIS caminhos que confirmam o mesmo
// pagamento e não podem divergir: o polling da tela de QR Code
// (app/api/abacatepay/status/route.js) e o webhook do Abacate
// (app/api/abacatepay/webhook/route.js). Os dois podem chegar aqui pro mesmo
// agendamento — a cliente que paga com a tela aberta dispara os dois — então a
// idempotência abaixo não é defensiva, é o caso normal.
//
// Os campos gravados são os MESMOS do gesto manual em marcarPendente
// (components/BlocoConfirmacaoPix.js), `pendente_desde` inclusive, que é de
// onde sai a janela de protocolo de 24h.
export async function confirmarPagamentoPix(agendamentoId, supabaseAdmin) {
  const { data: agendamento, error: erroAgendamento } = await supabaseAdmin
    .from("agendamentos")
    .select("id, status, abacatepay_pago_em")
    .eq("id", agendamentoId)
    .maybeSingle();

  if (erroAgendamento) {
    console.error("Falha ao buscar agendamento pra confirmar o Pix", agendamentoId, erroAgendamento);
    return { atualizado: false };
  }

  if (!agendamento) {
    console.error("Agendamento não encontrado pra confirmar o Pix", agendamentoId);
    return { atualizado: false };
  }

  // Guarda de idempotência. `abacatepay_pago_em` cobre a chegada repetida do
  // mesmo pagamento (polling + webhook, ou reentrega do webhook); o status
  // cobre a linha que já saiu de `aguardando_sinal` por outro caminho — o
  // /admin confirmou na mão, a cliente cancelou, o pg_cron expirou a reserva.
  // Em nenhum desses casos a gente quer reescrever `pendente_desde` e mover o
  // protocolo de 24h pra frente.
  if (agendamento.abacatepay_pago_em || agendamento.status !== "aguardando_sinal") {
    return { atualizado: false };
  }

  // .select("id") + checagem de 0 linhas é o padrão do projeto: um update que
  // não pega linha nenhuma volta com error null. A falha NÃO lança — o
  // dinheiro já saiu da conta da cliente, e quem chama precisa seguir
  // respondendo (a tela avança, o webhook confirma recebimento). O log é o que
  // permite o salão resolver na mão.
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
    return { atualizado: false };
  }

  return { atualizado: true };
}
