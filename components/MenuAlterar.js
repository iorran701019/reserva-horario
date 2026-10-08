"use client";

import { Calendar, Scissors } from "lucide-react";

// Menu pequeno do botão "Alterar" (cards de Pendentes e "Fora da janela",
// detalhe de confirmado e ficha do cliente). Só apresentação: quem chama decide o que
// cada opção faz. "Alterar serviço" só aparece quando `podeAlterarServico`
// (sem par, sem cancelado/concluído); sem ele sobra só data/horário.
export default function MenuAlterar({
  podeAlterarServico = false,
  onAlterarServico,
  onAlterarData,
  onFechar,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Alterar agendamento"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40 px-4"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-xs rounded-2xl bg-card p-4 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          {podeAlterarServico && (
            <button
              type="button"
              onClick={onAlterarServico}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2 text-sm font-medium text-heading ring-1 ring-border transition hover:bg-surface"
            >
              <Scissors className="h-4 w-4" aria-hidden="true" />
              Alterar serviço
            </button>
          )}
          <button
            type="button"
            onClick={onAlterarData}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2 text-sm font-medium text-heading ring-1 ring-border transition hover:bg-surface"
          >
            <Calendar className="h-4 w-4" aria-hidden="true" />
            Alterar data/horário
          </button>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
