"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { SLUG_TENANT_COMERCIAL } from "@/lib/crm";
import { formatarDataBR, formatarHorario } from "@/lib/data";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import PainelCalendario from "@/app/[salon]/admin/PainelCalendario";

// Aba "Agenda" do hub (ver HubPainelGlobal): o MESMO calendário do /admin de
// salão, apontado pro tenant comercial. É a tela onde os atendimentos criados
// pelo CRM (marcarAtendimento, sempre "pendente") aparecem — eles não entram
// na aba Pendentes do /admin do acolhe-comercial de propósito (o inbox de lá
// exige `telefone`, e o CRM não copia o WhatsApp do lead pra `agendamentos`).
//
// PainelCalendario é totalmente desacoplado da casca do /admin: recebe os
// agendamentos por prop e resolve profissionais/ausências/expediente sozinho,
// só a partir de `estabelecimentoId`. Este componente, portanto, só precisa
// resolver o tenant pelo slug e replicar a query.
//
// Regra pra quem for trazer mais recursos do /admin pra cá: só vira aba deste
// hub o que for tão desacoplado quanto este calendário — sem useSessaoAdmin,
// sem depender do shell do salão, recebendo tudo por prop ou buscando por
// conta própria a partir do estabelecimento_id. O que não for assim precisa
// ser desacoplado ANTES de virar aba.

// Mesma query de buscarAgendamentos no /admin de salão, com UMA diferença
// deliberada em duracao_min (ver abaixo). `estabelecimentoId` particiona por
// salão; o resto do pipeline (classificarAgendamento, cores do calendário) só
// recebe os dados já filtrados.
async function buscarAgendamentos(estabelecimentoId) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select(
      "id, nome_cliente, telefone, data, horario, status, finalizado, observacao, servico_id, servico_livre, duracao_min, profissional_id, origem, servicos(nome, duracao_min), profissionais(nome)"
    )
    .eq("estabelecimento_id", estabelecimentoId)
    .order("data", { ascending: true })
    .order("horario", { ascending: true });

  // Eleva a duração do serviço ao topo do item, como no /admin — mas com
  // fallback na coluna `duracao_min` do próprio agendamento em vez de `null`.
  // O /admin pode sobrescrever com null porque lá todo agendamento tem
  // serviço; aqui os do CRM têm `servico_id = null` e guardam a duração do
  // tipo de atendimento na coluna, que sem o fallback se perderia e o bloco
  // sairia com a duração padrão da loja.
  const dados = (data ?? []).map((item) => ({
    ...item,
    duracao_min: item.servicos?.duracao_min ?? item.duracao_min ?? null,
    profissional_nome: item.profissionais?.nome ?? null,
  }));

  return { dados, error };
}

export default function AbaAgenda() {
  // Resolvido SEMPRE pelo slug em runtime (o id muda entre staging e
  // produção) — mesma regra de lib/crm.js.
  const [estabelecimentoId, setEstabelecimentoId] = useState(null);
  const [agendamentos, setAgendamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Agendamento aberto no painel de detalhe (clique no calendário).
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [cancelando, setCancelando] = useState(false);
  const [erroCancelar, setErroCancelar] = useState("");

  const recarregar = useCallback(async (id) => {
    const { dados, error } = await buscarAgendamentos(id);
    if (error) {
      setErro(`Não foi possível carregar a agenda: ${error.message}`);
      return;
    }
    setErro("");
    setAgendamentos(dados);
  }, []);

  useEffect(() => {
    let ativo = true;

    (async () => {
      const { data: estab, error } = await supabase
        .from("estabelecimentos")
        .select("id")
        .eq("slug", SLUG_TENANT_COMERCIAL)
        .maybeSingle();

      if (!ativo) return;

      if (error || !estab) {
        setErro(
          `Tenant "${SLUG_TENANT_COMERCIAL}" não encontrado${error ? `: ${error.message}` : "."}`
        );
        setCarregando(false);
        return;
      }

      setEstabelecimentoId(estab.id);
      await recarregar(estab.id);
      if (ativo) setCarregando(false);
    })();

    return () => {
      ativo = false;
    };
  }, [recarregar]);

  // Lê o item VIVO da lista: depois de cancelar, o painel reflete o status
  // novo sem estado duplicado (mesmo padrão do modal de detalhe do /admin).
  const selecionado = agendamentos.find((item) => item.id === selecionadoId) ?? null;

  function abrirDetalhe(item) {
    setSelecionadoId(item.id);
    setErroCancelar("");
  }

  // Mesmo update do /admin de salão (status + cancelado_pelo_salao). Sem
  // mensagem de WhatsApp: aqui não existe cliente com telefone do outro lado,
  // é a agenda comercial interna.
  async function handleCancelar() {
    if (!selecionado || cancelando) return;

    setCancelando(true);
    setErroCancelar("");

    const { data, error } = await supabase
      .from("agendamentos")
      .update({ status: "cancelado", cancelado_pelo_salao: true })
      .eq("id", selecionado.id)
      .select("id");

    setCancelando(false);

    // Zero linha sem erro = RLS filtrou (mesma leitura do resto do projeto).
    if (error || !data?.length) {
      setErroCancelar(`Não foi possível cancelar: ${mensagemFalhaSalvar(error)}`);
      return;
    }

    await recarregar(estabelecimentoId);
    setSelecionadoId(null);
  }

  if (carregando) {
    return <p className="text-sm text-body">Carregando agenda...</p>;
  }

  if (erro) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
        {erro}
      </p>
    );
  }

  return (
    <>
      <PainelCalendario
        agendamentos={agendamentos}
        estabelecimentoId={estabelecimentoId}
        onSelecionarConfirmado={abrirDetalhe}
        onSelecionarPendente={abrirDetalhe}
        // Não se aplica: "vincular cliente" é do fluxo de importação do Google
        // Calendar do salão, que o tenant comercial não usa.
        onVincularCliente={() => {}}
      />

      {selecionado && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setSelecionadoId(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card p-5 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-bold text-heading">
              {selecionado.nome_cliente || "Sem nome"}
            </h2>

            <dl className="mt-3 space-y-1 text-sm text-body">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Quando</dt>
                <dd className="font-medium text-heading">
                  {formatarDataBR(selecionado.data)} às {formatarHorario(selecionado.horario)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Atendimento</dt>
                <dd className="text-right font-medium text-heading">
                  {selecionado.servicos?.nome || selecionado.servico_livre || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Status</dt>
                <dd className="font-medium text-heading">{selecionado.status}</dd>
              </div>
              {selecionado.profissional_nome && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Profissional</dt>
                  <dd className="font-medium text-heading">{selecionado.profissional_nome}</dd>
                </div>
              )}
              {selecionado.observacao && (
                <div className="pt-2">
                  <dt className="text-muted">Observação</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-heading">
                    {selecionado.observacao}
                  </dd>
                </div>
              )}
            </dl>

            {erroCancelar && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100">
                {erroCancelar}
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setSelecionadoId(null)}
                className="flex-1 rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-body ring-1 ring-border transition hover:text-heading"
              >
                Fechar
              </button>
              {selecionado.status !== "cancelado" && (
                <button
                  type="button"
                  onClick={handleCancelar}
                  disabled={cancelando}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cancelando ? "Cancelando..." : "Cancelar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
