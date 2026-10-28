import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/components/FormularioAgendamento", () => ({ formatarData: (iso) => iso }));
vi.mock("@/lib/agendamentosCliente", () => ({ cancelarAgendamentoCliente: vi.fn() }));

import TelaSolicitacaoEnviada from "@/components/TelaSolicitacaoEnviada";

const TEXTO = "Acréscimo de Domingo no valor total do serviço";

function tela(props = {}, estabelecimento = {}) {
  return render(
    <TelaSolicitacaoEnviada
      estabelecimento={{ whatsapp: "5511999999999", ...estabelecimento }}
      servicoNome="Corte"
      data="2026-11-01"
      horario="10:00"
      nomeCliente="Ana"
      {...props}
    />
  );
}

describe("TelaSolicitacaoEnviada: valor total e acréscimo", () => {
  afterEach(cleanup);

  it("com acréscimo e preço visível mostra o total e o texto", () => {
    tela({ precoTotalCentavos: 12000, acrescimoAtivo: true });
    expect(screen.getByText("Valor total")).toBeInTheDocument();
    expect(screen.getByText(/120,00/)).toBeInTheDocument();
    expect(screen.getByText(TEXTO)).toBeInTheDocument();
  });

  it("com acréscimo e preço oculto mostra só o texto", () => {
    tela({ precoTotalCentavos: 12000, acrescimoAtivo: true }, { ocultar_preco_servicos: true });
    expect(screen.queryByText("Valor total")).not.toBeInTheDocument();
    expect(screen.queryByText(/120,00/)).not.toBeInTheDocument();
    expect(screen.getByText(TEXTO)).toBeInTheDocument();
  });

  it("sem acréscimo mostra só o total, sem texto", () => {
    tela({ precoTotalCentavos: 10000, acrescimoAtivo: false });
    expect(screen.getByText("Valor total")).toBeInTheDocument();
    expect(screen.getByText(/100,00/)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO)).not.toBeInTheDocument();
  });

  it("nunca mostra percentual", () => {
    tela({ precoTotalCentavos: 12000, acrescimoAtivo: true });
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
