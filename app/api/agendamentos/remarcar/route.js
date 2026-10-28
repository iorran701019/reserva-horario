import { createClient } from "@supabase/supabase-js";
import { servicoAceitaAgregado } from "@/lib/servicoAgregado";
import { acrescimoParaGravarRemarcacao } from "@/lib/acrescimoDomingo";

// Remarca um agendamento cujo sinal JÁ foi pago via AbacatePay: cancela a
// linha atual e cria a do horário novo carregando o pagamento junto.
//
// Por que existe uma rota pra isso, se trocar de horário já funcionava no
// cliente. O fluxo público inteiro é cancela-e-recria (ver selecionarHorario
// em components/FormularioAgendamento.js): a linha antiga vira "cancelado" e
// nasce uma linha NOVA, com id novo. Enquanto a antiga era só uma reserva
// provisória em "aguardando_sinal" isso não custava nada. Depois que o sinal
// foi pago, custa o sinal inteiro — a linha nova nascia sem
// `abacatepay_pago_em`, e o bloco do QR Code gerava uma cobrança nova pra uma
// reserva que a cliente já tinha pago.
//
// O que ela carrega pra linha nova, e por quê:
//   status="pendente"      – o sinal já está pago, então a reserva não volta
//                            pra fila de "aguardando_sinal". NÃO herda um
//                            "confirmado" do original de propósito: o horário
//                            mudou, e quem aprova horário é o salão.
//   sinal_declarado_pago   – true, mesmo campo que confirmarPagamentoPix e o
//                            gesto manual gravam.
//   pendente_desde         – o valor ORIGINAL, não `now()`. É dele que sai a
//                            janela de protocolo de 24h (ver a régua de telas
//                            em app/[salon]/page.js); reiniciá-la a cada
//                            remarcação daria à cliente uma janela nova de
//                            graça toda vez que ela trocasse de horário.
//   abacatepay_*           – copiadas, MENOS `abacatepay_cobranca_id`. É
//                            `abacatepay_pago_em` que impede a cobrança nova
//                            (ver a guarda em gerar-cobranca), e o br_code
//                            mantém o rastro do Pix pago preso ao agendamento.
//                            O id da cobrança fica de fora porque a coluna é
//                            UNIQUE no banco: copiá-lo colidia com a linha
//                            antiga e o insert morria com 23505.
//
// Rota PÚBLICA, service role, pelo mesmo motivo da gerar-cobranca: quem chama
// é o /agendar, ainda sem sessão. O escopo é o que a torna segura, e aqui ele
// é estreito de propósito — a rota SÓ aceita uma linha que já esteja paga e
// ainda ativa, e nada além de cancelar essa linha e recriá-la noutro horário.
//
// Esse escopo é a ÚNICA coisa que a segura. Até a Etapa 4 do fechamento da RLS
// a justificativa era outra ("cancelar um agendamento por id já é permitido
// pela policy de UPDATE anônimo em `agendamentos`"), mas o fluxo público não
// faz mais UPDATE direto — ele passa pelas RPCs de
// sql/rpcs_agendamento_publico.sql — e a policy de UPDATE anon cai na Etapa 5.
// Daí em diante esta rota é mais permissiva que qualquer coisa que o anon
// consiga fazer sozinho, e as duas guardas abaixo (`abacatepay_pago_em`
// presente e status diferente de 'cancelado') são o que resta no lugar dela.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// 23P01 = violação da exclusion constraint agendamentos_sem_sobreposicao.
// Mesma detecção (código + texto) do fluxo público, pra resposta e mensagem
// não divergirem conforme o caminho.
function ehHorarioOcupado(erro) {
  return (
    erro?.code === "23P01" ||
    /agendamentos_sem_sobreposicao|exclusion constraint/i.test(erro?.message ?? "")
  );
}

// Respostas do popup de perguntas da linha NOVA, gravadas aqui com service
// role. Antes quem gravava era o navegador, logo depois desta rota responder —
// o que deixará de funcionar quando a policy de SELECT anon em `agendamentos`
// cair: o EXISTS da policy `agendamento_respostas_public_insert` não enxergaria
// mais a linha recém-criada e o insert falharia com 42501, em silêncio. Mesmo
// motivo pelo qual as respostas passaram a viajar dentro de agendamento_criar.
//
// As respostas vêm do estado ATUAL do wizard, não da linha antiga: a cliente
// pode ter trocado o serviço junto com o horário.
//
// Validação de pertencimento igual à da RPC — a pergunta tem que ser do
// serviço, e a opção tem que ser da pergunta. Service role passa por cima da
// RLS, então sem isto o corpo do POST escreveria o que quisesse nessa tabela.
//
// Linha inválida é DESCARTADA (com log), não derruba a remarcação: diferente
// da criação, aqui a reserva nova já existe e já carrega o sinal pago — não há
// transação pra desfazer, e recusar agora deixaria a cliente sem horário e com
// o dinheiro preso. Nada do que o wizard monta cai nesse caso.
async function gravarRespostas(supabaseAdmin, agendamentoId, servicoId, respostas) {
  if (!Array.isArray(respostas) || respostas.length === 0) return;

  const { data: perguntas, error: erroPerguntas } = await supabaseAdmin
    .from("servico_perguntas")
    .select("id, servico_pergunta_opcoes!servico_pergunta_opcoes_pergunta_id_fkey(id)")
    .eq("servico_id", servicoId);

  if (erroPerguntas) {
    console.error("Falha ao validar respostas da remarcação", agendamentoId, erroPerguntas);
    return;
  }

  const opcoesPorPergunta = new Map(
    (perguntas ?? []).map((p) => [p.id, new Set((p.servico_pergunta_opcoes ?? []).map((o) => o.id))])
  );

  const linhas = [];
  for (const resposta of respostas) {
    const perguntaId = resposta?.pergunta_id;
    const opcaoId = resposta?.opcao_id ?? null;
    const textoLivre = resposta?.texto_livre?.trim() || null;

    const opcoes = opcoesPorPergunta.get(perguntaId);
    const valida =
      opcoes !== undefined &&
      (opcaoId == null) !== (textoLivre == null) &&
      (opcaoId == null || opcoes.has(opcaoId)) &&
      !linhas.some((l) => l.pergunta_id === perguntaId);

    if (!valida) {
      console.error("Resposta descartada na remarcação", agendamentoId, perguntaId);
      continue;
    }

    linhas.push({
      agendamento_id: agendamentoId,
      pergunta_id: perguntaId,
      opcao_id: opcaoId,
      texto_livre: textoLivre,
    });
  }

  if (linhas.length === 0) return;

  const { error } = await supabaseAdmin.from("agendamento_respostas").insert(linhas);
  if (error) {
    console.error("Falha ao gravar respostas da remarcação", agendamentoId, error);
  }
}

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  const {
    agendamentoId,
    data,
    horario,
    servicoId,
    duracaoMin,
    profissionalId,
    respostas,
    servicoAgregadoId = null,
    acrescimoDomingo = false,
  } = corpo ?? {};

  if (!agendamentoId || !data || !horario || !servicoId) {
    return new Response("Dados da remarcação incompletos.", { status: 400 });
  }

  const supabaseAdmin = supabaseServiceRole();

  const { data: atual, error: erroAtual } = await supabaseAdmin
    .from("agendamentos")
    .select(
      "id, estabelecimento_id, servico_id, servico_agregado_id, agregado_nome, agregado_preco_centavos, agregado_duracao_min, nome_cliente, telefone, status, pendente_desde, sinal_valor_centavos, abacatepay_pago_em, abacatepay_expira_em, abacatepay_br_code, abacatepay_br_code_base64"
    )
    .eq("id", agendamentoId)
    .maybeSingle();

  if (erroAtual) {
    console.error("Falha ao buscar agendamento pra remarcar", agendamentoId, erroAtual);
    return Response.json({ erro: "Não foi possível trocar o horário agora." }, { status: 500 });
  }

  if (!atual) {
    return new Response("Agendamento não encontrado.", { status: 404 });
  }

  // As duas condições que delimitam o escopo da rota. Sem sinal pago não há
  // nada aqui que o cancela-e-recria do cliente não faça igual, e uma linha já
  // cancelada não se remarca — recriá-la ressuscitaria, com horário novo, algo
  // que a cliente ou o salão já tinham encerrado. Nos dois casos a resposta é
  // 409 e quem chama segue pelo caminho de sempre.
  if (!atual.abacatepay_pago_em) {
    return Response.json(
      { erro: "Este agendamento não tem sinal pago para transferir.", codigo: "sem_sinal_pago" },
      { status: 409 }
    );
  }

  if (atual.status === "cancelado") {
    return Response.json(
      { erro: "Este agendamento não está mais ativo.", codigo: "nao_ativo" },
      { status: 409 }
    );
  }

  // Serviço agregado da linha nova. Resolvido ANTES de cancelar a linha
  // antiga: qualquer recusa daqui sai com 409 sem ter tocado em nada, então a
  // reserva paga nunca fica cancelada por causa do agregado.
  //   - serviço mudou ou sem agregado no corpo -> quatro colunas nulas;
  //   - mesmo agregado da linha atual          -> herda os valores GRAVADOS
  //     nela (preço/tempo negociados), nunca os do corpo;
  //   - OUTRO agregado do mesmo serviço        -> lê a configuração em
  //     servico_agregados e o serviço destino em servicos (ativos, do mesmo
  //     estabelecimento, servicoAceitaAgregado) e grava a partir DELA. Se não
  //     valer, 409 "agregado_invalido": nunca grava sem agregado em silêncio,
  //     porque o wizard já mostrou "A + B" e a grade somou o tempo.
  // `duracaoMin` do corpo não decide nada sobre o agregado — o gatilho do
  // banco recalcula `duracao_min`. Comparação por String: o id é bigint e pode
  // chegar como number ou string.
  const semAgregado = {
    servico_agregado_id: null,
    agregado_nome: null,
    agregado_preco_centavos: null,
    agregado_duracao_min: null,
  };
  const mesmoServico = String(atual.servico_id) === String(servicoId);
  let agregadoHerdado = semAgregado;

  if (mesmoServico && servicoAgregadoId != null) {
    if (
      atual.servico_agregado_id != null &&
      String(atual.servico_agregado_id) === String(servicoAgregadoId)
    ) {
      agregadoHerdado = {
        servico_agregado_id: atual.servico_agregado_id,
        agregado_nome: atual.agregado_nome,
        agregado_preco_centavos: atual.agregado_preco_centavos,
        agregado_duracao_min: atual.agregado_duracao_min,
      };
    } else {
      const agregadoInvalido = () =>
        Response.json(
          {
            erro: "O serviço adicional escolhido não está mais disponível. Escolha o serviço de novo.",
            codigo: "agregado_invalido",
          },
          { status: 409 }
        );

      const [
        { data: config, error: erroConfig },
        { data: destino, error: erroDestino },
        { data: salao, error: erroSalao },
      ] = await Promise.all([
        supabaseAdmin
          .from("servico_agregados")
          .select("preco_centavos, duracao_min")
          .eq("servico_id", servicoId)
          .eq("servico_agregado_id", servicoAgregadoId)
          .eq("ativo", true)
          .maybeSingle(),
        supabaseAdmin
          .from("servicos")
          .select("id, nome, eh_manutencao, exige_segunda_data, manutencao_externa")
          .eq("id", servicoAgregadoId)
          .eq("estabelecimento_id", atual.estabelecimento_id)
          .eq("ativo", true)
          .maybeSingle(),
        supabaseAdmin
          .from("estabelecimentos")
          .select("servico_manutencao_externa_id")
          .eq("id", atual.estabelecimento_id)
          .maybeSingle(),
      ]);

      if (erroConfig || erroDestino || erroSalao) {
        console.error(
          "Falha ao validar agregado na remarcação",
          agendamentoId,
          erroConfig,
          erroDestino,
          erroSalao
        );
        return Response.json(
          { erro: "Não foi possível trocar o horário agora." },
          { status: 500 }
        );
      }

      if (!config || !destino || !servicoAceitaAgregado(destino, salao)) {
        return agregadoInvalido();
      }

      agregadoHerdado = {
        servico_agregado_id: destino.id,
        agregado_nome: destino.nome,
        agregado_preco_centavos: config.preco_centavos,
        agregado_duracao_min: config.duracao_min,
      };
    }
  }

  // Acréscimo de domingo da linha NOVA. O corpo só diz sim ou não (boolean
  // estrito; qualquer outro tipo vale como não); o percentual é lido do salão
  // da reserva, nunca do corpo, e só se grava em domingo (a constraint do banco
  // recusaria o resto com 23514). Nunca copiado da linha cancelada: a data
  // nova é que decide. Consulta só quando há sim, pra não pesar o caminho sem
  // acréscimo, e ANTES de cancelar a linha paga — falha aqui não toca em nada.
  let acrescimoPercentual = null;
  if (acrescimoDomingo === true) {
    const { data: salaoAcrescimo, error: erroAcrescimo } = await supabaseAdmin
      .from("estabelecimentos")
      .select("acrescimo_domingo_percentual")
      .eq("id", atual.estabelecimento_id)
      .maybeSingle();

    if (erroAcrescimo) {
      console.error("Falha ao ler o acréscimo de domingo na remarcação", agendamentoId, erroAcrescimo);
      return Response.json({ erro: "Não foi possível trocar o horário agora." }, { status: 500 });
    }

    acrescimoPercentual = acrescimoParaGravarRemarcacao({
      querAcrescimo: true,
      data,
      percentual: salaoAcrescimo?.acrescimo_domingo_percentual,
    });
  }

  // MESMA ordem do fluxo público (ver selecionarHorario): cancela ANTES de
  // inserir. Não é preferência de estilo — a linha antiga e a nova são da
  // mesma cliente e podem se sobrepor no tempo (trocar 14h por 14h30 num
  // serviço de 1h), e inserir primeiro faria a exclusion constraint recusar a
  // nova por causa da própria reserva que estamos substituindo.
  //
  // `.select("id")` + checagem de 0 linhas pelo padrão do projeto: um update
  // que não pega linha nenhuma volta com error null.
  const { data: canceladas, error: erroCancelamento } = await supabaseAdmin
    .from("agendamentos")
    .update({ status: "cancelado" })
    .eq("id", atual.id)
    .select("id");

  if (erroCancelamento || !canceladas || canceladas.length === 0) {
    console.error(
      "Falha ao cancelar agendamento antigo na remarcação",
      agendamentoId,
      erroCancelamento
    );
    return Response.json({ erro: "Não foi possível trocar o horário agora." }, { status: 500 });
  }

  const { data: nova, error: erroInsert } = await supabaseAdmin
    .from("agendamentos")
    .insert({
      nome_cliente: atual.nome_cliente,
      telefone: atual.telefone,
      data,
      horario,
      servico_id: servicoId,
      ...agregadoHerdado,
      duracao_min: duracaoMin ?? null,
      estabelecimento_id: atual.estabelecimento_id,
      profissional_id: profissionalId ?? null,
      status: "pendente",
      // Fallback só defensivo: confirmarPagamentoPix grava `pendente_desde` e
      // `abacatepay_pago_em` no mesmo instante, então o primeiro só seria nulo
      // num dado inconsistente — e aí o carimbo do pagamento é a melhor
      // aproximação disponível da entrada em "pendente". O que NÃO pode
      // acontecer aqui é cair em `now()`.
      pendente_desde: atual.pendente_desde ?? atual.abacatepay_pago_em,
      sinal_declarado_pago: true,
      // Valor do sinal gravado na criação da cobrança (ver gerar-cobranca):
      // é o que foi PAGO, então viaja com o pagamento — a config atual do
      // salão pode já ser outra.
      sinal_valor_centavos: atual.sinal_valor_centavos,
      finalizado: true,
      // `abacatepay_cobranca_id` NÃO é copiado: a coluna tem UNIQUE
      // (abacatepay_cobranca_id_unico) no banco, então duplicá-lo na linha
      // nova derrubava o insert inteiro com 23505. O id fica só na linha
      // antiga cancelada, como histórico de qual cobrança pagou o sinal.
      abacatepay_expira_em: atual.abacatepay_expira_em,
      abacatepay_br_code: atual.abacatepay_br_code,
      abacatepay_br_code_base64: atual.abacatepay_br_code_base64,
      abacatepay_pago_em: atual.abacatepay_pago_em,
      acrescimo_percentual_aplicado: acrescimoPercentual,
    })
    .select("id, acrescimo_percentual_aplicado")
    .single();

  if (erroInsert) {
    // O insert falhou DEPOIS do cancelamento: sem desfazer, a cliente ficaria
    // sem agendamento nenhum e com o sinal pago preso numa linha cancelada.
    // Diferente do fluxo público, onde o mesmo ponto de falha só custava uma
    // reserva provisória, aqui é uma reserva paga — por isso a tentativa de
    // volta.
    //
    // Best-effort de propósito: a restauração pode falhar por si só (alguém
    // pode ter ocupado o horário ANTIGO nesse meio-tempo, e aí a exclusion
    // constraint recusa a volta). Não há como garantir as duas pontas sem uma
    // transação de verdade; o que dá pra garantir é que o caso não passe em
    // silêncio — daí o log e a mensagem específica.
    const { data: restauradas, error: erroRestauracao } = await supabaseAdmin
      .from("agendamentos")
      .update({ status: atual.status })
      .eq("id", atual.id)
      .select("id");

    const restaurado = !erroRestauracao && restauradas && restauradas.length > 0;

    if (!restaurado) {
      console.error(
        "Remarcação falhou e o agendamento pago NÃO voltou ao estado anterior",
        agendamentoId,
        erroInsert,
        erroRestauracao
      );
      return Response.json(
        {
          erro: "Não foi possível trocar o horário e a reserva anterior não pôde ser restaurada. Entre em contato com o salão.",
          codigo: "restauracao_falhou",
        },
        { status: 500 }
      );
    }

    if (ehHorarioOcupado(erroInsert)) {
      return Response.json(
        { erro: "Esse horário acabou de ser reservado.", codigo: "horario_ocupado" },
        { status: 409 }
      );
    }

    console.error("Falha ao criar agendamento remarcado", agendamentoId, erroInsert);
    return Response.json({ erro: "Não foi possível trocar o horário agora." }, { status: 500 });
  }

  await gravarRespostas(supabaseAdmin, nova.id, servicoId, respostas);

  return Response.json({
    id: nova.id,
    pendenteDesde: atual.pendente_desde ?? atual.abacatepay_pago_em,
    abacatepayPagoEm: atual.abacatepay_pago_em,
    acrescimo_percentual_aplicado: nova.acrescimo_percentual_aplicado ?? null,
  });
}
