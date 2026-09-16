"use client";

import { useEffect, useRef } from "react";

// Painel suspenso do filtro de cidade (aberto pelo botão "Cidades" na barra do
// hub). Flutua por cima do conteúdo em vez de ocupar uma linha: a grade 2×3 do
// Quadro é dimensionada pra caber inteira na tela, e uma barra fixa a
// empurraria pra fora no celular.
//
// Seleção cumulativa (OR): cada chip liga/desliga uma cidade. `opcoes` vem de
// opcoesCidade (lib/crm.js); `selecionadas` são chaves normalizadas.
export default function FiltroCidade({ opcoes, selecionadas, onAlternar, onLimpar, onFechar }) {
  const raiz = useRef(null);

  useEffect(() => {
    function fecharFora(e) {
      // O botão da barra que abre o painel fica de fora dele; sem esta
      // exceção, o pointerdown fecharia e o click logo em seguida reabriria.
      if (raiz.current?.contains(e.target) || e.target.closest?.("[data-filtro-cidade-botao]")) return;
      onFechar();
    }
    function fecharEsc(e) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("pointerdown", fecharFora);
    document.addEventListener("keydown", fecharEsc);
    return () => {
      document.removeEventListener("pointerdown", fecharFora);
      document.removeEventListener("keydown", fecharEsc);
    };
  }, [onFechar]);

  return (
    <div
      ref={raiz}
      className="absolute inset-x-0 top-0 z-30 rounded-xl bg-card p-3 shadow-lg ring-1 ring-border"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-heading">Filtrar por cidade</p>
        <div className="flex items-center gap-3">
          {selecionadas.length > 0 && (
            <button type="button" onClick={onLimpar} className="text-xs font-medium text-primary hover:underline">
              Limpar filtro
            </button>
          )}
          <button type="button" onClick={onFechar} aria-label="Fechar filtro" className="text-sm text-muted hover:text-heading">
            ✕
          </button>
        </div>
      </div>

      {opcoes.length === 0 ? (
        <p className="text-xs text-muted">Nenhum lead com cidade cadastrada.</p>
      ) : (
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {opcoes.map((opcao) => {
            const ativa = selecionadas.includes(opcao.chave);
            return (
              <button
                key={opcao.chave}
                type="button"
                onClick={() => onAlternar(opcao.chave)}
                aria-pressed={ativa}
                className={`rounded-full px-2.5 py-1 text-xs ring-1 transition ${
                  ativa
                    ? "bg-primary text-white ring-primary"
                    : `bg-surface ring-border hover:ring-primary/40 ${opcao.contagem ? "text-body" : "text-muted"}`
                }`}
              >
                {opcao.rotulo} ({opcao.contagem})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
