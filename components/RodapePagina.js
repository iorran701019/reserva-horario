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
//
// O "Desenvolvido por Acolhe" mora DENTRO da div observada, acima dos selos:
// assim o topo medido é o topo do texto, e o botão para 16px acima dele em
// vez de cobri-lo. O respiro de cima é `mt-10` NA DIV (margem fica fora do
// getBoundingClientRect; um padding-top entraria na conta e empurraria o
// botão pra longe do texto). O respiro entre texto e selos é o pb do <p>.
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
      <div ref={rodapeRef} className="mt-10">
        <p className="pb-10 text-center text-[10px] text-muted sm:pb-16 sm:text-xs">
          Desenvolvido por Acolhe
        </p>
        <RodapeSelos estabelecimento={estabelecimento} />
      </div>
    </>
  );
}
