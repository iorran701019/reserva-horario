// Rodar: node --test lib/situacaoPixDona.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  situacaoPixDonaElegivel,
  tagSituacaoPixDona,
  rankPixPendente,
  ordenarPendentesPorPix,
  textoEstadoOriginalPix,
  opcoesMenuSituacaoPix,
  situacaoPixDonaEditavel,
} from "./situacaoPixDona.js";

const manual = { sinal_regra: "sempre", metodo_cobranca_pix: "manual", sinal_chave_pix: "chave" };
const auto = {
  sinal_regra: "sempre",
  metodo_cobranca_pix: "abacatepay",
  sinal_chave_pix: "chave",
  abacatepay_conectado: true,
};

test("elegivel: manual sim, abacatepay nao", () => {
  assert.equal(situacaoPixDonaElegivel({ id: 1 }, manual), true);
  assert.equal(situacaoPixDonaElegivel({ id: 1 }, auto), false);
});
test("elegivel: desligado (regra ou chave vazia) e estabelecimento nulo sao inelegiveis", () => {
  assert.equal(situacaoPixDonaElegivel({ id: 1 }, { ...manual, sinal_regra: "desligado" }), false);
  assert.equal(situacaoPixDonaElegivel({ id: 1 }, { ...manual, sinal_chave_pix: "" }), false);
  assert.equal(situacaoPixDonaElegivel({ id: 1 }, null), false);
  assert.equal(situacaoPixDonaElegivel({ id: 1 }, undefined), false);
  assert.equal(tagSituacaoPixDona({ id: 1, situacao_pix_dona: "pago" }, null), null);
  assert.equal(rankPixPendente({ status: "aguardando_sinal" }, null), 0);
});
test("elegivel: br_code ou pago_em tira do escopo mesmo em manual", () => {
  assert.equal(situacaoPixDonaElegivel({ id: 1, abacatepay_br_code: "x" }, manual), false);
  assert.equal(situacaoPixDonaElegivel({ id: 1, abacatepay_pago_em: "2026-01-01" }, manual), false);
});
test("tag: da dona sobrepoe a derivada; inelegivel nao tem tag", () => {
  const base = { id: 1, comprovante_pix_url: "a/b" };
  assert.equal(tagSituacaoPixDona(base, manual), null);
  assert.equal(tagSituacaoPixDona({ ...base, situacao_pix_dona: "pago" }, manual), "pago");
  assert.equal(
    tagSituacaoPixDona({ ...base, situacao_pix_dona: "pendente_pagamento" }, manual),
    "pendente_pagamento"
  );
  assert.equal(tagSituacaoPixDona({ ...base, situacao_pix_dona: "pago" }, auto), null);
  assert.equal(
    tagSituacaoPixDona({ id: 1, situacao_pix_dona: "pago", abacatepay_pago_em: "x" }, manual),
    null
  );
});
test("ranks: 0 confirmado, 1 declarado/sem sinal, 2 aguardando", () => {
  assert.equal(rankPixPendente({ situacao_pix_dona: "pago", status: "aguardando_sinal" }, manual), 0);
  assert.equal(rankPixPendente({ comprovante_pix_url: "a", status: "pendente" }, manual), 0);
  assert.equal(rankPixPendente({ sinal_declarado_pago: true, status: "pendente" }, manual), 1);
  assert.equal(rankPixPendente({ status: "pendente" }, manual), 1);
  assert.equal(rankPixPendente({ status: "aguardando_sinal" }, manual), 2);
  assert.equal(
    rankPixPendente({ situacao_pix_dona: "pendente_pagamento", sinal_declarado_pago: true }, manual),
    2
  );
});
test("rank: inelegivel e sempre 0", () => {
  assert.equal(rankPixPendente({ status: "aguardando_sinal" }, auto), 0);
  assert.equal(
    rankPixPendente({ status: "aguardando_sinal", abacatepay_br_code: "x" }, manual),
    0
  );
});
test("ordenar: estavel dentro do degrau", () => {
  const lista = [
    { id: "a", telefone: "1", status: "aguardando_sinal" },
    { id: "b", telefone: "2", status: "pendente" },
    { id: "c", telefone: "3", status: "aguardando_sinal" },
    { id: "d", telefone: "4", comprovante_pix_url: "x", status: "pendente" },
    { id: "e", telefone: "5", status: "pendente" },
  ];
  assert.deepEqual(
    ordenarPendentesPorPix(lista, manual).map((i) => i.id),
    ["d", "b", "e", "a", "c"]
  );
});
test("ordenar: inelegivel mantem a ordem original", () => {
  const lista = [
    { id: "a", telefone: "1", status: "aguardando_sinal" },
    { id: "b", telefone: "2", comprovante_pix_url: "x" },
  ];
  assert.deepEqual(
    ordenarPendentesPorPix(lista, auto).map((i) => i.id),
    ["a", "b"]
  );
});
test("ordenar: grupo com ranks mistos usa o menor e fica junto", () => {
  const lista = [
    { id: "a", telefone: "(11) 9", status: "aguardando_sinal" },
    { id: "b", telefone: "2", status: "aguardando_sinal" },
    { id: "c", telefone: "11 9", comprovante_pix_url: "x" },
  ];
  assert.deepEqual(
    ordenarPendentesPorPix(lista, manual).map((i) => i.id),
    ["a", "c", "b"]
  );
});

test("textoEstadoOriginalPix: cada ramo derivado, na ordem do card", () => {
  assert.equal(
    textoEstadoOriginalPix({ comprovante_pix_url: "a", sinal_declarado_pago: true }, manual),
    "Comprovante do Pix"
  );
  assert.equal(
    textoEstadoOriginalPix({ sinal_declarado_pago: true, status: "aguardando_sinal" }, manual),
    "Comprovante declarado pelo WhatsApp"
  );
  assert.equal(textoEstadoOriginalPix({ status: "aguardando_sinal" }, manual), "Aguardando sinal");
  assert.equal(
    textoEstadoOriginalPix({ status: "pendente" }, manual),
    "Nenhum sinal de Pix foi cobrado"
  );
  assert.equal(
    textoEstadoOriginalPix({ status: "pendente" }, { ...manual, sinal_chave_pix: "" }),
    "Sinal não cobrado, configurar sinal Pix"
  );
});
test("textoEstadoOriginalPix: sem tag devolve null e ignora situacao_pix_dona", () => {
  const desligado = { ...manual, sinal_regra: "desligado" };
  assert.equal(textoEstadoOriginalPix({ status: "pendente" }, desligado), null);
  assert.equal(textoEstadoOriginalPix({ status: "confirmado" }, manual), null);
  assert.equal(
    textoEstadoOriginalPix({ status: "aguardando_sinal", situacao_pix_dona: "pago" }, manual),
    "Aguardando sinal"
  );
  assert.equal(
    textoEstadoOriginalPix({ status: "pendente", situacao_pix_dona: "pendente_pagamento" }, desligado),
    null
  );
});
test("opcoesMenuSituacaoPix: original aguardando = duas opcoes", () => {
  const item = { status: "aguardando_sinal" };
  assert.deepEqual(opcoesMenuSituacaoPix(item, manual), [
    { rotulo: "Aguardando sinal", valor: null, desabilitada: true },
    { rotulo: "Pago", valor: "pago", desabilitada: false },
  ]);
  assert.equal(
    opcoesMenuSituacaoPix({ ...item, situacao_pix_dona: "pago" }, manual)[1].desabilitada,
    true
  );
});
test("opcoesMenuSituacaoPix: demais casos tem tres opcoes; sem tag, duas", () => {
  const declarado = { status: "pendente", sinal_declarado_pago: true };
  assert.deepEqual(opcoesMenuSituacaoPix(declarado, manual), [
    { rotulo: "Aguardando sinal", valor: "pendente_pagamento", desabilitada: false },
    { rotulo: "Pago", valor: "pago", desabilitada: false },
    { rotulo: "Comprovante declarado pelo WhatsApp", valor: null, desabilitada: true },
  ]);
  const marcado = opcoesMenuSituacaoPix({ ...declarado, situacao_pix_dona: "pendente_pagamento" }, manual);
  assert.equal(marcado[0].desabilitada, true);
  assert.equal(marcado[2].desabilitada, false);
  const semTag = opcoesMenuSituacaoPix({ status: "confirmado" }, manual);
  assert.equal(semTag.length, 2);
  assert.equal(new Set(semTag.map((o) => o.rotulo)).size, semTag.length);
});

test("editavel: nos tres estados cobrados", () => {
  assert.equal(situacaoPixDonaEditavel({ status: "pendente", comprovante_pix_url: "a" }, manual), true);
  assert.equal(situacaoPixDonaEditavel({ status: "pendente", sinal_declarado_pago: true }, manual), true);
  assert.equal(situacaoPixDonaEditavel({ status: "aguardando_sinal" }, manual), true);
});
test("editavel: nao em 'nenhum sinal cobrado' (regra novos), config rebaixada e sem tag", () => {
  const novos = { ...manual, sinal_regra: "novos" };
  assert.equal(situacaoPixDonaEditavel({ status: "pendente" }, novos), false);
  assert.equal(
    situacaoPixDonaEditavel({ status: "pendente" }, { ...manual, sinal_chave_pix: "" }),
    false
  );
  assert.equal(situacaoPixDonaEditavel({ status: "confirmado" }, manual), false);
});
test("editavel: ja marcada pela dona continua editavel mesmo nesses estados", () => {
  const novos = { ...manual, sinal_regra: "novos" };
  assert.equal(
    situacaoPixDonaEditavel({ status: "pendente", situacao_pix_dona: "pago" }, novos),
    true
  );
  assert.equal(
    situacaoPixDonaEditavel({ status: "confirmado", situacao_pix_dona: "pendente_pagamento" }, manual),
    true
  );
});
test("editavel: inelegivel nunca (abacatepay, desligado, null, br_code)", () => {
  const marcado = { status: "aguardando_sinal", situacao_pix_dona: "pago" };
  assert.equal(situacaoPixDonaEditavel(marcado, auto), false);
  assert.equal(situacaoPixDonaEditavel(marcado, { ...manual, sinal_regra: "desligado" }), false);
  assert.equal(situacaoPixDonaEditavel(marcado, null), false);
  assert.equal(situacaoPixDonaEditavel({ ...marcado, abacatepay_br_code: "x" }, manual), false);
});
