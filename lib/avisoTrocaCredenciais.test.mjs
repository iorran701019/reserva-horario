// Rodar: node --test lib/avisoTrocaCredenciais.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { modoTrocaCredenciais, DIAS_AVISO } from "./avisoTrocaCredenciais.js";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 9, 16, 12, 0, 0);
const dono = (troca_exigida_em, marca = true) => ({
  papel: "dono",
  precisa_trocar_credenciais: marca,
  troca_exigida_em,
});
const haDias = (n) => new Date(AGORA - n * DIA).toISOString();

test("DIAS_AVISO e 30", () => {
  assert.equal(DIAS_AVISO, 30);
});
test("nenhum: papel global", () => {
  assert.equal(modoTrocaCredenciais({ ...dono(haDias(0)), papel: "global" }, AGORA), "nenhum");
});
test("nenhum: marca desligada", () => {
  assert.equal(modoTrocaCredenciais(dono(haDias(40), false), AGORA), "nenhum");
});
test("bloqueio: marca ligada sem data (reset)", () => {
  assert.equal(modoTrocaCredenciais(dono(null), AGORA), "bloqueio");
  assert.equal(modoTrocaCredenciais(dono(undefined), AGORA), "bloqueio");
});
test("aviso no dia 0", () => {
  assert.equal(modoTrocaCredenciais(dono(haDias(0)), AGORA), "aviso");
});
test("aviso no dia 29", () => {
  assert.equal(modoTrocaCredenciais(dono(haDias(29)), AGORA), "aviso");
});
test("bloqueio no dia 30", () => {
  assert.equal(modoTrocaCredenciais(dono(haDias(30)), AGORA), "bloqueio");
});
test("bloqueio: data invalida", () => {
  assert.equal(modoTrocaCredenciais(dono("nao e data"), AGORA), "bloqueio");
});
test("aviso: data no futuro", () => {
  assert.equal(modoTrocaCredenciais(dono(new Date(AGORA + 5 * DIA).toISOString()), AGORA), "aviso");
});
