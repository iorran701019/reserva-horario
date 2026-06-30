// Hero reutilizável no topo das telas (home, /agendar, /admin).
//
// IDENTIDADE 100% via tema — nada hardcoded aqui:
//   • cores  → tokens do globals.css (surface, card, border, heading, body, ...)
//   • foto   → constante HERO_IMAGE abaixo (ÚNICO lugar pra trocar a imagem)
//   • fonte  → font-display (Fraunces) via tema
//
// >>> PARA TROCAR A FOTO DO HERO:
//   1. Coloque o arquivo em /public (ex.: public/hero-salao.jpg).
//   2. Aponte HERO_IMAGE para ele (ex.: "/hero-salao.jpg").
//   Use uma foto SEM marca d'água. Enquanto HERO_IMAGE for null, o hero usa um
//   degradê CLARO da paleta (creme → bege) como PLACEHOLDER leve.

const NOME_LOJA = process.env.NEXT_PUBLIC_NOME_LOJA || "Agendamento";

// Caminho da foto de fundo (arquivo em /public). null => placeholder claro.
export const HERO_IMAGE = null;

// `nome` sobrescreve o nome exibido (estab.nome resolvido por ?salon=). Sem ele,
// cai no NEXT_PUBLIC_NOME_LOJA / "Agendamento" — comportamento original.
export default function Hero({ subtitulo, compacto = false, nome }) {
  // Fundo do hero, sempre CLARO e leve:
  //  - sem foto: degradê suave creme → bege, todo via tokens da paleta;
  //  - com foto: scrim branco translúcido (mantém o texto escuro legível). É
  //    camada neutra de leitura, não identidade.
  const estiloFundo = HERO_IMAGE
    ? {
        backgroundImage: `linear-gradient(rgba(255,255,255,0.6), rgba(255,255,255,0.6)), url(${HERO_IMAGE})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {
        backgroundImage:
          "linear-gradient(180deg, var(--color-card), var(--color-border))",
      };

  return (
    <header
      className={[
        // Corte limpo entre hero e corpo: borda definida, sem fade esfumaçado.
        "flex flex-col items-center justify-center border-b border-border px-4 text-center",
        compacto
          ? "min-h-[110px] py-8 sm:min-h-[130px]"
          : "min-h-[180px] py-12 sm:min-h-[220px]",
      ].join(" ")}
      style={estiloFundo}
    >
      <h1
        className={[
          "font-display font-semibold tracking-tight text-heading",
          compacto ? "text-2xl sm:text-3xl" : "text-4xl sm:text-5xl",
        ].join(" ")}
      >
        {nome || NOME_LOJA}
      </h1>

      {subtitulo && (
        <p className="mt-2 max-w-md text-sm text-body sm:text-base">{subtitulo}</p>
      )}
    </header>
  );
}
