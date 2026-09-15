"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { MOTIVOS_PERDA } from "@/lib/crm";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_INPUT,
  Campo,
  MensagemErro,
  Modal,
} from "./ui";

// Popup NÃO bloqueante: o status já foi gravado como `perdido` antes de abrir.
// "Pular" só fecha. Vem preenchido com o motivo anterior, se houver (lead
// reaberto e perdido de novo).
export default function ModalPerda({ lead, onFechar, onSalvo }) {
  const [motivo, setMotivo] = useState(lead.motivo_perda ?? "");
  const [observacao, setObservacao] = useState(lead.observacao_perda ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro("");
    const { data, error } = await supabase
      .from("leads")
      .update({
        motivo_perda: motivo || null,
        observacao_perda: observacao.trim() || null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", lead.id)
      .select("id");
    setSalvando(false);
    if (error || !data?.length) {
      setErro(mensagemFalhaSalvar(error));
      return;
    }
    onSalvo();
  }

  return (
    <Modal titulo={`Por que ${lead.nome} foi perdido?`} onFechar={onFechar} largura="max-w-sm">
      <form onSubmit={salvar} className="space-y-3">
        <p className="text-xs text-muted">Opcional — o lead já está em Perdidos.</p>
        <Campo rotulo="Motivo">
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CLASSE_INPUT}>
            <option value="">—</option>
            {MOTIVOS_PERDA.map((m) => (
              <option key={m.id} value={m.id}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Observação">
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} className={CLASSE_INPUT} />
        </Campo>
        <MensagemErro>{erro}</MensagemErro>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} className={CLASSE_BOTAO_SECUNDARIO}>
            Pular
          </button>
          <button type="submit" disabled={salvando} className={CLASSE_BOTAO_PRIMARIO}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
