"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import { classesBadgeEtiqueta } from "@/components/SeletorEtiquetaRapido";
import { formatarDataBR, formatarHorario } from "@/lib/data";
import {
  MOTIVOS_PERDA,
  SELECT_LEADS_COM_ATENDIMENTO,
  STATUS_ATIVOS,
  STATUS_TODOS,
  expirarAtendimentoAoSairDoStatus,
  hojeISO,
  rotulo,
  tipoDoAtendimento,
  urgenciaAtendimento,
} from "@/lib/crm";
import { linkWhatsAppSemMensagem } from "@/lib/whatsapp";
import CardLead from "./CardLead";
import DetalheLead from "./DetalheLead";
import ModalAtendimento from "./ModalAtendimento";
import ModalNovoLead from "./ModalNovoLead";
import ModalPerda from "./ModalPerda";
import TiposAtendimento from "./TiposAtendimento";
import { MensagemErro } from "./ui";

// CRM comercial do Acolhe, aba padrão do hub (ver HubPainelGlobal). A guarda
// de sessão/papel 'global' mora no shell — chegar aqui já é permissão; a RLS
// das 4 tabelas exige 'global' de qualquer jeito.
//
// A troca de visão e o "+ Novo lead" ficam no menu da direita da barra do
// shell; por isso `visao` e `novoLeadAberto` chegam por prop.
export const VISOES_CRM = [
  { id: "quadro", rotulo: "Quadro" },
  { id: "perdidos", rotulo: "Perdidos" },
  { id: "followup", rotulo: "Follow-up" },
  { id: "clientes", rotulo: "Clientes" },
  { id: "tipos", rotulo: "Tipos de atendimento" },
];

export default function AbaCrm({ visao, novoLeadAberto, onFecharNovoLead, onContagemPerdidos }) {
  const [leads, setLeads] = useState([]);
  const [tags, setTags] = useState([]);
  const [leadTags, setLeadTags] = useState([]);
  const [interacoes, setInteracoes] = useState([]);
  const [tiposAtendimento, setTiposAtendimento] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [leadAbertoId, setLeadAbertoId] = useState(null);
  // { lead, tipos } — tipos já filtrados pro contexto em que o modal abriu.
  const [atendimento, setAtendimento] = useState(null);
  const [leadPerda, setLeadPerda] = useState(null);
  const [colunaAlvo, setColunaAlvo] = useState(null);

  const carregar = useCallback(async () => {
    const [rLeads, rTags, rLeadTags, rInteracoes, rTipos] = await Promise.all([
      supabase
        .from("leads")
        .select(SELECT_LEADS_COM_ATENDIMENTO)
        .order("atualizado_em", { ascending: false }),
      supabase.from("tags").select("id, nome, cor").order("nome"),
      supabase.from("lead_tags").select("lead_id, tag_id"),
      supabase
        .from("interacoes")
        .select("id, lead_id, data, canal, descricao, criado_em")
        .order("data", { ascending: false })
        .order("criado_em", { ascending: false }),
      supabase.from("tipos_atendimento").select("*").order("nome"),
    ]);
    const falha = [rLeads, rTags, rLeadTags, rInteracoes, rTipos].find((r) => r.error);
    setErro(falha ? falha.error.message : "");
    setLeads(rLeads.data ?? []);
    setTags(rTags.data ?? []);
    setLeadTags(rLeadTags.data ?? []);
    setInteracoes(rInteracoes.data ?? []);
    setTiposAtendimento(rTipos.data ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, [carregar]);

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

  const tiposAtivos = tiposAtendimento.filter((t) => t.ativo);

  function abrirAtendimento(lead) {
    setAtendimento({ lead, tipos: tiposAtivos });
  }

  // Ponto único de mudança de status (arraste, select do card, detalhe).
  //   etapa que algum tipo ativo move (move_para_status; hoje, Demonstração)
  //                → não grava aqui: abre o ModalAtendimento só com esses
  //                  tipos, e marcarAtendimento (lib/crm.js) move o lead
  //                  depois de criar o agendamento. Fechar o modal = status
  //                  não muda. Sem tipo que mova pra etapa, grava direto;
  //   perdido      → grava e abre o popup opcional de motivo;
  //   convertido   → grava data_conversao se ainda não tiver;
  //   reabrir um perdido mantém motivo_perda/observacao_perda (histórico);
  //   sair da etapa em que o próximo atendimento expira (expira_ao_sair_de
  //                → apaga o agendamento e limpa o vínculo no mesmo update;
  //                  no caminho do modal acima não precisa: marcarAtendimento
  //                  já substitui o atendimento anterior).
  async function mudarStatus(lead, novoStatus) {
    if (!lead || lead.status === novoStatus) return;
    const tiposQueMovem = tiposAtivos.filter((t) => t.move_para_status === novoStatus);
    if (tiposQueMovem.length) {
      setAtendimento({ lead, tipos: tiposQueMovem });
      return;
    }

    const expiracao = await expirarAtendimentoAoSairDoStatus(lead);
    if (!expiracao.ok) {
      setErro(`Não foi possível mudar o status de ${lead.nome}: ${expiracao.erro}`);
      return;
    }

    const patch = { status: novoStatus, atualizado_em: new Date().toISOString() };
    if (novoStatus === "convertido" && !lead.data_conversao) patch.data_conversao = hojeISO();
    if (expiracao.expirou) {
      patch.proximo_atendimento_agendamento_id = null;
      patch.proximo_atendimento_tipo_id = null;
    }

    // Otimista: move o card já, e o carregar() abaixo confirma o estado real.
    setLeads((atual) =>
      atual.map((l) =>
        l.id === lead.id
          ? { ...l, ...patch, ...(expiracao.expirou ? { proximo_atendimento: null } : {}) }
          : l
      )
    );

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

  const leadAberto = leads.find((l) => l.id === leadAbertoId);
  const ativos = leads.filter((l) => l.status !== "perdido");
  const perdidos = leads.filter((l) => l.status === "perdido");

  // A contagem aparece no menu da direita, que é do shell.
  useEffect(() => {
    onContagemPerdidos(perdidos.length);
  }, [onContagemPerdidos, perdidos.length]);

  return (
    <>
      <div className="crm mx-auto max-w-7xl">
        {erro && (
          <div className="mb-4">
            <MensagemErro>{erro}</MensagemErro>
          </div>
        )}

        {carregando ? (
          <p className="text-sm text-body">Carregando leads...</p>
        ) : visao === "quadro" ? (
          // Grade 2×3 (3×2 a partir de md) que cabe inteira na tela; quem rola
          // é a lista de cada coluna, não a página. Medidas em .crm-quadro
          // (globals.css).
          <div className="crm-quadro">
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
                  className={`crm-coluna ring-1 transition ${
                    colunaAlvo === coluna.id ? "bg-primary/10 ring-primary" : "bg-card/60 ring-border"
                  }`}
                >
                  <h2 className="crm-coluna-titulo text-heading">
                    <span className="truncate">{coluna.rotulo}</span>
                    <span className="crm-coluna-contagem bg-surface text-body ring-1 ring-border">
                      {daColuna.length}
                    </span>
                  </h2>
                  <div className="crm-coluna-lista">
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
        ) : visao === "followup" ? (
          <FollowUp leads={ativos} onAbrir={setLeadAbertoId} />
        ) : visao === "clientes" ? (
          <Clientes leads={leads} tagsDoLead={tagsDoLead} onAbrir={setLeadAbertoId} />
        ) : (
          <TiposAtendimento tipos={tiposAtendimento} onAlterado={carregar} />
        )}
      </div>

      {novoLeadAberto && (
        <ModalNovoLead
          tags={tags}
          onTagCriada={adicionarTag}
          onFechar={onFecharNovoLead}
          onCriado={({ fechar }) => {
            if (fechar) onFecharNovoLead();
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
          onMarcarAtendimento={abrirAtendimento}
          onAlterado={carregar}
        />
      )}

      {atendimento && (
        <ModalAtendimento
          lead={atendimento.lead}
          tipos={atendimento.tipos}
          onFechar={() => setAtendimento(null)}
          onConcluido={() => {
            setAtendimento(null);
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
    </>
  );
}

// Follow-up: leads fora de Perdidos com próximo atendimento marcado (join em
// agendamentos via proximo_atendimento_agendamento_id), em três blocos por
// urgenciaAtendimento (data + hora). Ordenados por data + horário (crescente) dentro de cada bloco.
function FollowUp({ leads, onAbrir }) {
  const agora = new Date();
  const chave = (l) => `${l.proximo_atendimento.data} ${l.proximo_atendimento.horario}`;
  const comData = leads
    .filter((l) => l.proximo_atendimento)
    .sort((a, b) => chave(a).localeCompare(chave(b)));

  const blocos = [
    { id: "atrasado", titulo: "🔴 Atrasados" },
    { id: "hoje", titulo: "🟡 Hoje" },
    { id: "proximo", titulo: "🔵 Próximos" },
  ].map((bloco) => ({
    ...bloco,
    itens: comData.filter((l) => urgenciaAtendimento(l.proximo_atendimento, agora) === bloco.id),
  }));

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
                      <span className="block text-xs text-muted">
                        {tipoDoAtendimento(lead.proximo_atendimento)} · {rotulo(STATUS_TODOS, lead.status)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-body">
                      {formatarDataBR(lead.proximo_atendimento.data)}
                      <span className="block">{formatarHorario(lead.proximo_atendimento.horario)}</span>
                    </span>
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

// Clientes: leads convertidos, só consulta. Mais recente primeiro por
// data_conversao (gravada em mudarStatus/marcarAtendimento); convertido sem
// data — legado de antes da coluna — vai pro fim. Clique abre o DetalheLead.
function Clientes({ leads, tagsDoLead, onAbrir }) {
  const clientes = leads
    .filter((l) => l.status === "convertido")
    .sort((a, b) => (b.data_conversao ?? "").localeCompare(a.data_conversao ?? ""));

  if (clientes.length === 0) {
    return <p className="text-sm text-body">Nenhum cliente convertido ainda.</p>;
  }

  return (
    <ul className="mx-auto max-w-3xl divide-y divide-border rounded-2xl bg-card shadow-sm ring-1 ring-border">
      {clientes.map((lead) => {
        const tags = tagsDoLead(lead.id);
        return (
          <li
            key={lead.id}
            onClick={() => onAbrir(lead.id)}
            className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-surface"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-heading">{lead.nome}</p>
              {(lead.tipo_profissional || lead.cidade) && (
                <p className="truncate text-xs text-body">
                  {[lead.tipo_profissional, lead.cidade].filter(Boolean).join(" · ")}
                </p>
              )}
              {tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span key={tag.id} className={classesBadgeEtiqueta(tag.cor)}>
                      {tag.nome}
                    </span>
                  ))}
                </div>
              )}
              {lead.data_conversao && (
                <p className="mt-1 text-xs text-muted">
                  Cliente desde {formatarDataBR(lead.data_conversao)}
                </p>
              )}
            </div>
            {/* Mesmo botão do CardLead; stopPropagation pra não abrir o detalhe. */}
            {lead.whatsapp && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(linkWhatsAppSemMensagem(lead.whatsapp), "_blank", "noopener,noreferrer");
                }}
                aria-label="Abrir conversa no WhatsApp"
                title="Abrir conversa no WhatsApp"
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-green-50 p-2 text-green-700 ring-1 ring-green-200 transition hover:bg-green-100"
              >
                <IconeWhatsApp className="h-4 w-4" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
