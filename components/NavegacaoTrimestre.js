"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

// Controles de navegação por trimestre do Histórico (admin geral e ficha do
// cliente — ver lib/useNavegacaoTrimestre). "<"/">" desabilitados quando não
// há trimestre vizinho com dado; "Voltar para o atual" só aparece quando o
// trimestre selecionado não é o corrente.
export default function NavegacaoTrimestre({
  rotulo,
  temAnterior,
  temProximo,
  noAtual,
  onAnterior,
  onProximo,
  onVoltarAtual,
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onAnterior}
        disabled={!temAnterior}
        aria-label="Trimestre anterior"
        className="shrink-0 rounded-lg bg-card p-2 text-body shadow-sm ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex min-w-0 flex-col items-center gap-1">
        <span className="truncate text-sm font-medium text-heading">{rotulo}</span>
        {!noAtual && (
          <button
            type="button"
            onClick={onVoltarAtual}
            className="text-xs font-medium text-blue-600 transition hover:text-blue-700"
          >
            Voltar para o atual
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onProximo}
        disabled={!temProximo}
        aria-label="Próximo trimestre"
        className="shrink-0 rounded-lg bg-card p-2 text-body shadow-sm ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
