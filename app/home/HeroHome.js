import Image from "next/image";
import Link from "next/link";

// Topo da página institucional. Nada aqui é por tenant — é o produto se
// apresentando —, então NÃO reusa components/Hero.js, que resolve tema/logo/
// foto a partir do slug do salão e não teria o que resolver fora de /[salon].
export default function HeroHome() {
  return (
    <section className="px-4 py-12 sm:py-20">
      <div className="mx-auto grid max-w-5xl items-center gap-10 sm:grid-cols-2 sm:gap-12">
        <div className="text-center sm:text-left">
          <span className="inline-flex items-center rounded-full bg-card px-4 py-1.5 text-sm font-semibold text-muted ring-1 ring-border">
            Feito para profissionais de beleza
          </span>

          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-heading sm:text-5xl">
            Agenda organizada, cabeça tranquila.
          </h1>

          <p className="mt-4 text-base leading-relaxed text-body sm:text-lg">
            A Acolhe é o sistema de agendamento feito para manicures, nail
            designers e profissionais de beleza que buscam ficar menos tempo no
            WhatsApp e poder cuidar do que realmente importa: atender a cliente
            que está no salão.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/acolhe"
              className="rounded-full bg-primary px-6 py-3 text-center text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover"
            >
              Simular experiência da cliente
            </Link>
            <a
              href="#contato"
              className="rounded-full bg-card px-6 py-3 text-center text-sm font-semibold text-heading ring-1 ring-border transition-colors hover:bg-surface"
            >
              Quero conhecer
            </a>
          </div>
        </div>

        {/* Print real do fluxo público (tela da cliente). `priority` porque é a
            imagem de maior destaque acima da dobra — sem ela o LCP fica no
            texto e o print entra piscando depois. */}
        <div className="flex justify-center">
          <Image
            src="/images/home/print-demo.png"
            alt="Tela de agendamento da Acolhe vista pela cliente"
            width={520}
            height={835}
            sizes="(min-width: 640px) 320px, 70vw"
            priority
            className="h-auto w-56 rounded-2xl shadow-sm ring-1 ring-border sm:w-72"
          />
        </div>
      </div>
    </section>
  );
}
