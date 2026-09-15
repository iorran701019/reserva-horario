"use client";

import { useState } from "react";
import { criarDemonstracao, hojeISO } from "@/lib/crm";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_INPUT,
  Campo,
  MensagemErro,
  Modal,
} from "./ui";

// Data + hora + duração da demonstração. Deliberadamente NÃO usa
// FormularioAgendamento (regras de serviço/cliente/sinal não se aplicam).
// Toda a sequência insert → update do lead → rollback mora em
// criarDemonstracao (lib/crm.js); aqui só coleta e mostra o erro.
export default function ModalDemonstracao({ lead, onFechar, onConcluido }) {
  const [data, setData] = useState(hojeISO());
  const [horario, setHorario] = useState("");
  const [duracaoMin, setDuracaoMin] = useState(60);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function confirmar(e) {
    e.preventDefault();
    if (!data || !horario || !(duracaoMin > 0)) return;
    setSalvando(true);
    setErro("");
    const resultado = await criarDemonstracao({
      lead,
      data,
      horario,
      duracaoMin: Number(duracaoMin),
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    onConcluido();
  }

  return (
    <Modal titulo={`Demonstração — ${lead.nome}`} onFechar={salvando ? () => {} : onFechar} largura="max-w-sm">
      <form onSubmit={confirmar} className="space-y-3">
        <p className="text-xs text-muted">
          Cria um agendamento confirmado no tenant Acolhe — Comercial e move o
          lead para Demonstração.
        </p>
        <Campo rotulo="Data">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} required className={CLASSE_INPUT} />
        </Campo>
        <Campo rotulo="Horário">
          <input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} required className={CLASSE_INPUT} />
        </Campo>
        <Campo rotulo="Duração (min)">
          <input
            type="number"
            min={5}
            step={5}
            value={duracaoMin}
            onChange={(e) => setDuracaoMin(e.target.value)}
            required
            className={CLASSE_INPUT}
          />
        </Campo>

        <MensagemErro>{erro}</MensagemErro>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} disabled={salvando} className={CLASSE_BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando || !horario} className={CLASSE_BOTAO_PRIMARIO}>
            {salvando ? "Agendando..." : "Confirmar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
