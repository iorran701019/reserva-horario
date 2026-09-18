import Link from "next/link";
import IconeAcolhe from "@/components/IconeAcolhe";
import LogoAcolheRodape from "@/components/LogoAcolheRodape";
import HeroHome from "./HeroHome";
import SecaoRecursos from "./SecaoRecursos";
import SecaoSobre from "./SecaoSobre";
import CtaFinalHome from "./CtaFinalHome";

// Página institucional da ACOLHE (o produto), não de um salão: estática, sem
// Supabase, sem tema por tenant — por isso é Server Component puro, ao
// contrário de /[salon] e /painel-global.
//
// >>> COLISÃO COM /[salon]:
//   "/home" casaria com a rota dinâmica /[salon] (salon="home"). Não é
//   bloqueante: no App Router o segmento ESTÁTICO sempre vence o dinâmico,
//   então esta página é a que responde. O efeito colateral é permanente,
//   porém: o slug "home" fica queimado e não pode mais ser usado por nenhum
//   estabelecimento. Vale o mesmo cuidado antes de criar qualquer outra rota
//   de primeiro nível.
export const metadata = {
  title: "Acolhe — Agenda organizada, cabeça tranquila",
  description:
    "Sistema de agendamento online para manicures e profissionais de beleza: a cliente marca sozinha, paga o sinal por Pix e recebe os lembretes automaticamente.",
};

// Âncoras do menu. Fonte única — a ordem aqui é a ordem na tela.
const SECOES = [
  { href: "#o-que-e", rotulo: "O que é" },
  { href: "#sobre", rotulo: "Sobre" },
  { href: "#contato", rotulo: "Contato" },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* O logo já traz a marca por extenso no próprio traço (ver
          docs/identidade-visual/README.md) — escrever "Acolhe" ao lado
          duplicaria a palavra. Altura fixa e largura livre: o viewBox não é
          quadrado (ver IconeAcolhe). */}
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/home" aria-label="Acolhe" className="text-heading">
            <IconeAcolhe className="h-7 w-auto" />
          </Link>

          <nav className="hidden items-center gap-6 sm:flex">
            {SECOES.map(({ href, rotulo }) => (
              <a
                key={href}
                href={href}
                className="text-sm font-medium text-body transition-colors hover:text-heading"
              >
                {rotulo}
              </a>
            ))}
          </nav>

          <Link
            href="/acolhe"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover"
          >
            Simular experiência
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <HeroHome />
        <SecaoRecursos />
        <SecaoSobre />
        <CtaFinalHome />
      </main>

      {/* LogoAcolheRodape já traz mt-10 e se centraliza sozinho; no desktop o
          copyright vai pro lado dele, no mobile empilha embaixo. */}
      <footer className="px-4 pb-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-6">
          <LogoAcolheRodape />
          <p className="text-center text-[10px] text-muted sm:text-xs">
            © 2026 Acolhe. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
