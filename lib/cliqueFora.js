"use client";

import { useRef } from "react";

// Fechamento por clique no backdrop de um modal, à prova de seleção de texto.
//
// O ingênuo `onClick={onFechar}` no backdrop fecha o modal em situações que
// não são clique-fora nenhum: o `click` do DOM é despachado no ancestral
// comum mais próximo entre os alvos do mousedown e do mouseup — NÃO no alvo
// do mouseup. Arrastar pra selecionar o texto de um input e soltar o botão
// fora do card faz o click cair no backdrop, e o modal fecha no meio de um
// "selecionar tudo pra colar" (bug real na troca de WhatsApp do admin, ver
// ModalAlterarWhatsapp.js). O `stopPropagation` do card não protege nesse
// caso: ele nem chega a estar no caminho do evento.
//
// A guarda: só fecha se o gesto COMEÇOU e TERMINOU no próprio backdrop
// (`target === currentTarget` nos dois eventos). Clique-fora de verdade
// continua fechando, inclusive em toque (o mousedown/click sintetizado sai
// no mesmo elemento).
//
// Uso: <div {...useCliqueForaBackdrop(onFechar)} className="fixed inset-0 ...">
export function useCliqueForaBackdrop(onFechar) {
  const comecouNoBackdrop = useRef(false);

  return {
    onMouseDown: (e) => {
      comecouNoBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e) => {
      const fechar = comecouNoBackdrop.current && e.target === e.currentTarget;
      comecouNoBackdrop.current = false;
      if (fechar) onFechar();
    },
  };
}
