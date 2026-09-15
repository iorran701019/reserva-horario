"use client";

import { useState } from "react";
import { formatarDataBR, formatarHorario } from "@/lib/data";
import { STATUS_TODOS, hojeISO, marcarAtendimento, rotulo, tipoDoAtendimento } from "@/lib/crm";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_INPUT,
  Campo,
  MensagemErro,
  Modal,
} from "./ui";

// Tipo + data + hora do próximo atendimento com o lead. Duração vem do tipo
// (só exibida). Deliberadamente NÃO usa FormularioAgendamento (regras de
// serviço/cliente/sinal não se aplicam). Apagar o anterior, inserir, mover o
// status e desfazer em caso de falha mora em marcarAtendimento (lib/crm.js);
// aqui só coleta e mostra o erro.
// `tipos` já chega filtrado pela página (só ativos; e, quando aberto por
// mudança de status, só os que movem pra aquela etapa).
export default function ModalAtendimento({ lead, tipos, onFechar, onConcluido }) {
  const [tipoId, setTipoId] = useState(tipos.length === 1 ? String(tipos[0].id) : "");
  const [data, setData] = useState(hojeISO());
  const [horario, setHorario] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const tipo = tipos.find((t) => String(t.id) === tipoId);
  const atual = lead.proximo_atendimento;

  async function confirmar(e) {
    e.preventDefault();
    if (!tipo || !data || !horario) return;
    setSalvando(true);
    setErro("");
    const resultado = await marcarAtendimento({ lead, tipo, data, horario, observacao });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    onConcluido();
  }

  return (
    <Modal
      titulo={`${atual ? "Remarcar" : "Marcar"} atendimento — ${lead.nome}`}
      onFechar={salvando ? () => {} : onFechar}
      largura="max-w-sm"
    >
      <form onSubmit={confirmar} className="space-y-3">
        {atual && (
          <p className="rounded-lg bg-surface px-3 py-2 text-xs text-body ring-1 ring-border">
            Atual: {tipoDoAtendimento(atual)} em {formatarDataBR(atual.data)} às{" "}
            {formatarHorario(atual.horario)}. Será substituído pelo novo.
          </p>
        )}

        {tipos.length === 0 ? (
          <p className="text-sm text-body">
            Nenhum tipo de atendimento ativo. Cadastre um na aba Tipos de atendimento.
          </p>
        ) : (
          <Campo rotulo="Tipo">
            <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} required className={CLASSE_INPUT}>
              <option value="">Escolha…</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {tipo && (
          <p className="text-xs text-muted">
            Duração: {tipo.duracao_min} min
            {tipo.move_para_status ? ` · move o lead para ${rotulo(STATUS_TODOS, tipo.move_para_status)}` : ""}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Data">
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} required className={CLASSE_INPUT} />
          </Campo>
          <Campo rotulo="Horário">
            <input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} required className={CLASSE_INPUT} />
          </Campo>
        </div>
        <Campo rotulo="Observação (opcional)">
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} className={CLASSE_INPUT} />
        </Campo>

        <MensagemErro>{erro}</MensagemErro>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} disabled={salvando} className={CLASSE_BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando || !tipo || !horario} className={CLASSE_BOTAO_PRIMARIO}>
            {salvando ? "Agendando..." : "Confirmar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
