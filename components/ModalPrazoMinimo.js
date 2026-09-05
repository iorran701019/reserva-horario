"use client";

// Aviso de "essa cliente já tem um agendamento perto demais desta data",
// mostrado ANTES de gravar o novo agendamento. Componente só de apresentação
// (mesmo molde de ModalClientePendente.js, do qual este foi copiado): quem
// decide quando abrir e o que cada ação faz é quem monta.
//
// Dois caminhos levam ao mesmo modal, por isso ele é compartilhado em vez de
// duplicado:
//   - o fluxo público, no clique do horário (selecionarHorario), onde a
//     reserva ainda NÃO foi gravada; e
//   - o /admin, no gate de finalizarAgendamento, junto dos popups de janela e
//     restrição de agenda.
// Em ambos, nada foi escrito no banco quando este modal aparece — as três
// ações abaixo é que decidem o que gravar.
//
// A regra em si (quem conflita com quem) mora em buscarConflitoPrazoMinimo,
// em lib/agendamentosCliente.js — aqui só desenhamos a decisão.
//
// Não é um bloqueio: "Manter dois agendamentos próximos" segue o fluxo
// normal e cria o novo com o antigo de pé, igual ao "Agendar mesmo assim" do
// ModalClientePendente. Das três saídas, só "Cancelar este e manter <data
// antiga>" não grava nada. O objetivo é evitar o agendamento próximo demais
// feito sem perceber que já havia outro por perto.
//
// Props (as datas chegam JÁ FORMATADAS — este componente não importa nada de
// FormularioAgendamento, que é quem o renderiza; ver formatarData lá):
//   conflito        – { dataFormatada, horario, servicoNome } do agendamento
//                     que já existe, ou null (fechado).
//   dataNova        – data escolhida agora, já formatada.
//   horarioNovo     – horário escolhido agora ("HH:MM").
//   prazoDias       – prazo mínimo configurado pelo salão, só pro texto.
//   processando     – trava os botões enquanto a ação escolhida grava.
//   onTrocar        – cancela o agendamento antigo e segue com o novo.
//   onDesistir      – abandona o novo e mantém o antigo como está.
//   onManterOsDois  – cria o novo SEM cancelar o antigo: os dois ficam de pé.
//   onCancelar      – fecha e deixa quem chamou onde estava (é também o que o
//                     clique no fundo faz, como nos demais modais daqui).
export default function ModalPrazoMinimo({
  conflito,
  dataNova,
  horarioNovo,
  prazoDias,
  processando = false,
  onTrocar,
  onDesistir,
  onManterOsDois,
  onCancelar,
}) {
  if (!conflito) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-prazo-minimo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
      onClick={processando ? undefined : onCancelar}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="titulo-prazo-minimo" className="text-lg font-semibold text-heading">
          Já existe um agendamento próximo
        </h2>
        <p className="mt-2 text-sm text-body">
          Existe um agendamento
          {conflito.servicoNome ? ` de ${conflito.servicoNome}` : ""} em{" "}
          <span className="font-medium text-heading">
            {conflito.dataFormatada}
            {conflito.horario ? ` às ${conflito.horario}` : ""}
          </span>
          , a menos de {prazoDias}{" "}
          {prazoDias === 1 ? "dia" : "dias"} da data escolhida agora (
          <span className="font-medium text-heading">
            {dataNova}
            {horarioNovo ? ` às ${horarioNovo}` : ""}
          </span>
          ).
        </p>

        {/* Empilhado (sem sm:flex-row-reverse do modal de 2 ações): são três
            ações e o texto de cada uma não cabe lado a lado. Ordem = da mais
            recomendada pra menos, mesmo critério do ModalClientePendente. */}
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onTrocar}
            disabled={processando}
            className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {processando
              ? "Processando…"
              : `Cancelar ${conflito.dataFormatada} e confirmar ${dataNova}`}
          </button>
          <button
            type="button"
            onClick={onDesistir}
            disabled={processando}
            className="w-full rounded-lg bg-card px-4 py-2.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancelar este e manter {conflito.dataFormatada}
          </button>
          <button
            type="button"
            onClick={onManterOsDois}
            disabled={processando}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium text-body transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            Manter dois agendamentos próximos
          </button>
        </div>
      </div>
    </div>
  );
}
