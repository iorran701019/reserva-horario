import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseFalso } from "./helpers/consulta.js";

const h = vi.hoisted(() => ({ supabase: {} }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: h.supabase }));

import SecaoServicoAgregado from "@/app/[salon]/admin/SecaoServicoAgregado";

const servico = { id: 1, nome: "Corte" };
const servicos = [
  { id: 1, nome: "Corte", ativo: true, preco_centavos: 10000, duracao_min: 60 },
  { id: 2, nome: "Escova", ativo: true, preco_centavos: 4500, duracao_min: 25 },
  { id: 3, nome: "Manutenção X", ativo: true, eh_manutencao: true },
  { id: 4, nome: "Duas datas", ativo: true, exige_segunda_data: true },
  { id: 5, nome: "Externa", ativo: true, manutencao_externa: true },
  { id: 6, nome: "Apontado", ativo: true },
  { id: 7, nome: "Inativo", ativo: false },
  { id: 8, nome: "Já adicionado", ativo: true, preco_centavos: 1000, duracao_min: 10 },
  { id: 9, nome: "Barba", ativo: true, preco_centavos: 3000, duracao_min: 20 },
];
const linha = (over = {}) => ({
  id: 100,
  servico_id: 1,
  servico_agregado_id: 8,
  preco_centavos: 1000,
  duracao_min: 10,
  ordem: 1,
  ativo: true,
  ...over,
});

function montar({ lista = [], resultados = {}, props = {} } = {}) {
  for (const k of Object.keys(h.supabase)) delete h.supabase[k];
  Object.assign(
    h.supabase,
    supabaseFalso({
      servico_agregados: { select: { data: lista, error: null }, ...resultados },
    })
  );
  return render(
    <SecaoServicoAgregado
      servico={servico}
      servicos={servicos}
      agendaFixa={false}
      estabelecimento={{ servico_manutencao_externa_id: 6 }}
      {...props}
    />
  );
}

describe("SecaoServicoAgregado", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ["ehManutencao", { ehManutencao: true }],
    ["exigeSegundaData", { exigeSegundaData: true }],
    ["manutencaoExterna", { manutencaoExterna: true }],
    ["serviço apontado pelo estabelecimento", { estabelecimento: { servico_manutencao_externa_id: 1 } }],
  ])("some com %s", (_nome, props) => {
    const { container } = montar({ props });
    expect(container).toBeEmptyDOMElement();
  });

  it("checkbox travado com agregado ativo", async () => {
    montar({ lista: [linha()] });
    await screen.findByText("Já adicionado");
    const marcado = screen.getByRole("checkbox", { name: /Permitir agregar/ });
    expect(marcado).toBeChecked();
    expect(marcado).toBeDisabled();
  });

  it("checkbox livre quando não há agregado ativo", async () => {
    montar({ lista: [linha({ ativo: false })] });
    const caixa = await screen.findByRole("checkbox", { name: /Permitir agregar/ });
    await vi.waitFor(() => expect(caixa).toBeEnabled());
    expect(caixa).not.toBeChecked();
  });

  it("lista suspensa sem bloqueados nem já adicionados", async () => {
    montar({ lista: [linha()] });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "+ Adicionar" }));
    const nomes = within(screen.getByRole("combobox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(nomes).toEqual(["Selecione...", "Escova", "Barba"]);
  });

  it("pré-preenche preço e tempo ao escolher o serviço", async () => {
    montar({ lista: [linha()] });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "+ Adicionar" }));
    await u.selectOptions(screen.getByRole("combobox"), "Escova");
    expect(screen.getByRole("textbox")).toHaveValue("45.00");
    expect(screen.getByRole("spinbutton")).toHaveValue(25);
  });

  it("insert com retorno vazio mostra erro", async () => {
    montar({ lista: [linha()], resultados: { insert: { data: [], error: null } } });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "+ Adicionar" }));
    await u.selectOptions(screen.getByRole("combobox"), "Escova");
    await u.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText(/Não foi possível salvar: nenhuma linha foi alterada/)
    ).toBeInTheDocument();
  });

  it("delete com retorno vazio mostra erro", async () => {
    montar({ lista: [linha()], resultados: { delete: { data: [], error: null } } });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Excluir" }));
    await u.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(
      await screen.findByText(/Não foi possível excluir: nenhuma linha foi alterada/)
    ).toBeInTheDocument();
  });

  it("selo 'Não é mais oferecido ao cliente' só no agregado ativo cujo destino não aceita", async () => {
    montar({
      lista: [
        linha({ id: 1, servico_agregado_id: 3 }),
        linha({ id: 2, servico_agregado_id: 4, ativo: false, ordem: 2 }),
        linha({ id: 3, servico_agregado_id: 2, ordem: 3 }),
      ],
    });
    await screen.findByText("Manutenção X");
    expect(screen.getAllByText("Não é mais oferecido ao cliente")).toHaveLength(1);
  });
});
