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
            alt="Iorran, criador do Acolhe"
            width={1087}
            height={1447}
            sizes="224px"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="text-center sm:text-left">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
            Quem está por trás
          </span>

          <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
            Iorran, criador do Acolhe
          </h2>

          <p className="mt-4 text-base leading-relaxed text-body">
            Sou desenvolvedor de sistemas, com formação em suporte de TI e
            desenvolvimento full-stack. O Acolhe não nasceu de um plano de
            negócio: nasceu de acompanhar manicures parceiras perdendo tempo e
            dinheiro com agenda desorganizada — caderno, print de conversa,
            horário marcado duas vezes, cliente que não aparece.
          </p>

          <p className="mt-4 text-base leading-relaxed text-body">
            Sou baseado no Sul Fluminense (RJ) e atendo de perto: quem usa o
            Acolhe fala comigo, não com um robô genérico de suporte. Cada
            ajuste que entra no sistema veio de uma profissional real pedindo.
          </p>
        </div>
      </div>
    </section>
  );
}
