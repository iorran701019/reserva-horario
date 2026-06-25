"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { linkWhatsApp } from "@/lib/whatsapp";

// Formata "2026-06-25" como "25/06". Mantém simples; sem libs de data.
function formatarData(data) {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

// Formata "14:30:00" (time do Postgres) como "14:30".
function formatarHorario(horario) {
  if (!horario) return "—";
  return horario.slice(0, 5);
}

// Cores do badge de status. Cai num cinza neutro pra status desconhecido.
function classesStatus(status) {
  const mapa = {
    confirmado: "bg-green-50 text-green-700 ring-green-100",
    pendente: "bg-amber-50 text-amber-700 ring-amber-100",
    cancelado: "bg-red-50 text-red-700 ring-red-100",
  };
  return mapa[status] ?? "bg-zinc-100 text-zinc-600 ring-zinc-200";
}

// Ícone do WhatsApp. Herda a cor do texto (fill="currentColor") e o tamanho
// via className, então serve tanto pro botão verde quanto pro vermelho.
function IconeWhatsApp({ className = "h-4 w-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24.044 12.045.044 5.463.044.102 5.404.1 11.986c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.582 0 11.943-5.361 11.945-11.945a11.86 11.86 0 00-3.418-8.4" />
    </svg>
  );
}

// Abre a conversa do WhatsApp do cliente em nova aba, com a mensagem pronta.
// noopener,noreferrer replicam o rel="noopener noreferrer" de um <a target=_blank>.
function abrirWhatsApp(telefone, mensagem) {
  window.open(linkWhatsApp(telefone, mensagem), "_blank", "noopener,noreferrer");
}

export default function AdminPage() {
  const [agendamentos, setAgendamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Agendamento aguardando confirmação de cancelamento (controla o modal).
  // null = nenhum modal aberto.
  const [agendamentoParaCancelar, setAgendamentoParaCancelar] = useState(null);

  // Botão A: por enquanto só abre o WhatsApp com a mensagem de confirmação.
  function handleConfirmar(agendamento) {
    abrirWhatsApp(
      agendamento.telefone,
      `Olá ${agendamento.nome_cliente}! Seu agendamento de Corte simples no dia ${formatarData(
        agendamento.data
      )} às ${formatarHorario(agendamento.horario)} está confirmado. Será um prazer lhe atender! ✅`
    );
    // TODO: atualizar status no banco
  }

  // Botão B: só roda DEPOIS que o dono confirma no modal. Por enquanto só abre
  // o WhatsApp com a mensagem de cancelamento e fecha o modal.
  function handleCancelar(agendamento) {
    abrirWhatsApp(
      agendamento.telefone,
      `Olá ${agendamento.nome_cliente}. Infelizmente seu agendamento de Corte simples no dia ${formatarData(
        agendamento.data
      )} às ${formatarHorario(agendamento.horario)} foi cancelado. Caso queira reagendar, acesse o link: http://localhost:3000/agendar .`
    );
    // TODO: atualizar status no banco
    setAgendamentoParaCancelar(null);
  }

  useEffect(() => {
    async function carregar() {
      setErro("");
      setCarregando(true);

      // Lê todos os agendamentos, próximos primeiro (data e depois horário).
      const { data, error } = await supabase
        .from("agendamentos")
        .select("id, nome_cliente, telefone, data, horario, status")
        .order("data", { ascending: true })
        .order("horario", { ascending: true });

      setCarregando(false);

      if (error) {
        // Mostra a mensagem real do Supabase para facilitar o diagnóstico.
        setErro(error.message);
        return;
      }

      setAgendamentos(data ?? []);
    }

    carregar();
  }, []);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900">Agendamentos</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Visão do barbeiro — próximos horários primeiro.
          </p>
        </header>

        {carregando && (
          <p className="rounded-lg bg-white px-4 py-3 text-sm text-zinc-500 shadow-sm ring-1 ring-zinc-100">
            Carregando agendamentos...
          </p>
        )}

        {!carregando && erro && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
            {erro}
          </p>
        )}

        {!carregando && !erro && agendamentos.length === 0 && (
          <p className="rounded-lg bg-white px-4 py-8 text-center text-sm text-zinc-500 shadow-sm ring-1 ring-zinc-100">
            Nenhum agendamento ainda.
          </p>
        )}

        {!carregando && !erro && agendamentos.length > 0 && (
          <ul className="space-y-3">
            {agendamentos.map((item) => (
              <li
                key={item.id}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900">
                      {item.nome_cliente}
                    </p>
                    <p className="mt-0.5 text-sm text-zinc-500">{item.telefone}</p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${classesStatus(
                      item.status
                    )}`}
                  >
                    {item.status ?? "—"}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-4 text-sm text-zinc-700">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-zinc-400">Data</span>
                    <span className="font-medium">{formatarData(item.data)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-zinc-400">Horário</span>
                    <span className="font-medium">
                      {formatarHorario(item.horario)}
                    </span>
                  </span>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => handleConfirmar(item)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
                  >
                    <IconeWhatsApp />
                    Confirmar agendamento
                  </button>

                  <button
                    type="button"
                    onClick={() => setAgendamentoParaCancelar(item)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                  >
                    <IconeWhatsApp />
                    Cancelar agendamento
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal de confirmação do cancelamento. Só aparece quando há um
          agendamento "armado"; "Voltar" fecha sem efeito colateral. */}
      {agendamentoParaCancelar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-cancelar"
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4"
          onClick={() => setAgendamentoParaCancelar(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg ring-1 ring-zinc-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-cancelar"
              className="text-lg font-semibold text-zinc-900"
            >
              Cancelar agendamento
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              Tem certeza que deseja cancelar o agendamento de{" "}
              <span className="font-medium text-zinc-900">
                {agendamentoParaCancelar.nome_cliente}
              </span>
              ?
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => handleCancelar(agendamentoParaCancelar)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                <IconeWhatsApp />
                Confirmar cancelamento
              </button>
              <button
                type="button"
                onClick={() => setAgendamentoParaCancelar(null)}
                className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-300 transition hover:bg-zinc-50"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
