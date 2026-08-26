"use client";

// Aviso de "essa cliente já tem agendamento pendente", mostrado ANTES de
// abrir o wizard de agendamento do admin. Componente só de apresentação
// (mesmo padrão de ModalConflitoWhatsapp.js): quem decide quando abrir e o
// que cada ação faz é quem monta.
//
// Dois caminhos levam ao mesmo modal, por isso ele é compartilhado em vez de
// duplicado:
//   - a busca por nome do pré-passo (IdentificacaoClienteAdmin), onde a
//     pendência vem de buscarPendentesPorTelefones; e
//   - o atalho "Novo agendamento" da aba Histórico (app/[salon]/admin/page.js),
//     que pula o pré-passo e checa contra o `inbox` já derivado ali.
//
// Não é um bloqueio: "Agendar mesmo assim" segue o fluxo normal. O objetivo é
// só evitar o agendamento duplicado feito sem saber que já havia um pendente
// esperando ação na outra aba.
//
// Props:
//   cliente             – { nome, telefone } com pendência, ou null (fechado).
//   onIrParaPendentes   – leva pra aba Pendentes com o item em destaque.
//   onAgendarMesmoAssim – segue pro wizard, ignorando a pendência.
//   onCancelar          – fecha e deixa o admin onde estava (é também o que o
//                         clique no fundo faz, como nos demais modais daqui).
export default function ModalClientePendente({
  cliente,
  onIrParaPendentes,
  onAgendarMesmoAssim,
  onCancelar,
}) {
  if (!cliente) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-cliente-pendente"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
      onClick={onCancelar}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="titulo-cliente-pendente"
          className="text-lg font-semibold text-heading"
        >
          Essa cliente tem agendamento pendente
        </h2>
        <p className="mt-2 text-sm text-body">
          <span className="font-medium text-heading">{cliente.nome}</span> já
          tem um agendamento aguardando confirmação na aba Pendentes. Marcar um
          novo agora não resolve o que está lá.
        </p>

        {/* Empilhado (sem sm:flex-row-reverse do modal de 2 ações): são três
            ações e o texto de cada uma não cabe lado a lado. Ordem = da mais
            recomendada pra menos. */}
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onIrParaPendentes}
            className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-700"
          >
            Ir para pendentes
          </button>
          <button
            type="button"
            onClick={onAgendarMesmoAssim}
            className="w-full rounded-lg bg-card px-4 py-2.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
          >
            Agendar mesmo assim
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium text-body transition hover:bg-surface"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
