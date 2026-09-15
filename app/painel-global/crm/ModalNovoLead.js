"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ORIGENS, STATUS_ATIVOS, hojeISO } from "@/lib/crm";
import SeletorTags from "./SeletorTags";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_INPUT,
  Campo,
  MensagemErro,
  Modal,
} from "./ui";

// Cadastro rápido: só `nome` é obrigatório. Status inicial não oferece
// `demonstracao` (exige o agendamento — o lead entra e depois é movido pelo
// quadro, que dispara o gatilho) nem `perdido`.
const STATUS_INICIAIS = STATUS_ATIVOS.filter((s) => s.id !== "demonstracao");

export default function ModalNovoLead({ tags, onTagCriada, onFechar, onCriado }) {
  const [form, setForm] = useState({
    nome: "",
    whatsapp: "",
    instagram: "",
    cidade: "",
    tipo_profissional: "",
    origem: "",
    status: "novo",
    proximo_contato_em: "",
    observacoes: "",
  });
  const [tagIds, setTagIds] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function campo(nome) {
    return {
      value: form[nome],
      onChange: (e) => setForm((f) => ({ ...f, [nome]: e.target.value })),
    };
  }

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) return;
    setSalvando(true);
    setErro("");

    // Texto vazio vira null (origem vazia violaria o check constraint).
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v])
    );
    if (payload.status === "convertido") payload.data_conversao = hojeISO();

    const { data: lead, error } = await supabase
      .from("leads")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      setSalvando(false);
      setErro(error.message);
      return;
    }

    if (tagIds.length) {
      const { error: erroTags } = await supabase
        .from("lead_tags")
        .insert(tagIds.map((tag_id) => ({ lead_id: lead.id, tag_id })));
      if (erroTags) {
        // Lead já existe: não desfaz, só avisa — as tags dá pra marcar no detalhe.
        setSalvando(false);
        setErro(`Lead criado, mas as tags não foram gravadas: ${erroTags.message}`);
        onCriado({ fechar: false });
        return;
      }
    }

    setSalvando(false);
    onCriado({ fechar: true });
  }

  function toggleTag(id) {
    setTagIds((atual) => (atual.includes(id) ? atual.filter((t) => t !== id) : [...atual, id]));
  }

  return (
    <Modal titulo="Novo lead" onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <Campo rotulo="Nome *">
          <input {...campo("nome")} required autoFocus className={CLASSE_INPUT} />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="WhatsApp">
            <input {...campo("whatsapp")} inputMode="tel" className={CLASSE_INPUT} />
          </Campo>
          <Campo rotulo="Instagram">
            <input {...campo("instagram")} placeholder="@" className={CLASSE_INPUT} />
          </Campo>
          <Campo rotulo="Cidade">
            <input {...campo("cidade")} className={CLASSE_INPUT} />
          </Campo>
          <Campo rotulo="Tipo de profissional">
            <input {...campo("tipo_profissional")} placeholder="Ex.: manicure" className={CLASSE_INPUT} />
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
          <Campo rotulo="Status inicial">
            <select {...campo("status")} className={CLASSE_INPUT}>
              {STATUS_INICIAIS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Próximo contato">
            <input {...campo("proximo_contato_em")} type="date" className={CLASSE_INPUT} />
          </Campo>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-body">Tags</span>
          <SeletorTags
            tags={tags}
            selecionadas={tagIds}
            onToggle={toggleTag}
            onCriada={onTagCriada}
          />
        </div>
        <Campo rotulo="Observação">
          <textarea {...campo("observacoes")} rows={3} className={CLASSE_INPUT} />
        </Campo>

        <MensagemErro>{erro}</MensagemErro>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} className={CLASSE_BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando || !form.nome.trim()} className={CLASSE_BOTAO_PRIMARIO}>
            {salvando ? "Salvando..." : "Cadastrar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
