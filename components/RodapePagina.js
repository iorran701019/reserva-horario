"use client";

import { useEffect, useRef, useState } from "react";
import RodapeSelos from "./RodapeSelos";
import ContatoDono from "./ContatoDono";

const GAP_PX = 16;

// Agrupa o RodapeSelos com o botão flutuante ContatoDono e evita que os dois
// se sobreponham no fim do scroll (mobile). ContatoDono é `fixed bottom-4`
// por padrão; um IntersectionObserver no rodapé liga/desliga o acompanhamento
// só enquanto ele está perto/dentro da viewport (barato o resto do tempo).
// Nessa janela, scroll/resize recalculam a cada frame a distância real entre
// o topo do rodapé e o fundo da viewport (getBoundingClientRect, não a
// altura do rodapé) — isso já cobre sozinho qualquer espaço extra abaixo do
// rodapé (ex.: min-h-screen do <main>) e qualquer altura de rodapé por
// tenant (Laysla tem selo mais longo), sem precisar medir isso à parte.
export default function RodapePagina({ estabelecimento, nome }) {
  const rodapeRef = useRef(null);
  const [pertoDoRodape, setPertoDoRodape] = useState(false);
  const [bottomExtra, setBottomExtra] = useState(0);

  useEffect(() => {
    const el = rodapeRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setPertoDoRodape(entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = rodapeRef.current;
    if (!pertoDoRodape || !el) {
      setBottomExtra(0);
      return;
    }

    let frame = null;
    const atualizar = () => {
      frame = null;
      const distanciaAoFundo = window.innerHeight - el.getBoundingClientRect().top;
      setBottomExtra(Math.max(0, distanciaAoFundo) + GAP_PX);
    };
    const agendar = () => {
      if (frame === null) frame = requestAnimationFrame(atualizar);
    };

    atualizar();
    window.addEventListener("scroll", agendar, { passive: true });
    window.addEventListener("resize", agendar);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", agendar);
      window.removeEventListener("resize", agendar);
    };
  }, [pertoDoRodape]);

  return (
    <>
      <ContatoDono
        estabelecimento={estabelecimento}
        nome={nome}
        style={bottomExtra ? { bottom: `${bottomExtra}px` } : undefined}
      />
      <div ref={rodapeRef}>
        <RodapeSelos estabelecimento={estabelecimento} />
      </div>
    </>
  );
}
