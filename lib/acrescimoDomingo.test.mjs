// Rodar: node --test lib/acrescimoDomingo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { ehDomingoISO, diasDoPeriodoDeLiberacao } from "./acrescimoDomingo.js";

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
