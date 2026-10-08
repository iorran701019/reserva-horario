"use client";

import { useEffect } from "react";

// Popup bloqueante exibido no fluxo público do FormularioAgendamento antes
// de a cliente se comprometer com o agendamento — sempre, com ou sem sinal a
// pagar — quando o salão tem um aviso configurado
// (estabelecimento.aviso_regras_agendamento, ver ConfiguracoesSalao).
// Componente só de apresentação: quem decide SE e QUANDO mostra é quem chama
// (ver selecionarHorario/handleSubmit em FormularioAgendamento); aqui só
// desenha o texto e o botão de confirmação. Mesmo padrão visual dos outros
// modais do wizard (ModalConflitoWhatsapp etc).
//
// Props:
//   texto        – aviso_regras_agendamento do estabelecimento (texto
//                  livre). Quebras de linha são preservadas; *trecho* vira
//                  negrito (mesmo padrão do WhatsApp), via parse simples de
//                  regex.
//   onConfirmar  – clique em "Entendi, continuar".

// "algo *em negrito* aqui" -> partes alternando texto normal e o conteúdo
// entre asteriscos, que vira <strong>. Não lida com *aninhado* nem escaping —
// só o caso comum de destaque simples.
function formatarAviso(texto) {
  return texto.split(/(\*[^*]+\*)/g).map((parte, i) =>
    parte.startsWith("*") && parte.endsWith("*") && parte.length > 1 ? (
      <strong key={i}>{parte.slice(1, -1)}</strong>
    ) : (
      <span key={i}>{parte}</span>
    )
  );
}

export default function PopupRegrasAgendamento({ texto, onConfirmar }) {
  // Trava a rolagem do fundo enquanto o popup está aberto.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-aviso-regras-agendamento"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
    >
      <div className="modal-janela w-full max-w-sm rounded-2xl bg-card shadow-lg ring-1 ring-border">
        <h2 id="titulo-aviso-regras-agendamento" className="sr-only">
          Aviso
        </h2>

        <div className="relative flex min-h-0 flex-1 flex-col pt-6">
          <div className="modal-janela-corpo px-6">
            <p className="whitespace-pre-wrap text-sm text-on-card">
              {formatarAviso(texto)}
            </p>
          </div>
          <div className="modal-janela-fade" aria-hidden="true" />
        </div>

        <div className="modal-janela-rodape px-6 pt-2">
          <button
            type="button"
            onClick={onConfirmar}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-on-primary transition hover:bg-primary-hover"
          >
            Entendi, continuar
          </button>
        </div>
      </div>
    </div>
  );
}
