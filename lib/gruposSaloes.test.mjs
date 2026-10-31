import test from "node:test";
import assert from "node:assert/strict";
import {
  GRUPOS,
  SEM_GRUPO,
  TODOS,
  grupoDoSalao,
  filtrarSaloesPorGrupo,
  contarPorGrupo,
  salvarGrupoSalao,
  buscarGruposSaloes,
} from "./gruposSaloes.js";

const saloes = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
const mapa = new Map([
  [1, "producao"],
  [2, "teste_interno"],
  [3, "valor_desconhecido"],
]);

test("grupo ausente ou desconhecido cai em sem_grupo", () => {
  assert.equal(grupoDoSalao(mapa, 1), "producao");
  assert.equal(grupoDoSalao(mapa, 4), SEM_GRUPO);
  assert.equal(grupoDoSalao(mapa, 3), SEM_GRUPO);
  assert.equal(grupoDoSalao(undefined, 1), SEM_GRUPO);
});

test("todos devolve todos os salões, inclusive sem linha", () => {
  assert.deepEqual(filtrarSaloesPorGrupo(saloes, mapa, TODOS).map((s) => s.id), [1, 2, 3, 4]);
});

test("sem_grupo traz quem não tem linha", () => {
  assert.deepEqual(filtrarSaloesPorGrupo(saloes, mapa, SEM_GRUPO).map((s) => s.id), [3, 4]);
});

test("filtro por grupo e mapa de grupos não cria salão", () => {
  assert.deepEqual(filtrarSaloesPorGrupo(saloes, mapa, "producao").map((s) => s.id), [1]);
  const comLinhaOrfa = new Map([...mapa, [99, "producao"]]);
  assert.deepEqual(filtrarSaloesPorGrupo(saloes, comLinhaOrfa, "producao").map((s) => s.id), [1]);
});

test("contagem por grupo", () => {
  const c = contarPorGrupo(saloes, mapa);
  assert.equal(c[TODOS], 4);
  assert.equal(c[SEM_GRUPO], 2);
  assert.equal(c.producao, 1);
  assert.equal(c.teste_interno, 1);
  assert.equal(c.inativo, 0);
  assert.equal(Object.keys(c).length, GRUPOS.length + 2);
});

function falso(resultado) {
  const chamadas = [];
  const cadeia = {
    from: (t) => (chamadas.push(["from", t]), cadeia),
    upsert: (...a) => (chamadas.push(["upsert", ...a]), cadeia),
    delete: () => (chamadas.push(["delete"]), cadeia),
    select: (...a) => (chamadas.push(["select", ...a]), cadeia),
    eq: (...a) => (chamadas.push(["eq", ...a]), cadeia),
    then: (res) => res(resultado),
  };
  return { cadeia, chamadas };
}

test("salvar: upsert com linhas = gravou", async () => {
  const { cadeia, chamadas } = falso({ data: [{ estabelecimento_id: 1 }], error: null });
  const r = await salvarGrupoSalao(cadeia, 1, "inativo");
  assert.equal(r.gravou, true);
  assert.equal(chamadas.find((c) => c[0] === "upsert")[1].grupo, "inativo");
});

test("salvar: 0 linhas é falha", async () => {
  const { cadeia } = falso({ data: [], error: null });
  assert.equal((await salvarGrupoSalao(cadeia, 1, "inativo")).gravou, false);
});

test("salvar sem_grupo faz delete e grupo inválido não consulta", async () => {
  const { cadeia, chamadas } = falso({ data: [{ estabelecimento_id: 1 }], error: null });
  assert.equal((await salvarGrupoSalao(cadeia, 1, SEM_GRUPO)).gravou, true);
  assert.ok(chamadas.some((c) => c[0] === "delete"));
  const r = await salvarGrupoSalao(cadeia, 1, "xyz");
  assert.equal(r.gravou, false);
});

test("buscar devolve mapa e erro", async () => {
  const ok = falso({ data: [{ estabelecimento_id: 5, grupo: "inativo" }], error: null });
  const r = await buscarGruposSaloes(ok.cadeia);
  assert.equal(r.mapa.get(5), "inativo");
  assert.equal(r.erro, null);
  const ruim = falso({ data: null, error: { code: "x" } });
  const r2 = await buscarGruposSaloes(ruim.cadeia);
  assert.ok(r2.erro);
  assert.equal(r2.mapa.size, 0);
});
