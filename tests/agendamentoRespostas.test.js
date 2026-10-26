import { describe, it, expect, vi, beforeEach } from "vitest";
import { consulta } from "./helpers/consulta.js";

const h = vi.hoisted(() => ({ supabase: {} }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: h.supabase }));

import { somarAjustesPrecoEmLote } from "@/lib/agendamentoRespostas";

const resp = (agendamento_id, ajuste) => ({
  agendamento_id,
  servico_pergunta_opcoes: ajuste === undefined ? null : { ajuste_preco_centavos: ajuste },
});

// Cada chamada a from() consome o próximo resultado da fila (um por bloco).
function usar(resultados) {
  const consultas = [];
  const fila = [...resultados];
  h.supabase.from = vi.fn(() => {
    const q = consulta(fila.shift());
    consultas.push(q);
    return q;
  });
  return consultas;
}

const uuids = (n) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("somarAjustesPrecoEmLote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("soma por agendamento e consulta a tabela certa com .in", async () => {
    const consultas = usar([
      { data: [resp("a", 1500), resp("a", -500), resp("b", 2000)], error: null },
    ]);
    const r = await somarAjustesPrecoEmLote(["a", "b"]);
    expect(r.ok).toBe(true);
    expect(r.porAgendamento.get("a")).toBe(1000);
    expect(r.porAgendamento.get("b")).toBe(2000);
    expect(h.supabase.from).toHaveBeenCalledWith("agendamento_respostas");
    expect(consultas[0].in).toHaveBeenCalledWith("agendamento_id", ["a", "b"]);
  });

  it("id sem resposta vale 0", async () => {
    usar([{ data: [resp("a", 700)], error: null }]);
    const r = await somarAjustesPrecoEmLote(["a", "b"]);
    expect(r.porAgendamento.get("b")).toBe(0);
  });

  it("ajuste 0, nulo ou opção ausente é ignorado", async () => {
    usar([{ data: [resp("a", 0), resp("a", null), resp("a"), resp("a", 300)], error: null }]);
    const r = await somarAjustesPrecoEmLote(["a"]);
    expect(r.porAgendamento.get("a")).toBe(300);
  });

  it("erro devolve ok false e Map vazio", async () => {
    usar([{ data: null, error: { message: "falhou" } }]);
    const r = await somarAjustesPrecoEmLote(["a"]);
    expect(r.ok).toBe(false);
    expect(r.porAgendamento.size).toBe(0);
  });

  it("mais de 100 ids gera dois blocos", async () => {
    const consultas = usar([
      { data: [resp("id-0", 100)], error: null },
      { data: [resp("id-100", 200)], error: null },
    ]);
    const r = await somarAjustesPrecoEmLote(uuids(101));
    expect(consultas).toHaveLength(2);
    expect(consultas[0].in.mock.calls[0][1]).toHaveLength(100);
    expect(consultas[1].in.mock.calls[0][1]).toEqual(["id-100"]);
    expect(r.ok).toBe(true);
    expect(r.porAgendamento.size).toBe(101);
    expect(r.porAgendamento.get("id-0")).toBe(100);
    expect(r.porAgendamento.get("id-100")).toBe(200);
  });

  it("erro no segundo bloco devolve ok false e Map vazio, sem resultado parcial", async () => {
    usar([
      { data: [resp("id-0", 100)], error: null },
      { data: null, error: { message: "falhou" } },
    ]);
    const r = await somarAjustesPrecoEmLote(uuids(101));
    expect(r.ok).toBe(false);
    expect(r.porAgendamento.size).toBe(0);
  });

  it("exceção na consulta devolve ok false", async () => {
    h.supabase.from = vi.fn(() => {
      throw new Error("rede");
    });
    const r = await somarAjustesPrecoEmLote(["a"]);
    expect(r.ok).toBe(false);
    expect(r.porAgendamento.size).toBe(0);
  });

  it("lista vazia ou nula não consulta", async () => {
    usar([]);
    for (const entrada of [[], null, undefined]) {
      const r = await somarAjustesPrecoEmLote(entrada);
      expect(r).toEqual({ ok: true, porAgendamento: new Map() });
    }
    expect(h.supabase.from).not.toHaveBeenCalled();
  });
});
