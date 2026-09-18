import Link from "next/link";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import {
  WHATSAPP_SUPORTE_ACOLHE,
  INSTAGRAM_ACOLHE,
  INSTAGRAM_ACOLHE_HANDLE,
} from "@/lib/acolhe";
import { linkWhatsApp } from "@/lib/whatsapp";

// Texto de abertura da conversa. NÃO reusa MENSAGEM_SUPORTE_ACOLHE: aquela é
// da dona que JÁ usa o painel pedindo ajuda; aqui quem escreve ainda não é
// cliente, e a primeira frase precisa dizer de onde ela veio.
const MENSAGEM_INTERESSE =
  "Olá! Vi a página do Acolhe e quero conhecer o sistema de agendamento.";

export default function CtaFinalHome() {
  return (
    <section id="contato" className="scroll-mt-20 bg-heading px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-card sm:text-3xl">
          Quer parar de perder horário por falta de confirmação?
        </h2>

        <p className="mt-4 text-base leading-relaxed text-card/80">
          Dá pra ver o sistema funcionando agora mesmo, do jeito que a sua
          cliente veria. Se fizer sentido pra você, me chama — a conversa é
          direta comigo.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/acolhe"
            className="rounded-full bg-card px-6 py-3 text-center text-sm font-semibold text-heading transition-colors hover:bg-surface"
          >
            Simular experiência da cliente
          </Link>

          <a
            href={linkWhatsApp(WHATSAPP_SUPORTE_ACOLHE, MENSAGEM_INTERESSE)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-card ring-1 ring-card/40 transition-colors hover:bg-card/10"
          >
            <IconeWhatsApp className="h-4 w-4" />
            Chamar no WhatsApp
          </a>
        </div>

        <p className="mt-6 text-sm text-card/70">
          Ou acompanhe no Instagram{" "}
          <a
            href={INSTAGRAM_ACOLHE}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-card underline underline-offset-4"
          >
            {INSTAGRAM_ACOLHE_HANDLE}
          </a>
        </p>
      </div>
    </section>
  );
}
