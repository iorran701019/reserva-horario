"use client";

import { useCliqueForaBackdrop } from "@/lib/cliqueFora";

// Confirmação antes de cancelar um agendamento PELA CLIENTE, no fluxo
// público. Até então os quatro botões de cancelar do público (lista do
// PainelCliente, tela do sinal, tela de protocolo e o bloco do sinal dentro
// do wizard) disparavam cancelarAgendamentoCliente no primeiro clique — um
// toque errado no celular já apagava o horário, e o cancelamento é
// irreversível: a linha vira "cancelado" e o slot volta pra grade pública,
// podendo ser tomado por outra pessoa em segundos.
//
// Só de apresentação (mesmo padrão de ModalClientePendente/
// ModalConflitoWhatsapp): quem chama continua dono do cancelarAgendamentoCliente,
// do spinner e da mensagem de erro. Visual idêntico ao modal de cancelamento
// do /admin (ver agendamentoParaCancelar em app/[salon]/admin/page.js) —
// mesmo backdrop, mesmo card, mesmo par de botões com o destrutivo em
// vermelho à direita.
//
// Props:
//   aberto        – false esconde (nada é renderizado).
//   cancelando    – trava os botões e troca o rótulo enquanto o helper roda.
//   erro          – mensagem de falha do cancelamento, mostrada aqui dentro
//                   (o modal fica aberto pra ela poder tentar de novo).
//   onConfirmar / onFechar
export default function ModalConfirmarCancelamento({
  aberto,
  cancelando = false,
  erro = "",
  onConfirmar,
  onFechar,
}) {
  // Hook antes do return: tem que rodar em toda renderização. Fechar pelo
  // fundo fica bloqueado enquanto o cancelamento está em voo — sumir com o
  // modal no meio da requisição deixaria a cliente sem o erro, caso falhe.
  const cliqueFora = useCliqueForaBackdrop(() => {
    if (!cancelando) onFechar();
  });

  if (!aberto) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-confirmar-cancelamento"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
      {...cliqueFora}
    >
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border">
        <h2
          id="titulo-confirmar-cancelamento"
          className="text-lg font-semibold text-heading"
        >
          Cancelar agendamento
        </h2>

        <p className="mt-2 text-sm text-body">
          Tem certeza que deseja cancelar esse agendamento? O horário volta a
          ficar disponível para outras pessoas.
        </p>

        {erro && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
            {erro}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onConfirmar}
            disabled={cancelando}
            className="flex-1 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelando ? "Cancelando..." : "Sim, cancelar"}
          </button>
          <button
            type="button"
            onClick={onFechar}
            disabled={cancelando}
            className="flex-1 rounded-lg bg-card px-3 py-2.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            Manter agendamento
          </button>
        </div>
      </div>
    </div>
  );
}
