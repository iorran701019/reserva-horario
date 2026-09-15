"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { STATUS_TODOS, rotulo } from "@/lib/crm";
import { CLASSE_BOTAO_PRIMARIO, CLASSE_BOTAO_SECUNDARIO, CLASSE_INPUT, Campo, MensagemErro } from "./ui";

// Cadastro de tipos_atendimento. Sem exclusão: tipo sai de uso com
// "Desativar" (some do seletor do ModalAtendimento; agendamentos antigos
// seguem com o nome gravado em servico_livre). `move_para_status` vazio =
// agendar não mexe no status do lead.
const FORM_VAZIO = { nome: "", duracao_min: 15, move_para_status: "" };

function payload(form) {
  return {
    nome: form.nome.trim(),
    duracao_min: Number(form.duracao_min),
    move_para_status: form.move_para_status || null,
  };
}

function valido(form) {
  return Boolean(form.nome.trim()) && Number(form.duracao_min) > 0;
}

function CamposTipo({ form, setForm }) {
  const set = (nome) => (e) => setForm((f) => ({ ...f, [nome]: e.target.value }));
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_7rem_12rem]">
      <Campo rotulo="Nome">
        <input value={form.nome} onChange={set("nome")} required className={CLASSE_INPUT} />
      </Campo>
      <Campo rotulo="Duração (min)">
        <input type="number" min={5} step={5} value={form.duracao_min} onChange={set("duracao_min")} required className={CLASSE_INPUT} />
      </Campo>
      <Campo rotulo="Ao agendar, mover lead para">
        <select value={form.move_para_status} onChange={set("move_para_status")} className={CLASSE_INPUT}>
          <option value="">Não mover</option>
          {STATUS_TODOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.rotulo}
            </option>
          ))}
        </select>
      </Campo>
    </div>
  );
}

export default function TiposAtendimento({ tipos, onAlterado }) {
  const [novo, setNovo] = useState(FORM_VAZIO);
  const [editandoId, setEditandoId] = useState(null);
  const [edicao, setEdicao] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function executar(query) {
    setSalvando(true);
    setErro("");
    const { data, error } = await query.select("id");
    setSalvando(false);
    if (error || !data?.length) {
      setErro(error?.code === "23505" ? "Já existe um tipo com esse nome." : mensagemFalhaSalvar(error));
      return false;
    }
    onAlterado();
    return true;
  }

  async function criar(e) {
    e.preventDefault();
    if (!valido(novo)) return;
    if (await executar(supabase.from("tipos_atendimento").insert(payload(novo)))) setNovo(FORM_VAZIO);
  }

  async function salvarEdicao(e) {
    e.preventDefault();
    if (!valido(edicao)) return;
    const query = supabase.from("tipos_atendimento").update(payload(edicao)).eq("id", editandoId);
    if (await executar(query)) setEditandoId(null);
  }

  function alternarAtivo(tipo) {
    executar(supabase.from("tipos_atendimento").update({ ativo: !tipo.ativo }).eq("id", tipo.id));
  }

  return (
    <div className="max-w-3xl space-y-4">
      <MensagemErro>{erro}</MensagemErro>

      <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="mb-3 text-sm font-semibold text-heading">Tipos cadastrados</h2>
        {tipos.length === 0 ? (
          <p className="text-xs text-muted">Nenhum tipo cadastrado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tipos.map((tipo) => (
              <li key={tipo.id} className="py-3">
                {editandoId === tipo.id ? (
                  <form onSubmit={salvarEdicao} className="space-y-2">
                    <CamposTipo form={edicao} setForm={setEdicao} />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditandoId(null)} className={CLASSE_BOTAO_SECUNDARIO}>
                        Cancelar
                      </button>
                      <button type="submit" disabled={salvando || !valido(edicao)} className={CLASSE_BOTAO_PRIMARIO}>
                        Salvar
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className={tipo.ativo ? "" : "opacity-50"}>
                      <p className="text-sm font-medium text-heading">
                        {tipo.nome}
                        {!tipo.ativo && <span className="ml-2 text-xs text-muted">(inativo)</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {tipo.duracao_min} min
                        {tipo.move_para_status ? ` · move para ${rotulo(STATUS_TODOS, tipo.move_para_status)}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-3 text-sm font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          setEditandoId(tipo.id);
                          setEdicao({
                            nome: tipo.nome,
                            duracao_min: tipo.duracao_min,
                            move_para_status: tipo.move_para_status ?? "",
                          });
                        }}
                        className="text-primary hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => alternarAtivo(tipo)}
                        disabled={salvando}
                        className="text-body hover:underline"
                      >
                        {tipo.ativo ? "Desativar" : "Reativar"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={criar} className="space-y-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-sm font-semibold text-heading">Novo tipo</h2>
        <CamposTipo form={novo} setForm={setNovo} />
        <div className="flex justify-end">
          <button type="submit" disabled={salvando || !valido(novo)} className={CLASSE_BOTAO_PRIMARIO}>
            Adicionar
          </button>
        </div>
      </form>
    </div>
  );
}
