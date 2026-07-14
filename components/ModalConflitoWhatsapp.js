"use client";

import { linkWhatsApp } from "@/lib/whatsapp";

// Os dois modais da checagem de WhatsApp já cadastrado (ver
// lib/checagemWhatsapp.js — useConflitoWhatsapp). Componente só de
// apresentação: quem decide quando abrir/fechar e o que "Sim"/"Não" fazem é
// o hook; aqui só desenha o que ele expõe. Usado tanto pelo completarEndereco
// (CadastroCliente) quanto pelo cadastro simples (IdentificacaoCliente).
//
// Props:
//   clienteConflitante   – cliente achado com o mesmo WhatsApp (abre o modal
//                          "é você?") ou null.
//   modalContato         – true abre o modal "fale com a gente" (3ª tentativa).
//   estabelecimentoWhatsapp, nomeContato – pro link/texto do modal de contato
//                          (mesmo padrão de ContatoDono.js).
//   onConfirmar, onNegar, onFecharContato – handlers do hook.
export default function ModalConflitoWhatsapp({
  clienteConflitante,
  modalContato,
  estabelecimentoWhatsapp,
  nomeContato = "a equipe",
  onConfirmar,
  onNegar,
  onFecharContato,
}) {
  return (
    <>
      {clienteConflitante && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-conflito-whatsapp"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={onNegar}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-conflito-whatsapp"
              className="text-lg font-semibold text-heading"
            >
              Número já cadastrado
            </h2>
            <p className="mt-2 text-sm text-body">
              Você é{" "}
              <span className="font-medium text-heading">
                {clienteConflitante.nome}
              </span>
              ?
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={onConfirmar}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
              >
                Sim, sou eu
              </button>
              <button
                type="button"
                onClick={onNegar}
                className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Não
              </button>
            </div>
          </div>
        </div>
      )}

      {modalContato && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-contato-whatsapp"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={onFecharContato}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-contato-whatsapp"
              className="text-lg font-semibold text-heading"
            >
              Fale com a gente
            </h2>
            <p className="mt-2 text-sm text-body">
              Parece que esse número está associado a outro cadastro. Fale
              diretamente com{" "}
              <span className="font-medium text-heading">{nomeContato}</span>.
            </p>

            <a
              href={linkWhatsApp(
                estabelecimentoWhatsapp,
                "Olá! Estou com um problema pra me cadastrar."
              )}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onFecharContato}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 font-medium text-white transition hover:bg-green-700"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="h-5 w-5 shrink-0"
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24.044 12.045.044 5.463.044.102 5.404.1 11.986c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.582 0 11.943-5.361 11.945-11.945a11.86 11.86 0 00-3.418-8.4" />
              </svg>
              Falar no WhatsApp
            </a>
          </div>
        </div>
      )}
    </>
  );
}
