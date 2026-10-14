import { formatarPreco } from "./preco.js";

// Regras puras do "serviço agregado" (servico_agregados): um serviço extra que
// a cliente acrescenta ao principal, com preço e tempo próprios. Sem import de
// supabase, no mesmo padrão de lib/sinalRegra.js, pra rodar igual no wizard, no
// /admin e em `node --test`. O import tem extensão (.js) de propósito: é o que
// o Node resolve sem bundler.

// Mesmos limites de duracaoEfetivaServico (components/FormularioAgendamento.js)
// e da RPC agendamento_criar (c_duracao_min / c_duracao_max).
export const DURACAO_MINIMA_MIN = 5;
export const DURACAO_MAXIMA_MIN = 720;

function inteiro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

// Total em centavos: serviço + agregado + ajustes das perguntas.
// preço do serviço nulo vale 0, igual a `precoBaseCentavos` do wizard
// (`servicoSelecionado?.preco_centavos ?? 0`); agregado nulo/indefinido vale 0.
export function somarPreco(precoServicoCentavos, precoAgregadoCentavos, ajustesCentavos = 0) {
  return (
    inteiro(precoServicoCentavos) + inteiro(precoAgregadoCentavos) + inteiro(ajustesCentavos)
  );
}

// O tempo do agregado só soma quando NENHUM profissional ativo do serviço tem
// agenda fixa (modo_horario 'fixo'). Espelha o gatilho do banco. Profissional
// sem `ativo` informado conta como ativo (o select do wizard já filtra ativos).
// Lista vazia -> true.
export function agregadoSomaTempo(profissionaisDoServico) {
  return !(profissionaisDoServico ?? []).some(
    (p) => p?.ativo !== false && p?.modo_horario === "fixo"
  );
}

// Duração gravada em agendamentos.duracao_min. Mesma regra de
// duracaoEfetivaServico (base + ajuste, piso de 5 min), mais o tempo do
// agregado quando `somaTempo`, e o teto de 720 da RPC.
export function somarTempo({
  duracaoServico,
  ajusteDuracao = 0,
  tempoAgregado = 0,
  somaTempo = false,
} = {}) {
  const total =
    inteiro(duracaoServico) + inteiro(ajusteDuracao) + (somaTempo ? inteiro(tempoAgregado) : 0);
  return Math.min(Math.max(total, DURACAO_MINIMA_MIN), DURACAO_MAXIMA_MIN);
}

// "Serviço + Agregado"; sem agregado, só o serviço.
export function nomeComAgregado(nomeServico, nomeAgregado) {
  const agregado = typeof nomeAgregado === "string" ? nomeAgregado.trim() : "";
  if (!agregado || !nomeServico) return nomeServico;
  return `${nomeServico} + ${agregado}`;
}

// Ponto único de verdade: este serviço aceita agregado (como PRINCIPAL e como
// AGREGADO)? Não aceita: manutenção (eh_manutencao), serviço de duas datas
// (exige_segunda_data) e a manutenção vinda de outro salão — que o wizard
// identifica por DOIS campos independentes: servicos.manutencao_externa (a
// caixa "Manutenção vinda de outro salão") e o serviço apontado por
// estabelecimentos.servico_manutencao_externa_id (o destino do "Sim, em outro
// salão"). `estabelecimento` pode faltar: só a regra do próprio serviço vale.
export function servicoAceitaAgregado(servico, estabelecimento) {
  if (!servico) return false;
  if (servico.eh_manutencao || servico.exige_segunda_data || servico.manutencao_externa) {
    return false;
  }
  const externoId = estabelecimento?.servico_manutencao_externa_id;
  if (externoId != null && externoId !== "" && String(externoId) === String(servico.id)) {
    return false;
  }
  return true;
}

// Admin: a reserva pode ter o agregado editado (modo isolado "Alterar serviço
// agregado")? Só em pendente, aguardando_sinal ou confirmado, fora de par
// (reserva_grupo_id) e com serviço que aceita agregado. `agendamento.servicos`
// vem do join e não traz o id; ele vem de `servico_id`.
const STATUS_ALTERA_AGREGADO = ["pendente", "aguardando_sinal", "confirmado"];
export function reservaPodeAlterarAgregado(agendamento, estabelecimento) {
  if (!agendamento || !STATUS_ALTERA_AGREGADO.includes(agendamento.status)) return false;
  if (agendamento.reserva_grupo_id) return false;
  if (!agendamento.servicos || agendamento.servico_id == null) return false;
  return servicoAceitaAgregado(
    { ...agendamento.servicos, id: agendamento.servico_id },
    estabelecimento
  );
}

// Variante de somarPreco pra mensagens e telas que escondem o preço quando o
// serviço não tem um: serviço sem preço (null) -> null (nunca inventa valor,
// nem só com o agregado); senão serviço + agregado.
export function somarPrecoOuNulo(precoServicoCentavos, precoAgregadoCentavos) {
  if (precoServicoCentavos == null) return null;
  return precoServicoCentavos + inteiro(precoAgregadoCentavos);
}

// "R$ 100,00 + R$ 150,00 = R$ 250,00" (formato de formatarPreco, sempre com
// centavos). Sem agregado (0 ou ausente), só o total formatado. Os ajustes das
// perguntas entram no total, não como parcela do texto.
export function resumoPreco(precoServicoCentavos, precoAgregadoCentavos, ajustesCentavos = 0) {
  const total = somarPreco(precoServicoCentavos, precoAgregadoCentavos, ajustesCentavos);
  const agregado = inteiro(precoAgregadoCentavos);
  if (agregado === 0) return formatarPreco(total);
  const principal = total - agregado;
  return `${formatarPreco(principal)} + ${formatarPreco(agregado)} = ${formatarPreco(total)}`;
}

// Valor padrão do CardConclusaoAtendimento quando a dona ainda não substituiu:
//   etapa anterior de um par -> 0
//   valor_cobrado_centavos   -> ele mesmo (já é o total, agregado incluso)
//   serviço sem preço (null) -> null: o card não inventa valor
//   senão preço do serviço + agregado_preco_centavos
export function precoPadraoConclusao(agendamento) {
  if (agendamento?.papel_reserva === "anterior") return 0;
  if (agendamento?.valor_cobrado_centavos != null) return agendamento.valor_cobrado_centavos;
  const preco = agendamento?.servicos?.preco_centavos;
  if (preco == null) return null;
  return preco + inteiro(agendamento?.agregado_preco_centavos);
}
