"use client";

import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import { HORA_ABERTURA, HORA_FECHAMENTO } from "@/lib/horarios";

// Cores dos eventos por status, coerentes com classesStatus dos badges:
// pendente em âmbar, confirmado em verde (fundo claro / texto escuro).
const CORES_EVENTO = {
  pendente: { fundo: "#fef3c7", borda: "#fcd34d", texto: "#92400e" },
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
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// Calendário do Painel. Recebe `agendamentos` já carregado pela página (sem
// fetch novo) e deriva os eventos pendentes/confirmados. View inicial e
// toolbars são responsivas (mobile-first); o `key` reinicia o calendário ao
// virar o breakpoint.
export default function PainelCalendario({ agendamentos }) {
  // Começa em `false` (desktop) tanto no servidor quanto no cliente para não
  // divergir na hidratação; o efeito ajusta após montar. Nunca lemos `window`
  // durante o render.
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const aplicar = () => setIsMobile(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  // Eventos: só pendentes/confirmados com data e horário. start/end em ISO
  // LOCAL (sem "Z"); end = start + duracao_min. O registro completo vai em
  // extendedProps (usado no clique na leva B).
  const eventos = agendamentos
    .filter(
      (a) =>
        (a.status === "pendente" || a.status === "confirmado") &&
        a.data &&
        a.horario
    )
    .map((a) => {
      const cor = CORES_EVENTO[a.status] ?? CORES_EVENTO.pendente;
      const inicioMin = horaParaMin(a.horario);
      const duracao = a.servicos?.duracao_min;
      return {
        id: String(a.id),
        title: `${a.nome_cliente} · ${a.servicos?.nome ?? "serviço"}`,
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
          // Valores crus do mesmo par usado no `title`, p/ abreviar no rótulo.
          nome_cliente: a.nome_cliente,
          servico: a.servicos?.nome ?? "serviço",
        },
      };
    });

  return (
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
        // (título completo).
        if (!arg.view.type.startsWith("timeGrid")) return undefined;
        const nome = abreviarNome(arg.event.extendedProps.nome_cliente);
        const servico = abreviarServico(arg.event.extendedProps.servico);
        const hora = `${hhmm(arg.event.start)} - ${hhmm(arg.event.end)}`;
        return (
          <div className="ag-evento">
            <span className="ag-evento-titulo">{nome} - {servico}</span>{" "}
            <span className="ag-evento-hora">- {hora}</span>
          </div>
        );
      }}
      eventClick={(info) => {
        // Inerte por enquanto — as ações vêm na leva B.
        console.log(info.event.extendedProps.agendamento);
      }}
    />
  );
}
