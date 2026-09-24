// Regras ESPECIAIS de sinal — valor por serviço e/ou por período de datas.
//
// O que isto resolve: até aqui a cobrança do sinal era um escalar só por salão
// (`estabelecimentos.sinal_regra` + `sinal_valor_centavos`). "Em dezembro todo
// mundo paga", "a progressiva sempre pede R$ 100", "nesta semana de curso
// ninguém paga" não tinham onde morar. `sinal_regras_especiais` (ver
// sql/sinal_regras_especiais.sql) guarda essas exceções, e este módulo é quem
// as resolve.
//
// DIVISÃO DE TRABALHO COM lib/sinalPix.js — as duas perguntas são diferentes e
// continuam em módulos separados de propósito:
//
//   lib/sinalRegra.js (aqui) -> "cobra deste atendimento? e quanto?"  REGRA
//   lib/sinalPix.js          -> "por qual meio dá pra cobrar?"        CAPACIDADE
//
// Juntar as duas faria a cascata de capacidade (credencial da AbacatePay,
// chave Pix) passar a depender de serviço e data, que não têm nada a ver com
// ela. Quem compõe as duas é o consumidor: `cobra && metodo !== 'desligado'`.
//
// Módulo PURO, sem import de supabase, mesmo padrão de lib/sinalPix.js e
// lib/janelaAgendamento.js: a regra fica testável e roda igual no browser
// (precisaSinal, exibição do valor) e no servidor (gerar-cobranca,
// confirmarPagamentoPix). A MESMA lógica está reimplementada em SQL na função
// `sinal_resolver` — é duplicação consciente, pelo mesmo motivo da antecedência
// mínima: o valor gravado não pode depender do que o navegador manda, e o
// navegador precisa mostrar o número antes de gravar. Mexeu aqui, mexa lá.
//
// GARANTIA CENTRAL: com `sinal_regras_especiais` VAZIA, `resolverSinal`
// devolve exatamente o que o código fazia antes deste módulo existir — o passo
// 4 é uma transcrição literal do `precisaSinal` antigo, e o valor continua
// saindo de `estabelecimentos.sinal_valor_centavos`.

// Valores permitidos em `sinal_regras_especiais.cobranca` (mesmo check do
// banco). 'exceto_manutencao' espelha o modo homônimo de `sinal_regra`:
// cobra de todo mundo MENOS dos serviços marcados como manutenção.
export const COBRANCAS_REGRA_ESPECIAL = ["todas", "exceto_manutencao", "nao_cobrar"];

// Data no formato do banco ("YYYY-MM-DD"), que é o mesmo formato de `form.data`
// e de `agendamentos.data` lido pelo PostgREST. Comparação lexicográfica de
// strings ISO é equivalente à cronológica e não constrói Date nenhum — mesmo
// cuidado de excecoesDoDia (lib/disponibilidade.js), onde `new Date("YYYY-MM-DD")`
// já introduziu bug de fuso.
function iso(valor) {
  if (typeof valor === "string" && valor.length >= 10) return valor.slice(0, 10);
  return null;
}

// A regra vale NESTA data?
//
// Regra sem período (as duas colunas nulas) vale sempre — inclusive quando a
// data do atendimento ainda não existe, que é o estado do wizard antes da
// etapa "data" (passo 6 da especificação). Regra COM período precisa de data
// pra ser avaliada: sem data ela é ignorada, nunca chutada.
function dataCobreRegra(regra, data) {
  const inicio = iso(regra?.data_inicio);
  const fim = iso(regra?.data_fim);

  if (inicio == null && fim == null) return true;

  const alvo = iso(data);
  if (alvo == null) return false;

  // O check do banco garante "as duas ou nenhuma", mas um dado torto não deve
  // virar exceção silenciosa que cobre datas demais.
  if (inicio == null || fim == null) return false;

  return inicio <= alvo && alvo <= fim;
}

// Quanto mais específica, mais forte. Serviço pesa mais que período: "a
// progressiva custa R$ 100" é uma afirmação sobre aquele serviço, e uma regra
// de dezembro que fale de TODOS os serviços não deve sobrescrevê-la.
//
//   3 = serviço + período     ("a progressiva em dezembro")
//   2 = só serviço            ("a progressiva, sempre")
//   1 = só período            ("dezembro, todos os serviços")
//   0 = nem um nem outro      ("todos os serviços, sempre" — o padrão do salão
//                              reescrito como regra; raro, mas é linha válida)
function especificidade(regra) {
  return (regra?.servico_id != null ? 2 : 0) + (iso(regra?.data_inicio) != null ? 1 : 0);
}

// Desempate: a mais recente ganha. É REDE DE SEGURANÇA, não regra de produto —
// a UI barra sobreposição no cadastro, então o empate só aparece em dado
// inserido na mão (ou numa corrida entre duas abas). Melhor um critério
// determinístico e explicável que "a que o Postgres devolver primeiro".
function maisRecente(a, b) {
  const ca = a?.criado_em ?? "";
  const cb = b?.criado_em ?? "";
  return cb > ca ? b : a;
}

// Regra especial que vale pra este (serviço, data), ou null.
//
// `servico_id = null` na regra significa "todos os serviços" — por isso o
// candidato passa tanto na igualdade quanto no nulo. A comparação é por String:
// o id é bigint no banco e chega como number pelo PostgREST, mas já apareceu
// como string em objeto remontado à mão (ver ModalVincularCliente), e um
// `===` cru falharia em silêncio justamente no caso que a dona configurou.
export function regraEspecialVencedora(regras, servico, data) {
  let vencedora = null;

  for (const regra of regras ?? []) {
    if (regra?.servico_id != null) {
      if (servico?.id == null) continue;
      if (String(regra.servico_id) !== String(servico.id)) continue;
    }

    if (!dataCobreRegra(regra, data)) continue;

    if (vencedora == null) {
      vencedora = regra;
      continue;
    }

    const e = especificidade(regra);
    const eVencedora = especificidade(vencedora);

    if (e > eVencedora) vencedora = regra;
    else if (e === eVencedora) vencedora = maisRecente(vencedora, regra);
  }

  return vencedora;
}

// O resolver.
//
//   { estabelecimento, servico, data, ehNovo, naListaBloqueio }
//     -> { cobra, valor_centavos, regra }
//
//   estabelecimento – linha de `estabelecimentos` (sinal_regra,
//                     sinal_valor_centavos e, hidratado pelos loaders,
//                     sinal_regras_especiais).
//   servico         – { id, eh_manutencao }. Só esses dois campos são lidos;
//                     `null` é aceito (nada escolhido ainda).
//   data            – "YYYY-MM-DD" do ATENDIMENTO, não de hoje. Vazia no wizard
//                     antes da etapa de data: aí só as regras sem período
//                     entram (ver dataCobreRegra).
//   ehNovo          – cliente sem histórico no salão, entrada do modo 'novos'.
//   naListaBloqueio – cliente com a etiqueta "Lista de Bloqueio" num salão que
//                     marcou a opção. Força a cobrança POR CIMA de tudo,
//                     inclusive de uma regra especial 'nao_cobrar': é
//                     exatamente pra isso que a Lista existe.
//   regras          – opcional. Por padrão sai de
//                     `estabelecimento.sinal_regras_especiais` (hidratado pelos
//                     loaders); as rotas de API passam explicitamente, porque
//                     lá o estabelecimento vem de um select próprio com service
//                     role.
//
// `valor_centavos` é resolvido SEMPRE, mesmo com `cobra: false`. Quem só quer
// exibir o número (os blocos de Pix, que montam sobre uma linha já em
// "aguardando_sinal") não precisa reavaliar a cobrança, e `eh_manutencao`, que
// pode faltar nesses pontos, só afeta `cobra` — nunca o valor.
export function resolverSinal({
  estabelecimento,
  servico = null,
  data = null,
  ehNovo = false,
  naListaBloqueio = false,
  regras = undefined,
} = {}) {
  const padraoCentavos = estabelecimento?.sinal_valor_centavos ?? null;

  const vencedora = regraEspecialVencedora(
    regras ?? estabelecimento?.sinal_regras_especiais,
    servico,
    data
  );

  let cobra;
  let valor;

  if (vencedora) {
    cobra =
      vencedora.cobranca === "todas" ||
      (vencedora.cobranca === "exceto_manutencao" && !servico?.eh_manutencao);
    // `??` e não `||`: 0 é um valor configurável ("cobra, mas de graça" não
    // existe — mas se a dona digitar zero, o certo é gravar zero e não cair
    // silenciosamente no padrão do salão).
    valor = vencedora.valor_centavos ?? padraoCentavos;
  } else {
    // PASSO 4 — comportamento atual, transcrito de `precisaSinal`
    // (components/FormularioAgendamento.js) sem uma vírgula de diferença. É
    // este ramo que roda com a tabela vazia, ou seja, em 100% dos salões antes
    // de alguém cadastrar a primeira regra.
    cobra =
      estabelecimento?.sinal_regra === "todos" ||
      (estabelecimento?.sinal_regra === "exceto_manutencao" && !servico?.eh_manutencao) ||
      (estabelecimento?.sinal_regra === "novos" && ehNovo && !servico?.eh_manutencao);
    valor = padraoCentavos;
  }

  // PASSO 5 — a Lista de Bloqueio é a última palavra, por cima do padrão E da
  // regra especial. Não mexe no valor: quem está na Lista paga o mesmo que
  // qualquer outra pessoa pagaria naquele serviço e naquela data.
  if (naListaBloqueio) cobra = true;

  return { cobra: Boolean(cobra), valor_centavos: valor, regra: vencedora };
}

// Atalho pra quem só quer o número (os três componentes que exibem "Este
// agendamento exige um sinal de R$ X"). Mesma fonte, nunca uma segunda conta.
export function valorSinalCentavos(argumentos) {
  return resolverSinal(argumentos).valor_centavos;
}

// Este salão cobra sinal de ALGUÉM, em algum momento?
//
// Pergunta grosseira de propósito: não olha serviço, data nem cliente, só
// responde se existe cenário em que a cobrança acontece. Serve a um consumidor
// só — o curto-circuito de hidratarAbacatepayConectado (lib/estabelecimento.js),
// que pula a consulta da credencial quando ela não pode mudar decisão nenhuma.
//
// Antes das regras especiais, `sinal_regra !== 'desligado'` respondia isso
// sozinho. Agora não: um salão pode ter o padrão desligado e uma regra de
// dezembro que cobra de todo mundo, e nesse salão a credencial da AbacatePay
// importa. Falso positivo aqui custa um round-trip; falso negativo esconderia o
// QR Code de quem configurou tudo certo.
// Regra ENCERRADA (o período já passou) não conta: ela não vai cobrar de mais
// ninguém, e mantê-la no cálculo deixaria a tela de Configurações acesa em
// vermelho, e a consulta de credencial de pé, por causa de um dezembro que já
// foi. Regra FUTURA conta — em novembro, a de dezembro já precisa da chave Pix
// configurada, e é justamente aí que o aviso serve pra alguma coisa.
export function salaoPodeCobrarSinal(estabelecimento) {
  if (estabelecimento?.sinal_regra !== "desligado") return true;

  const hoje = hojeIso();

  return (estabelecimento?.sinal_regras_especiais ?? []).some((regra) => {
    if (regra?.cobranca === "nao_cobrar") return false;
    const fim = iso(regra?.data_fim);
    // Sem data de fim = regra "sempre": nunca encerra.
    return fim == null || fim >= hoje;
  });
}

// "YYYY-MM-DD" de hoje, componente a componente. NUNCA toISOString, que
// despeja em UTC e, depois das 21h em GMT-3, já devolve o dia seguinte —
// mesmo cuidado de dataMaisDias (ConfiguracoesSalao.js).
function hojeIso() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}
