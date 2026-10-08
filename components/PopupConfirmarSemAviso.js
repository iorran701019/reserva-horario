"use client";

import { useEffect } from "react";

// Popup de confirmação reaproveitável para ações que normalmente avisam a
// cliente (ex.: alterar data/horário/valor) e que a dona escolheu fazer SEM
// notificar. Só apresentação: quem chama decide quando mostrar e o que fazer
// em cada botão. Mesmo padrão visual de PopupRegrasAgendamento.
//
// Props:
//   titulo       – opcional (padrão: "Alterar sem avisar a cliente?").
//   texto        – opcional (padrão: aviso sobre data, horário e valor).
//   rotuloAcao   – opcional (padrão: "Alterar sem avisar").
//   onConfirmar  – clique no botão de ação (segue sem avisar).
//   onVoltar     – clique em "Voltar" ou no véu.
//   desabilitado – trava os botões enquanto a ação roda.
export default function PopupConfirmarSemAviso({
  titulo = "Alterar sem avisar a cliente?",
  texto = "Mudanças de data, horário e valor são importantes de comunicar à cliente. Deseja mesmo alterar sem notificar?",
  rotuloAcao = "Alterar sem avisar",
  onConfirmar,
  onVoltar,
  desabilitado = false,
}) {
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
      aria-labelledby="titulo-confirmar-sem-aviso"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40 px-4"
      onClick={desabilitado ? undefined : onVoltar}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="titulo-confirmar-sem-aviso"
          className="text-lg font-semibold text-on-card"
        >
          {titulo}
        </h2>
        <p className="mt-2 text-sm text-on-card">{texto}</p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirmar}
            disabled={desabilitado}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {rotuloAcao}
          </button>
          <button
            type="button"
            onClick={onVoltar}
            disabled={desabilitado}
            className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-on-card ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
