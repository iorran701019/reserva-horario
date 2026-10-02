"use client";

import { useState } from "react";

// Confirmação inline da recusa de um pagamento informado: motivo opcional que
// a dona vê na aba Assinatura. `aoConfirmar` recebe o texto (já trimado, ou null).
export default function FormRecusa({ aoConfirmar, aoCancelar, ocupado }) {
  const [motivo, setMotivo] = useState("");
  return (
    <div className="mt-2 w-full rounded-lg bg-surface p-3 ring-1 ring-border">
      <label className="block text-xs text-body">
        Motivo (aparece para a dona)
        <textarea
          rows={2}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => aoConfirmar(motivo.trim() || null)}
          className="rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Confirmar recusa
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={aoCancelar}
          className="rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-heading ring-1 ring-border transition hover:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
