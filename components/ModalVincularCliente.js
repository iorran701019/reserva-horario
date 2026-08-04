"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Vincula um cliente real a um agendamento importado do Google Calendar sem
// telefone (ver POST em app/api/google-calendar/importar/route.js e o botão
// "Vincular cliente" no bloco âmbar do Painel — PainelCalendario.js). Mesma
// UX de busca ao vivo em `clientes` (debounce ~300ms, ilike no nome) já usada
// na etapa "Dados" do FormularioAgendamento no /admin — não é o MESMO
// componente (aquele vive dentro do wizard de agendamento, entrelaçado com o
// resto do form), mas replica o padrão pra manter a experiência consistente.
//
// `agendamento` é o item vivo selecionado no Painel (precisa de id e
// nome_cliente, usado como sugestão inicial de busca); null fecha o modal.
// Confirmar faz um UPDATE direto em agendamentos (nome_cliente, telefone) —
// isso dispara o gatilho pg_net normalmente, e a partir daí o sync de saída
// (lib/googleCalendarSync.js) passa a atualizar o evento no Google, já que a
// guarda de telefone null deixa de valer.
export default function ModalVincularCliente({
  agendamento,
  estabelecimentoId,
  onFechar,
  onVinculado,
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Recomeça do zero a cada agendamento selecionado — nome do evento como
  // ponto de partida da busca (frequentemente já é o nome da cliente).
  useEffect(() => {
    setNome(agendamento?.nome_cliente ?? "");
    setTelefone("");
    setClienteSelecionado(null);
    setResultados([]);
    setErro("");
  }, [agendamento]);

  // Debounce ~300ms da busca em `clientes`, mesmo padrão do autopreenchimento
  // admin em FormularioAgendamento. Só roda sem cliente já selecionado e com
  // 2+ caracteres.
  useEffect(() => {
    if (!agendamento || clienteSelecionado) {
      setResultados([]);
      setBuscando(false);
      return;
    }

    const termo = nome.trim();
    if (termo.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }

    let ativo = true;
    setBuscando(true);

    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, whatsapp")
        .eq("estabelecimento_id", estabelecimentoId)
        .ilike("nome", `%${termo}%`)
        .order("nome", { ascending: true })
        .limit(8);

      if (!ativo) return;
      setResultados(error ? [] : data ?? []);
      setBuscando(false);
    }, 300);

    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [nome, clienteSelecionado, agendamento, estabelecimentoId]);

  function selecionarCliente(cliente) {
    setNome(cliente.nome);
    setTelefone(cliente.whatsapp ?? "");
    setClienteSelecionado(cliente);
    setResultados([]);
  }

  function trocarCliente() {
    setClienteSelecionado(null);
    setTelefone("");
  }

  async function confirmar() {
    const nomeLimpo = nome.trim();
    const telefoneLimpo = telefone.trim();
    if (!nomeLimpo || !telefoneLimpo) {
      setErro("Preencha nome e WhatsApp.");
      return;
    }

    setSalvando(true);
    setErro("");

    const { error } = await supabase
      .from("agendamentos")
      .update({ nome_cliente: nomeLimpo, telefone: telefoneLimpo })
      .eq("id", agendamento.id);

    setSalvando(false);
    if (error) {
      setErro(error.message);
      return;
    }

    onVinculado?.({ nome_cliente: nomeLimpo, telefone: telefoneLimpo });
  }

  if (!agendamento) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-vincular-cliente"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="titulo-vincular-cliente" className="text-lg font-semibold text-heading">
          Vincular cliente
        </h2>
        <p className="mt-1 text-xs text-muted">
          Evento importado do Google Calendar — associe um cliente pra liberar
          WhatsApp, lembrete e a sincronização de volta pro Calendar.
        </p>

        <div className="mt-4">
          <label htmlFor="vincular-nome" className="mb-1 block text-sm font-medium text-body">
            Nome do cliente
          </label>

          {clienteSelecionado ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-heading">{clienteSelecionado.nome}</span>
              <button
                type="button"
                onClick={trocarCliente}
                className="shrink-0 text-sm font-medium text-primary hover:underline"
              >
                Trocar
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                id="vincular-nome"
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoComplete="off"
                placeholder="Buscar cliente pelo nome"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />

              {nome.trim().length >= 2 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg bg-card shadow-lg ring-1 ring-border">
                  {buscando && <p className="px-3 py-2 text-sm text-body">Buscando...</p>}

                  {!buscando && resultados.length === 0 && (
                    <p className="px-3 py-2 text-sm text-body">
                      Nenhum cliente encontrado. Pode preencher os dados livremente.
                    </p>
                  )}

                  {!buscando &&
                    resultados.map((cliente) => (
                      <button
                        key={cliente.id}
                        type="button"
                        onClick={() => selecionarCliente(cliente)}
                        className="block w-full px-3 py-2 text-left text-sm text-heading transition hover:bg-surface"
                      >
                        {cliente.nome}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="vincular-telefone" className="mb-1 block text-sm font-medium text-body">
            WhatsApp
          </label>
          <input
            id="vincular-telefone"
            type="tel"
            inputMode="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            readOnly={Boolean(clienteSelecionado)}
            placeholder="(24) 99999-9999"
            className={[
              "w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10",
              clienteSelecionado ? "bg-surface" : "",
            ].join(" ")}
          />
        </div>

        {erro && <p className="mt-3 text-xs text-red-600">{erro}</p>}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={confirmar}
            disabled={salvando}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Vincular"}
          </button>
          <button
            type="button"
            onClick={onFechar}
            className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
