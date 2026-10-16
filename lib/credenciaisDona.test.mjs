// Rodar: node --test lib/credenciaisDona.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { validarSenha, validarEmail, senhaEhObvia, mascararEmail } from "./credenciaisDona.js";

const ids = (r) => Object.fromEntries(r.requisitos.map((x) => [x.id, x.ok]));

test("senha forte passa em todos os requisitos", () => {
  const r = validarSenha("Lirio#4821x");
  assert.equal(r.ok, true);
  assert.ok(r.requisitos.every((x) => x.ok));
});
test("requisito: tamanho minimo 8", () => {
  assert.equal(ids(validarSenha("Lr#4821"))["tamanho"], false);
  assert.equal(ids(validarSenha("Lr#48215"))["tamanho"], true);
});
test("requisito: maiuscula", () => {
  assert.equal(ids(validarSenha("lirio#4821x"))["maiuscula"], false);
  assert.equal(validarSenha("lirio#4821x").ok, false);
});
test("requisito: numero", () => {
  assert.equal(ids(validarSenha("Lirio#abcdx"))["numero"], false);
  assert.equal(validarSenha("Lirio#abcdx").ok, false);
});
test("requisito: simbolo", () => {
  assert.equal(ids(validarSenha("Lirio4821xz"))["especial"], false);
  assert.equal(validarSenha("Lirio4821xz").ok, false);
});
test("senha vazia nao marca nenhum requisito", () => {
  const r = validarSenha("");
  assert.equal(r.ok, false);
  assert.ok(r.requisitos.every((x) => !x.ok));
});
test("senhas obvias sao recusadas mesmo cumprindo a forma", () => {
  for (const s of ["Senha@123", "MUDAR#2024", "Salao@2024", "Qwerty#123", "Mudar123!", "Salão#1234", "Aaaaa#1111"]) {
    assert.equal(senhaEhObvia(s), true, s);
    assert.equal(validarSenha(s).ok, false, s);
  }
  assert.equal(senhaEhObvia("Abc#12345678"), true);
  assert.equal(senhaEhObvia("12345678"), true);
});
test("senha nao obvia nao e marcada", () => {
  assert.equal(senhaEhObvia("Lirio#4821x"), false);
});
test("email valido: trim e minusculas", () => {
  const r = validarEmail("  Maria.Silva@Exemplo.COM ");
  assert.equal(r.ok, true);
  assert.equal(r.email, "maria.silva@exemplo.com");
});
test("email invalido", () => {
  for (const e of ["", "semarroba", "a@b", "a b@c.com", "@c.com", "a@.com", null, undefined]) {
    assert.equal(validarEmail(e).ok, false, String(e));
  }
});

test("mascararEmail: exemplos e bordas", () => {
  assert.equal(mascararEmail("ana.paula@gmail.com"), "an...a@g...com");
  assert.equal(mascararEmail("Maria@uol.com.br"), "ma...a@u...com.br");
  assert.equal(mascararEmail("ana@gmail.com"), "a...@g...com");
  assert.equal(mascararEmail("jo@x.io"), "j...@x...io");
  assert.equal(mascararEmail("  ABCD@Gmail.com "), "ab...d@g...com");
  assert.equal(mascararEmail("sem-arroba"), "");
  assert.equal(mascararEmail(""), "");
  assert.equal(mascararEmail(null), "");
  assert.equal(mascararEmail("a@semponto"), "");
});
