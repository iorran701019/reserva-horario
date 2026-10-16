"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import TrocarCredenciais from "@/components/TrocarCredenciais";

// Aviso fixo no topo de Pendentes enquanto a troca de e-mail e senha da dona
// ainda não é obrigatória (modo 'aviso' de lib/avisoTrocaCredenciais.js). Sem
// botão de fechar: só some quando a troca é feita. O formulário é o mesmo do
// bloqueio (TrocarCredenciais); aberto/fechado é estado só local.
export default function AvisoTrocaCredenciais({ onConcluido }) {
  const [aberto, setAberto] = useState(false);

  return (
    <section
      aria-label="Atualize os dados de acesso do seu app"
      className="mb-4 rounded-2xl bg-card p-3 shadow-sm ring-2 ring-primary sm:p-4"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-heading">Atualize os dados de acesso do seu app</h2>
          <p className="mt-1 text-sm text-body">
            Adicione um novo email e senha para acesso ao APP
          </p>
          {!aberto && (
            <button
              type="button"
              onClick={() => setAberto(true)}
              className="mt-3 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-on-primary transition hover:opacity-90 sm:w-auto"
            >
              Atualizar agora
            </button>
          )}
        </div>
      </div>
      {aberto && (
        <div className="mt-4">
          <TrocarCredenciais semCabecalho onConcluido={onConcluido} />
        </div>
      )}
    </section>
  );
}
