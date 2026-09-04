// Janela de agendamento por DATA ÚNICA (estabelecimentos.janela_agendamento_fim).
//
// LEGADO desde o status mensal da agenda (ver o bloco "Status mensal da
// agenda" mais abaixo): NENHUM ponto de decisão de agendamento chama mais as
// duas funções deste bloco — quem decide é mesAgendavel/dataAgendavelComMes,
// pelo registro do mês. Ficam aqui, intocadas e exportadas, porque módulos
// antigos ainda as importam e porque a coluna continua existindo (o campo no
// /admin virou decorativo). Não volte a chamá-las de dentro de mesAgendavel.

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
// Status mensal da agenda (tabela `janela_agendamento_meses`)
//
// Evolução da data única acima: em vez de "a agenda vai até 30/11", o salão
// marca MÊS A MÊS se está aberto, fechado ou restrito a uma etiqueta. Cada
// linha é (estabelecimento_id, ano, mes, status, etiqueta_liberada_id).
//
// Relação com janela_agendamento_fim, decidida com o Iorran: o status do mês
// SUBSTITUIU a data única, inteira. A agenda pública passa a ser FAIL-CLOSED:
// mês SEM registro em janela_agendamento_meses = mês FECHADO, sem exceção e
// sem consultar janela_agendamento_fim. Nada mais lê a data única pra decidir
// agendamento — dentroDaJanelaAgendamento continua exportada e intocada só
// porque módulos antigos ainda a importam, e o campo do /admin virou
// decorativo (ver ConfiguracoesSalao).
//
// Consequência que quem mexer aqui precisa saber: um salão sem NENHUMA linha
// em janela_agendamento_meses tem a agenda pública inteiramente fechada. É a
// regra pedida (nada abre por acidente), não um bug — a dona abre mês a mês
// na grade de Regras de negócio.
//
// A ÚNICA exceção ao fail-closed é a falha de LEITURA (rede caiu, Supabase
// fora, RLS negando): aí não sabemos o que está configurado, e "não sei" não
// pode virar "fechado" — seria derrubar a agenda de um salão pagante por um
// problema nosso. Esse caso é sinalizado pelo loader e tratado como fail-open
// (equivale a não filtrar por mês). Ver marcarMesesJanelaIndisponiveis logo
// abaixo. Repare na assimetria, ela é deliberada:
//   consulta OK, zero linhas  -> Map vazio      -> FECHADO (falta configurar)
//   consulta falhou           -> Map sinalizado -> ABERTO  (não sabemos)

// Chave do Map/objeto de configuração: "AAAA-M" (mês SEM zero à esquerda —
// use sempre esta função dos dois lados, nunca monte a chave na mão).
export function chaveMesJanela(ano, mes) {
  return `${Number(ano)}-${Number(mes)}`;
}

// Sinaliza um mapa de meses como "não deu pra ler" (ver o bloco acima). É uma
// PROPRIEDADE no próprio Map, e não um retorno de formato diferente (null, ou
// { mapa, erro }), de propósito: o mapa atravessa uma pilha inteira de
// consumidores que já o tratam como Map puro — carregarBaseDisponibilidade ->
// base.mesesJanela, o state de page.js/FormularioAgendamento, a prop de
// CalendarioDias — e todos continuam funcionando sem nenhuma mudança
// (`.get`/`.values`/`.size` de um mapa vazio). Só quem precisa da distinção
// pergunta por ela.
//
// Cuidado ao propagar: a marca vive no objeto, então recriar o mapa
// (`new Map(atual)`) ou trocá-lo por um default estável a perde. Isso é o
// certo depois de uma gravação bem-sucedida, e é um BUG onde a intenção era
// repassar o resultado da leitura adiante.
export function marcarMesesJanelaIndisponiveis(mapa = new Map()) {
  mapa.erroDeLeitura = true;
  return mapa;
}

// Este mapa veio de uma leitura que FALHOU? (o oposto de "veio vazio").
export function mesesJanelaIndisponiveis(mesesConfig) {
  return Boolean(mesesConfig?.erroDeLeitura);
}

// Lê o registro do mês de um Map OU de um objeto simples (o loader devolve
// Map, mas aceitar os dois deixa a função testável sem construir um Map).
function registroDoMes(ano, mes, mesesConfig) {
  if (!mesesConfig) return null;
  const chave = chaveMesJanela(ano, mes);
  if (typeof mesesConfig.get === "function") return mesesConfig.get(chave) ?? null;
  return mesesConfig[chave] ?? null;
}

// Um registro de mês libera quem está agendando?
//   'aberto'   -> sempre
//   'fechado'  -> nunca
//   'restrito' -> quem tem a etiqueta_liberada_id do registro, OU qualquer
//                 pessoa a partir de abre_para_todos_em (opcional). Mesma
//                 comparação de restricaoLibera (abaixo): as DUAS pontas da
//                 etiqueta precisam existir — nula nunca "casa" com nula.
// Status desconhecido/nulo (linha existe, com um valor que ninguém reconhece)
// segue liberando: o fail-closed desta feature está na AUSÊNCIA de registro,
// checada em mesAgendavel — aqui já houve uma decisão explícita da dona.
function mesLibera(registro, etiquetaClienteId, hoje = null) {
  if (registro.status === "fechado") return false;
  if (registro.status === "restrito") {
    // `abre_para_todos_em` tem exatamente o mesmo nome, tipo e significado em
    // `restricoes_agenda` e em `janela_agendamento_meses`, então a checagem é
    // a MESMA função de restricoes_agenda (restricaoAbertaParaTodos, no fim
    // do arquivo) — nunca uma cópia. Chegada a data, o mês vale como 'aberto'.
    if (restricaoAbertaParaTodos(registro, hoje)) return true;
    return (
      etiquetaClienteId != null &&
      registro.etiqueta_liberada_id != null &&
      registro.etiqueta_liberada_id === etiquetaClienteId
    );
  }
  return true;
}

// Quantos meses o /admin lista pra configurar (e o card do Painel exibe),
// quando estabelecimentos.meses_alcance_edicao_agenda não está preenchido.
export const MESES_ALCANCE_PADRAO = 4;

// Os N meses a partir do mês corrente: [{ ano, mes }], mes 1–12. Fonte única
// da fileira do card do Painel e da grade de configuração, pra as duas telas
// nunca mostrarem meses diferentes.
export function mesesDoAlcance(quantidade, agora = new Date()) {
  const total = Number(quantidade) > 0 ? Number(quantidade) : MESES_ALCANCE_PADRAO;
  const lista = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() + i, 1);
    lista.push({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }
  return lista;
}

// Status configurado do mês, ou null quando não há registro — e "sem
// registro" AGORA significa fechado (ver o bloco acima), o que a UI precisa
// pintar como fechado, não como um estado neutro. Só pra UI — a decisão de
// bloqueio é de mesAgendavel/dataAgendavelComMes, a fonte única da regra.
export function statusDoMes(ano, mes, mesesConfig) {
  return registroDoMes(ano, mes, mesesConfig)?.status ?? null;
}

// Registro cru do mês (pra UI que precisa da etiqueta_liberada_id/id da linha).
export function registroMesJanela(ano, mes, mesesConfig) {
  return registroDoMes(ano, mes, mesesConfig);
}

// (ano, mes) -> mês agendável? FONTE ÚNICA da regra: sem registro do mês, o
// mês está FECHADO (fail-closed, ver o bloco de comentário acima) — exceto se
// o mapa vier marcado como falha de leitura, que é fail-open. Nenhum fallback
// pra janela_agendamento_fim.
//
// `estabelecimento` não é mais lido — o parâmetro fica na assinatura de
// propósito, pra não quebrar os pontos de chamada existentes (page.js,
// FormularioAgendamento, disponibilidade.js) numa fatia que já mexe em muita
// coisa. Pode sair num passe de limpeza depois.
export function mesAgendavel(
  ano,
  mes,
  estabelecimento,
  mesesConfig,
  etiquetaClienteId = null,
  hoje = null
) {
  // Falha de leitura: não sabemos a configuração, então não filtramos por mês
  // (fail-OPEN). É a única saída antecipada daqui, e vale só pra este caso —
  // ausência real de registro continua fechando, logo abaixo.
  if (mesesJanelaIndisponiveis(mesesConfig)) return true;

  const registro = registroDoMes(ano, mes, mesesConfig);
  if (!registro) return false;
  return mesLibera(registro, etiquetaClienteId, hoje);
}

// "YYYY-MM-DD" -> data agendável? É esta a função chamada nos pontos de
// decisão (calendário do wizard, carregarBaseDisponibilidade, submit do
// /admin). Wrapper FINO sobre mesAgendavel: a granularidade da regra é o MÊS,
// nenhuma checagem de dia sobra por cima. Continua exportada com a mesma
// assinatura porque é o que todos os pontos de chamada usam.
export function dataAgendavelComMes(
  iso,
  estabelecimento,
  mesesConfig,
  etiquetaClienteId = null,
  hoje = null
) {
  // Sem data não há mês pra consultar — "não sei" nunca vira bloqueio (mesmo
  // critério das outras funções daqui que respondem sobre uma data ausente).
  if (!iso) return true;

  const [ano, mes] = iso.split("-").map(Number);
  return mesAgendavel(ano, mes, estabelecimento, mesesConfig, etiquetaClienteId, hoje);
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
