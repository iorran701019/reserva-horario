// Rodar: node --test lib/gradeAdmin.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAVE_POR_MOTIVO,
  ESTADOS_GRADE_ADMIN,
  exibirGradeAdmin,
  horarioJaPassouHoje,
  minutosDoHorario,
  montarGradeAdmin,
  separarGradeAdmin,
} from "./gradeAdmin.js";

const DOMINGO = "2026-10-25";
const SEGUNDA = "2026-10-26";
const ALVO = "p1";

// Mapa filtrado: horário -> { livres, bloqueados, ocupados }.
function filtrado(linhas) {
  const m = {};
  for (const [h, e] of Object.entries(linhas)) {
    m[h] = { livres: [], bloqueados: [], ocupados: [], ...e };
  }
  return m;
}

// Mapa cru: lista de livres por horário + acrescimoPorHorario (não enumerável).
function cru(livres, marcas = {}) {
  const m = { ...livres };
  Object.defineProperty(m, "acrescimoPorHorario", {
    value: new Map(Object.entries(marcas).map(([h, ids]) => [h, new Set(ids)])),
    enumerable: false,
  });
  return m;
}

function grade(extra) {
  return montarGradeAdmin({
    vagasCru: cru({}),
    vagasFiltradas: {},
    data: SEGUNDA,
    profissionalId: ALVO,
    liberacoes: [],
    agendamentosDoDia: [],
    agora: new Date(2026, 9, 20, 8, 0),
    ...extra,
  });
}

test("livre: profissional alvo livre vira status livre", () => {
  const r = grade({ vagasFiltradas: filtrado({ "09:00": { livres: [ALVO] } }) });
  assert.deepEqual(r, [{ horario: "09:00", status: "livre", chave: "livre" }]);
});

test("cada motivo de bloqueio mapeia para a chave certa", () => {
  const motivos = ["excecao_ausencia", "exclusividade_servico", "antecedencia", "fora_do_modo"];
  const r = grade({
    vagasFiltradas: filtrado(
      Object.fromEntries(
        motivos.map((motivo, i) => [
          `${String(i + 8).padStart(2, "0")}:00`,
          { bloqueados: [{ profissionalId: ALVO, motivo }] },
        ])
      )
    ),
  });
  assert.deepEqual(
    r.map((g) => [g.status, g.motivo, g.chave]),
    [
      ["bloqueado", "excecao_ausencia", "ausencia"],
      ["bloqueado", "exclusividade_servico", "exclusividade"],
      ["bloqueado", "antecedencia", "antecedencia"],
      ["bloqueado", "fora_do_modo", "foraDoModo"],
    ]
  );
  for (const g of r) assert.ok(ESTADOS_GRADE_ADMIN[g.chave]);
  assert.equal(CHAVE_POR_MOTIVO.fora_do_modo, "foraDoModo");
});

test("motivo desconhecido cai em foraDoModo", () => {
  const r = grade({
    vagasFiltradas: filtrado({ "09:00": { bloqueados: [{ profissionalId: ALVO, motivo: "x" }] } }),
  });
  assert.equal(r[0].chave, "foraDoModo");
});

test("ocupado sem agendamento conhecido: sem id e sem rótulo", () => {
  const r = grade({
    vagasFiltradas: filtrado({ "09:00": { ocupados: [{ profissionalId: ALVO, inicio: 540 }] } }),
  });
  assert.deepEqual(r, [
    { horario: "09:00", status: "ocupado", chave: "ocupado", agendamentoId: null, rotuloOcupado: null },
  ]);
});

test("ocupado com agendamento conhecido: id e rótulo cliente · serviço", () => {
  const r = grade({
    vagasFiltradas: filtrado({ "09:00": { ocupados: [{ profissionalId: ALVO, inicio: 540 }] } }),
    agendamentosDoDia: [
      { id: 7, data: SEGUNDA, profissional_id: ALVO, status: "confirmado", horario: "09:00:00", nome_cliente: "Ana", servicos: { nome: "Corte" } },
      { id: 8, data: SEGUNDA, profissional_id: ALVO, status: "cancelado", horario: "09:00", nome_cliente: "Ze" },
    ],
  });
  assert.equal(r[0].agendamentoId, 7);
  assert.equal(r[0].rotuloOcupado, "Ana · Corte");
});

test("ocupado usa servico_livre quando não há serviço", () => {
  const r = grade({
    vagasFiltradas: filtrado({ "10:30": { ocupados: [{ profissionalId: ALVO, inicio: 630 }] } }),
    agendamentosDoDia: [
      { id: 1, data: SEGUNDA, profissional_id: ALVO, status: "pendente", horario: "10:30", nome_cliente: "Bia", servico_livre: "Retoque" },
    ],
  });
  assert.equal(r[0].rotuloOcupado, "Bia · Retoque");
});

test("liberação: horário aberto por liberação vira chave liberacao", () => {
  const r = grade({
    vagasFiltradas: filtrado({ "09:00": { livres: [ALVO] }, "10:00": { livres: [ALVO] } }),
    liberacoes: [{ hora_inicio: "09:00:00", dia_inteiro: false, data_inicio: SEGUNDA, data_fim: SEGUNDA }],
  });
  assert.deepEqual(r.map((g) => g.chave), ["liberacao", "livre"]);
});

test("liberação de dia inteiro ou de outro dia não pinta", () => {
  const r = grade({
    vagasFiltradas: filtrado({ "09:00": { livres: [ALVO] } }),
    liberacoes: [
      { hora_inicio: "09:00", dia_inteiro: true, data_inicio: SEGUNDA, data_fim: SEGUNDA },
      { hora_inicio: "09:00", dia_inteiro: false, data_inicio: "2026-10-27", data_fim: "2026-10-27" },
    ],
  });
  assert.equal(r[0].chave, "livre");
});

test("acréscimo: só em domingo, lido do mapa cru, e só para o profissional alvo", () => {
  const f = filtrado({ "09:00": { livres: [ALVO] } });
  const c = cru({ "09:00": [ALVO] }, { "09:00": [ALVO] });
  assert.equal(grade({ vagasCru: c, vagasFiltradas: f, data: DOMINGO })[0].chave, "acrescimo");
  assert.equal(grade({ vagasCru: c, vagasFiltradas: f, data: SEGUNDA })[0].chave, "livre");
  const outro = cru({ "09:00": [ALVO] }, { "09:00": ["p2"] });
  assert.equal(grade({ vagasCru: outro, vagasFiltradas: f, data: DOMINGO })[0].chave, "livre");
});

test("acréscimo em horário de liberação também vira acrescimo; bloqueado não", () => {
  const c = cru({}, { "09:00": [ALVO], "10:00": [ALVO] });
  const r = grade({
    vagasCru: c,
    data: DOMINGO,
    vagasFiltradas: filtrado({
      "09:00": { livres: [ALVO] },
      "10:00": { bloqueados: [{ profissionalId: ALVO, motivo: "fora_do_modo" }] },
    }),
    liberacoes: [{ hora_inicio: "09:00", dia_inteiro: false, data_inicio: DOMINGO, data_fim: DOMINGO }],
  });
  assert.deepEqual(r.map((g) => g.chave), ["acrescimo", "foraDoModo"]);
});

test("horário já passado hoje some; outros dias ficam inteiros", () => {
  const f = filtrado({ "07:00": { livres: [ALVO] }, "09:00": { livres: [ALVO] } });
  const agora = new Date(2026, 9, 26, 8, 0);
  assert.deepEqual(grade({ vagasFiltradas: f, data: SEGUNDA, agora }).map((g) => g.horario), ["09:00"]);
  assert.deepEqual(
    grade({ vagasFiltradas: f, data: SEGUNDA, agora: new Date(2026, 9, 25, 8, 0) }).map((g) => g.horario),
    ["07:00", "09:00"]
  );
  assert.equal(horarioJaPassouHoje(SEGUNDA, "08:00", agora), false);
  assert.equal(horarioJaPassouHoje(SEGUNDA, "07:59", agora), true);
});

test("profissional alvo: ignora os outros; sem alvo vale qualquer um", () => {
  const f = filtrado({
    "09:00": { livres: ["p2"], bloqueados: [{ profissionalId: ALVO, motivo: "antecedencia" }] },
    "10:00": { livres: ["p2"] },
    "11:00": { ocupados: [{ profissionalId: "p2", inicio: 660 }] },
  });
  assert.deepEqual(
    grade({ vagasFiltradas: f }).map((g) => [g.horario, g.status]),
    [["09:00", "bloqueado"]]
  );
  assert.deepEqual(
    grade({ vagasFiltradas: f, profissionalId: null }).map((g) => [g.horario, g.status]),
    [["09:00", "livre"], ["10:00", "livre"], ["11:00", "ocupado"]]
  );
});

test("minutosDoHorario", () => {
  assert.equal(minutosDoHorario("09:30:00"), 570);
  assert.equal(minutosDoHorario("00:00"), 0);
});

const g = (horario, chave) => ({ horario, status: "livre", chave });

test("separarGradeAdmin: fora do expediente recolhe só na faixa 05:00-22:00", () => {
  const lista = [g("03:00", "foraDoModo"), g("06:00", "foraDoModo"), g("09:00", "livre"), g("23:00", "foraDoModo")];
  const r = separarGradeAdmin(lista, "");
  assert.deepEqual(r.visiveis.map((x) => x.horario), ["09:00"]);
  assert.deepEqual(r.recolhidos.map((x) => x.horario), ["06:00"]);
  assert.equal(r.selecionadoNoRecolhido, false);
});

test("separarGradeAdmin: selecionado nunca fica escondido", () => {
  const lista = [g("06:00", "foraDoModo"), g("07:00", "foraDoModo"), g("09:00", "livre")];
  const r = separarGradeAdmin(lista, "06:00");
  assert.deepEqual(r.visiveis.map((x) => x.horario), ["06:00", "09:00"]);
  assert.deepEqual(r.recolhidos.map((x) => x.horario), ["07:00"]);
  assert.equal(r.selecionadoNoRecolhido, true);
});

test("exibirGradeAdmin: recolhido por padrão, expande por pedido, vazio ou selecionado", () => {
  const lista = [g("06:00", "foraDoModo"), g("09:00", "livre")];
  let p = separarGradeAdmin(lista, "");
  let e = exibirGradeAdmin({ ...p, aberto: false });
  assert.equal(e.expandido, false);
  assert.deepEqual(e.exibida.map((x) => x.horario), ["09:00"]);
  e = exibirGradeAdmin({ ...p, aberto: true });
  assert.deepEqual(e.exibida.map((x) => x.horario), ["06:00", "09:00"]);
  p = separarGradeAdmin([g("06:00", "foraDoModo")], "");
  assert.equal(exibirGradeAdmin({ ...p, aberto: false }).expandido, true);
  p = separarGradeAdmin([g("06:00", "foraDoModo"), g("07:00", "foraDoModo"), g("09:00", "livre")], "06:00");
  assert.equal(exibirGradeAdmin({ ...p, aberto: false }).expandido, true);
  p = separarGradeAdmin([g("09:00", "livre")], "");
  assert.equal(exibirGradeAdmin({ ...p, aberto: true }).expandido, false);
});
