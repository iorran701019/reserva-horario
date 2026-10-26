// Rodar: node --test lib/acrescimoDomingo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  ehDomingoISO,
  diasDoPeriodoDeLiberacao,
  textoAcrescimo,
  percentualValido,
  valorTotalAgendamento,
  agendamentoTemAcrescimo,
  textoAcrescimoDona,
  comparaAcrescimo,
  precoPadraoConclusao,
} from "./acrescimoDomingo.js";

test("ehDomingoISO: domingo, não domingo e vazio", () => {
  assert.equal(ehDomingoISO("2026-10-25"), true);
  assert.equal(ehDomingoISO("2026-10-24"), false);
  assert.equal(ehDomingoISO("2026-10-26"), false);
  assert.equal(ehDomingoISO(""), false);
  assert.equal(ehDomingoISO(null), false);
});

test("diasDoPeriodoDeLiberacao: só domingos no modo domingo; senão, os escolhidos", () => {
  assert.deepEqual([...diasDoPeriodoDeLiberacao(true, [1, 2, 3])], [0]);
  assert.deepEqual([...diasDoPeriodoDeLiberacao(false, [1, 3])], [1, 3]);
  assert.equal(diasDoPeriodoDeLiberacao(false, []).size, 0);
});

import { conflitoDeHorario } from "./acrescimoDomingo.js";

const HOJE = "2026-10-22";
// 2026-10-25 é domingo.
const dia = (data, hora, marca) => ({
  tipo: "periodo", tipo_registro: "liberacao", data_inicio: data, data_fim: data,
  hora_inicio: hora, acrescimo_domingo: marca,
});
const todos = (hora, marca = true) => ({
  tipo: "recorrente", tipo_registro: "liberacao", dia_semana: 0,
  hora_inicio: hora, acrescimo_domingo: marca,
});

test("conflitoDeHorario: marcada x sem marca", () => {
  const c = conflitoDeHorario([dia("2026-10-25", "09:00", true)], [dia("2026-10-25", "09:00:00", false)], HOJE);
  assert.equal(c.tipo, "sem_marca");
  assert.match(c.mensagem, /^Em 25\/10 às 09:00 já existe uma liberação sem acréscimo\./);
});

test("conflitoDeHorario: sem marca x marcada (nulo vale como sem marca)", () => {
  const c = conflitoDeHorario([dia("2026-10-25", "09:00", null)], [dia("2026-10-25", "09:00", true)], HOJE);
  assert.equal(c.tipo, "com_marca");
  assert.match(c.mensagem, /já existe um domingo com acréscimo\. Exclua o acréscimo antes/);
});

test("conflitoDeHorario: Todos os domingos duas vezes", () => {
  const c = conflitoDeHorario([todos("09:00")], [todos("09:00")], HOJE);
  assert.equal(c.mensagem, "Todos os domingos já estão liberados com acréscimo às 09:00.");
});

test("conflitoDeHorario: avulso x Todos os domingos, nos dois sentidos", () => {
  const a = conflitoDeHorario([dia("2026-10-25", "09:00", true)], [todos("09:00")], HOJE);
  assert.equal(a.tipo, "marcada_recorrente");
  const b = conflitoDeHorario([todos("09:00")], [dia("2026-11-01", "09:00", true)], HOJE);
  assert.equal(b.tipo, "marcada_data");
  assert.equal(b.mensagem, "Em 01/11 às 09:00 já existe um domingo com acréscimo.");
});

test("conflitoDeHorario: liberação recorrente de domingo sem marca x marcada de data", () => {
  const c = conflitoDeHorario([dia("2026-10-25", "09:00", true)], [todos("09:00", false)], HOJE);
  assert.equal(c.tipo, "sem_marca");
});

test("conflitoDeHorario: sem marca x sem marca não é conflito", () => {
  assert.equal(conflitoDeHorario([dia("2026-10-25", "09:00", false)], [dia("2026-10-25", "09:00", false)], HOJE), null);
  assert.equal(conflitoDeHorario([todos("09:00", false)], [todos("09:00", null)], HOJE), null);
});

test("conflitoDeHorario: horário ou dia diferente não conflita", () => {
  assert.equal(conflitoDeHorario([dia("2026-10-25", "10:00", true)], [dia("2026-10-25", "09:00", false)], HOJE), null);
  assert.equal(conflitoDeHorario([dia("2026-10-25", "09:00", true)], [dia("2026-11-01", "09:00", true)], HOJE), null);
  assert.equal(conflitoDeHorario([dia("2026-10-26", "09:00", false)], [todos("09:00")], HOJE), null);
});

test("conflitoDeHorario: existente de data passada é ignorada", () => {
  assert.equal(conflitoDeHorario([todos("09:00")], [dia("2026-10-18", "09:00", false)], HOJE), null);
});

test("conflitoDeHorario: edição (linha editada fora da lista) não conflita consigo", () => {
  const lista = [dia("2026-10-25", "09:00", true)];
  const semEditadas = lista.filter(() => false);
  assert.equal(conflitoDeHorario([dia("2026-10-25", "09:00", true)], semEditadas, HOJE), null);
});

test("conflitoDeHorario: duplicata dentro do lote", () => {
  const c = conflitoDeHorario([dia("2026-10-25", "09:00", true), dia("2026-10-25", "09:00", true)], [], HOJE);
  assert.equal(c.tipo, "marcada_data");
  assert.equal(conflitoDeHorario([dia("2026-10-25", "09:00", true), dia("2026-10-25", "10:00", true)], [], HOJE), null);
});

test("conflitoDeHorario: recorrente x recorrente, sem a palavra null, nos dois sentidos", () => {
  const a = conflitoDeHorario([todos("09:00", false)], [todos("09:00", true)], HOJE);
  assert.equal(a.mensagem, "Todo domingo às 09:00 já existe um domingo com acréscimo. Exclua o acréscimo antes de liberar este horário.");
  assert.doesNotMatch(a.mensagem, /null/);
  const b = conflitoDeHorario([todos("09:00", true)], [todos("09:00", false)], HOJE);
  assert.equal(b.mensagem, "Todo domingo às 09:00 já existe uma liberação sem acréscimo. Exclua essa liberação antes, senão o acréscimo não vale.");
  assert.doesNotMatch(b.mensagem, /null/);
});

test("conflitoDeHorario: existente periodo com intervalo data_inicio..data_fim", () => {
  const faixa = { ...dia("2026-10-20", "09:00", false), data_fim: "2026-11-03" };
  // data nova dentro do intervalo
  assert.equal(conflitoDeHorario([dia("2026-10-25", "09:00", true)], [faixa], HOJE).tipo, "sem_marca");
  // fora do intervalo
  assert.equal(conflitoDeHorario([dia("2026-11-08", "09:00", true)], [faixa], HOJE), null);
  // recorrente nova: primeiro domingo futuro do intervalo (25/10)
  const c = conflitoDeHorario([todos("09:00", true)], [faixa], HOJE);
  assert.equal(c.data, "2026-10-25");
  // intervalo encerrado é ignorado; data_fim nulo vale data_inicio
  const velha = { ...dia("2026-10-01", "09:00", false), data_fim: "2026-10-20" };
  assert.equal(conflitoDeHorario([todos("09:00", true)], [velha], HOJE), null);
  const semFim = { ...dia("2026-10-25", "09:00", false), data_fim: null };
  assert.equal(conflitoDeHorario([dia("2026-10-25", "09:00", true)], [semFim], HOJE).tipo, "sem_marca");
  // intervalo futuro sem nenhum domingo
  const semana = { ...dia("2026-10-26", "09:00", false), data_fim: "2026-10-31" };
  assert.equal(conflitoDeHorario([todos("09:00", true)], [semana], HOJE), null);
});

import {
  liberacaoEntraNoCalendario,
  liberacaoCobreDia,
  liberacaoAindaVale,
  diaTemAcrescimo,
} from "./acrescimoDomingo.js";

// Datas montadas por partes (nunca new Date("YYYY-MM-DD")).
const iso = (ano, mes, d) => {
  const x = new Date(ano, mes - 1, d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const DOM = iso(2026, 10, 25); // domingo
const SEG = iso(2026, 10, 26);
const SEMFIM = (diaSemana, marca) => ({
  tipo: "recorrente", tipo_registro: "liberacao", dia_semana: diaSemana,
  data_inicio: null, data_fim: null, acrescimo_domingo: marca,
});

test("calendário: um domingo (periodo de um dia) cobre só aquele dia", () => {
  const a = dia(DOM, "09:00", true);
  assert.equal(liberacaoCobreDia(a, DOM), true);
  assert.equal(liberacaoCobreDia(a, SEG), false);
  assert.equal(diaTemAcrescimo([a], DOM), true);
  assert.equal(diaTemAcrescimo([a], SEG), false);
});

test("calendário: periodo cobre cada domingo gravado, não os outros", () => {
  const lista = [dia(iso(2026, 10, 25), "09:00", true), dia(iso(2026, 11, 1), "09:00", true)];
  assert.equal(diaTemAcrescimo(lista, iso(2026, 11, 1)), true);
  assert.equal(diaTemAcrescimo(lista, iso(2026, 11, 8)), false);
});

test("calendário: todos os domingos cobre qualquer domingo e nenhum outro dia", () => {
  const a = SEMFIM(0, true);
  assert.equal(liberacaoEntraNoCalendario(a), true);
  assert.equal(liberacaoCobreDia(a, DOM), true);
  assert.equal(liberacaoCobreDia(a, iso(2027, 3, 7)), true);
  assert.equal(liberacaoCobreDia(a, SEG), false);
  assert.equal(diaTemAcrescimo([a], iso(2027, 3, 7)), true);
});

test("calendário: recorrente SEM acréscimo continua ignorada", () => {
  for (const marca of [false, null, undefined]) {
    const a = SEMFIM(0, marca);
    assert.equal(liberacaoEntraNoCalendario(a), false);
    assert.equal(liberacaoCobreDia(a, DOM), false);
    assert.equal(liberacaoAindaVale(a, DOM), false);
    assert.equal(diaTemAcrescimo([a], DOM), false);
  }
});

test("calendário: recorrente de outro dia da semana com acréscimo não abre (marca só vale no domingo)", () => {
  const quarta = SEMFIM(3, true);
  assert.equal(liberacaoEntraNoCalendario(quarta), false);
  assert.equal(liberacaoCobreDia(quarta, iso(2026, 10, 28)), false);
  assert.equal(liberacaoCobreDia(quarta, DOM), false);
  assert.equal(diaTemAcrescimo([quarta], iso(2026, 10, 28)), false);
});

test("calendário: data_fim nula = sem fim só no domingo recorrente marcado", () => {
  assert.equal(liberacaoAindaVale(SEMFIM(0, true), iso(2030, 1, 1)), true);
  assert.equal(liberacaoAindaVale(dia(DOM, "09:00", true), DOM), true);
  assert.equal(liberacaoAindaVale(dia(DOM, "09:00", true), SEG), false);
  assert.equal(liberacaoAindaVale({ tipo: "periodo", data_inicio: DOM, data_fim: null }, DOM), false);
});

test("calendário: periodo sem marca abre o dia mas não conta como acréscimo", () => {
  const a = dia(DOM, "09:00", false);
  assert.equal(liberacaoEntraNoCalendario(a), true);
  assert.equal(liberacaoCobreDia(a, DOM), true);
  assert.equal(diaTemAcrescimo([a], DOM), false);
});

test("textoAcrescimo: percentual válido mostra o número", () => {
  assert.equal(textoAcrescimo(50), "Acréscimo de 50% sobre o valor total do agendamento");
  assert.equal(textoAcrescimo(12.5), "Acréscimo de 12.5% sobre o valor total do agendamento");
});

test("textoAcrescimo: inválido cai no texto sem número", () => {
  const semNumero = "Acréscimo sobre o valor total do agendamento";
  for (const v of [null, undefined, NaN, 0, -10, Infinity, "50"]) {
    assert.equal(textoAcrescimo(v), semNumero);
  }
});

test("percentualValido: só número finito maior que zero", () => {
  assert.equal(percentualValido(50), true);
  assert.equal(percentualValido(0), false);
  assert.equal(percentualValido(null), false);
});

import { precoComAcrescimo, horarioTemAcrescimo } from "./acrescimoDomingo.js";

test("precoComAcrescimo: 1005 com 50% dá 1507 (fração .5 arredonda para baixo)", () => {
  assert.equal(precoComAcrescimo(1005, 50), 1507);
  assert.equal(precoComAcrescimo(10000, 50), 15000);
  assert.equal(precoComAcrescimo(1000, 7.1), 1071);
});

test("precoComAcrescimo: base zero", () => {
  assert.equal(precoComAcrescimo(0, 50), 0);
});

test("precoComAcrescimo: percentual nulo, zero e negativo devolve a base", () => {
  for (const p of [null, undefined, 0, -10, NaN]) assert.equal(precoComAcrescimo(1005, p), 1005);
});

test("precoComAcrescimo: base não numérica, fracionária ou negativa devolve a base", () => {
  assert.equal(precoComAcrescimo("100", 50), "100");
  assert.equal(precoComAcrescimo(null, 50), null);
  assert.equal(precoComAcrescimo(10.5, 50), 10.5);
  assert.equal(precoComAcrescimo(-100, 50), -100);
});

function mapaCru(livres, marcas) {
  const m = { ...livres };
  Object.defineProperty(m, "acrescimoPorHorario", {
    value: new Map(Object.entries(marcas).map(([h, ids]) => [h, new Set(ids)])),
    enumerable: false,
  });
  return m;
}

test("horarioTemAcrescimo: com profissional escolhido vale a marca dele", () => {
  const m = mapaCru({ "09:00": ["a", "b"] }, { "09:00": ["a"] });
  assert.equal(horarioTemAcrescimo(m, "09:00", "a"), true);
  assert.equal(horarioTemAcrescimo(m, "09:00", "b"), false);
});

test("horarioTemAcrescimo: sem escolha só vale se TODOS os livres tiverem a marca", () => {
  assert.equal(horarioTemAcrescimo(mapaCru({ "09:00": ["a", "b"] }, { "09:00": ["a", "b"] }), "09:00", null), true);
  assert.equal(horarioTemAcrescimo(mapaCru({ "09:00": ["a", "b"] }, { "09:00": ["a"] }), "09:00", null), false);
});

test("horarioTemAcrescimo: sem marca, mapa ausente ou sem livre devolve false", () => {
  assert.equal(horarioTemAcrescimo(mapaCru({ "09:00": ["a"] }, {}), "09:00", "a"), false);
  assert.equal(horarioTemAcrescimo(null, "09:00", "a"), false);
  assert.equal(horarioTemAcrescimo({ "09:00": ["a"] }, "09:00", null), false);
  assert.equal(horarioTemAcrescimo(mapaCru({ "09:00": [] }, { "09:00": ["a"] }), "09:00", null), false);
  assert.equal(horarioTemAcrescimo(mapaCru({}, {}), "", null), false);
});

import { acrescimoAplicavel } from "./acrescimoDomingo.js";

test("acrescimoAplicavel: reserva já criada manda, mesmo se a marca sumiu do mapa", () => {
  const comMarca = mapaCru({ "09:00": ["a"] }, { "09:00": ["a"] });
  const semMarca = mapaCru({ "09:00": ["a"] }, {});
  const base = { percentual: 50, horario: "09:00", profissionalId: "a", temReserva: true };
  assert.equal(acrescimoAplicavel({ ...base, mapa: semMarca, decididoNaReserva: true }), true);
  assert.equal(acrescimoAplicavel({ ...base, mapa: comMarca, decididoNaReserva: false }), false);
  // sem decisão gravada (reserva restaurada), cai no mapa
  assert.equal(acrescimoAplicavel({ ...base, mapa: comMarca, decididoNaReserva: null }), true);
  // sem reserva, a decisão antiga é ignorada
  assert.equal(acrescimoAplicavel({ ...base, temReserva: false, mapa: semMarca, decididoNaReserva: true }), false);
});

test("acrescimoAplicavel: par, modo livre e percentual inválido nunca aplicam", () => {
  const m = mapaCru({ "09:00": ["a"] }, { "09:00": ["a"] });
  const base = { percentual: 50, mapa: m, horario: "09:00", profissionalId: "a" };
  assert.equal(acrescimoAplicavel(base), true);
  assert.equal(acrescimoAplicavel({ ...base, ehPar: true }), false);
  assert.equal(acrescimoAplicavel({ ...base, modoLivre: true }), false);
  assert.equal(acrescimoAplicavel({ ...base, percentual: 0 }), false);
  assert.equal(acrescimoAplicavel({ ...base, percentual: null, temReserva: true, decididoNaReserva: true }), false);
});

import { textoAcrescimoCliente } from "./acrescimoDomingo.js";

test("textoAcrescimoCliente: texto fixo, sem percentual nem valor", () => {
  assert.equal(textoAcrescimoCliente(), "Acréscimo de Domingo no valor total do serviço");
  assert.doesNotMatch(textoAcrescimoCliente(), /%|R\$|\d/);
});

test("valorTotalAgendamento: 1005 com 50% arredonda para baixo (1507)", () => {
  const linha = { servicos: { preco_centavos: 1005 }, acrescimo_percentual_aplicado: 50 };
  assert.equal(valorTotalAgendamento(linha), 1507);
});

test("valorTotalAgendamento: agregado e ajustes entram na base", () => {
  const linha = {
    servicos: { preco_centavos: 1005 },
    agregado_preco_centavos: 500,
    acrescimo_percentual_aplicado: 50,
  };
  assert.equal(valorTotalAgendamento({ ...linha, acrescimo_percentual_aplicado: null }, 100), 1605);
  assert.equal(valorTotalAgendamento(linha, 100), 2407);
});

test("valorTotalAgendamento: percentual nulo devolve a base, agregado nulo conta 0", () => {
  const linha = {
    servicos: { preco_centavos: 1005 },
    agregado_preco_centavos: null,
    acrescimo_percentual_aplicado: null,
  };
  assert.equal(valorTotalAgendamento(linha), 1005);
});

test("valorTotalAgendamento: sem serviço devolve null", () => {
  assert.equal(valorTotalAgendamento({ acrescimo_percentual_aplicado: 50 }), null);
  assert.equal(valorTotalAgendamento({ servicos: { preco_centavos: null } }), null);
  assert.equal(valorTotalAgendamento(null), null);
});

test("agendamentoTemAcrescimo: só com percentual válido", () => {
  assert.equal(agendamentoTemAcrescimo({ acrescimo_percentual_aplicado: 10 }), true);
  assert.equal(agendamentoTemAcrescimo({ acrescimo_percentual_aplicado: null }), false);
  assert.equal(agendamentoTemAcrescimo(null), false);
});

test("textoAcrescimoDona: com e sem percentual", () => {
  assert.equal(textoAcrescimoDona(20), "Agendamento com acréscimo de domingo (20%)");
  assert.equal(textoAcrescimoDona(null), "Agendamento com acréscimo de domingo sem número");
});

test("comparaAcrescimo: ligar, desligar e manter", () => {
  assert.equal(comparaAcrescimo({ temAtual: false, temNovo: true }), "ligar");
  assert.equal(comparaAcrescimo({ temAtual: true, temNovo: false }), "desligar");
  assert.equal(comparaAcrescimo({ temAtual: true, temNovo: true }), "manter");
  assert.equal(comparaAcrescimo({ temAtual: false, temNovo: false }), "manter");
});

test("precoPadraoConclusao", () => {
  const base = { servicos: { preco_centavos: 10000 } };
  assert.equal(precoPadraoConclusao(base), 10000); // sem agregado = hoje
  assert.equal(precoPadraoConclusao({ ...base, agregado_preco_centavos: 15000 }), 25000);
  assert.equal(
    precoPadraoConclusao({ ...base, valor_cobrado_centavos: 9000, agregado_preco_centavos: 15000 }),
    9000
  );
  assert.equal(precoPadraoConclusao({ servicos: { preco_centavos: null }, agregado_preco_centavos: 5000 }), null);
  assert.equal(precoPadraoConclusao({ servicos: null }), null);
  assert.equal(precoPadraoConclusao({ ...base, papel_reserva: "anterior" }), 0);
});

test("precoPadraoConclusao: acréscimo de domingo e ajustes das perguntas", () => {
  const base = { servicos: { preco_centavos: 10000 } };
  // acréscimo sobre serviço + agregado (mesma conta do cron)
  assert.equal(precoPadraoConclusao({ ...base, acrescimo_percentual_aplicado: 20 }), 12000);
  assert.equal(
    precoPadraoConclusao({ ...base, agregado_preco_centavos: 5000, acrescimo_percentual_aplicado: 10 }),
    16500
  );
  // ajustes entram na base ANTES do acréscimo
  assert.equal(
    precoPadraoConclusao({ ...base, acrescimo_percentual_aplicado: 50 }, 2000),
    18000
  );
  assert.equal(precoPadraoConclusao({ ...base }, 2000), 12000);
  // ajuste negativo (desconto) também entra na base
  assert.equal(precoPadraoConclusao({ ...base, acrescimo_percentual_aplicado: 10 }, -1000), 9900);
  // ajustes ausentes, nulos ou indefinidos contam 0
  assert.equal(precoPadraoConclusao({ ...base, acrescimo_percentual_aplicado: 20 }, undefined), 12000);
  assert.equal(precoPadraoConclusao({ ...base, acrescimo_percentual_aplicado: 20 }, 0), 12000);
  // arredonda pra baixo uma vez: 1005 * 50% = 502,5 -> 502
  assert.equal(
    precoPadraoConclusao({ servicos: { preco_centavos: 1005 }, acrescimo_percentual_aplicado: 50 }),
    1507
  );
  // percentual nulo = sem acréscimo
  assert.equal(precoPadraoConclusao({ ...base, acrescimo_percentual_aplicado: null }), 10000);
  // o que já foi gravado e a etapa anterior seguem como antes
  assert.equal(
    precoPadraoConclusao({ ...base, valor_cobrado_centavos: 9000, acrescimo_percentual_aplicado: 20 }),
    9000
  );
  assert.equal(precoPadraoConclusao({ ...base, papel_reserva: "anterior", acrescimo_percentual_aplicado: 20 }), 0);
  assert.equal(precoPadraoConclusao({ servicos: { preco_centavos: null }, acrescimo_percentual_aplicado: 20 }), null);
});
