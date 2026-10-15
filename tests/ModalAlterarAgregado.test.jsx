import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseFalso } from "./helpers/consulta.js";

const h = vi.hoisted(() => ({ supabase: {} }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: h.supabase }));

import ModalAlterarAgregado from "@/components/ModalAlterarAgregado";

const estabelecimento = { id: 5, servico_manutencao_externa_id: null };
const agendamento = {
  id: "a1",
  servico_id: 1,
  servico_agregado_id: 10,
  agregado_nome: "Hidratação",
  agregado_preco_centavos: 5000,
  agregado_duracao_min: 20,
  duracao_min: 80,
  servicos: { nome: "Corte", preco_centavos: 10000 },
};
const linhasConfig = [
  { id: 1, servico_id: 1, servico_agregado_id: 10, preco_centavos: 3000, duracao_min: 15, ordem: 1 },
  { id: 2, servico_id: 1, servico_agregado_id: 11, preco_centavos: 4500, duracao_min: 25, ordem: 2 },
];
const servicosAtivos = [
  { id: 10, nome: "Hidratação" },
  { id: 11, nome: "Escova" },
];

let rpc;
let onSalvo;
let onFechar;

function montar({
  ag = agendamento,
  config = linhasConfig,
  profissionais = [{ profissionais: { ativo: true, modo_horario: "janela" } }],
  rpcResultado = { data: [{ servico_agregado_id: 10, duracao_min: 90 }], error: null },
} = {}) {
  rpc = vi.fn(async () => rpcResultado);
  onSalvo = vi.fn();
  onFechar = vi.fn();
  for (const k of Object.keys(h.supabase)) delete h.supabase[k];
  Object.assign(
    h.supabase,
    supabaseFalso(
      {
        servicos: { data: servicosAtivos, error: null },
        servico_agregados: { data: config, error: null },
        servico_profissional: { data: profissionais, error: null },
      },
      rpc
    )
  );
  return render(
    <ModalAlterarAgregado
      agendamento={ag}
      estabelecimento={estabelecimento}
      onSalvo={onSalvo}
      onFechar={onFechar}
    />
  );
}

const botaoSalvar = () => screen.getByRole("button", { name: /Confirmar alteração/ });
const campoPreco = () => screen.getByLabelText(/Valor/);
const campoTempo = () => screen.getByLabelText(/Tempo/);
const opcao = (nome) => screen.getByRole("button", { name: new RegExp(nome) });
const carregado = () => screen.findByRole("button", { name: /Escova/ });

async function digitar(campo, texto) {
  const u = userEvent.setup();
  await u.clear(campo);
  if (texto !== "") await u.type(campo, texto);
}

describe("ModalAlterarAgregado", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("marca o agregado atual e mostra os valores gravados na reserva", async () => {
    montar();
    await carregado();
    expect(opcao("Hidratação")).toHaveAttribute("aria-pressed", "true");
    expect(opcao("Escova")).toHaveAttribute("aria-pressed", "false");
    expect(campoPreco()).toHaveValue("50,00");
    expect(campoTempo()).toHaveValue("20");
  });

  it("outro agregado parte dos valores configurados", async () => {
    montar();
    await carregado();
    await userEvent.setup().click(opcao("Escova"));
    expect(opcao("Escova")).toHaveAttribute("aria-pressed", "true");
    expect(campoPreco()).toHaveValue("45,00");
    expect(campoTempo()).toHaveValue("25");
  });

  it("salvar fica travado sem mudança e libera ao mudar", async () => {
    montar();
    await carregado();
    expect(botaoSalvar()).toBeDisabled();
    await digitar(campoTempo(), "30");
    expect(botaoSalvar()).toBeEnabled();
  });

  it.each([
    ["preço negativo", "preco", "-1"],
    ["tempo 721", "tempo", "721"],
    ["tempo decimal", "tempo", "10.5"],
  ])("trava com valor inválido: %s", async (_nome, campo, valor) => {
    montar();
    await carregado();
    await digitar(campo === "preco" ? campoPreco() : campoTempo(), valor);
    expect(botaoSalvar()).toBeDisabled();
  });

  it("altera valores: parâmetros da RPC", async () => {
    montar();
    await carregado();
    await digitar(campoPreco(), "60");
    await digitar(campoTempo(), "30");
    await userEvent.setup().click(botaoSalvar());
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("agendamento_alterar_agregado", {
      p_agendamento_id: "a1",
      p_servico_agregado_id: 10,
      p_preco_centavos: 6000,
      p_duracao_min: 30,
    });
    await waitFor(() => expect(onSalvo).toHaveBeenCalledTimes(1));
    expect(onSalvo.mock.calls[0][1]).toBe(true);
  });

  it("troca de agregado: parâmetros da RPC com os valores configurados", async () => {
    montar();
    await carregado();
    await userEvent.setup().click(opcao("Escova"));
    await userEvent.setup().click(botaoSalvar());
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("agendamento_alterar_agregado", {
      p_agendamento_id: "a1",
      p_servico_agregado_id: 11,
      p_preco_centavos: 4500,
      p_duracao_min: 25,
    });
  });

  it("remover: agregado, preço e tempo nulos", async () => {
    montar();
    await carregado();
    await userEvent.setup().click(opcao("Sem agregado"));
    await userEvent.setup().click(botaoSalvar());
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("agendamento_alterar_agregado", {
      p_agendamento_id: "a1",
      p_servico_agregado_id: null,
      p_preco_centavos: null,
      p_duracao_min: null,
    });
  });

  it("23P01 mostra a mensagem de sobreposição e não chama onSalvo", async () => {
    montar({ rpcResultado: { data: null, error: { code: "23P01", message: "exclusion" } } });
    await carregado();
    await digitar(campoTempo(), "30");
    await userEvent.setup().click(botaoSalvar());
    expect(
      await screen.findByText(
        "O tempo adicional não cabe antes do próximo agendamento deste profissional."
      )
    ).toBeInTheDocument();
    expect(onSalvo).not.toHaveBeenCalled();
    expect(campoTempo()).toHaveValue("30");
  });

  it("retorno vazio mostra erro genérico e não chama onSalvo", async () => {
    montar({ rpcResultado: { data: [], error: null } });
    await carregado();
    await digitar(campoTempo(), "30");
    await userEvent.setup().click(botaoSalvar());
    expect(await screen.findByText(/nenhuma linha foi alterada/)).toBeInTheDocument();
    expect(onSalvo).not.toHaveBeenCalled();
  });

  it("mostra o texto informativo quando a agenda é fixa", async () => {
    montar({
      profissionais: [{ profissionais: { ativo: true, modo_horario: "fixo" } }],
    });
    expect(
      await screen.findByText(/Informativo: a agenda é fixa, o tempo não altera os horários\./)
    ).toBeInTheDocument();
  });

  it("não mostra o informativo quando o tempo soma", async () => {
    montar();
    await carregado();
    expect(screen.queryByText(/Informativo/)).not.toBeInTheDocument();
  });

  it("sem agregados cadastrados e sem agregado na reserva", async () => {
    montar({
      ag: { ...agendamento, servico_agregado_id: null, agregado_nome: null },
      config: [],
    });
    expect(
      await screen.findByText("Este serviço não tem agregados cadastrados.")
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Voltar" }));
    expect(onFechar).toHaveBeenCalled();
  });
});
