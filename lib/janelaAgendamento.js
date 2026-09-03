// Janela de agendamento: cada salão tem uma data fixa
// (estabelecimentos.janela_agendamento_fim) além da qual nenhum dia pode ser
// agendado, no fluxo público E no /admin. Fonte única da checagem — qualquer
// lugar que decide se um dia é selecionável (calendário do wizard,
// calcularVagasPorHorario) chama a MESMA função, pra nunca divergir.
//
// null/undefined em janela_agendamento_fim = salão ainda não configurou (ou
// migração recente) => SEM restrição, nenhum dia é bloqueado por aqui. A UI
// de configuração (ConfiguracoesSalao) trata o campo como obrigatório pra
// GRAVAR, mas a ausência de valor no banco não pode travar o fluxo de quem
// ainda não configurou.

// "YYYY-MM-DD" -> dentro da janela? Comparação lexicográfica ISO, mesmo
// padrão usado no resto do app pra datas nesse formato (ex.: lib/disponibilidade.js).
export function dentroDaJanelaAgendamento(data, estabelecimento) {
  const fim = estabelecimento?.janela_agendamento_fim;
  if (!fim || !data) return true;
  return data <= fim;
}

// Dias restantes até o fim da janela (pode ser negativo, se já passou).
// null quando a janela não está configurada — quem chama decide o que fazer
// (banner/popup só aparecem com um valor numérico).
export function diasRestantesJanela(janelaFim) {
  if (!janelaFim) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const [ano, mes, dia] = janelaFim.split("-").map(Number);
  const fim = new Date(ano, mes - 1, dia);

  const diffMs = fim.getTime() - hoje.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Restrições de agenda por etiqueta (tabela `restricoes_agenda`)
//
// Segunda camada de bloqueio de DIA, independente da janela acima: um período
// (data_inicio..data_fim) em que só quem tem uma etiqueta específica pode
// agendar — ex.: "Dezembro só pra clientes VIP". A regra é PURA e mora aqui
// junto de dentroDaJanelaAgendamento porque é exatamente o mesmo tipo de
// decisão ("este dia é oferecível?") e os dois são checados nos MESMOS três
// pontos (calendário do wizard, carregarBaseDisponibilidade e
// calcularVagasDoMes) — um dia só é selecionável se passar nas DUAS.
//
// Quem carrega as linhas do banco é buscarRestricoesAtivas, em
// lib/disponibilidade.js (este módulo continua sem tocar em supabase, o que
// deixa a regra testável e utilizável também fora do browser).
//
// O `etiqueta_id` da cliente trafega pelo fluxo público só pra alimentar esta
// função: NENHUMA tela pública mostra nome/emoji de etiqueta — isso é
// informação interna do salão (ver SeletorEtiquetaRapido/mostrarEtiquetaAdmin).

// Data de HOJE em "YYYY-MM-DD" local. Mesma construção componente-a-componente
// do resto do app (nunca toISOString, que despeja em UTC e pode voltar um dia).
function hojeISO() {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Restrições ATIVAS cujo período cobre `data` (comparação lexicográfica ISO,
// mesmo padrão de excecoesDoDia em lib/disponibilidade.js). Linhas sem
// data_inicio/data_fim são ignoradas — período incompleto não cobre nada.
export function restricoesQueCobrem(data, restricoes) {
  if (!data) return [];
  return (restricoes ?? []).filter(
    (r) =>
      r.ativa !== false &&
      r.data_inicio &&
      r.data_fim &&
      r.data_inicio <= data &&
      data <= r.data_fim
  );
}

// Uma restrição LIBERA este dia para esta cliente quando a etiqueta dela é a
// etiqueta_liberada_id da restrição, OU quando a data de abertura geral
// (abre_para_todos_em, opcional) já chegou. Qualquer outro caso é bloqueio.
function restricaoLibera(restricao, etiquetaClienteId, hoje) {
  if (
    etiquetaClienteId != null &&
    restricao.etiqueta_liberada_id != null &&
    restricao.etiqueta_liberada_id === etiquetaClienteId
  ) {
    return true;
  }
  return Boolean(restricao.abre_para_todos_em) && hoje >= restricao.abre_para_todos_em;
}

// "YYYY-MM-DD" + restrições do salão + etiqueta da cliente -> dia liberado?
//
// Sem nenhuma restrição ativa cobrindo a data, o dia segue liberado (esta
// função nunca é a que fecha um dia por conta própria).
//
// Com DUAS OU MAIS restrições cobrindo o mesmo dia, aplica em dois passes
// determinísticos — o resultado não pode depender da ordem em que as linhas
// chegam do banco (a query não garante ordem), mesmo padrão de aplicarExcecoes
// em lib/disponibilidade.js:
//   PASSO 1 — liberações: qualquer restrição que libere marca o dia liberado.
//   PASSO 2 — bloqueios, sempre DEPOIS: qualquer restrição que NÃO libere
//             derruba a liberação. Um bloqueio sempre vence uma liberação no
//             mesmo dia, não importa qual linha foi criada primeiro.
//
// `contexto === "admin"` nunca bloqueia (mesma regra da janela de agendamento):
// quem chama a partir do /admin passa contexto:'admin' e recebe sempre true —
// a decisão consciente acontece no popup do submit (ver FormularioAgendamento).
export function diaLiberadoPorEtiqueta(
  data,
  restricoes,
  etiquetaClienteId,
  { hoje = null, contexto = "publico" } = {}
) {
  if (contexto === "admin") return true;

  const cobrindo = restricoesQueCobrem(data, restricoes);
  if (cobrindo.length === 0) return true;

  const referencia = hoje ?? hojeISO();

  let liberado = false;
  for (const restricao of cobrindo) {
    if (restricaoLibera(restricao, etiquetaClienteId, referencia)) liberado = true;
  }

  for (const restricao of cobrindo) {
    if (!restricaoLibera(restricao, etiquetaClienteId, referencia)) liberado = false;
  }

  return liberado;
}

// Restrições ativas que ainda importam HOJE — as que cobrem hoje ou começam no
// futuro (data_fim >= hoje), ordenadas por data_inicio. Alimenta o banner do
// Painel (ver app/[salon]/admin/page.js): o /admin quer ver "o que está
// restrito agora ou a seguir", não o histórico de períodos já vencidos.
export function restricoesVigentesOuFuturas(restricoes, hoje = null) {
  const referencia = hoje ?? hojeISO();
  return (restricoes ?? [])
    .filter((r) => r.ativa !== false && r.data_fim && r.data_fim >= referencia)
    .sort((a, b) => String(a.data_inicio).localeCompare(String(b.data_inicio)));
}

// Já abriu pra todo mundo? Usado só pelo texto do banner (a decisão de
// bloqueio em si é de diaLiberadoPorEtiqueta, acima).
export function restricaoAbertaParaTodos(restricao, hoje = null) {
  const referencia = hoje ?? hojeISO();
  return Boolean(restricao?.abre_para_todos_em) && referencia >= restricao.abre_para_todos_em;
}
