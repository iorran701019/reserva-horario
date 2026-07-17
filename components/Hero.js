import Image from "next/image";
import { buscarTema } from "@/lib/temas";

// Hero reutilizável no topo das telas (home, /agendar, /admin).
//
// IDENTIDADE 100% via tema — nada hardcoded aqui:
//   • cores  → tokens do globals.css (surface, card, border, heading, body, ...)
//   • foto   → condicional por slug (ver SLUGS_COM_FOTO abaixo)
//   • fonte  → font-display (Fraunces) via tema
//
// >>> FOTO DE FUNDO POR SALÃO:
//   A foto (/images/hero-salao.jpg) só entra para os slugs em SLUGS_COM_FOTO;
//   os demais salões mantêm o degradê CLARO da paleta (creme → bege) como
//   PLACEHOLDER leve. Para ativar a foto em outro salão, adicione o slug ao
//   conjunto. Use uma foto SEM marca d'água. Sobre a foto, um overlay escuro +
//   text-shadow garantem o contraste do título em qualquer imagem.
//
// >>> MARCA (LOGO) POR SALÃO (lib/temas.js):
//   Salões com tema cadastrado trocam o título centralizado por uma marca
//   própria, conforme tema.layoutMarca:
//     'esquerda'        → monograma (esquerda) + nome/tagline empilhados
//                          (direita), nas cores do tema (ex.: laysla).
//     'pilha-completa'  → símbolo + wordmark empilhados e centralizados,
//                          sem nome em texto — a imagem já contém a marca
//                          por extenso (ex.: flavia).
//   Sem tema cadastrado (todo o resto), o Hero não muda em nada.

const NOME_LOJA = process.env.NEXT_PUBLIC_NOME_LOJA || "Agendamento";

// Slugs que usam a foto de fundo do hero. Fonte única — comparação em minúsculas.
const SLUGS_COM_FOTO = new Set(["valeria", "junior"]);

// Caminho da foto de fundo (arquivo em /public).
const HERO_FOTO = "/images/hero-salao.jpg";

// `nome` sobrescreve o nome exibido (estab.nome resolvido pelo slug do path). Sem ele,
// cai no NEXT_PUBLIC_NOME_LOJA / "Agendamento" — comportamento original.
// `slug` decide o fundo: slugs em SLUGS_COM_FOTO usam a foto; os demais, o degradê.
export default function Hero({ subtitulo, compacto = false, nome, slug }) {
  const usaFoto = slug != null && SLUGS_COM_FOTO.has(String(slug).toLowerCase());

  // tema só entra em jogo com identidade própria cadastrada — sem ela, `tema`
  // fica null e o resto da função segue exatamente como antes (nenhuma
  // mudança visual). `personalizado` é o gatilho explícito (independe do
  // formato da marca: monograma+texto ou pilha de imagens).
  const temaBruto = buscarTema(slug);
  const tema = temaBruto?.personalizado ? temaBruto : null;
  const ehPilhaCompleta = tema?.layoutMarca === "pilha-completa";

  // Fundo do hero:
  //  - com foto (valeria/junior): a imagem cobrindo o hero; o contraste do texto
  //    vem do overlay escuro + text-shadow, não de scrim claro;
  //  - com tema (ex.: laysla): a cor/degradê próprio do tema (`background`, não
  //    `backgroundImage` — tema.bgHeader pode ser uma cor sólida). A borda
  //    (border-border já na className abaixo) NÃO precisa de override aqui:
  //    vem de --color-border, centralizado em app/[salon]/page.js.
  //  - sem nenhum dos dois: degradê suave creme → bege, via tokens da paleta.
  const estiloFundo = usaFoto
    ? {
        backgroundImage: `url(${HERO_FOTO})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : tema
    ? { background: tema.bgHeader }
    : {
        backgroundImage:
          "linear-gradient(180deg, var(--color-card), var(--color-border))",
      };

  return (
    <header
      className={[
        // Corte limpo entre hero e corpo: borda definida, sem fade esfumaçado.
        // `relative` ancora o overlay escuro da foto.
        "relative flex flex-col items-center justify-center border-b border-border px-4 text-center",
        // 'pilha-completa' (ex.: flavia) usa padding vertical reduzido: as
        // duas imagens empilhadas já preenchem mais altura que um título de
        // texto, então o mesmo py do padrão deixaria o header "grosso"
        // demais. Os demais layouts (laysla, texto padrão) não mudam.
        compacto
          ? ehPilhaCompleta
            ? "min-h-[70px] py-4 sm:min-h-[90px] sm:py-5"
            : "min-h-[110px] py-8 sm:min-h-[130px]"
          : ehPilhaCompleta
          ? "min-h-[120px] py-6 sm:min-h-[150px] sm:py-7"
          : "min-h-[180px] py-12 sm:min-h-[220px]",
      ].join(" ")}
      style={estiloFundo}
    >
      {/* Overlay escuro só quando há foto: garante contraste do texto claro
          sobre QUALQUER imagem. Sem foto, nada é renderizado (degradê claro). */}
      {usaFoto && (
        <div
          className="pointer-events-none absolute inset-0 bg-black/40"
          aria-hidden="true"
        />
      )}

      {tema?.layoutMarca === "pilha-completa" ? (
        // Logo completo (símbolo + wordmark) empilhado e centralizado — a
        // imagem já contém o nome do estabelecimento por extenso, então
        // nenhum texto adicional é renderizado aqui.
        <div className="relative flex flex-col items-center justify-center gap-2">
          <Image
            src={tema.marcaSimbolo}
            alt=""
            width={220}
            height={110}
            style={{ width: "auto" }}
            className={compacto ? "h-[70px] sm:h-[90px]" : "h-[90px] sm:h-[110px]"}
            preload
          />
          <Image
            src={tema.marcaTexto}
            alt={tema.nomeExibido || nome || NOME_LOJA}
            width={340}
            height={130}
            style={{ width: "auto" }}
            className={compacto ? "h-10 sm:h-12" : "h-12 sm:h-14"}
            preload
          />
        </div>
      ) : tema ? (
        // Marca (monograma) é o elemento de destaque: grande e colada na
        // borda esquerda (mx-auto max-w-md replica o inset do conteúdo
        // abaixo do Hero). Nome/tagline ocupam o espaço restante (flex-1) e
        // ficam centralizados NESSE espaço — respiro tanto da marca quanto
        // da borda direita, sem grudar em nenhum dos dois.
        <div className="relative mx-auto flex w-full max-w-md items-center gap-4">
          <Image
            src={tema.marca}
            alt=""
            width={266}
            height={338}
            className={compacto ? "h-16 w-auto sm:h-20" : "h-24 w-auto sm:h-28"}
            preload
          />
          <div className="flex flex-1 flex-col items-center text-center">
            <h1
              className={[
                tema.fonteDisplay,
                "font-medium tracking-tight",
                compacto ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl",
              ].join(" ")}
              style={{ color: tema.textoSecundario }}
            >
              {tema.nomeExibido || nome || NOME_LOJA}
            </h1>
            {tema.tagline && (
              <span
                className={[
                  tema.fonteDisplay,
                  "mt-1 text-xs font-normal uppercase tracking-[0.25em] sm:text-sm",
                ].join(" ")}
                style={{ color: tema.textoSecundario }}
              >
                {tema.tagline}
              </span>
            )}
          </div>
        </div>
      ) : (
        <h1
          className={[
            // `relative` mantém o título acima do overlay.
            "relative font-display font-semibold tracking-tight",
            usaFoto
              ? "text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.6)]"
              : "text-heading",
            compacto ? "text-2xl sm:text-3xl" : "text-4xl sm:text-5xl",
          ].join(" ")}
        >
          {nome || NOME_LOJA}
        </h1>
      )}

      {subtitulo && (
        <p
          className={[
            "relative mt-2 max-w-md text-sm sm:text-base",
            usaFoto
              ? "text-white/90 [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]"
              : "text-body",
          ].join(" ")}
        >
          {subtitulo}
        </p>
      )}
    </header>
  );
}
