"use client";

// Página temporária só para testar CampoMensagemWhatsapp no navegador antes
// de aprovar. Remover depois — não usada em nenhum fluxo real.

import { useState } from "react";
import CampoMensagemWhatsapp from "@/components/CampoMensagemWhatsapp";

export default function TesteCampoMensagem() {
  const [texto, setTexto] = useState("");

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-lg font-semibold text-heading">
        Teste: CampoMensagemWhatsapp
      </h1>

      <CampoMensagemWhatsapp
        value={texto}
        onChange={setTexto}
        variaveisDisponiveis={["nome_cliente", "data", "horario", "servico"]}
      />

      <div className="rounded-lg border border-border bg-surface p-3 text-sm text-body">
        <p className="mb-1 font-medium text-heading">Valor atual:</p>
        <pre className="whitespace-pre-wrap break-words">{texto || "(vazio)"}</pre>
      </div>
    </div>
  );
}
