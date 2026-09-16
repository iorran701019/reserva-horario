"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { formatarDataBR, formatarHorario } from "@/lib/data";
import { linkWhatsAppSemMensagem } from "@/lib/whatsapp";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import {
  CANAIS_INTERACAO,
  MOTIVOS_PERDA,
  ORIGENS,
  STATUS_TODOS,
  hojeISO,
  rotulo,
  tipoDoAtendimento,
} from "@/lib/crm";
import SeletorTags from "./SeletorTags";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_INPUT,
  Campo,
  MensagemErro,
  Modal,
} from "./ui";

const CAMPOS_EDITAVEIS = [
  "nome",
  "whatsapp",
  "instagram",
  "cidade",
  "tipo_profissional",
  "origem",
  "observacoes",
  "ultimo_contato_em",
  "indicado_por_lead_id",
  "motivo_perda",
  "observacao_perda",
];

function formInicial(lead) {
  return Object.fromEntries(CAMPOS_EDITAVEIS.map((c) => [c, lead[c] ?? ""]));
}

// Detalhe do lead. Dados básicos têm botão "Salvar" próprio; status e tags
// gravam na hora (status passa pelo mesmo mudarStatus do quadro, pra
// atendimento/perda dispararem igual). "Marcar/Remarcar" abre o
// ModalAtendimento com todos os tipos ativos, em qualquer status. Montado com
// key={lead.id} pela página, então o form reinicia ao trocar de lead.
export default function DetalheLead({
  lead,
  leads,
  tags,
  tagIds,
  interacoes,
  onTagCriada,
  onFechar,
  onMudarStatus,
  onMarcarAtendimento,
  onAlterado,
}) {
  const [form, setForm] = useState(() => formInicial(lead));
  const [salvando, setSalvando] = useState(false);
  const [status, setStatus] = useState("");
  const [erro, setErro] = useState("");

  const [buscaIndicacao, setBuscaIndicacao] = useState("");
  const [erroTags, setErroTags] = useState("");

  const [novaInteracao, setNovaInteracao] = useState(null);
  const [salvandoInteracao, setSalvandoInteracao] = useState(false);
  const [erroInteracao, setErroInteracao] = useState("");

  const atendimento = lead.proximo_atendimento;

  function campo(nome) {
    return {
      value: form[nome],
      onChange: (e) => setForm((f) => ({ ...f, [nome]: e.target.value })),
    };
  }

  async function salvar(e) {
    e.preventDefault();
    if (!String(form.nome).trim()) return;
    setSalvando(true);
    setErro("");
    setStatus("");
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v])
    );
    payload.atualizado_em = new Date().toISOString();
    const { data, error } = await supabase
      .from("leads")
      .update(payload)
      .eq("id", lead.id)
      .select("id");
    setSalvando(false);
    if (error || !data?.length) {
      setErro(mensagemFalhaSalvar(error));
      return;
    }
    setStatus("Salvo.");
    onAlterado();
  }

  async function toggleTag(tagId) {
    setErroTags("");
    const marcada = tagIds.includes(tagId);
    const { error } = marcada
      ? await supabase.from("lead_tags").delete().eq("lead_id", lead.id).eq("tag_id", tagId)
      : await supabase.from("lead_tags").insert({ lead_id: lead.id, tag_id: tagId });
    if (error) {
      setErroTags(error.message);
      return;
    }
    onAlterado();
  }

  async function salvarInteracao(e) {
    e.preventDefault();
    setSalvandoInteracao(true);
    setErroInteracao("");
    const { error } = await supabase.from("interacoes").insert({
      lead_id: lead.id,
      data: novaInteracao.data || hojeISO(),
      canal: novaInteracao.canal || null,
      descricao: novaInteracao.descricao.trim() || null,
    });
    if (error) {
      setSalvandoInteracao(false);
      setErroInteracao(error.message);
      return;
    }
    // Interação mais nova que o último contato registrado empurra a data.
    const dataInteracao = novaInteracao.data || hojeISO();
    if (!lead.ultimo_contato_em || dataInteracao > lead.ultimo_contato_em) {
      await supabase
        .from("leads")
        .update({ ultimo_contato_em: dataInteracao, atualizado_em: new Date().toISOString() })
        .eq("id", lead.id);
      setForm((f) => ({ ...f, ultimo_contato_em: dataInteracao }));
    }
    setSalvandoInteracao(false);
    setNovaInteracao(null);
    onAlterado();
  }

  const indicadoPor = leads.find((l) => l.id === Number(form.indicado_por_lead_id));
  const sugestoesIndicacao = buscaIndicacao.trim()
    ? leads
        .filter(
          (l) =>
            l.id !== lead.id &&
            l.nome.toLowerCase().includes(buscaIndicacao.trim().toLowerCase())
        )
        .slice(0, 6)
    : [];

  const mostrarPerda = lead.status === "perdido" || form.motivo_perda || form.observacao_perda;

  return (
    <Modal titulo={lead.nome} onFechar={onFechar} largura="max-w-2xl">
      <div className="space-y-5">
        <section className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Status">
            <select
              value={lead.status}
              onChange={(e) => onMudarStatus(lead, e.target.value)}
              className={CLASSE_INPUT}
            >
              {STATUS_TODOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </Campo>
          {lead.data_conversao && (
            <p className="pb-2 text-xs text-muted">
              Convertido em {formatarDataBR(lead.data_conversao)}
            </p>
          )}
          {/* Mesmo botão do inbox de Pendentes do /admin (conversa em branco).
              Lê o whatsapp SALVO do lead, não o do formulário em edição. */}
          {lead.whatsapp && (
            <button
              type="button"
              onClick={() =>
                window.open(linkWhatsAppSemMensagem(lead.whatsapp), "_blank", "noopener,noreferrer")
              }
              className="mb-2 ml-auto inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200 transition hover:bg-green-100"
            >
              <IconeWhatsApp className="h-3.5 w-3.5" />
              Entrar em contato
            </button>
          )}
        </section>

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3 ring-1 ring-border">
          <div>
            <h3 className="text-sm font-semibold text-heading">Próximo atendimento</h3>
            {atendimento ? (
              <p className="text-sm text-body">
                {tipoDoAtendimento(atendimento)} — {formatarDataBR(atendimento.data)} às{" "}
                {formatarHorario(atendimento.horario)}
                <span className="text-xs text-muted"> · {atendimento.duracao_min} min</span>
              </p>
            ) : (
              <p className="text-xs text-muted">Nenhum atendimento marcado.</p>
            )}
          </div>
          <button type="button" onClick={() => onMarcarAtendimento(lead)} className={CLASSE_BOTAO_SECUNDARIO}>
            {atendimento ? "Remarcar" : "Marcar atendimento"}
          </button>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-heading">Tags</h3>
          <SeletorTags tags={tags} selecionadas={tagIds} onToggle={toggleTag} onCriada={onTagCriada} />
          <MensagemErro>{erroTags}</MensagemErro>
        </section>

        <form onSubmit={salvar} className="space-y-3">
          <h3 className="text-sm font-semibold text-heading">Dados</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nome *">
              <input {...campo("nome")} required className={CLASSE_INPUT} />
            </Campo>
            <Campo rotulo="WhatsApp">
              <input {...campo("whatsapp")} inputMode="tel" className={CLASSE_INPUT} />
            </Campo>
            <Campo rotulo="Instagram">
              <input {...campo("instagram")} className={CLASSE_INPUT} />
            </Campo>
            <Campo rotulo="Cidade">
              <input {...campo("cidade")} className={CLASSE_INPUT} />
            </Campo>
            <Campo rotulo="Tipo de profissional">
              <input {...campo("tipo_profissional")} className={CLASSE_INPUT} />
            </Campo>
            <Campo rotulo="Origem">
              <select {...campo("origem")} className={CLASSE_INPUT}>
                <option value="">—</option>
                {ORIGENS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Último contato">
              <input {...campo("ultimo_contato_em")} type="date" className={CLASSE_INPUT} />
            </Campo>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-body">Indicado por</span>
            {indicadoPor ? (
              <div className="flex items-center gap-2 text-sm text-heading">
                {indicadoPor.nome}
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, indicado_por_lead_id: "" }))}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  remover
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={buscaIndicacao}
                  onChange={(e) => setBuscaIndicacao(e.target.value)}
                  placeholder="Buscar lead pelo nome"
                  className={CLASSE_INPUT}
                />
                {sugestoesIndicacao.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg bg-card shadow-lg ring-1 ring-border">
                    {sugestoesIndicacao.map((l) => (
                      <li key={l.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setForm((f) => ({ ...f, indicado_por_lead_id: l.id }));
                            setBuscaIndicacao("");
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-heading hover:bg-surface"
                        >
                          {l.nome}
                          {l.cidade ? <span className="text-xs text-muted"> · {l.cidade}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <Campo rotulo="Observações">
            <textarea {...campo("observacoes")} rows={3} className={CLASSE_INPUT} />
          </Campo>

          {mostrarPerda && (
            <div className="grid gap-3 rounded-lg bg-surface p-3 ring-1 ring-border sm:grid-cols-2">
              <Campo rotulo="Motivo da perda">
                <select {...campo("motivo_perda")} className={CLASSE_INPUT}>
                  <option value="">—</option>
                  {MOTIVOS_PERDA.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.rotulo}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Observação da perda">
                <input {...campo("observacao_perda")} className={CLASSE_INPUT} />
              </Campo>
            </div>
          )}

          <MensagemErro>{erro}</MensagemErro>
          <div className="flex items-center justify-end gap-3">
            {status && <span className="text-xs text-emerald-700">{status}</span>}
            <button type="submit" disabled={salvando} className={CLASSE_BOTAO_PRIMARIO}>
              {salvando ? "Salvando..." : "Salvar dados"}
            </button>
          </div>
        </form>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-heading">Interações</h3>
            {!novaInteracao && (
              <button
                type="button"
                onClick={() => setNovaInteracao({ data: hojeISO(), canal: "whatsapp", descricao: "" })}
                className="text-sm font-semibold text-primary hover:underline"
              >
                + nova interação
              </button>
            )}
          </div>

          {novaInteracao && (
            <form onSubmit={salvarInteracao} className="mb-3 space-y-2 rounded-lg bg-surface p-3 ring-1 ring-border">
              <div className="grid gap-2 sm:grid-cols-2">
                <Campo rotulo="Data">
                  <input
                    type="date"
                    value={novaInteracao.data}
                    onChange={(e) => setNovaInteracao((n) => ({ ...n, data: e.target.value }))}
                    className={CLASSE_INPUT}
                  />
                </Campo>
                <Campo rotulo="Canal">
                  <select
                    value={novaInteracao.canal}
                    onChange={(e) => setNovaInteracao((n) => ({ ...n, canal: e.target.value }))}
                    className={CLASSE_INPUT}
                  >
                    {CANAIS_INTERACAO.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.rotulo}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
              <Campo rotulo="Descrição">
                <input
                  value={novaInteracao.descricao}
                  onChange={(e) => setNovaInteracao((n) => ({ ...n, descricao: e.target.value }))}
                  autoFocus
                  className={CLASSE_INPUT}
                />
              </Campo>
              <MensagemErro>{erroInteracao}</MensagemErro>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setNovaInteracao(null)} className={CLASSE_BOTAO_SECUNDARIO}>
                  Cancelar
                </button>
                <button type="submit" disabled={salvandoInteracao} className={CLASSE_BOTAO_PRIMARIO}>
                  {salvandoInteracao ? "Salvando..." : "Adicionar"}
                </button>
              </div>
            </form>
          )}

          {interacoes.length === 0 ? (
            <p className="text-xs text-muted">Nenhuma interação registrada.</p>
          ) : (
            <ol className="space-y-2 border-l-2 border-border pl-4">
              {interacoes.map((i) => (
                <li key={i.id}>
                  <p className="text-xs font-medium text-body">
                    {formatarDataBR(i.data)}
                    {i.canal ? ` · ${rotulo(CANAIS_INTERACAO, i.canal)}` : ""}
                  </p>
                  {i.descricao && <p className="text-sm text-heading">{i.descricao}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}
