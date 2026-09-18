import Image from "next/image";

export default function SecaoSobre() {
  return (
    <section id="sobre" className="scroll-mt-20 px-4 py-12 sm:py-20">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 sm:flex-row sm:items-start sm:gap-12">
        {/* O PNG original é 1087x1447 e pesa ~1,6MB. O recorte circular vem do
            wrapper (overflow-hidden + object-cover), e a redução de peso do
            next/image: `sizes` amarra a largura servida ao tamanho real
            renderizado (224px), então o arquivo grande nunca chega à cliente. */}
        <div className="h-56 w-56 shrink-0 overflow-hidden rounded-full shadow-sm ring-1 ring-border">
          <Image
            src="/images/home/iorran.png"
            alt="Iorran, criador da Acolhe"
            width={1087}
            height={1447}
            sizes="224px"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="text-center sm:text-left">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
            Quem cuida de cada detalhe
          </span>

          <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
            Iorran, criador da Acolhe
          </h2>
          
          <p className="mt-4 text-base leading-relaxed text-body">
            Tenho 37 anos de idade, com formação em TI (Desenvolvimento Full
            Stack). Moro em Barra Mansa, região Sul Fluminense — RJ, onde faço
            o atendimento às profissionais de beleza online e presencialmente.
            Todo suporte do aplicativo é 100% humano e feito sob medida.
          </p>
        </div>
      </div>
    </section>
  );
}
