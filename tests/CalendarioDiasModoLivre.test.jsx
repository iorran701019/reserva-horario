import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({ supabase: {} }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: h.supabase }));

import { CalendarioDias } from "@/components/FormularioAgendamento";

const TODOS_OS_DIAS = new Set([0, 1, 2, 3, 4, 5, 6]);
const TITULO_FORA = "Fora das regras normais de agendamento — modo livre do admin";

function montar(props = {}) {
  return render(
    <CalendarioDias
      mes={new Date(2099, 0, 1)}
      min="2000-01-01"
      diasSemanaAtivos={TODOS_OS_DIAS}
      selecionado=""
      onSelecionar={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
      podeVoltar={false}
      estabelecimento={{}}
      modoLivre
      {...props}
    />
  );
}

describe("CalendarioDias em modoLivre (modal Alterar do /admin)", () => {
  afterEach(cleanup);

  it("sem mesesJanela o dia do expediente sai fora da janela (tracejado)", () => {
    montar();
    const dia = screen.getByRole("button", { name: "15" });
    expect(dia).toHaveAttribute("title", TITULO_FORA);
    expect(dia).toBeEnabled();
  });

  it("com o mês configurado o dia do expediente não sai tracejado", () => {
    montar({ mesesJanela: new Map([["2099-1", { status: "aberto" }]]) });
    const dia = screen.getByRole("button", { name: "15" });
    expect(dia).not.toHaveAttribute("title");
    expect(dia).toBeEnabled();
  });

  it("dia fora do expediente continua tracejado mesmo no mês aberto, e uma data liberada o abre", () => {
    const mesesJanela = new Map([["2099-1", { status: "aberto" }]]);
    montar({ mesesJanela, diasSemanaAtivos: new Set() });
    expect(screen.getByRole("button", { name: "15" })).toHaveAttribute("title", TITULO_FORA);
    cleanup();
    montar({
      mesesJanela,
      diasSemanaAtivos: new Set(),
      datasLiberadas: new Set(["2099-01-15"]),
    });
    expect(screen.getByRole("button", { name: "15" })).not.toHaveAttribute("title");
  });
});
