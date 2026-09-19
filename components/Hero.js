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
//     'direita'         → mesmo bloco de 'esquerda', espelhado: nome/tagline
//                          à esquerda, marca colada na borda direita (ex.: julia).
//     'pilha-completa'  → símbolo + wordmark empilhados e centralizados,
//                          sem nome em texto — a imagem já contém a marca
//                          por extenso (ex.: flavia).
//     'centro'          → mesmo bloco de 'esquerda', marca centralizada na
//                          largura do header (ex.: acolhe).
//   Tema sem tema.marca (ex.: teste) cai no título em texto centralizado,
//   só que com as cores do tema. Slug sem entrada própria recebe TEMA_PADRAO
//   (ver lib/temas.js), então na prática todo tenant tem tema.

const NOME_LOJA = process.env.NEXT_PUBLIC_NOME_LOJA || "Agendamento";

// Slugs que usam a foto de fundo do hero. Fonte única — comparação em
// minúsculas. NÃO incluir slugs com layoutMarca 'pilha-completa' (ex.:
// flavia) — esses usam só a cor sólida de tema.bgHeader atrás do logo, sem
// foto/overlay.
const SLUGS_COM_FOTO = new Set([]);

// Caminho da foto de fundo (arquivo em /public).
// Foto de fundo por slug. Slug fora do mapa usa a foto padrão.
const FOTOS_POR_SLUG = {};
const HERO_FOTO_PADRAO = "/images/hero-salao.jpg";

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
  // 'centro' (ex.: acolhe) — mesmo bloco de 'esquerda', só que com a marca
  // centralizada na largura do header. Com ocultarNome e sem tagline/
  // marcaTexto, a coluna de texto fica vazia e sai do layout (hidden), senão
  // o gap-4 dela deslocaria a logo pra esquerda.
  const ehCentro = tema?.layoutMarca === "centro";
  const semTextoMarca =
    tema?.ocultarNome && !tema?.tagline && !tema?.marcaTexto;
  // achatarLogo (ex.: laysla) — imagens de marca vieram mais alongadas
  // verticalmente do que o desejado; scaleY via CSS corrige sem reamostrar
  // os PNGs. Genérico: qualquer tenant com o mesmo problema reaproveita.
  const transformLogo = tema?.achatarLogo ? "scaleY(0.82)" : undefined;
  // achatarWordmark (ex.: laysla) — achatamento ESTÉTICO do wordmark
  // (nome), pedido pela cliente; não confundir com achatarLogo, que corrige
  // a proporção alongada do monograma. Campo/valor separados de propósito.
  const transformWordmark = tema?.achatarWordmark
    ? `scaleY(${tema.achatarWordmark})`
    : undefined;
  // escalaLogo (ex.: laysla) — reduz o bloco de marca inteiro (monograma +
  // wordmark + linha divisória) mantendo as proporções entre eles: um único
  // scale() no wrapper que os agrupa, em vez de escalar cada elemento à
  // parte. Genérico: qualquer tenant no layout 'esquerda' reaproveita.
  const transformBlocoMarca = tema?.escalaLogo
    ? `scale(${tema.escalaLogo})`
    : undefined;
  // escalaMonograma (ex.: laysla) — reduz SÓ o monograma (símbolo), separado
  // de escalaLogo (bloco inteiro) e independente do wordmark/divisor.
  // Combinado com achatarLogo (scaleY) direto na <Image> do monograma no
  // layout 'esquerda' — não se aplica ao layoutMarca 'pilha-completa', que
  // não tem monograma isolado do wordmark.
  // alturaMonograma (ex.: julia) — override COMPLETO do className de altura
  // do monograma (substitui o par fixo compacto/normal, não soma). Quando
  // presente, escalaMonograma é ignorado: a redução vem da altura real, que
  // (ao contrário do scale) também libera espaço no flex pro nome/tagline.
  const transformMonograma = [
    tema?.escalaMonograma && !tema?.alturaMonograma
      ? `scale(${tema.escalaMonograma})`
      : null,
    transformLogo,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  // headerMinH / headerPy (ex.: layra) — override por tenant das medidas do
  // ramo `headerCompacto` (min-h e py). Esse ramo é compartilhado por
  // laysla/junior/acolhe, então afinar o header de um tenant editando as
  // strings fixas mexeria em todos; os dois campos deixam o ajuste local ao
  // tema. Ausentes, cada ramo devolve exatamente as classes de antes — é o
  // que garante zero mudança pros demais. São independentes entre si: dá pra
  // definir só um dos dois. Lembrando que min-h é PISO: baixar só o py não
  // afina o header enquanto o min-h for maior que conteúdo + padding.
  const medidasHeaderCompacto = (minHPadrao, pyPadrao) =>
    [tema?.headerMinH ?? minHPadrao, tema?.headerPy ?? pyPadrao].join(" ");

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
        backgroundImage: `url(${FOTOS_POR_SLUG[String(slug).toLowerCase()] ?? HERO_FOTO_PADRAO})`,
        backgroundSize: "cover",
        backgroundPosition: "center 25%",
      }
    : tema
    ? { background: tema.fundoHero ?? tema.bgHeader }
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
        // demais. `headerCompacto` (ex.: laysla) é outro override pontual,
        // por tenant — py bem menor que o padrão do layout 'esquerda' (dois
        // cortes sucessivos já aplicados), com min-h reduzido junto pra não
        // sobrar respiro (min-h só é piso; sem reduzi-lo, ele dominaria e a
        // redução do py não apareceria). Os demais tenants (texto padrão,
        // sem tema) não mudam.
        compacto
          ? ehPilhaCompleta
            ? "min-h-[70px] py-4 sm:min-h-[90px] sm:py-5"
            : tema?.headerCompacto
            ? medidasHeaderCompacto("min-h-[92px] sm:min-h-[108px]", "py-3.5")
            : "min-h-[110px] py-8 sm:min-h-[130px]"
          : ehPilhaCompleta
          ? "min-h-[120px] py-6 sm:min-h-[150px] sm:py-7"
          : tema?.headerCompacto
          ? medidasHeaderCompacto("min-h-[136px] sm:min-h-[152px]", "py-5")
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
            style={{ width: "auto", transform: transformLogo }}
            className={compacto ? "h-[70px] sm:h-[90px]" : "h-[90px] sm:h-[110px]"}
            preload
          />
          <Image
            src={tema.marcaTexto}
            alt={tema.nomeExibido || nome || NOME_LOJA}
            width={340}
            height={130}
            style={{ width: "auto", transform: transformLogo }}
            className={compacto ? "h-10 sm:h-12" : "h-12 sm:h-14"}
            preload
          />
        </div>
      ) : tema?.marca ? (
        // Marca (monograma) é o elemento de destaque: grande e colada na
        // borda esquerda (mx-auto max-w-md replica o inset do conteúdo
        // abaixo do Hero). Nome/tagline ocupam o espaço restante (flex-1) e
        // ficam centralizados NESSE espaço — respiro tanto da marca quanto
        // da borda direita, sem grudar em nenhum dos dois.
        // 'direita' (ex.: julia) reaproveita este mesmo bloco espelhado via
        // flex-row-reverse: a ordem no DOM (marca → divisor → texto) vira
        // texto | divisor | marca na tela, com a marca colada na borda direita.
        <div
          className={[
            "relative mx-auto flex w-full max-w-md items-center gap-4",
            tema.layoutMarca === "direita" ? "flex-row-reverse" : "",
            ehCentro ? "justify-center" : "",
          ].join(" ")}
          style={{ transform: transformBlocoMarca }}
        >
          <Image
            src={tema.marca}
            alt=""
            width={266}
            height={338}
            style={{ transform: transformMonograma }}
            className={
              tema.alturaMonograma ??
              (compacto ? "h-16 w-auto sm:h-20" : "h-24 w-auto sm:h-28")
            }
            preload
          />
          {tema.dividorHeader && (
            // Linha fina separando monograma e nome/tagline — cor sempre
            // var(--color-heading) (já tematizada por tenant), então o campo
            // (tema.dividorHeader) é só o gatilho booleano, sem cor própria.
            <div
              aria-hidden="true"
              className={compacto ? "h-10 w-px sm:h-12" : "h-14 w-px sm:h-16"}
              style={{ backgroundColor: "var(--color-heading)" }}
            />
          )}
          <div
            className={[
              "flex flex-col items-center text-center",
              // flex-1 empurraria a marca pra borda; no 'centro' o texto
              // ocupa só a própria largura.
              ehCentro ? "" : "flex-1",
              ehCentro && semTextoMarca ? "hidden" : "",
            ].join(" ")}
          >
            {tema.marcaTexto ? (
              // Nome + tagline já vêm prontos na imagem (fonte original da
              // marca) — substitui o texto ao vivo, igual ao wordmark da
              // Flávia, mas mantendo o monograma à esquerda (layout 'esquerda').
              // SEM transformLogo aqui: ao contrário do monograma (tema.marca,
              // que segue alongado por design), este wordmark já vem com a
              // proporção correta — aplicar o scaleY de achatarLogo de novo o
              // deixaria achatado demais. transformWordmark é outro campo,
              // achatamento estético pedido pela cliente (ver lib/temas.js).
              <Image
                src={tema.marcaTexto}
                alt={tema.nomeExibido || nome || NOME_LOJA}
                width={1600}
                height={289}
                style={{ width: "auto", transform: transformWordmark }}
                className={compacto ? "h-12 sm:h-14" : "h-16 sm:h-20"}
                preload
              />
            ) : (
              <>
                {/* ocultarNome (ex.: acolhe) — logo já traz a marca por extenso. */}
                {!tema.ocultarNome && (
                <h1
                  className={[
                    tema.fonteDisplay,
                    "font-medium tracking-tight break-words",
                    // tamanhoNome (ex.: julia) — override completo do par de
                    // tamanho compacto/normal; ausente, mantém o padrão.
                    tema.tamanhoNome ??
                      (compacto ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl"),
                  ].join(" ")}
                  style={{ color: tema.textoSecundario }}
                >
                  {tema.nomeExibido || nome || NOME_LOJA}
                </h1>
                )}
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
              </>
            )}
          </div>
        </div>
      ) : (
        // Texto simples centralizado: sem tema OU tema personalizado sem
        // tema.marca (ex.: teste). Com tema, a cor do título vem de
        // tema.textoPrincipal (e a fonte de tema.fonteDisplay, se houver).
        <h1
          className={[
            // `relative` mantém o título acima do overlay.
            "relative font-semibold tracking-tight",
            tema?.fonteDisplay ?? "font-display",
            usaFoto
              ? "text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.6)]"
              : "text-heading",
            compacto ? "text-2xl sm:text-3xl" : "text-4xl sm:text-5xl",
          ].join(" ")}
          style={tema && !usaFoto ? { color: tema.textoPrincipal } : undefined}
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
