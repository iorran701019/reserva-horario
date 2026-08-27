"use client";

import { useState } from "react";

// Foto circular clicável com crop (zoom + posição) — recurso GENÉRICO do
// motor, sem nada específico de salão nem de perfil. Hoje serve a DOIS
// donos, e por isso as props não citam tabela nenhuma:
//   1. foto de perfil do estabelecimento —
//      estabelecimentos.foto_perfil_url/_posicao/_zoom (ver
//      buscarEstabelecimento em lib/estabelecimento.js), usada na página
//      pública e no preview ao vivo de ConfiguracoesSalao;
//   2. foto por categoria de serviço —
//      categorias_servico.foto_url/foto_posicao/foto_zoom, como miniatura
//      no acordeão de /agendar e como preview em GerenciarServicos.
// `src` null/undefined ou `diametro` <= 0 não renderiza nada (sem buraco no
// layout nem flash de círculo 0x0 antes da primeira medição) — é isso que
// deixa a foto ser opcional nos dois casos.
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
// O overlay também usa <img> nativa, e por um motivo DIFERENTE do círculo:
// o otimizador do next/image exige allowlist por bucket em
// next.config.mjs (images.remotePatterns), e este componente é genérico —
// serve 'fotos-perfil' E 'fotos-categorias', e amanhã outro bucket. Com
// <Image> aqui, a miniatura (que é <img> nativa) carregava normal e só o
// zoom quebrava, com 400 do /_next/image, pra todo bucket fora da lista.
// <img> nativa vai direto na URL pública e é imune a isso.
//
// Zoom mínimo OFERECIDO PELOS EDITORES de crop (ConfiguracoesSalao,
// GerenciarServicos). Fica aqui só pra ter uma fonte única; o componente
// NÃO força esse mínimo no render — baseScale segue sendo a cobertura
// exata (object-fit: cover) e uma foto salva com zoom 1 continua
// renderizando idêntica a antes. O ponto é que, em zoom exatamente 1, a
// sobra em pelo menos um dos eixos é zero e os sliders de posição X/Y não
// têm curso nenhum; começar em 1.12 garante folga pros dois desde a
// primeira foto enviada.
export const ZOOM_MINIMO = 1.12;

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
//
// Props de reuso (todas OPCIONAIS, com default == comportamento original —
// os dois consumidores antigos não passam nenhuma delas):
//   wrapperClassName – classes do <div> em volta do círculo. O default
//                      centraliza e reserva margem embaixo, que é o certo
//                      pra uma foto de perfil sozinha no topo da página; a
//                      miniatura de categoria (dentro da linha do acordeão
//                      de /agendar) passa "shrink-0" pra não centralizar
//                      nem empurrar o resto da linha.
//   formato          – 'circulo' (default) ou 'quadrado' (cantos só
//                      arredondados), pra fotos que não são retrato.
//   ariaLabel        – rótulo do botão que abre o zoom.
//   ariaLabelDialog  – rótulo do overlay de tela cheia.
//   comRing          – desenha o ring de 1px em volta da foto (default
//                      true, == comportamento original). A miniatura de
//                      categoria em /agendar passa false porque o card do
//                      acordeão já tem `ring-1 ring-border` próprio: com a
//                      foto encostando na borda, os dois rings colam e
//                      viram uma borda visualmente mais grossa naquele
//                      trecho.
export default function FotoPerfilCircular({
  src,
  posicao,
  zoom = 1,
  diametro,
  alt = "",
  wrapperClassName = "mb-6 flex justify-center",
  formato = "circulo",
  ariaLabel = "Ver foto de perfil",
  ariaLabelDialog = "Foto de perfil",
  comRing = true,
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
      <div className={wrapperClassName}>
        <button
          type="button"
          onClick={() => setAberta(true)}
          aria-label={ariaLabel}
          className={[
            "relative overflow-hidden transition hover:opacity-90",
            comRing ? "ring-1 ring-border" : "",
            formato === "quadrado" ? "rounded-lg" : "rounded-full",
          ].join(" ")}
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
          aria-label={ariaLabelDialog}
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
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image exigiria allowlist por bucket em next.config.mjs, ver comentário no topo */}
            <img
              src={src}
              alt={alt}
              className="h-full w-full object-contain"
              style={{ objectPosition }}
            />
          </div>
        </div>
      )}
    </>
  );
}
