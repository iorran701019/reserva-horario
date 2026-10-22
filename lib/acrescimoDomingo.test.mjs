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
