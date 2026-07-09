"use client";

import { linkWhatsApp } from "@/lib/whatsapp";

// Botão fixo de contato com o estabelecimento, visível em qualquer tela do
// fluxo público (identificação, cadastro, anamnese, painel, wizard e resumo).
// O nome do "responsável" exibido no texto (profissional ativo de menor id,
// ou "a equipe" na ausência de um) vem pronto de quem monta a página — ver
// app/[salon]/page.js —, pra que a mesma busca alimente também o texto do
// bloco de sinal do FormularioAgendamento sem duplicar a query.
//
// Props:
//   estabelecimento – { id, whatsapp } do salão resolvido pelo slug.
//   nome            – nome já resolvido a exibir (com fallback já aplicado).
export default function ContatoDono({ estabelecimento, nome = "a equipe" }) {
  return (
    <a
      href={linkWhatsApp(estabelecimento.whatsapp, "Olá! Estou com uma dúvida.")}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-green-600 px-4 py-3 font-medium text-white shadow-lg transition hover:bg-green-700"
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className="h-5 w-5 shrink-0"
      >
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24.044 12.045.044 5.463.044.102 5.404.1 11.986c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.582 0 11.943-5.361 11.945-11.945a11.86 11.86 0 00-3.418-8.4" />
      </svg>
      <span className="text-sm">Falar com {nome}</span>
    </a>
  );
}
