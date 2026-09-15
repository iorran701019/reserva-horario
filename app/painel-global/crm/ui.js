"use client";

// Peças visuais repetidas entre os modais do CRM.

export const CLASSE_INPUT =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10";

export const CLASSE_BOTAO_PRIMARIO =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

export const CLASSE_BOTAO_SECUNDARIO =
  "rounded-lg bg-card px-4 py-2 text-sm font-semibold text-body ring-1 ring-border transition hover:text-heading disabled:opacity-60";

export function Campo({ rotulo, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-body">{rotulo}</span>
      {children}
    </label>
  );
}

export function Modal({ titulo, onFechar, children, largura = "max-w-lg" }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center"
      onClick={onFechar}
    >
      <div
        className={`max-h-full w-full ${largura} overflow-y-auto rounded-2xl bg-card p-5 shadow-xl ring-1 ring-border`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-heading">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="text-xl leading-none text-muted hover:text-heading"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function MensagemErro({ children }) {
  if (!children) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
      {children}
    </p>
  );
}
