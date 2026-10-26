// Rodar: node --test lib/servicoAgregado.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  somarPreco,
  agregadoSomaTempo,
  somarTempo,
  nomeComAgregado,
  resumoPreco,
  servicoAceitaAgregado,
  reservaPodeAlterarAgregado,
} from "./servicoAgregado.js";

// formatarPreco usa espaço não separável entre "R$" e o número.
const nbsp = (s) => s.replace(/R\$ /g, "R$ ");

test("somarPreco: agregado ausente = preço de hoje", () => {
  assert.equal(somarPreco(10000, null), 10000);
  assert.equal(somarPreco(10000, undefined, 500), 10500);
});
test("somarPreco: soma agregado e ajustes; agregado zerado", () => {
  assert.equal(somarPreco(10000, 15000), 25000);
  assert.equal(somarPreco(10000, 0, -1000), 9000);
});
test("somarPreco: preço do serviço nulo vale 0", () => {
  assert.equal(somarPreco(null, null), 0);
  assert.equal(somarPreco(null, 5000), 5000);
});

test("agregadoSomaTempo: janela soma, fixo não, vazia soma", () => {
  assert.equal(agregadoSomaTempo([{ modo_horario: "janela" }]), true);
  assert.equal(agregadoSomaTempo([{ modo_horario: "janela" }, { modo_horario: "fixo" }]), false);
  assert.equal(agregadoSomaTempo([{ modo_horario: "fixo" }]), false);
  assert.equal(agregadoSomaTempo([]), true);
  assert.equal(agregadoSomaTempo(undefined), true);
});
test("agregadoSomaTempo: fixo inativo é ignorado", () => {
  assert.equal(
    agregadoSomaTempo([{ modo_horario: "fixo", ativo: false }, { modo_horario: "janela", ativo: true }]),
    true
  );
});

test("somarTempo: agregado ausente = duração de hoje", () => {
  assert.equal(somarTempo({ duracaoServico: 60 }), 60);
  assert.equal(somarTempo({ duracaoServico: 60, ajusteDuracao: 15 }), 75);
});
test("somarTempo: janela soma, fixo não", () => {
  assert.equal(somarTempo({ duracaoServico: 60, tempoAgregado: 30, somaTempo: true }), 90);
  assert.equal(somarTempo({ duracaoServico: 60, tempoAgregado: 30, somaTempo: false }), 60);
});
test("somarTempo: tempo do agregado zerado", () => {
  assert.equal(somarTempo({ duracaoServico: 60, tempoAgregado: 0, somaTempo: true }), 60);
});
test("somarTempo: piso de 5 min com ajuste negativo", () => {
  assert.equal(somarTempo({ duracaoServico: 30, ajusteDuracao: -60 }), 5);
  assert.equal(somarTempo({ duracaoServico: 30, ajusteDuracao: -30 }), 5);
});
test("somarTempo: teto de 720", () => {
  assert.equal(somarTempo({ duracaoServico: 700, tempoAgregado: 100, somaTempo: true }), 720);
  assert.equal(somarTempo({ duracaoServico: 720 }), 720);
});

test("nomeComAgregado", () => {
  assert.equal(nomeComAgregado("Corte", "Barba"), "Corte + Barba");
  assert.equal(nomeComAgregado("Corte", null), "Corte");
  assert.equal(nomeComAgregado("Corte", "  "), "Corte");
});

test("resumoPreco: com agregado", () => {
  assert.equal(resumoPreco(10000, 15000), nbsp("R$ 100,00 + R$ 150,00 = R$ 250,00"));
});
test("resumoPreco: sem agregado devolve só o total", () => {
  assert.equal(resumoPreco(10000, 0), nbsp("R$ 100,00"));
  assert.equal(resumoPreco(10000, null, 500), nbsp("R$ 105,00"));
});
test("resumoPreco: ajustes entram no total sem quebrar a conta", () => {
  assert.equal(resumoPreco(10000, 15000, 500), nbsp("R$ 105,00 + R$ 150,00 = R$ 255,00"));
});
test("resumoPreco: preço do serviço nulo", () => {
  assert.equal(resumoPreco(null, 5000), nbsp("R$ 0,00 + R$ 50,00 = R$ 50,00"));
  assert.equal(resumoPreco(null, null), nbsp("R$ 0,00"));
});

test("nomeComAgregado: serviço sem nome não vira 'undefined + X'", () => {
  assert.equal(nomeComAgregado(undefined, "Barba"), undefined);
});

test("servicoAceitaAgregado: serviço comum aceita", () => {
  assert.equal(servicoAceitaAgregado({ id: 1 }, { servico_manutencao_externa_id: 9 }), true);
  assert.equal(servicoAceitaAgregado({ id: 1 }), true);
});
test("servicoAceitaAgregado: manutenção, duas datas e externa não aceitam", () => {
  assert.equal(servicoAceitaAgregado({ id: 1, eh_manutencao: true }, {}), false);
  assert.equal(servicoAceitaAgregado({ id: 1, exige_segunda_data: true }, {}), false);
  assert.equal(servicoAceitaAgregado({ id: 1, manutencao_externa: true }, {}), false);
});
test("servicoAceitaAgregado: o serviço apontado como manutenção externa não aceita", () => {
  assert.equal(servicoAceitaAgregado({ id: 9 }, { servico_manutencao_externa_id: 9 }), false);
  // bigint pode chegar como string de um lado e number do outro
  assert.equal(servicoAceitaAgregado({ id: 9 }, { servico_manutencao_externa_id: "9" }), false);
  assert.equal(servicoAceitaAgregado({ id: 9 }, { servico_manutencao_externa_id: null }), true);
  assert.equal(servicoAceitaAgregado({ id: 9 }, { servico_manutencao_externa_id: "" }), true);
});
test("servicoAceitaAgregado: sem serviço", () => {
  assert.equal(servicoAceitaAgregado(null, {}), false);
});

test("reservaPodeAlterarAgregado: status, par e serviço que aceita", () => {
  const base = { status: "confirmado", servico_id: 1, servicos: { eh_manutencao: false } };
  assert.equal(reservaPodeAlterarAgregado(base, null), true);
  assert.equal(reservaPodeAlterarAgregado({ ...base, status: "pendente" }, null), true);
  assert.equal(reservaPodeAlterarAgregado({ ...base, status: "aguardando_sinal" }, null), true);
  assert.equal(reservaPodeAlterarAgregado({ ...base, status: "concluido" }, null), false);
  assert.equal(reservaPodeAlterarAgregado({ ...base, status: "cancelado" }, null), false);
  assert.equal(reservaPodeAlterarAgregado({ ...base, reserva_grupo_id: "g" }, null), false);
  assert.equal(
    reservaPodeAlterarAgregado({ ...base, servicos: { eh_manutencao: true } }, null),
    false
  );
  assert.equal(
    reservaPodeAlterarAgregado(base, { servico_manutencao_externa_id: 1 }),
    false
  );
  assert.equal(reservaPodeAlterarAgregado({ status: "confirmado" }, null), false);
});
