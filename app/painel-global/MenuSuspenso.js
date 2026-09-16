"use client";

import { useEffect, useRef, useState } from "react";

// Botão + lista suspensa da barra do hub (ver HubPainelGlobal). O rótulo do
// botão é decidido por quem usa — o menu não sabe qual opção está "ativa" além
// do `ativo` de cada item, usado só pro destaque.
//
// itens: [{ id, rotulo, ativo?, onSelecionar }]
export default function MenuSuspenso({ rotulo, itens, alinhar = "esquerda" }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    function fecharFora(e) {
      if (!raiz.current?.contains(e.target)) setAberto(false);
    }
    function fecharEsc(e) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("pointerdown", fecharFora);
    document.addEventListener("keydown", fecharEsc);
    return () => {
      document.removeEventListener("pointerdown", fecharFora);
      document.removeEventListener("keydown", fecharEsc);
    };
  }, [aberto]);

  return (
    <div ref={raiz} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-sm font-semibold text-heading ring-1 ring-border transition hover:ring-primary/40"
      >
        <span className="truncate">{rotulo}</span>
        <span aria-hidden className={`text-xs text-muted transition ${aberto ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>

      {aberto && (
        <ul
          role="menu"
          className={`absolute top-full z-40 mt-1 w-max min-w-full overflow-hidden rounded-lg bg-card py-1 shadow-lg ring-1 ring-border ${
            alinhar === "direita" ? "right-0" : "left-0"
          }`}
        >
          {itens.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAberto(false);
                  item.onSelecionar();
                }}
                className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-surface ${
                  item.ativo ? "font-semibold text-primary" : "text-body"
                }`}
              >
                {item.rotulo}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
