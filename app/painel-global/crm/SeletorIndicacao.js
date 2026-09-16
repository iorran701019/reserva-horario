"use client";

import { useState } from "react";
import { CLASSE_INPUT } from "./ui";

// "Indicado por": busca por nome entre os leads já carregados e devolve o id
// (indicado_por_lead_id). Sem match, é só não escolher — o campo fica vazio e
// não trava o salvar. Sem texto livre de propósito: o vínculo é sempre lead→lead.
// Usado no ModalNovoLead e no DetalheLead, só quando origem = indicação.
export default function SeletorIndicacao({ leads, valor, excluirId, onChange }) {
  const [busca, setBusca] = useState("");

  const selecionado = leads.find((l) => l.id === Number(valor));
  const termo = busca.trim().toLowerCase();
  const sugestoes = termo
    ? leads.filter((l) => l.id !== excluirId && l.nome.toLowerCase().includes(termo)).slice(0, 6)
    : [];

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-body">Indicado por</span>
      {selecionado ? (
        <div className="flex items-center gap-2 text-sm text-heading">
          {selecionado.nome}
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs font-semibold text-red-600 hover:underline"
          >
            remover
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar lead pelo nome (opcional)"
            className={CLASSE_INPUT}
          />
          {termo && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg bg-card shadow-lg ring-1 ring-border">
              {sugestoes.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted">
                  Nenhum lead com esse nome — dá pra salvar sem vincular.
                </li>
              ) : (
                sugestoes.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(l.id);
                        setBusca("");
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-heading hover:bg-surface"
                    >
                      {l.nome}
                      {l.cidade ? <span className="text-xs text-muted"> · {l.cidade}</span> : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
