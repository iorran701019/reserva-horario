import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseFalso } from "./helpers/consulta.js";

const h = vi.hoisted(() => ({ supabase: {} }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: h.supabase }));

import { buscarAgregadosDoServico, buscarSomaTempoAgregado } from "@/lib/agregadosServico";

const linha = (id, agregadoId, ordem) => ({
  id,
  servico_id: 1,
  servico_agregado_id: agregadoId,
  preco_centavos: 1000 * id,
  duracao_min: 10,
  ordem,
});

function usar(tabelas) {
  for (const k of Object.keys(h.supabase)) delete h.supabase[k];
  Object.assign(h.supabase, supabaseFalso(tabelas));
}

describe("buscarAgregadosDoServico", () => {
  const servicos = [
    { id: 10, nome: "Hidratação" },
    { id: 11, nome: "Escova" },
  ];

  beforeEach(() => vi.clearAllMocks());

  it("pede só ativos, ordenados por ordem, e devolve na ordem recebida com o nome", async () => {
    usar({
      servico_agregados: { data: [linha(1, 11, 1), linha(2, 10, 2)], error: null },
    });
    const r = await buscarAgregadosDoServico(1, servicos, null);
    expect(r.map((x) => x.nome)).toEqual(["Escova", "Hidratação"]);
    const { q } = h.supabase.consultas[0];
    expect(q.eq).toHaveBeenCalledWith("servico_id", 1);
    expect(q.eq).toHaveBeenCalledWith("ativo", true);
    expect(q.order).toHaveBeenCalledWith("ordem", { ascending: true });
  });

  it("ignora destino ausente da lista (inativo ou removido)", async () => {
    usar({
      servico_agregados: { data: [linha(1, 10, 1), linha(2, 99, 2)], error: null },
    });
    const r = await buscarAgregadosDoServico(1, servicos, null);
    expect(r.map((x) => x.servico_agregado_id)).toEqual([10]);
  });

  it("ignora manutenção, segunda data, manutenção externa e o serviço apontado", async () => {
    const lista = [
      { id: 10, nome: "Ok" },
      { id: 20, nome: "Manut", eh_manutencao: true },
      { id: 21, nome: "Duas datas", exige_segunda_data: true },
      { id: 22, nome: "Externa", manutencao_externa: true },
      { id: 23, nome: "Apontado" },
    ];
    usar({
      servico_agregados: {
        data: [linha(1, 10, 1), linha(2, 20, 2), linha(3, 21, 3), linha(4, 22, 4), linha(5, 23, 5)],
        error: null,
      },
    });
    const r = await buscarAgregadosDoServico(1, lista, { servico_manutencao_externa_id: 23 });
    expect(r.map((x) => x.nome)).toEqual(["Ok"]);
  });

  it("erro de consulta devolve lista vazia", async () => {
    usar({ servico_agregados: { data: null, error: { message: "boom" } } });
    expect(await buscarAgregadosDoServico(1, servicos, null)).toEqual([]);
  });
});

describe("buscarSomaTempoAgregado", () => {
  beforeEach(() => vi.clearAllMocks());

  it("janela soma (true)", async () => {
    usar({
      servico_profissional: {
        data: [{ profissionais: { ativo: true, modo_horario: "janela" } }],
        error: null,
      },
    });
    expect(await buscarSomaTempoAgregado(1, 5)).toBe(true);
  });

  it("fixo não soma (false)", async () => {
    usar({
      servico_profissional: {
        data: [
          { profissionais: { ativo: true, modo_horario: "janela" } },
          { profissionais: { ativo: true, modo_horario: "fixo" } },
        ],
        error: null,
      },
    });
    expect(await buscarSomaTempoAgregado(1, 5)).toBe(false);
  });

  it("erro devolve null", async () => {
    usar({ servico_profissional: { data: null, error: { message: "boom" } } });
    expect(await buscarSomaTempoAgregado(1, 5)).toBeNull();
  });
});
