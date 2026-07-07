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

const NOME_LOJA = process.env.NEXT_PUBLIC_NOME_LOJA || "Agendamento";

// Slugs que usam a foto de fundo do hero. Fonte única — comparação em minúsculas.
const SLUGS_COM_FOTO = new Set(["valeria", "junior", "flavia"]);

// Caminho da foto de fundo (arquivo em /public).
// Foto de fundo por slug. Slug fora do mapa usa a foto padrão.
const FOTOS_POR_SLUG = {
  valeria: "/images/hero-salao.jpg",
  junior: "/images/hero-salao.jpg",
  flavia: "/images/flavia.jpg",
};
const HERO_FOTO_PADRAO = "/images/hero-salao.jpg";

// `nome` sobrescreve o nome exibido (estab.nome resolvido pelo slug do path). Sem ele,
// cai no NEXT_PUBLIC_NOME_LOJA / "Agendamento" — comportamento original.
// `slug` decide o fundo: slugs em SLUGS_COM_FOTO usam a foto; os demais, o degradê.
export default function Hero({ subtitulo, compacto = false, nome, slug }) {
  const usaFoto = slug != null && SLUGS_COM_FOTO.has(String(slug).toLowerCase());

  // Fundo do hero:
  //  - com foto (valeria/junior): a imagem cobrindo o hero; o contraste do texto
  //    vem do overlay escuro + text-shadow, não de scrim claro;
  //  - sem foto (ex.: barbearia): degradê suave creme → bege, via tokens da paleta.
  const estiloFundo = usaFoto
    ? {
        backgroundImage: `url(${FOTOS_POR_SLUG[String(slug).toLowerCase()] ?? HERO_FOTO_PADRAO})`,
        backgroundSize: "cover",
        backgroundPosition: "center 75%",
      }
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
        compacto
          ? "min-h-[110px] py-8 sm:min-h-[130px]"
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
