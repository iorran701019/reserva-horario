"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useSessaoAdmin } from "@/hooks/useSessaoAdmin";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { formatarDataBR } from "@/lib/data";
import { MOTIVOS_PERDA, STATUS_ATIVOS, STATUS_TODOS, hojeISO, rotulo } from "@/lib/crm";
import CardLead from "./CardLead";
import DetalheLead from "./DetalheLead";
import ModalDemonstracao from "./ModalDemonstracao";
import ModalNovoLead from "./ModalNovoLead";
import ModalPerda from "./ModalPerda";
import { CLASSE_BOTAO_PRIMARIO, MensagemErro } from "./ui";

// CRM comercial do Acolhe. Mesma guarda do /painel-global (useSessaoAdmin sem
// slug + papel 'global'); sem sessão, manda logar lá — esta página não tem
// formulário de login próprio. RLS das 4 tabelas também exige 'global'.
const VISOES = [
  { id: "quadro", rotulo: "Quadro" },
  { id: "perdidos", rotulo: "Perdidos" },
  { id: "followup", rotulo: "Follow-up" },
];

export default function CrmPage() {
  const { autenticado, perfil } = useSessaoAdmin();
  const autorizado = perfil?.papel === "global";

  const [visao, setVisao] = useState("quadro");
  const [leads, setLeads] = useState([]);
  const [tags, setTags] = useState([]);
  const [leadTags, setLeadTags] = useState([]);
  const [interacoes, setInteracoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [novoLeadAberto, setNovoLeadAberto] = useState(false);
  const [leadAbertoId, setLeadAbertoId] = useState(null);
  const [leadDemonstracao, setLeadDemonstracao] = useState(null);
  const [leadPerda, setLeadPerda] = useState(null);
  const [colunaAlvo, setColunaAlvo] = useState(null);

  const carregar = useCallback(async () => {
    const [rLeads, rTags, rLeadTags, rInteracoes] = await Promise.all([
      supabase.from("leads").select("*").order("atualizado_em", { ascending: false }),
      supabase.from("tags").select("id, nome, cor").order("nome"),
      supabase.from("lead_tags").select("lead_id, tag_id"),
      supabase
        .from("interacoes")
        .select("id, lead_id, data, canal, descricao, criado_em")
        .order("data", { ascending: false })
        .order("criado_em", { ascending: false }),
    ]);
    const falha = [rLeads, rTags, rLeadTags, rInteracoes].find((r) => r.error);
    setErro(falha ? falha.error.message : "");
    setLeads(rLeads.data ?? []);
    setTags(rTags.data ?? []);
    setLeadTags(rLeadTags.data ?? []);
    setInteracoes(rInteracoes.data ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (!autorizado) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, [autorizado, carregar]);

  const tagsPorId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const tagIdsPorLead = useMemo(() => {
    const mapa = new Map();
    for (const { lead_id, tag_id } of leadTags) {
      if (!mapa.has(lead_id)) mapa.set(lead_id, []);
      mapa.get(lead_id).push(tag_id);
    }
    return mapa;
  }, [leadTags]);

  // Já vem ordenado da query (mais recente primeiro): a primeira de cada lead
  // é a mais nova.
  const interacoesPorLead = useMemo(() => {
    const mapa = new Map();
    for (const i of interacoes) {
      if (!mapa.has(i.lead_id)) mapa.set(i.lead_id, []);
      mapa.get(i.lead_id).push(i);
    }
    return mapa;
  }, [interacoes]);

  function tagsDoLead(leadId) {
    return (tagIdsPorLead.get(leadId) ?? []).map((id) => tagsPorId.get(id)).filter(Boolean);
  }

  // Trecho do card: descrição da interação mais recente; sem interação com
  // texto, cai nas observações do cadastro.
  function trechoDoLead(lead) {
    const recente = (interacoesPorLead.get(lead.id) ?? []).find((i) => i.descricao);
    return recente?.descricao ?? lead.observacoes ?? "";
  }

  // Ponto único de mudança de status (arraste, select do card, detalhe).
  //   demonstracao → não grava aqui: abre o modal, que cria o agendamento e
  //                  só então move o lead (lib/crm.js criarDemonstracao);
  //   perdido      → grava e abre o popup opcional de motivo;
  //   convertido   → grava data_conversao se ainda não tiver;
  //   reabrir um perdido mantém motivo_perda/observacao_perda (histórico).
  async function mudarStatus(lead, novoStatus) {
    if (!lead || lead.status === novoStatus) return;
    if (novoStatus === "demonstracao") {
      setLeadDemonstracao(lead);
      return;
    }

    const patch = { status: novoStatus, atualizado_em: new Date().toISOString() };
    if (novoStatus === "convertido" && !lead.data_conversao) patch.data_conversao = hojeISO();

    // Otimista: move o card já, e o carregar() abaixo confirma o estado real.
    setLeads((atual) => atual.map((l) => (l.id === lead.id ? { ...l, ...patch } : l)));

    const { data, error } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", lead.id)
      .select("id");

    if (error || !data?.length) {
      setErro(`Não foi possível mudar o status de ${lead.nome}: ${mensagemFalhaSalvar(error)}`);
    } else if (novoStatus === "perdido") {
      setLeadPerda({ ...lead, ...patch });
    }
    carregar();
  }

  function soltarNaColuna(e, statusId) {
    e.preventDefault();
    setColunaAlvo(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    mudarStatus(
      leads.find((l) => l.id === id),
      statusId
    );
  }

  function adicionarTag(tag) {
    setTags((atual) => [...atual, tag].sort((a, b) => a.nome.localeCompare(b.nome)));
  }

  if (autenticado === null || (autenticado && perfil === undefined)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  if (!autenticado || !autorizado) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h1 className="text-2xl font-bold text-heading">Acesso restrito.</h1>
          {!autenticado && (
            <Link href="/painel-global" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
              Entrar pelo Painel Global
            </Link>
          )}
        </div>
      </main>
    );
  }

  const leadAberto = leads.find((l) => l.id === leadAbertoId);
  const ativos = leads.filter((l) => l.status !== "perdido");
  const perdidos = leads.filter((l) => l.status === "perdido");

  return (
    <main className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/painel-global" className="text-xs font-semibold text-body hover:underline">
              ← Painel Global
            </Link>
            <h1 className="font-display text-2xl font-bold text-heading">CRM Comercial</h1>
          </div>
          <button type="button" onClick={() => setNovoLeadAberto(true)} className={CLASSE_BOTAO_PRIMARIO}>
            + Novo lead
          </button>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          {VISOES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setVisao(item.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                visao === item.id
                  ? "bg-primary text-white"
                  : "bg-card text-body ring-1 ring-border hover:text-heading"
              }`}
            >
              {item.rotulo}
              {item.id === "perdidos" ? ` (${perdidos.length})` : ""}
            </button>
          ))}
        </div>

        {erro && (
          <div className="mb-4">
            <MensagemErro>{erro}</MensagemErro>
          </div>
        )}

        {carregando ? (
          <p className="text-sm text-body">Carregando leads...</p>
        ) : visao === "quadro" ? (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {STATUS_ATIVOS.map((coluna) => {
              const daColuna = ativos.filter((l) => l.status === coluna.id);
              return (
                <section
                  key={coluna.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setColunaAlvo(coluna.id);
                  }}
                  onDragLeave={() => setColunaAlvo((c) => (c === coluna.id ? null : c))}
                  onDrop={(e) => soltarNaColuna(e, coluna.id)}
                  className={`flex w-64 shrink-0 flex-col rounded-2xl p-2 ring-1 transition ${
                    colunaAlvo === coluna.id ? "bg-primary/10 ring-primary" : "bg-card/60 ring-border"
                  }`}
                >
                  <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-heading">
                    {coluna.rotulo}
                    <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-body ring-1 ring-border">
                      {daColuna.length}
                    </span>
                  </h2>
                  <div className="flex min-h-24 flex-col gap-2">
                    {daColuna.map((lead) => (
                      <CardLead
                        key={lead.id}
                        lead={lead}
                        tags={tagsDoLead(lead.id)}
                        trecho={trechoDoLead(lead)}
                        onAbrir={setLeadAbertoId}
                        onMudarStatus={mudarStatus}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : visao === "perdidos" ? (
          perdidos.length === 0 ? (
            <p className="text-sm text-body">Nenhum lead perdido.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {perdidos.map((lead) => (
                <div key={lead.id}>
                  <CardLead
                    lead={lead}
                    tags={tagsDoLead(lead.id)}
                    trecho={lead.observacao_perda ?? trechoDoLead(lead)}
                    onAbrir={setLeadAbertoId}
                    onMudarStatus={mudarStatus}
                  />
                  {lead.motivo_perda && (
                    <p className="mt-1 px-1 text-xs text-muted">
                      Motivo: {rotulo(MOTIVOS_PERDA, lead.motivo_perda)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <FollowUp leads={ativos} onAbrir={setLeadAbertoId} />
        )}
      </div>

      {novoLeadAberto && (
        <ModalNovoLead
          tags={tags}
          onTagCriada={adicionarTag}
          onFechar={() => setNovoLeadAberto(false)}
          onCriado={({ fechar }) => {
            if (fechar) setNovoLeadAberto(false);
            carregar();
          }}
        />
      )}

      {leadAberto && (
        <DetalheLead
          key={leadAberto.id}
          lead={leadAberto}
          leads={leads}
          tags={tags}
          tagIds={tagIdsPorLead.get(leadAberto.id) ?? []}
          interacoes={interacoesPorLead.get(leadAberto.id) ?? []}
          onTagCriada={adicionarTag}
          onFechar={() => setLeadAbertoId(null)}
          onMudarStatus={mudarStatus}
          onAlterado={carregar}
        />
      )}

      {leadDemonstracao && (
        <ModalDemonstracao
          lead={leadDemonstracao}
          onFechar={() => setLeadDemonstracao(null)}
          onConcluido={() => {
            setLeadDemonstracao(null);
            carregar();
          }}
        />
      )}

      {leadPerda && (
        <ModalPerda
          lead={leadPerda}
          onFechar={() => setLeadPerda(null)}
          onSalvo={() => {
            setLeadPerda(null);
            carregar();
          }}
        />
      )}
    </main>
  );
}

// Follow-up: leads fora de Perdidos com próximo contato marcado, em três
// blocos pela data. Ordenados por data (crescente) dentro de cada bloco.
function FollowUp({ leads, onAbrir }) {
  const hoje = hojeISO();
  const comData = leads
    .filter((l) => l.proximo_contato_em)
    .sort((a, b) => a.proximo_contato_em.localeCompare(b.proximo_contato_em));

  const blocos = [
    { id: "atrasados", titulo: "🔴 Atrasados", itens: comData.filter((l) => l.proximo_contato_em < hoje) },
    { id: "hoje", titulo: "🟡 Hoje", itens: comData.filter((l) => l.proximo_contato_em === hoje) },
    { id: "proximos", titulo: "🔵 Próximos", itens: comData.filter((l) => l.proximo_contato_em > hoje) },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {blocos.map((bloco) => (
        <section key={bloco.id} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="mb-3 text-sm font-semibold text-heading">
            {bloco.titulo} <span className="text-body">({bloco.itens.length})</span>
          </h2>
          {bloco.itens.length === 0 ? (
            <p className="text-xs text-muted">Nada aqui.</p>
          ) : (
            <ul className="divide-y divide-border">
              {bloco.itens.map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => onAbrir(lead.id)}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left hover:opacity-80"
                  >
                    <span>
                      <span className="block text-sm font-medium text-heading">{lead.nome}</span>
                      <span className="block text-xs text-muted">{rotulo(STATUS_TODOS, lead.status)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-body">{formatarDataBR(lead.proximo_contato_em)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
