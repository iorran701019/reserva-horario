"use client";

import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import { supabase } from "@/lib/supabaseClient";
import { HORA_ABERTURA, HORA_FECHAMENTO } from "@/lib/horarios";
import { classificarAgendamento } from "@/lib/particao";

// Cores dos eventos pela partição DERIVADA (não pelo status cru):
// - "inbox" (pendente) = OCUPAÇÃO CINZA neutra: segura o horário, mas o
//   atendimento ainda precisa ser tratado no Inbox (aba Pendentes).
// - "confirmado" = verde (fundo claro / texto escuro).
const CORES_EVENTO = {
  pendente: { fundo: "#e5e7eb", borda: "#9ca3af", texto: "#374151" },
  confirmado: { fundo: "#dcfce7", borda: "#86efac", texto: "#166534" },
};

// Formato 24h compartilhado por eventTimeFormat e slotLabelFormat.
const FORMATO_24H = { hour: "2-digit", minute: "2-digit", hour12: false };

// "HH:MM" ou "HH:MM:SS" -> minutos desde a meia-noite.
function horaParaMin(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// minutos -> "HH:MM:SS" (componente de hora de um ISO local).
function minParaHora(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

// Abreviação de nome/serviço usada só no rótulo dos eventos timeGrid (espaço
// apertado). Partículas ("de", "da"...) não viram sobrenome.
const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "di", "du", "e"]);
function abreviarNome(nome) {
  const partes = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] || "";
  const primeiro = partes[0];
  let sobrenome = null;
  for (let i = partes.length - 1; i >= 1; i--) {
    if (!PARTICULAS.has(partes[i].toLowerCase())) { sobrenome = partes[i]; break; }
  }
  return sobrenome ? `${primeiro} ${sobrenome[0].toUpperCase()}.` : primeiro;
}
function abreviarServico(servico) {
  return (servico || "").trim().split(/\s+/).filter(Boolean).map((p, i) => {
    const cap = p[0].toUpperCase() + p.slice(1).toLowerCase();
    return i === 0 ? cap : (cap.length > 4 ? cap.slice(0, 4) + "." : cap);
  }).join(" ");
}
const hhmm = (d) => d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";

// Calendário do Painel. Recebe `agendamentos` já carregado pela página (sem
// fetch novo) e deriva os eventos pendentes/confirmados. View inicial e
// toolbars são responsivas (mobile-first); o `key` reinicia o calendário ao
// virar o breakpoint.
export default function PainelCalendario({
  agendamentos,
  onSelecionarConfirmado,
  estabelecimentoId,
}) {
  // Começa em `false` (desktop) tanto no servidor quanto no cliente para não
  // divergir na hidratação; o efeito ajusta após montar. Nunca lemos `window`
  // durante o render.
  const [isMobile, setIsMobile] = useState(false);

  // Filtro "Ver agenda de": "todos" (padrão) ou o profissional_id (como string,
  // já que é o value do <select>). Filtra os eventos EM MEMÓRIA, sem query nova.
  const [filtroProfissional, setFiltroProfissional] = useState("todos");

  // Opções do filtro: profissionais ATIVOS do salão (tabela profissionais),
  // ordenados por nome — inclui quem ainda não tem nenhum agendamento.
  const [profissionaisDisponiveis, setProfissionaisDisponiveis] = useState([]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const aplicar = () => setIsMobile(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  useEffect(() => {
    if (!estabelecimentoId) return;
    let ativo = true;

    (async () => {
      const { data } = await supabase
        .from("profissionais")
        .select("id, nome")
        .eq("estabelecimento_id", estabelecimentoId)
        .eq("ativo", true)
        .order("nome");
      if (ativo) setProfissionaisDisponiveis(data ?? []);
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimentoId]);

  // Eventos: só itens ATIVOS pela partição derivada (classificarAgendamento !==
  // "historico"). Cancelados e caducados NÃO aparecem aqui (vão pro Histórico);
  // confirmados "em andamento" continuam, pois só somem quando o FIM passa.
  // Exige data/horário antes de classificar (classificarAgendamento parseia
  // ambos). start/end em ISO LOCAL (sem "Z"); end = start + duracao_min. O
  // registro completo vai em extendedProps (usado no clique na leva B).
  const eventos = agendamentos
    .filter(
      (a) =>
        a.data &&
        a.horario &&
        classificarAgendamento(a) !== "historico" &&
        (filtroProfissional === "todos" ||
          String(a.profissional_id) === filtroProfissional)
    )
    .map((a) => {
      // "inbox" = pendente segurando o horário → bloco cinza, rótulo "Pendente"
      // (ocupação a tratar no Inbox). Caso contrário, confirmado (verde).
      const pendente = classificarAgendamento(a) === "inbox";
      const cor = pendente ? CORES_EVENTO.pendente : CORES_EVENTO.confirmado;
      const inicioMin = horaParaMin(a.horario);
      const duracao = a.duracao_min ?? a.servicos?.duracao_min;
      return {
        id: String(a.id),
        title: pendente
          ? "Pendente"
          : `${a.nome_cliente} · ${a.servicos?.nome ?? a.servico_livre ?? "serviço"}`,
        start: `${a.data}T${minParaHora(inicioMin)}`,
        end:
          duracao != null
            ? `${a.data}T${minParaHora(inicioMin + duracao)}`
            : undefined,
        backgroundColor: cor.fundo,
        borderColor: cor.borda,
        textColor: cor.texto,
        extendedProps: {
          agendamento: a,
          // Sinaliza ocupação pendente p/ o eventContent (rótulo curto cinza).
          pendente,
          // Valores crus do mesmo par usado no `title`, p/ abreviar no rótulo.
          nome_cliente: a.nome_cliente,
          servico: a.servicos?.nome ?? a.servico_livre ?? "serviço",
        },
      };
    });

  return (
    <div>
      {/* Filtro "Ver agenda de": Todos + cada profissional presente nos
          agendamentos. Filtra os eventos em memória (padrão Todos). */}
      <div className="mb-4">
        <label
          htmlFor="filtro-profissional"
          className="mb-1 block text-sm font-medium text-body"
        >
          Ver agenda de:
        </label>
        <select
          id="filtro-profissional"
          value={filtroProfissional}
          onChange={(e) => setFiltroProfissional(e.target.value)}
          className="w-full rounded-lg bg-card px-3 py-2 text-sm font-medium text-heading shadow-sm ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-border"
        >
          <option value="todos">Todos</option>
          {profissionaisDisponiveis.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.nome}
            </option>
          ))}
        </select>
      </div>

      <FullCalendar
        key={isMobile ? "m" : "d"}
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
      locale={ptBrLocale}
      initialView={isMobile ? "timeGridDay" : "dayGridMonth"}
      headerToolbar={
        isMobile
          ? { left: "prev,next", center: "title", right: "today" }
          : {
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }
      }
      footerToolbar={
        isMobile ? { center: "timeGridDay,listWeek,dayGridMonth" } : false
      }
      buttonText={{
        today: "Hoje",
        month: "Mês",
        week: "Semana",
        day: "Dia",
        list: "Lista",
      }}
      allDaySlot={false}
      slotMinTime={HORA_ABERTURA}
      slotMaxTime={HORA_FECHAMENTO}
      slotDuration="00:30:00"
      nowIndicator
      expandRows
      height="auto"
      dayMaxEvents
      eventTimeFormat={FORMATO_24H}
      slotLabelFormat={FORMATO_24H}
      events={eventos}
      eventContent={(arg) => {
        // Só assumimos o markup nas views de grade de horário (Dia/Semana);
        // nas demais (Mês/Lista) devolvemos undefined pro padrão do FullCalendar
        // (título completo — "Pendente" ou "Nome · Serviço").
        if (!arg.view.type.startsWith("timeGrid")) return undefined;
        const hora = `${hhmm(arg.event.start)} - ${hhmm(arg.event.end)}`;
        // Ocupação pendente: rótulo curto "Pendente", sem expor o cliente —
        // o atendimento é tratado no Inbox, não aqui.
        const titulo = arg.event.extendedProps.pendente
          ? "Pendente"
          : `${abreviarNome(arg.event.extendedProps.nome_cliente)} - ${abreviarServico(
              arg.event.extendedProps.servico
            )}`;
        return (
          <div className="ag-evento">
            <span className="ag-evento-titulo">{titulo}</span>{" "}
            <span className="ag-evento-hora">- {hora}</span>
          </div>
        );
      }}
      eventClick={(info) => {
        // Só o bloco CONFIRMADO abre o modal de detalhe/ações (leva B.2). O
        // pendente (cinza) é só ocupação — tratado no Inbox, não clicável aqui.
        // O calendário apenas sinaliza a seleção; estado/handlers ficam no /admin.
        const item = info.event.extendedProps.agendamento;
        if (classificarAgendamento(item) === "confirmado") {
          onSelecionarConfirmado?.(item);
        }
      }}
      />
    </div>
  );
}
