import { linkWhatsAppLimiteTentativas } from "@/lib/whatsapp";

// Botão verde do WhatsApp da Acolhe, mostrado junto da mensagem de limite de
// tentativas (login do /admin e cartão de troca de credenciais).
export default function BotaoWhatsappLimiteTentativas() {
  return (
    <a
      href={linkWhatsAppLimiteTentativas()}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block w-full rounded-lg bg-green-600 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-green-700"
    >
      Falar com a Acolhe no WhatsApp
    </a>
  );
}
