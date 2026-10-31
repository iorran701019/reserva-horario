import test from "node:test";
import assert from "node:assert/strict";
import { TIPOS_PROFISSIONAL, tipoConhecido, rotuloTipoProfissional } from "./tiposProfissional.js";

test("tipoConhecido reconhece só os ids da lista", () => {
  for (const t of TIPOS_PROFISSIONAL) assert.equal(tipoConhecido(t.id), true);
  assert.equal(tipoConhecido("podologa"), false);
  assert.equal(tipoConhecido("Manicure"), false);
  assert.equal(tipoConhecido(""), false);
  assert.equal(tipoConhecido(null), false);
});

test("rotuloTipoProfissional devolve o rótulo do código conhecido", () => {
  assert.equal(rotuloTipoProfissional("manicure"), "Manicure");
  assert.equal(rotuloTipoProfissional("nail_designer"), "Nail Designer");
  assert.equal(rotuloTipoProfissional("maquiadora"), "Maquiadora");
  assert.equal(rotuloTipoProfissional("cabeleireira"), "Cabeleireira");
});

test("rotuloTipoProfissional devolve vazio para vazio e null", () => {
  assert.equal(rotuloTipoProfissional(""), "");
  assert.equal(rotuloTipoProfissional(null), "");
  assert.equal(rotuloTipoProfissional(undefined), "");
});

test("rotuloTipoProfissional nunca perde valor desconhecido", () => {
  assert.equal(rotuloTipoProfissional("podóloga"), "podóloga");
});
