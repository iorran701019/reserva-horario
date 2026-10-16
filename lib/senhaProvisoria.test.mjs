// Rodar: node --test lib/senhaProvisoria.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { gerarSenhaProvisoria } from "./senhaProvisoria.js";
import { validarSenha } from "./credenciaisDona.js";

test("senha provisória: 12 caracteres, sem ambíguos, com as 4 classes e válida", () => {
  for (let i = 0; i < 500; i++) {
    const s = gerarSenhaProvisoria();
    assert.equal(s.length, 12);
    assert.doesNotMatch(s, /[0O1lI]/);
    assert.match(s, /[A-Z]/);
    assert.match(s, /[a-z]/);
    assert.match(s, /\d/);
    assert.match(s, /[^A-Za-z0-9]/);
    assert.equal(validarSenha(s).ok, true);
  }
});

test("senhas geradas não se repetem", () => {
  const set = new Set(Array.from({ length: 200 }, gerarSenhaProvisoria));
  assert.equal(set.size, 200);
});
