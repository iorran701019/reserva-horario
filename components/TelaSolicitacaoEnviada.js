"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { linkWhatsApp, MENSAGEM_SOLICITACAO_ENVIADA } from "@/lib/whatsapp";
import { cancelarAgendamentoCliente } from "@/lib/agendamentosCliente";
import { formatarData } from "@/components/FormularioAgendamento";
import IconeWhatsApp from "@/components/IconeWhatsApp";

// Tela de protocolo ("Solicitação enviada!") do fluxo público. Era inline em
// app/[salon]/page.js e só existia LOGO APÓS o submit; agora é componente
// porque a mesma tela precisa reaparecer quando a cliente volta ao link do
// salão e se identifica de novo dentro da janela de protocolo (ver
// PENDENTE_PROTOCOLO_HORAS / reservaEmProtocolo em app/[salon]/page.js) — os
// dois caminhos mostram exatamente o mesmo card, com os mesmos botões.
//
// Props:
//   estabelecimento  – salão resolvido pelo slug (whatsapp, link_localizacao,
//                      msg_solicitacao_enviada).
//   agendamentoId    – linha em `agendamentos`; null esconde Editar/Cancelar
//                      (não há o que agir sobre).
//   servicoNome / data / horario / nomeCliente – o que o card resume. `data`
//                      é "YYYY-MM-DD" cru: a formatação é feita aqui, pra os
//                      dois caminhos de entrada não divergirem.
//   onNovoAgendamento – opcional; havendo, mostra "Fazer novo agendamento".
//   onVerAgendamentos – opcional; havendo, mostra "Ver meus agendamentos" —
//                      a saída desta tela pro PainelCliente. Sem ela (e sem
//                      onNovoAgendamento) a cliente ficaria presa aqui
//                      enquanto a janela de protocolo durasse.
//   onEditar          – opcional; havendo, mostra "Editar agendamento" (quem
//                      monta reabre o wizard, ver agendamentoEmEdicao em
//                      FormularioAgendamento).
//   onCancelado       – opcional; havendo, mostra "Cancelar agendamento" e é
//                      chamado depois do cancelamento dar certo.
export default function TelaSolicitacaoEnviada({
  estabelecimento,
  agendamentoId = null,
  servicoNome,
  data,
  horario,
  nomeCliente,
  onNovoAgendamento = null,
  onVerAgendamentos = null,
  onEditar = null,
  onCancelado = null,
}) {
  const [cancelando, setCancelando] = useState(false);
  const [erro, setErro] = useState("");

  // Foca o título ao montar — leitores de tela anunciam o status.
  const tituloRef = useRef(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  const dataFormatada = formatarData(data);
  const podeAgir = agendamentoId != null;

  async function handleCancelar() {
    setErro("");
    setCancelando(true);

    const { ok, erro: erroCancelamento } = await cancelarAgendamentoCliente({
      agendamentoId,
      estabelecimento,
      nomeCliente,
      dataFormatada,
      horario,
    });

    setCancelando(false);

    if (!ok) {
      setErro(erroCancelamento);
      return;
    }

    onCancelado();
  }

  return (
    <div
      role="status"
      className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border"
    >
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-10 w-10 text-green-600"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h1
        ref={tituloRef}
        tabIndex={-1}
        className="mt-6 text-2xl font-bold text-heading outline-none"
      >
        Solicitação enviada!
      </h1>
      <p className="mt-2 text-sm text-body">
        Recebemos seu agendamento. Em breve o estabelecimento confirma seu horário.
      </p>

      <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Aguardando confirmação
      </span>

      <dl className="mt-6 space-y-3 rounded-xl bg-surface p-4 text-left text-sm ring-1 ring-border">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-body">Serviço</dt>
          <dd className="font-medium text-heading">{servicoNome}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-body">Data</dt>
          <dd className="font-medium text-heading">{dataFormatada}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-body">Horário</dt>
          <dd className="font-medium text-heading">{horario}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-body">Nome</dt>
          <dd className="font-medium text-heading">{nomeCliente}</dd>
        </div>
      </dl>

      {estabelecimento.link_localizacao && (
        <a
          href={estabelecimento.link_localizacao}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
        >
          <MapPin className="h-5 w-5" aria-hidden="true" />
          Ver localização
        </a>
      )}

      {onNovoAgendamento && (
        <button
          type="button"
          onClick={onNovoAgendamento}
          className={`w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover ${
            estabelecimento.link_localizacao ? "mt-3" : "mt-6"
          }`}
        >
          Fazer novo agendamento
        </button>
      )}

      {onVerAgendamentos && (
        <button
          type="button"
          onClick={onVerAgendamentos}
          className={`w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface ${
            onNovoAgendamento || estabelecimento.link_localizacao ? "mt-3" : "mt-6"
          }`}
        >
          Ver meus agendamentos
        </button>
      )}

      <a
        href={linkWhatsApp(
          estabelecimento.whatsapp,
          MENSAGEM_SOLICITACAO_ENVIADA(
            {
              servico: servicoNome,
              data: dataFormatada,
              horario,
              nome: nomeCliente,
            },
            estabelecimento.msg_solicitacao_enviada
          )
        )}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex w-full items-center justify-center gap-2 rounded-lg bg-card px-4 py-2.5 font-medium text-green-700 ring-1 ring-green-600 transition hover:bg-green-50 ${
          onNovoAgendamento || onVerAgendamentos || estabelecimento.link_localizacao
            ? "mt-3"
            : "mt-6"
        }`}
      >
        <IconeWhatsApp className="h-5 w-5" />
        Falar no WhatsApp
      </a>

      {podeAgir && onEditar && (
        <button
          type="button"
          onClick={onEditar}
          className="mt-3 w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
        >
          Editar agendamento
        </button>
      )}

      {podeAgir && onCancelado && (
        <button
          type="button"
          onClick={handleCancelar}
          disabled={cancelando}
          className="mt-3 w-full rounded-lg bg-card px-4 py-2.5 font-medium text-red-700 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cancelando ? "Cancelando..." : "Cancelar agendamento"}
        </button>
      )}

      {erro && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}
    </div>
  );
}
