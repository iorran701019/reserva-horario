"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import { ChevronLeft, ChevronRight, ArrowUp } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { HORA_ABERTURA, HORA_FECHAMENTO } from "@/lib/horarios";
import { classificarAgendamento } from "@/lib/particao";

// Abas próprias do Painel (substituem a toolbar nativa do FullCalendar).
const ABAS_CALENDARIO = [
  { id: "dia", rotulo: "Dia" },
  { id: "lista", rotulo: "Lista" },
  { id: "mes", rotulo: "Mês" },
];

// Aba -> view do FullCalendar. "lista" usa a view customizada `listaAgenda`
// (agenda contínua a partir de hoje, ver `views` no <FullCalendar>).
const MAPA_VIEW = {
  dia: "timeGridDay",
  lista: "listaAgenda",
  mes: "dayGridMonth",
};

// Data local de hoje em "YYYY-MM-DD" (mesmo formato de `agendamentos.data`),
// usada pra ancorar a Lista sempre no dia atual ao trocar de aba.
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

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
// fetch novo) e deriva os eventos pendentes/confirmados. View inicial é
// responsiva (mobile-first); o `key` reinicia o calendário ao virar o
// breakpoint. Toolbar nativa desligada — navegação própria (abas + prev/
// next/Hoje) logo acima do calendário.
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

  // View ativa do FullCalendar (atualizada via datesSet), usada só pra decidir
  // o que passar em `events` (Lista filtra por confirmado) e o branch de
  // eventContent. Inicializa alinhada ao `initialView` abaixo.
  const [viewAtual, setViewAtual] = useState(
    isMobile ? "timeGridDay" : "dayGridMonth"
  );

  // Aba própria ativa (Dia/Lista/Mês — ver ABAS_CALENDARIO), controla a view
  // via changeView() na ref do calendário. Alinhada ao `viewAtual` inicial.
  const [abaAtiva, setAbaAtiva] = useState(isMobile ? "dia" : "mes");

  // Título do período atual (ex.: "agosto de 2026"), capturado em datesSet e
  // exibido na linha de navegação própria (Dia/Mês — a Lista não pagina).
  const [tituloAtual, setTituloAtual] = useState("");

  // Botão flutuante "voltar ao início", só na aba Lista: aparece depois de
  // ~300px de scroll no container da lista (ver `listaScrollRef`).
  const [mostrarBotaoTopo, setMostrarBotaoTopo] = useState(false);

  // Ref da API do FullCalendar (changeView/prev/next/today/gotoDate) e ref do
  // container com scroll próprio da aba Lista (mede o scroll do botão flutuante
  // e é o alvo do scrollTo suave).
  const calendarRef = useRef(null);
  const listaScrollRef = useRef(null);

  // Troca de aba: atualiza o state e comanda a view do FullCalendar via ref.
  // Ao entrar na Lista, sempre ancora em hoje ANTES de mudar de view — a
  // duração é de 1 ano (ver `views` no <FullCalendar>), então sem isso ela
  // continuaria de onde a navegação nativa (prev/next) tivesse deixado.
  function mudarAba(aba) {
    setAbaAtiva(aba);
    // Reseta o botão flutuante aqui (não num efeito) pra não disparar setState
    // síncrono dentro de useEffect — o container troca de conteúdo e volta ao
    // topo de qualquer forma ao entrar/sair da Lista.
    setMostrarBotaoTopo(false);
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (aba === "lista") api.gotoDate(hojeISO());
    api.changeView(MAPA_VIEW[aba]);
  }

  // Vai pra aba Dia numa data específica: usado tanto pelo clique num DIA do
  // Mês (dateClick) quanto pelo clique num EVENTO do Mês (eventClick) — nos
  // dois casos o destino é o mesmo, a agenda por hora daquele dia.
  function irParaAbaDiaEm(data) {
    setAbaAtiva("dia");
    const api = calendarRef.current?.getApi();
    api?.changeView("timeGridDay");
    api?.gotoDate(data);
  }

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

  // Mostra o botão flutuante "voltar ao início" só na aba Lista, depois de
  // ~300px de scroll no container próprio da lista (o reset ao trocar de aba
  // já acontece em mudarAba, direto no clique — não aqui). O scroll começa em
  // 0 ao entrar na Lista, então não precisa medir de cara, só assinar o evento.
  useEffect(() => {
    if (abaAtiva !== "lista") return;
    const el = listaScrollRef.current;
    if (!el) return;
    const aoRolar = () => setMostrarBotaoTopo(el.scrollTop > 300);
    el.addEventListener("scroll", aoRolar);
    return () => el.removeEventListener("scroll", aoRolar);
  }, [abaAtiva]);

  // Eventos: só itens ATIVOS pela partição derivada (classificarAgendamento !==
  // "historico"). Cancelados e caducados NÃO aparecem aqui (vão pro Histórico);
  // confirmados "em andamento" continuam, pois só somem quando o FIM passa.
  // Exige data/horário antes de classificar (classificarAgendamento parseia
  // ambos). start/end em ISO LOCAL (sem "Z"); end = start + duracao_min. O
  // registro completo vai em extendedProps (usado no clique na leva B).
  const eventos = useMemo(
    () =>
      agendamentos
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
        }),
    [agendamentos, filtroProfissional]
  );

  // Lista (listaAgenda) só mostra CONFIRMADOS — pendentes ficam de fora dessa
  // view (continuam normalmente em Dia/Mês, tratados no Inbox). Demais views
  // usam o array cheio de `eventos`.
  const eventosExibidos = useMemo(
    () =>
      viewAtual.startsWith("list")
        ? eventos.filter((ev) => !ev.extendedProps.pendente)
        : eventos,
    [eventos, viewAtual]
  );

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

      {/* Abas próprias (Dia/Lista/Mês), substituem a toolbar nativa do
          FullCalendar. Ficam antes de qualquer navegação de data. */}
      <div className="mb-3 flex gap-1 rounded-lg bg-surface p-1">
        {ABAS_CALENDARIO.map((aba) => (
          <button
            key={aba.id}
            type="button"
            onClick={() => mudarAba(aba.id)}
            aria-pressed={abaAtiva === aba.id}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              abaAtiva === aba.id
                ? "bg-card text-heading shadow-sm ring-1 ring-border"
                : "text-body hover:text-heading"
            }`}
          >
            {aba.rotulo}
          </button>
        ))}
      </div>

      {/* Navegação própria de período (Dia/Mês) — a Lista não pagina, é uma
          agenda contínua a partir de hoje. */}
      {abaAtiva !== "lista" && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => calendarRef.current?.getApi().prev()}
            aria-label="Período anterior"
            className="rounded-lg bg-card p-2 text-body shadow-sm ring-1 ring-border transition hover:bg-surface"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-heading">
              {tituloAtual}
            </span>
            <button
              type="button"
              onClick={() => calendarRef.current?.getApi().today()}
              className="shrink-0 rounded-lg bg-card px-2.5 py-1 text-xs font-medium text-body shadow-sm ring-1 ring-border transition hover:bg-surface"
            >
              Hoje
            </button>
          </div>
          <button
            type="button"
            onClick={() => calendarRef.current?.getApi().next()}
            aria-label="Próximo período"
            className="rounded-lg bg-card p-2 text-body shadow-sm ring-1 ring-border transition hover:bg-surface"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Container com scroll próprio só na aba Lista (agenda contínua de 1
          ano) — é ele que mede o scroll do botão flutuante "voltar ao início"
          e recebe o scrollTo suave ao clicar nele. Nas outras abas cresce
          livre (height="auto" do calendário), sem limite nem scroll interno. */}
      <div
        ref={listaScrollRef}
        className={abaAtiva === "lista" ? "max-h-[70vh] overflow-y-auto" : ""}
      >
        <FullCalendar
          key={isMobile ? "m" : "d"}
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={ptBrLocale}
          initialView={isMobile ? "timeGridDay" : "dayGridMonth"}
          views={{ listaAgenda: { type: "list", duration: { years: 1 } } }}
          headerToolbar={false}
          footerToolbar={false}
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
          events={eventosExibidos}
          datesSet={(arg) => {
            setViewAtual(arg.view.type);
            setTituloAtual(arg.view.title);
          }}
          eventContent={(arg) => {
            // Mês: só a hora (HH:MM), num badge colorido pela mesma cor de
            // status do evento (CORES_EVENTO, já aplicada em
            // backgroundColor/textColor no objeto do evento) — sem nome nem
            // inicial, o card é só um indicador de ocupação.
            if (arg.view.type === "dayGridMonth") {
              const hora = hhmm(arg.event.start);
              return (
                <div
                  className="ag-evento-mes"
                  style={{
                    backgroundColor: arg.event.backgroundColor,
                    color: arg.event.textColor,
                  }}
                >
                  {hora}
                </div>
              );
            }
            // Lista: nome completo do cliente + serviço completo, sem abreviar — o
            // horário já vem na coluna nativa da view (mesmo eventTimeFormat).
            if (arg.view.type.startsWith("list")) {
              return arg.event.extendedProps.pendente
                ? "Pendente"
                : `${arg.event.extendedProps.nome_cliente} - ${arg.event.extendedProps.servico}`;
            }
            // Dia (timeGrid), única view restante: mantém o rótulo abreviado de sempre.
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
            // No Mês, tocar num evento tem o mesmo destino que tocar no dia
            // (dateClick): vai pra agenda por hora daquele dia na aba Dia, sem
            // abrir o modal de detalhe.
            if (info.view.type === "dayGridMonth") {
              irParaAbaDiaEm(info.event.startStr);
              return;
            }
            // Nas demais views (Dia/Lista): só o bloco CONFIRMADO abre o modal
            // de detalhe/ações (leva B.2). O pendente (cinza) é só ocupação —
            // tratado no Inbox, não clicável aqui. O calendário apenas sinaliza
            // a seleção; estado/handlers ficam no /admin.
            const item = info.event.extendedProps.agendamento;
            if (classificarAgendamento(item) === "confirmado") {
              onSelecionarConfirmado?.(item);
            }
          }}
          dateClick={(info) => {
            // Só no Mês: tocar num DIA (não num evento) leva direto pra agenda
            // daquele dia na aba Dia. Nas outras views não faz nada (Dia já é
            // por hora; a Lista não tem grade de dias clicável).
            if (info.view.type !== "dayGridMonth") return;
            irParaAbaDiaEm(info.date);
          }}
        />
      </div>

      {/* Botão flutuante "voltar ao início", só na aba Lista — some com a
          aba (ver efeito de mostrarBotaoTopo). */}
      {abaAtiva === "lista" && mostrarBotaoTopo && (
        <button
          type="button"
          onClick={() =>
            listaScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
          }
          aria-label="Voltar ao início da lista"
          className="fixed bottom-6 right-4 z-30 rounded-full bg-primary p-3 text-on-primary shadow-lg transition hover:bg-primary-hover"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
