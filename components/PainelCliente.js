"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { linkWhatsApp } from "@/lib/whatsapp";
import { buscarAgendamentosAtivos } from "@/lib/agendamentosCliente";
import { formatarData } from "@/components/FormularioAgendamento";
import AtualizarDadosCliente from "@/components/AtualizarDadosCliente";

// Painel exibido no fluxo público quando o cliente já identificado tem
// agendamentos ativos (pendente/confirmado): lista os horários marcados,
// permite cancelar (com aviso automático pro WhatsApp da dona) e oferece
// atalhos para marcar de novo ou falar direto com o estabelecimento.
//
// Props:
//   estabelecimento – { id, nome, whatsapp } do salão resolvido pelo slug.
//   cliente          – { id, nome, telefone } já identificado.
//   onNovoAgendamento – chamado (sem args) ao clicar em "Novo agendamento";
//                       quem monta a página decide o que fazer (abrir o
//                       wizard).
export default function PainelCliente({ estabelecimento, cliente, onNovoAgendamento }) {
  const [agendamentos, setAgendamentos] = useState(null);
  const [cancelandoId, setCancelandoId] = useState(null);

  // Cópia local do cliente exibido: nasce igual à prop, mas passa a refletir
  // o nome/telefone novos assim que a edição de dados é concluída — sem
  // depender de o pai recriar a prop `cliente`.
  const [clienteAtual, setClienteAtual] = useState(cliente);

  // Alterna a exibição do painel para o AtualizarDadosCliente. Mesmo
  // componente usado no cadastro inicial, só que pré-preenchido e fazendo
  // update em vez de insert.
  const [editando, setEditando] = useState(false);

  useEffect(() => {
    let ativo = true;
    buscarAgendamentosAtivos(
      estabelecimento.id,
      clienteAtual.telefone.replace(/\D/g, "")
    ).then((lista) => {
      if (ativo) setAgendamentos(lista);
    });
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id, clienteAtual.telefone]);

  if (editando) {
    return (
      <div className="space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border">
        <AtualizarDadosCliente
          clienteId={clienteAtual.id}
          onAtualizado={(dados) => {
            setClienteAtual((anterior) => ({ ...anterior, ...dados }));
            setEditando(false);
          }}
          onCancelar={() => setEditando(false)}
        />
      </div>
    );
  }

  async function handleCancelar(item) {
    setCancelandoId(item.id);

    const { error } = await supabase
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("id", item.id);

    setCancelandoId(null);

    if (error) return;

    setAgendamentos((anterior) => anterior.filter((a) => a.id !== item.id));

    window.open(
      linkWhatsApp(
        estabelecimento.whatsapp,
        `Olá! ${clienteAtual.nome} cancelou o agendamento de ${formatarData(item.data)} às ${item.horario}.`
      ),
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <div className="space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border">
      <div>
        <h2 className="text-lg font-semibold text-heading">
          Seus agendamentos
        </h2>
        <p className="mt-1 text-sm text-body">
          Olá, {clienteAtual.nome}. Aqui está o que você já tem marcado.
        </p>
      </div>

      {agendamentos === null && (
        <p className="text-sm text-body">Carregando...</p>
      )}

      {agendamentos !== null && agendamentos.length === 0 && (
        <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
          Você não tem agendamentos ativos no momento.
        </p>
      )}

      {agendamentos !== null && agendamentos.length > 0 && (
        <ul className="space-y-2">
          {agendamentos.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-3 ring-1 ring-border"
            >
              <span className="min-w-0">
                <span className="block font-medium text-heading">
                  {formatarData(item.data)} · {String(item.horario).slice(0, 5)}
                </span>
                <span className="block text-sm text-body">
                  {item.servicos?.nome ?? "Serviço"}
                </span>
              </span>

              <button
                type="button"
                onClick={() => handleCancelar(item)}
                disabled={cancelandoId === item.id}
                className="shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelandoId === item.id ? "Cancelando..." : "Cancelar"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onNovoAgendamento}
        className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
      >
        Novo agendamento
      </button>

      <button
        type="button"
        onClick={() => setEditando(true)}
        className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
      >
        Atualizar meus dados
      </button>

      <a
        href={linkWhatsApp(
          estabelecimento.whatsapp,
          `Olá! Sou ${clienteAtual.nome} e gostaria de falar sobre meu agendamento.`
        )}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-card px-4 py-2.5 font-medium text-green-700 ring-1 ring-green-600 transition hover:bg-green-50"
      >
        Falar com a dona
      </a>
    </div>
  );
}
