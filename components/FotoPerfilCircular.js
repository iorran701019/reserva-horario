"use client";

import { useState } from "react";
import Image from "next/image";

// Foto de perfil circular clicável — recurso GENÉRICO do motor, alimentado
// por estabelecimentos.foto_perfil_url/foto_perfil_posicao/foto_perfil_zoom
// (ver buscarEstabelecimento em lib/estabelecimento.js). Qualquer tenant com
// foto_perfil_url preenchida ganha o círculo; nada aqui é específico de
// salão. `src` null/undefined ou `diametro` <= 0 não renderiza nada (sem
// buraco no layout nem flash de círculo 0x0 antes da primeira medição).
//
// O círculo usa <img> nativa (não next/image) porque precisamos das
// dimensões reais da imagem (naturalWidth/naturalHeight) pra calcular
// manualmente escala + deslocamento — object-fit/object-position sozinhos
// não dão zoom de verdade (só cobrem o círculo no mínimo necessário).
// baseScale = MIN de escala que cobre o círculo (equivalente a object-fit:
// cover); escalaFinal = baseScale * zoom amplia a partir daí. O deslocamento
// reproduz a mesma matemática do object-position em %: com zoom=1 o
// resultado é visualmente idêntico ao object-fit: cover de antes (não
// regride fotos já configuradas).
//
// Clicar abre a foto inteira em overlay de tela cheia (fundo escurecido,
// sem corte via object-fit: contain, sem zoom) — mesma ideia da
// visualização de foto de perfil do WhatsApp. Fecha ao clicar fora da foto
// ou no X.
//
// Props:
//   src       – caminho/URL da foto (estabelecimentos.foto_perfil_url).
//   posicao   – object-position CSS (estabelecimentos.foto_perfil_posicao);
//               null/undefined cai no fallback '50% 50%' (centro).
//   zoom      – multiplicador sobre a escala mínima de cobertura
//               (estabelecimentos.foto_perfil_zoom); null/undefined cai no
//               fallback 1 (sem zoom extra, == comportamento antigo).
//   diametro  – tamanho (px) do círculo, definido por quem usa o componente
//               (na página pública, a altura da caixa logo abaixo — ver
//               app/[salon]/page.js).
export default function FotoPerfilCircular({
  src,
  posicao,
  zoom = 1,
  diametro,
  alt = "",
}) {
  const [aberta, setAberta] = useState(false);
  const [dimensoesNaturais, setDimensoesNaturais] = useState(null);

  // Reseta a medição ao trocar de foto — sem isso, a escala/deslocamento da
  // foto anterior ficaria valendo por um instante até a nova disparar onLoad.
  // Ajuste de state durante a renderização (não em useEffect) é o padrão
  // recomendado pra "resetar state quando uma prop muda" — evita o
  // ciclo extra de render→commit→effect→render.
  const [ultimoSrc, setUltimoSrc] = useState(src);
  if (src !== ultimoSrc) {
    setUltimoSrc(src);
    setDimensoesNaturais(null);
  }

  if (!src || !diametro) return null;

  const objectPosition = posicao || "50% 50%";
  const [xStr, yStr] = objectPosition.split(" ");
  const x = parseFloat(xStr);
  const y = parseFloat(yStr);
  const posX = Number.isNaN(x) ? 50 : x;
  const posY = Number.isNaN(y) ? 50 : y;

  // Só calcula (e só mostra a imagem) depois que naturalWidth/naturalHeight
  // chegam pelo onLoad — antes disso não dá pra saber a escala mínima de
  // cobertura, então fica invisível em vez de piscar em tamanho errado.
  let estiloImagem = { display: "none" };
  if (dimensoesNaturais) {
    const baseScale = Math.max(
      diametro / dimensoesNaturais.largura,
      diametro / dimensoesNaturais.altura
    );
    const escalaFinal = baseScale * (zoom || 1);
    const larguraRenderizada = dimensoesNaturais.largura * escalaFinal;
    const alturaRenderizada = dimensoesNaturais.altura * escalaFinal;
    const deslocamentoX = (diametro - larguraRenderizada) * (posX / 100);
    const deslocamentoY = (diametro - alturaRenderizada) * (posY / 100);

    estiloImagem = {
      position: "absolute",
      top: 0,
      left: 0,
      width: larguraRenderizada,
      height: alturaRenderizada,
      maxWidth: "none",
      transform: `translate(${deslocamentoX}px, ${deslocamentoY}px)`,
    };
  }

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
          {/* eslint-disable-next-line @next/next/no-img-element -- precisa de naturalWidth/naturalHeight pro zoom manual, ver comentário acima */}
          <img
            src={src}
            alt={alt}
            onLoad={(e) =>
              setDimensoesNaturais({
                largura: e.target.naturalWidth,
                altura: e.target.naturalHeight,
              })
            }
            style={estiloImagem}
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
