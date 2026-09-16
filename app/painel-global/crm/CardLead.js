"use client";

import { classesBadgeEtiqueta } from "@/components/SeletorEtiquetaRapido";
import { STATUS_TODOS, urgenciaAtendimento } from "@/lib/crm";

// Bolinha de urgência do próximo atendimento: a mesma classificação dos blocos
// do Follow-up, sem o texto (data/hora ficam no detalhe e no Follow-up).
const BOLINHA_URGENCIA = {
  atrasado: { cor: "bg-red-500", titulo: "Próximo atendimento atrasado" },
  hoje: { cor: "bg-amber-400", titulo: "Próximo atendimento hoje" },
  proximo: { cor: "bg-blue-500", titulo: "Próximo atendimento marcado" },
};

// Card do lead (quadro, Perdidos). Arrastável via drag and drop nativo; o
// <select> de status é a alternativa pro toque no celular, onde o arraste
// HTML5 não funciona — ele fica visível em qualquer largura.
// `lead.proximo_atendimento` vem do join em agendamentos (page.js).
// Tamanhos em .crm-card* (globals.css), compactos pra grade 2×3 do Quadro.
export default function CardLead({ lead, tags, trecho, onAbrir, onMudarStatus }) {
  const urgencia = BOLINHA_URGENCIA[urgenciaAtendimento(lead.proximo_atendimento)];

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(lead.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onAbrir(lead.id)}
      className="crm-card cursor-pointer bg-card text-left shadow-sm ring-1 ring-border transition hover:ring-primary/40"
    >
      <p className="crm-card-nome font-semibold text-heading">
        {urgencia && (
          <span
            role="img"
            aria-label={urgencia.titulo}
            title={urgencia.titulo}
            className={`crm-card-bolinha ${urgencia.cor}`}
          />
        )}
        <span className="truncate">{lead.nome}</span>
      </p>
      {(lead.tipo_profissional || lead.cidade) && (
        <p className="crm-card-detalhe truncate text-body">
          {[lead.tipo_profissional, lead.cidade].filter(Boolean).join(" · ")}
        </p>
      )}

      {tags.length > 0 && (
        <div className="crm-card-tags">
          {tags.map((tag) => (
            <span key={tag.id} className={classesBadgeEtiqueta(tag.cor)}>
              {tag.nome}
            </span>
          ))}
        </div>
      )}

      {trecho && <p className="crm-card-detalhe line-clamp-1 text-muted">{trecho}</p>}

      <select
        value={lead.status}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onMudarStatus(lead, e.target.value)}
        aria-label="Mudar status"
        className="crm-card-select w-full rounded-md border border-border bg-surface text-body"
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
