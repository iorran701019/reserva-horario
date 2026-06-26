"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

// Em qual aba o item se encaixa. 'confirmado' e 'cancelado' são explícitos;
// qualquer outra coisa (inclusive null/desconhecido) cai em 'pendente', pra
// nenhum agendamento sumir de todas as abas.
function abaDoStatus(status) {
  if (status === "confirmado") return "confirmado";
  if (status === "cancelado") return "cancelado";
  return "pendente";
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

// Abas por status, na ordem em que aparecem na barra.
const ABAS = [
  { id: "pendente", rotulo: "Pendentes" },
  { id: "confirmado", rotulo: "Confirmados" },
  { id: "cancelado", rotulo: "Cancelados" },
];

// Texto discreto quando a aba não tem nenhum item.
const TEXTO_VAZIO = {
  pendente: "Nenhum agendamento pendente.",
  confirmado: "Nenhum agendamento confirmado.",
  cancelado: "Nenhum agendamento cancelado.",
};

// Abre a conversa do WhatsApp do cliente em nova aba, com a mensagem pronta.
// noopener,noreferrer replicam o rel="noopener noreferrer" de um <a target=_blank>.
function abrirWhatsApp(telefone, mensagem) {
  window.open(linkWhatsApp(telefone, mensagem), "_blank", "noopener,noreferrer");
}

export default function AdminPage() {
  const router = useRouter();

  // Estado da sessão: null = ainda verificando; false = sem login; true = logado.
  // Enquanto for null não renderizamos a lista (evita "piscar" o conteúdo).
  const [autenticado, setAutenticado] = useState(null);

  const [agendamentos, setAgendamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Aba de status atualmente visível. A filtragem é derivada do status de cada
  // item — não há lista duplicada por aba.
  const [abaAtiva, setAbaAtiva] = useState("pendente");

  // Agendamento aguardando confirmação de cancelamento (controla o modal).
  // null = nenhum modal aberto.
  const [agendamentoParaCancelar, setAgendamentoParaCancelar] = useState(null);

  // Reflete o novo status no estado local, atualizando só o item alterado
  // (evita refazer o fetch inteiro). O badge muda de cor automaticamente.
  function atualizarStatusLocal(id, status) {
    setAgendamentos((atuais) =>
      atuais.map((item) => (item.id === id ? { ...item, status } : item))
    );
  }

  // Botão A: grava o status 'confirmado' no banco e, se der certo, abre o
  // WhatsApp com a mensagem de confirmação. Em caso de erro não abre o
  // WhatsApp (não anuncia confirmação que não foi gravada).
  async function handleConfirmar(agendamento) {
    const { error } = await supabase
      .from("agendamentos")
      .update({ status: "confirmado" })
      .eq("id", agendamento.id);

    if (error) {
      setErro(`Não foi possível confirmar o agendamento: ${error.message}`);
      return;
    }

    setErro("");
    atualizarStatusLocal(agendamento.id, "confirmado");

    abrirWhatsApp(
      agendamento.telefone,
      `Olá ${agendamento.nome_cliente}! Seu agendamento de Corte simples no dia ${formatarData(
        agendamento.data
      )} às ${formatarHorario(agendamento.horario)} está confirmado. Será um prazer lhe atender! ✅`
    );
  }

  // Botão B: só roda DEPOIS que o dono confirma no modal. Grava o status
  // 'cancelado' no banco e, se der certo, abre o WhatsApp com a mensagem de
  // cancelamento. Em caso de erro não abre o WhatsApp.
  async function handleCancelar(agendamento) {
    const { error } = await supabase
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("id", agendamento.id);

    if (error) {
      setErro(`Não foi possível cancelar o agendamento: ${error.message}`);
      setAgendamentoParaCancelar(null);
      return;
    }

    setErro("");
    atualizarStatusLocal(agendamento.id, "cancelado");

    abrirWhatsApp(
      agendamento.telefone,
      `Olá ${agendamento.nome_cliente}. Infelizmente seu agendamento de Corte simples no dia ${formatarData(
        agendamento.data
      )} às ${formatarHorario(agendamento.horario)} foi cancelado. Caso queira reagendar, acesse o link: ${process.env.NEXT_PUBLIC_URL_BASE}/agendar .`
    );
    setAgendamentoParaCancelar(null);
  }

  // Verifica a sessão ao montar e fica ouvindo mudanças (login/logout em
  // outra aba também caem aqui). Sem sessão → manda pro login.
  useEffect(() => {
    let ativo = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!ativo) return;
      if (!session) {
        setAutenticado(false);
        router.replace("/admin/login");
        return;
      }
      setAutenticado(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (!ativo) return;
      if (!session) {
        setAutenticado(false);
        router.replace("/admin/login");
        return;
      }
      setAutenticado(true);
    });

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleSair() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  useEffect(() => {
    // Só busca os agendamentos depois de confirmar que há sessão ativa.
    if (autenticado !== true) return;

    async function carregar() {
      setErro("");
      setCarregando(true);

      // Lê todos os agendamentos, próximos primeiro (data e depois horário).
      const { data, error } = await supabase
        .from("agendamentos")
        .select("id, nome_cliente, telefone, data, horario, status, created_at")
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
  }, [autenticado]);

  // Enquanto verifica a sessão (ou já sabemos que não há), não renderiza a
  // lista — o redirect pro login cuida do resto.
  if (autenticado !== true) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
        <p className="text-sm text-zinc-500">Carregando...</p>
      </main>
    );
  }

  // Quantos itens há em cada aba (derivado do status, recalculado a cada render).
  const contagens = { pendente: 0, confirmado: 0, cancelado: 0 };
  for (const item of agendamentos) {
    contagens[abaDoStatus(item.status)] += 1;
  }

  // Itens da aba ativa, já ordenados:
  // - pendente/confirmado: data + horário CRESCENTE (mais próximo primeiro);
  // - cancelado: created_at DECRESCENTE (mais recente primeiro).
  const visiveis = agendamentos
    .filter((item) => abaDoStatus(item.status) === abaAtiva)
    .sort((a, b) => {
      if (abaAtiva === "cancelado") {
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      }
      const chaveA = `${a.data ?? ""} ${a.horario ?? ""}`;
      const chaveB = `${b.data ?? ""} ${b.horario ?? ""}`;
      return chaveA.localeCompare(chaveB);
    });

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Agendamentos</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Visão do barbeiro — próximos horários primeiro.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSair}
            className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-300 transition hover:bg-zinc-50"
          >
            Sair
          </button>
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

        {!carregando && !erro && (
          <>
            {/* Barra de abas por status. A aba ativa ganha fundo branco +
                anel; as demais ficam neutras. O contador vem das contagens. */}
            <div className="mb-4 flex gap-1 rounded-xl bg-zinc-100 p-1">
              {ABAS.map((aba) => {
                const ativa = abaAtiva === aba.id;
                return (
                  <button
                    key={aba.id}
                    type="button"
                    onClick={() => setAbaAtiva(aba.id)}
                    className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium transition ${
                      ativa
                        ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200"
                        : "text-zinc-500 hover:text-zinc-700"
                    }`}
                  >
                    {aba.rotulo}
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                        ativa
                          ? "bg-zinc-100 text-zinc-600"
                          : "bg-zinc-200 text-zinc-500"
                      }`}
                    >
                      {contagens[aba.id]}
                    </span>
                  </button>
                );
              })}
            </div>

            {visiveis.length === 0 && (
              <p className="rounded-lg bg-white px-4 py-8 text-center text-sm text-zinc-500 shadow-sm ring-1 ring-zinc-100">
                {TEXTO_VAZIO[abaAtiva]}
              </p>
            )}
          </>
        )}

        {!carregando && !erro && visiveis.length > 0 && (
          <ul className="space-y-3">
            {visiveis.map((item) => (
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

                {/* "cancelado" é estado terminal: trava os dois botões da
                    linha (apagados, sem clique). Não volta a outro status. */}
                {(() => {
                  const cancelado = item.status === "cancelado";
                  const confirmado = item.status === "confirmado";
                  return (
                    <div className="mt-4 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => handleConfirmar(item)}
                        disabled={cancelado || confirmado}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 disabled:ring-zinc-200 disabled:hover:bg-zinc-100"
                      >
                        <IconeWhatsApp />
                        Confirmar agendamento
                      </button>

                      <button
                        type="button"
                        onClick={() => setAgendamentoParaCancelar(item)}
                        disabled={cancelado}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 disabled:ring-zinc-200 disabled:hover:bg-zinc-100"
                      >
                        <IconeWhatsApp />
                        Cancelar agendamento
                      </button>
                    </div>
                  );
                })()}
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
