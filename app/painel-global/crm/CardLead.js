"use client";

import { classesBadgeEtiqueta } from "@/components/SeletorEtiquetaRapido";
import { formatarDataBR, formatarHorario } from "@/lib/data";
import { STATUS_TODOS, hojeISO, tipoDoAtendimento } from "@/lib/crm";

// Card do lead (quadro, Perdidos). Arrastável via drag and drop nativo; o
// <select> de status é a alternativa pro toque no celular, onde o arraste
// HTML5 não funciona — ele fica visível em qualquer largura.
// `lead.proximo_atendimento` vem do join em agendamentos (page.js).
export default function CardLead({ lead, tags, trecho, onAbrir, onMudarStatus }) {
  const hoje = hojeISO();
  const atendimento = lead.proximo_atendimento;
  const corContato =
    !atendimento
      ? ""
      : atendimento.data < hoje
        ? "text-red-700"
        : atendimento.data === hoje
          ? "text-amber-700"
          : "text-body";

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(lead.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onAbrir(lead.id)}
      className="cursor-pointer rounded-xl bg-card p-3 text-left shadow-sm ring-1 ring-border transition hover:ring-primary/40"
    >
      <p className="font-semibold text-heading">{lead.nome}</p>
      {(lead.tipo_profissional || lead.cidade) && (
        <p className="mt-0.5 text-xs text-body">
          {[lead.tipo_profissional, lead.cidade].filter(Boolean).join(" · ")}
        </p>
      )}

      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span key={tag.id} className={classesBadgeEtiqueta(tag.cor)}>
              {tag.nome}
            </span>
          ))}
        </div>
      )}

      {atendimento && (
        <p className={`mt-2 text-xs font-medium ${corContato}`}>
          {tipoDoAtendimento(atendimento)}: {formatarDataBR(atendimento.data)} às{" "}
          {formatarHorario(atendimento.horario)}
        </p>
      )}

      {trecho && <p className="mt-1 line-clamp-2 text-xs text-muted">{trecho}</p>}

      <select
        value={lead.status}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onMudarStatus(lead, e.target.value)}
        aria-label="Mudar status"
        className="mt-2 w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-body"
      >
        {STATUS_TODOS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.rotulo}
          </option>
        ))}
      </select>
    </div>
  );
}
