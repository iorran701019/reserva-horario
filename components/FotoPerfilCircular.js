"use client";

import { useState } from "react";
import Image from "next/image";

// Foto de perfil circular clicável — recurso GENÉRICO do motor, alimentado
// por estabelecimentos.foto_perfil_url/foto_perfil_posicao (ver
// buscarEstabelecimento em lib/estabelecimento.js). Qualquer tenant com
// foto_perfil_url preenchida ganha o círculo; nada aqui é específico de
// salão. `src` null/undefined ou `diametro` <= 0 não renderiza nada (sem
// buraco no layout nem flash de círculo 0x0 antes da primeira medição).
//
// Clicar abre a foto inteira em overlay de tela cheia (fundo escurecido,
// sem corte via object-fit: contain) — mesma ideia da visualização de foto
// de perfil do WhatsApp. Fecha ao clicar fora da foto ou no X.
//
// Props:
//   src       – caminho/URL da foto (estabelecimentos.foto_perfil_url).
//   posicao   – object-position CSS (estabelecimentos.foto_perfil_posicao);
//               null/undefined cai no fallback '50% 50%' (centro).
//   diametro  – tamanho (px) do círculo, definido por quem usa o componente
//               (na página pública, a altura da caixa logo abaixo — ver
//               app/[salon]/page.js).
export default function FotoPerfilCircular({ src, posicao, diametro, alt = "" }) {
  const [aberta, setAberta] = useState(false);

  if (!src || !diametro) return null;

  const objectPosition = posicao || "50% 50%";

  return (
    <>
      <div className="mb-6 flex justify-center">
        <button
          type="button"
          onClick={() => setAberta(true)}
          aria-label="Ver foto de perfil"
          className="relative overflow-hidden rounded-full ring-1 ring-border transition hover:opacity-90"
          style={{ width: diametro, height: diametro }}
        >
          <Image
            src={src}
            alt={alt}
            fill
            sizes={`${Math.round(diametro)}px`}
            style={{ objectFit: "cover", objectPosition }}
          />
        </button>
      </div>

      {aberta && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Foto de perfil"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={() => setAberta(false)}
        >
          <button
            type="button"
            onClick={() => setAberta(false)}
            aria-label="Fechar"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              className="h-6 w-6"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <div
            className="relative h-[80vh] w-[90vw] max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={src}
              alt={alt}
              fill
              sizes="90vw"
              style={{ objectFit: "contain", objectPosition }}
            />
          </div>
        </div>
      )}
    </>
  );
}
