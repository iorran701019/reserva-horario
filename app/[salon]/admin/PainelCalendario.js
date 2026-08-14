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
// - "naoVinculado" = confirmado, mas importado do Google Calendar sem
//   cliente vinculado ainda (telefone null — ver POST em
//   app/api/google-calendar/importar/route.js): âmbar, pra chamar a atenção
//   pro botão "Vincular cliente".
// - "pessoal" = confirmado, importado do Google Calendar como bloco pessoal
//   (origem='importado_pessoal', ver montarCandidatos em
//   lib/googleCalendarImportacao): cinza-azulado neutro, só ocupa o
//   horário — sem selo de vincular, nunca vira cliente de verdade.
// "ausencia" (bloqueio da tabela `ausencias`, ver eventosAusencia abaixo) usa
// o MESMO cinza neutro de "pendente" — a distinção de "cliente agendada" não
// vem da cor, vem do padrão de listras diagonais (classe ag-evento-ausencia-
// bloco, ver app/globals.css) somado ao rótulo "Ausência" no lugar do nome.
const CORES_EVENTO = {
  pendente: { fundo: "#e5e7eb", borda: "#9ca3af", texto: "#374151" },
  confirmado: { fundo: "#dcfce7", borda: "#86efac", texto: "#166534" },
  naoVinculado: { fundo: "#fef3c7", borda: "#fbbf24", texto: "#92400e" },
  pessoal: { fundo: "#e2e8f0", borda: "#94a3b8", texto: "#334155" },
  ausencia: { fundo: "#e5e7eb", borda: "#6b7280", texto: "#374151" },
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

// Date -> "YYYY-MM-DD" em horário LOCAL, componente-a-componente (evita o
// desvio de fuso do toISOString(), que converte pra UTC) — mesma técnica
// usada em todo o projeto (ver formatarISO em FormularioAgendamento.js).
function paraISOLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

// "HH:MM" ou "HH:MM:SS" -> "HH:MM:SS", pro sufixo T do ISO local do evento
// (mesmo formato que minParaHora produz a partir de minutos).
function paraHoraCompleta(hora) {
  return `${String(hora).slice(0, 5)}:00`;
}

// Calendário do Painel. Recebe `agendamentos` já carregado pela página (sem
// fetch novo) e deriva os eventos pendentes/confirmados. View inicial é
// sempre Dia, independente de mobile ou desktop — Dia/Lista/Mês só trocam
// pelas abas manuais. Toolbar nativa desligada — navegação própria (abas +
// prev/next/Hoje) logo acima do calendário.
// Props:
//   dataInicial – "YYYY-MM-DD" opcional (ver ?data= em GerenciarClientes,
//                 clique no card "Próximo agendamento"): no MOUNT, pula
//                 direto pra aba Dia nessa data em vez de abrir em hoje.
//                 Ausente/null preserva o comportamento normal.
export default function PainelCalendario({
  agendamentos,
  onSelecionarConfirmado,
  onSelecionarPendente,
  onVincularCliente,
  onMarcarComoAtendimento,
  estabelecimentoId,
  dataInicial,
}) {
  // Filtro "Ver agenda de": "todos" (padrão) ou o profissional_id (como string,
  // já que é o value do <select>). Filtra os eventos EM MEMÓRIA, sem query nova.
  const [filtroProfissional, setFiltroProfissional] = useState("todos");

  // Opções do filtro: profissionais ATIVOS do salão (tabela profissionais),
  // ordenados por nome — inclui quem ainda não tem nenhum agendamento.
  const [profissionaisDisponiveis, setProfissionaisDisponiveis] = useState([]);

  // View ativa do FullCalendar (atualizada via datesSet), usada só pra decidir
  // o que passar em `events` (Lista filtra por confirmado) e o branch de
  // eventContent. Inicializa alinhada ao `initialView` abaixo.
  const [viewAtual, setViewAtual] = useState("timeGridDay");

  // Aba própria ativa (Dia/Lista/Mês — ver ABAS_CALENDARIO), controla a view
  // via changeView() na ref do calendário. Sempre abre em Dia, independente
  // de mobile ou desktop — a escolha de Dia/Lista/Mês é só manual (abas).
  const [abaAtiva, setAbaAtiva] = useState("dia");

  // Título do período atual (ex.: "agosto de 2026"), capturado em datesSet e
  // exibido na linha de navegação própria (Dia/Mês — a Lista não pagina).
  const [tituloAtual, setTituloAtual] = useState("");

  // Intervalo de datas REALMENTE renderizado pela grade atual (inclui os dias
  // de "preenchimento" do mês anterior/seguinte na view Mês), capturado em
  // datesSet — é o que baliza a busca de ausências abaixo. `fimExclusivo`
  // segue a mesma convenção do FullCalendar (arg.end): um dia DEPOIS do
  // último visível. null até o primeiro datesSet (chega rápido, ainda na
  // montagem).
  const [rangeVisivel, setRangeVisivel] = useState(null);

  // Ausências (tabela `ausencias`) dos profissionais ativos deste
  // estabelecimento, cruas do banco — expandidas em blocos por dia em
  // `eventosAusencia` abaixo. Buscadas de novo a cada troca de período
  // visível (ver efeito abaixo), mesmo padrão de busca por período já usado
  // pra agendamentos em outras telas (.gte/.lte sobre a coluna de data — ver
  // buscarHistoricoRecente em lib/agendamentosCliente.js).
  const [ausencias, setAusencias] = useState([]);

  // Expediente configurado de cada profissional ATIVO (dia_semana com
  // horário, por modo — mesma fonte que diasSemanaAtivos usa em
  // FormularioAgendamento.js e no modal "Alterar data" de page.js): Map
  // profissional_id -> Set<dia_semana>. Alimenta só a aproximação "sem vaga"
  // da view Mês (ver diasSemVagas abaixo) — NÃO é vaga a vaga (sem serviço
  // âncora no Painel, seria caro demais rodar por dia visível). Refeita só
  // quando a lista de profissionais ativos mudar, não a cada troca de mês.
  const [expedientePorProfissional, setExpedientePorProfissional] = useState(
    new Map()
  );

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

  // Pula direto pra data recebida via ?data= (ver dataInicial acima), uma
  // única vez no mount — abrir de novo a mesma aba Painel sem esse
  // parâmetro (ex.: clicando na aba "Painel" do menu) volta a abrir em
  // hoje normalmente, já que o efeito não roda de novo.
  useEffect(() => {
    if (!dataInicial) return;
    irParaAbaDiaEm(dataInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Nome por profissional (ver profissionaisDisponiveis acima) — usado só pro
  // rótulo dos blocos de ausência (eventosAusencia), pra dona saber QUEM está
  // ausente quando o filtro é "Todos".
  const nomePorProfissional = useMemo(
    () => new Map(profissionaisDisponiveis.map((p) => [p.id, p.nome])),
    [profissionaisDisponiveis]
  );

  // Busca as ausências dos profissionais ativos que se aplicam ao período
  // REALMENTE visível na grade (rangeVisivel, ver datesSet) — refeita a cada
  // troca de período (prev/next/Hoje/troca de aba), não uma vez só. Registros
  // `recorrente` (dia_semana) não têm coluna de data — valem pra QUALQUER
  // período, então entram sempre; só os `periodo` (data_inicio/data_fim) são
  // filtrados pelo intervalo, via .or() combinando as duas naturezas numa
  // única query (evita duas idas ao banco). Backend só filtra por
  // profissional + período; a expansão dia a dia (recorrente vs. periodo,
  // dia_inteiro vs. faixa de hora) acontece em memória em eventosAusencia,
  // abaixo — mesmo espírito de excecoesDoDia em lib/disponibilidade.js.
  useEffect(() => {
    // Guarda sem reset explícito de `ausencias`: só fica vazio aqui ANTES do
    // primeiro datesSet/carga de profissionais (quando `ausencias` já nasce
    // [] por padrão) — depois disso, estabelecimentoId/rangeVisivel não
    // voltam a ficar vazios em condições normais de uso.
    if (!estabelecimentoId || !rangeVisivel || profissionaisDisponiveis.length === 0) {
      return;
    }
    let ativo = true;

    (async () => {
      const ids = profissionaisDisponiveis.map((p) => p.id);
      const { data, error } = await supabase
        .from("ausencias")
        .select(
          "id, profissional_id, tipo, tipo_registro, dia_semana, data_inicio, data_fim, dia_inteiro, hora_inicio, hora_fim, motivo"
        )
        .in("profissional_id", ids)
        .or(
          `tipo.eq.recorrente,and(data_inicio.lt.${rangeVisivel.fimExclusivo},data_fim.gte.${rangeVisivel.inicio})`
        );
      if (ativo) setAusencias(error ? [] : data ?? []);
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimentoId, profissionaisDisponiveis, rangeVisivel]);

  // Busca o expediente (ver `expedientePorProfissional` acima) dos
  // profissionais ativos: 1 query só, não por dia/mês. `dia_semana` vem de
  // `horarios_trabalho` (modo 'janela') ou `horarios_fixos` (modo 'fixo'),
  // por profissional. Refeita quando a lista de profissionais ativos mudar
  // (mesmo gatilho de `profissionaisDisponiveis` já usado pela busca de
  // ausências acima).
  useEffect(() => {
    if (profissionaisDisponiveis.length === 0) {
      setExpedientePorProfissional(new Map());
      return;
    }
    let ativo = true;

    (async () => {
      const ids = profissionaisDisponiveis.map((p) => p.id);
      const { data, error } = await supabase
        .from("profissionais")
        .select(
          "id, modo_horario, horarios_trabalho(dia_semana), horarios_fixos(dia_semana)"
        )
        .in("id", ids);
      if (!ativo) return;
      if (error || !data) {
        setExpedientePorProfissional(new Map());
        return;
      }
      setExpedientePorProfissional(
        new Map(
          data.map((p) => {
            const linhas =
              p.modo_horario === "fixo" ? p.horarios_fixos : p.horarios_trabalho;
            return [p.id, new Set((linhas ?? []).map((h) => h.dia_semana))];
          })
        )
      );
    })();

    return () => {
      ativo = false;
    };
  }, [profissionaisDisponiveis]);

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
  const eventosAgendamentos = useMemo(
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
          // (ocupação a tratar no Inbox). Bloco pessoal importado (ver
          // CORES_EVENTO acima) → cinza-azulado, só o título bruto, sem selo.
          // Confirmado sem telefone (importado do Google Calendar, ainda sem
          // cliente vinculado) → âmbar, rótulo pede pra vincular. Caso
          // contrário, confirmado normal (verde).
          const pendente = classificarAgendamento(a) === "inbox";
          const pessoal = !pendente && a.origem === "importado_pessoal";
          const naoVinculado = !pendente && !pessoal && !a.telefone;
          const cor = pendente
            ? CORES_EVENTO.pendente
            : pessoal
            ? CORES_EVENTO.pessoal
            : naoVinculado
            ? CORES_EVENTO.naoVinculado
            : CORES_EVENTO.confirmado;
          const inicioMin = horaParaMin(a.horario);
          const duracao = a.duracao_min ?? a.servicos?.duracao_min;
          return {
            id: String(a.id),
            title: pendente
              ? "Pendente"
              : pessoal
              ? a.nome_cliente
              : naoVinculado
              ? `${a.nome_cliente} · Vincular cliente`
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
              // Bloco pessoal importado (ver acima) — eventContent mostra só o
              // título bruto (sem selo) e eventClick não abre nenhum modal.
              pessoal,
              // Confirmado importado sem cliente vinculado (ver acima) — o
              // eventContent troca o rótulo pelo pill "Vincular cliente" e o
              // eventClick abre o modal de vínculo em vez do de detalhe.
              naoVinculado,
              // Valores crus do mesmo par usado no `title`, p/ abreviar no rótulo.
              nome_cliente: a.nome_cliente,
              servico: a.servicos?.nome ?? a.servico_livre ?? "serviço",
            },
          };
        }),
    [agendamentos, filtroProfissional]
  );

  // Expande as ausências cruas (ver efeito acima) em UM BLOCO POR DIA dentro
  // do range visível: `recorrente` casa pelo dia da semana, `periodo` pelo
  // intervalo data_inicio..data_fim (comparação lexicográfica ISO, sem
  // construir Date — mesmo padrão de excecoesDoDia em lib/disponibilidade.js).
  // Só `tipo_registro === "ausencia"` entra aqui — `liberacao` é o OPOSTO de
  // uma ausência (abre horário extra), mostrá-la como bloqueio confundiria a
  // dona. `dia_inteiro` usa o expediente configurado (HORA_ABERTURA/
  // HORA_FECHAMENTO) como faixa visual; senão, a faixa hora_inicio/hora_fim
  // do próprio registro. `classNames` aplica o padrão de listras diagonais
  // (ver .ag-evento-ausencia-bloco em app/globals.css) — visualmente distinto
  // de qualquer agendamento real, mesmo tendo a mesma cor de base do
  // "pendente".
  const eventosAusencia = useMemo(() => {
    if (!rangeVisivel) return [];
    const relevantes = ausencias.filter(
      (a) => (a.tipo_registro ?? "ausencia") === "ausencia"
    );
    if (relevantes.length === 0) return [];

    const lista = [];
    const [ai, mi, di] = rangeVisivel.inicio.split("-").map(Number);
    const [af, mf, df] = rangeVisivel.fimExclusivo.split("-").map(Number);
    const fim = new Date(af, mf - 1, df);

    for (
      let cursor = new Date(ai, mi - 1, di);
      cursor < fim;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    ) {
      const iso = paraISOLocal(cursor);
      const diaSemana = cursor.getDay();

      for (const a of relevantes) {
        if (
          filtroProfissional !== "todos" &&
          String(a.profissional_id) !== filtroProfissional
        ) {
          continue;
        }

        const aplica =
          a.tipo === "recorrente"
            ? a.dia_semana === diaSemana
            : a.data_inicio <= iso && iso <= a.data_fim;
        if (!aplica) continue;

        const horaInicio = a.dia_inteiro ? HORA_ABERTURA : a.hora_inicio;
        const horaFim = a.dia_inteiro ? HORA_FECHAMENTO : a.hora_fim;
        const nome = nomePorProfissional.get(a.profissional_id) ?? "Profissional";

        lista.push({
          id: `ausencia-${a.id}-${iso}`,
          title: a.motivo ? `Ausência · ${nome} · ${a.motivo}` : `Ausência · ${nome}`,
          start: `${iso}T${paraHoraCompleta(horaInicio)}`,
          end: `${iso}T${paraHoraCompleta(horaFim)}`,
          backgroundColor: CORES_EVENTO.ausencia.fundo,
          borderColor: CORES_EVENTO.ausencia.borda,
          textColor: CORES_EVENTO.ausencia.texto,
          classNames: ["ag-evento-ausencia-bloco"],
          extendedProps: {
            ausencia: true,
            ausenciaRecorrente: a.tipo === "recorrente",
            motivo: a.motivo ?? "",
            profissionalNome: nome,
            diaInteiro: Boolean(a.dia_inteiro),
          },
        });
      }
    }
    return lista;
  }, [ausencias, rangeVisivel, filtroProfissional, nomePorProfissional]);

  // Dias (dentro do range visível) sem vaga possível — aproximação, não
  // lotação real (ver `expedientePorProfissional` acima; não olha
  // `agendamentos` nenhum). Um dia entra no Set por dois motivos:
  // (1) já é PASSADO (antes de hoje, comparado por data local — mesmo
  //     cuidado de fuso do resto do projeto, componente a componente, nunca
  //     string): sempre entra, incondicional, mesmo sem `ausencias`/
  //     `expedientePorProfissional` carregados ainda e mesmo sem nenhum
  //     profissional relevante.
  // (2) hoje/futuro, mas NENHUM profissional do filtro ativo tem expediente
  //     pra aquele dia da semana, ou o(s) que teria(m) está(ão) de ausência
  //     `dia_inteiro` (recorrente ou período — mesma fonte crua de
  //     `ausencias`) cobrindo justamente essa data. Só é avaliado depois que
  //     `expedientePorProfissional` carrega (evita marcar tudo de vermelho
  //     no flash inicial, antes da query resolver).
  // Alimenta só `dayCellClassNames` da view Mês (ver <FullCalendar> abaixo).
  const diasSemVagas = useMemo(() => {
    if (!rangeVisivel) return new Set();

    const agora = new Date();
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

    const idsRelevantes = profissionaisDisponiveis
      .map((p) => p.id)
      .filter(
        (id) => filtroProfissional === "todos" || String(id) === filtroProfissional
      );

    const ausenciasDiaInteiro = ausencias.filter(
      (a) => (a.tipo_registro ?? "ausencia") === "ausencia" && a.dia_inteiro
    );

    const resultado = new Set();
    const [ai, mi, di] = rangeVisivel.inicio.split("-").map(Number);
    const [af, mf, df] = rangeVisivel.fimExclusivo.split("-").map(Number);
    const fim = new Date(af, mf - 1, df);

    for (
      let cursor = new Date(ai, mi - 1, di);
      cursor < fim;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    ) {
      const iso = paraISOLocal(cursor);

      if (cursor < hoje) {
        resultado.add(iso);
        continue;
      }

      if (expedientePorProfissional.size === 0 || idsRelevantes.length === 0) continue;

      const diaSemana = cursor.getDay();
      const algumTrabalha = idsRelevantes.some((id) => {
        const dias = expedientePorProfissional.get(id);
        if (!dias || !dias.has(diaSemana)) return false;
        const ausenteHoje = ausenciasDiaInteiro.some((a) => {
          if (a.profissional_id !== id) return false;
          return a.tipo === "recorrente"
            ? a.dia_semana === diaSemana
            : a.data_inicio <= iso && iso <= a.data_fim;
        });
        return !ausenteHoje;
      });

      if (!algumTrabalha) resultado.add(iso);
    }
    return resultado;
  }, [
    rangeVisivel,
    expedientePorProfissional,
    profissionaisDisponiveis,
    filtroProfissional,
    ausencias,
  ]);

  // Array combinado que alimenta o calendário: agendamentos + blocos de
  // ausência. slotMinTime/slotMaxTime (abaixo) e eventosExibidos (Lista)
  // enxergam os dois juntos, sem duplicar lógica.
  const eventos = useMemo(
    () => [...eventosAgendamentos, ...eventosAusencia],
    [eventosAgendamentos, eventosAusencia]
  );

  // Lista (listaAgenda) só mostra CONFIRMADOS — pendentes ficam de fora dessa
  // view (continuam normalmente em Dia/Mês, tratados no Inbox). Mês e Lista
  // também ocultam ausências recorrentes (dia_semana): elas repetem o mesmo
  // padrão em todo dia da semana correspondente e só poluiriam o badge
  // "Ausente"/a lista sem agregar informação — só a view Dia continua
  // mostrando normalmente. Demais casos usam o array cheio de `eventos`.
  const eventosExibidos = useMemo(() => {
    if (viewAtual.startsWith("list")) {
      return eventos.filter(
        (ev) => !ev.extendedProps.pendente && !ev.extendedProps.ausenciaRecorrente
      );
    }
    if (viewAtual === "dayGridMonth") {
      return eventos.filter((ev) => !ev.extendedProps.ausenciaRecorrente);
    }
    return eventos;
  }, [eventos, viewAtual]);

  // slotMinTime/slotMaxTime (Dia/Semana) dinâmicos: começam no expediente
  // configurado (HORA_ABERTURA/HORA_FECHAMENTO), mas expandem pra sempre
  // incluir qualquer agendamento ATIVO já carregado fora dessa janela (ex.:
  // evento importado do Google Calendar às 8h com abertura configurada às
  // 9h) — não altera o expediente configurado, só garante que a grade visual
  // mostre a ocupação real. Baseado em `eventos` (já filtrado por
  // profissional e sem histórico), não no `agendamentos` cru.
  const [slotMinTime, slotMaxTime] = useMemo(() => {
    let minMin = horaParaMin(HORA_ABERTURA);
    let maxMin = horaParaMin(HORA_FECHAMENTO);
    for (const ev of eventos) {
      const inicioMin = horaParaMin(ev.start.slice(11, 19));
      if (inicioMin < minMin) minMin = inicioMin;
      const fimMin = ev.end ? horaParaMin(ev.end.slice(11, 19)) : inicioMin;
      if (fimMin > maxMin) maxMin = fimMin;
    }
    return [minParaHora(minMin), minParaHora(maxMin)];
  }, [eventos]);

  return (
    <div>
      {/* Filtro "Ver agenda de": Todos + cada profissional presente nos
          agendamentos. Filtra os eventos em memória (padrão Todos). Com 1 só
          profissional ativo, não faz sentido escolher entre "Todos" e ele
          mesmo — o painel já é implicitamente dele. */}
      {profissionaisDisponiveis.length > 1 && (
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
      )}

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
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={ptBrLocale}
          initialView="timeGridDay"
          views={{ listaAgenda: { type: "list", duration: { years: 1 } } }}
          headerToolbar={false}
          footerToolbar={false}
          allDaySlot={false}
          slotMinTime={slotMinTime}
          slotMaxTime={slotMaxTime}
          slotDuration="00:30:00"
          nowIndicator
          expandRows
          height="auto"
          dayMaxEvents
          eventTimeFormat={FORMATO_24H}
          slotLabelFormat={FORMATO_24H}
          events={eventosExibidos}
          dayCellClassNames={(arg) => {
            // Só a view Mês tem célula de dia no sentido usado aqui — evita
            // rodar a checagem em qualquer outro contexto de dayCell.
            if (arg.view.type !== "dayGridMonth") return [];
            return diasSemVagas.has(paraISOLocal(arg.date))
              ? ["ag-dia-sem-vagas"]
              : [];
          }}
          datesSet={(arg) => {
            setViewAtual(arg.view.type);
            setTituloAtual(arg.view.title);
            // Range REALMENTE renderizado (inclui os dias de preenchimento do
            // mês vizinho, na view Mês) — baliza a busca de ausências acima.
            setRangeVisivel({
              inicio: paraISOLocal(arg.start),
              fimExclusivo: paraISOLocal(arg.end),
            });
          }}
          eventContent={(arg) => {
            // Bloco de ausência (ver eventosAusencia acima): rótulo e
            // aparência PRÓPRIOS, checados antes de qualquer ramo de
            // agendamento — nunca tem `extendedProps.agendamento`, então não
            // pode cair nos ramos abaixo (que leem nome_cliente/servico).
            if (arg.event.extendedProps.ausencia) {
              const { motivo, profissionalNome, diaInteiro } = arg.event.extendedProps;
              if (arg.view.type === "dayGridMonth") {
                return (
                  <div
                    className="ag-evento-mes ag-evento-mes-ausencia"
                    style={{
                      backgroundColor: arg.event.backgroundColor,
                      color: arg.event.textColor,
                    }}
                  >
                    Ausente
                  </div>
                );
              }
              const rotulo = `Ausência · ${profissionalNome}${motivo ? ` · ${motivo}` : ""}`;
              if (arg.view.type.startsWith("list")) return rotulo;
              const hora = diaInteiro
                ? "Dia inteiro"
                : `${hhmm(arg.event.start)} - ${hhmm(arg.event.end)}`;
              return (
                <div className="ag-evento">
                  <span className="ag-evento-titulo">{rotulo}</span>{" "}
                  <span className="ag-evento-hora">- {hora}</span>
                </div>
              );
            }
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
            // Não vinculado: troca o serviço pelo pill "Vincular cliente" —
            // todo o bloco já é clicável (ver eventClick), o pill é só o
            // rótulo/CTA visual.
            if (arg.view.type.startsWith("list")) {
              if (arg.event.extendedProps.pendente) return "Pendente";
              if (arg.event.extendedProps.pessoal) return arg.event.extendedProps.nome_cliente;
              if (arg.event.extendedProps.naoVinculado) {
                return (
                  <span>
                    {arg.event.extendedProps.nome_cliente}{" "}
                    <span className="ag-pill-vincular">Vincular cliente</span>
                  </span>
                );
              }
              return `${arg.event.extendedProps.nome_cliente} - ${arg.event.extendedProps.servico}`;
            }
            // Dia (timeGrid), única view restante: mantém o rótulo abreviado de sempre.
            const hora = `${hhmm(arg.event.start)} - ${hhmm(arg.event.end)}`;
            // Ocupação pendente: rótulo curto "Pendente", sem expor o cliente —
            // o atendimento é tratado no Inbox, não aqui. Bloco pessoal: só o
            // título bruto, sem abreviar nem selo. Não vinculado: nome +
            // "Vincular cliente" no lugar do serviço (ainda não tem um).
            const titulo = arg.event.extendedProps.pendente
              ? "Pendente"
              : arg.event.extendedProps.pessoal
              ? arg.event.extendedProps.nome_cliente
              : arg.event.extendedProps.naoVinculado
              ? `${abreviarNome(arg.event.extendedProps.nome_cliente)} - Vincular cliente`
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
            // Bloco de ausência: só ocupação visual, sem ação nenhuma — não
            // tem `extendedProps.agendamento` (classificarAgendamento abaixo
            // quebraria em cima de undefined).
            if (info.event.extendedProps.ausencia) return;
            // Nas demais views (Dia/Lista): o pendente (cinza) não abre modal
            // de detalhe aqui — ele é tratado no Inbox (aba Pendentes). Em vez
            // de ficar inerte, o clique navega direto pro card certo lá (ver
            // onSelecionarPendente -> page.js: setViewPai("pendentes") +
            // scrollIntoView/destaque temporário). Bloco pessoal (cinza-azulado)
            // também é só ocupação, sem selo — mas continua clicável pra
            // correção pontual (a regra por colorId erra às vezes): um
            // window.confirm (mesmo padrão de correção pontual usado em
            // GerenciarProfissionais) e, se confirmado, origem volta pra
            // 'importado' — o bloco vira o pill âmbar normal de "Vincular
            // cliente" na próxima renderização. Confirmado sem cliente
            // vinculado (âmbar) abre o modal de vínculo em vez do de detalhe —
            // o de detalhe pressupõe telefone (WhatsApp de lembrete/cancelamento)
            // e ainda não há um. Confirmado normal abre o modal de detalhe/
            // ações de sempre (leva B.2). O calendário apenas sinaliza a
            // seleção; estado/handlers ficam no /admin.
            const item = info.event.extendedProps.agendamento;
            if (info.event.extendedProps.pendente) {
              onSelecionarPendente?.(item);
              return;
            }
            if (classificarAgendamento(item) !== "confirmado") return;
            if (info.event.extendedProps.pessoal) {
              const ok = window.confirm(
                `Marcar "${item.nome_cliente}" como atendimento? O bloco passa a pedir vínculo de cliente.`
              );
              if (ok) onMarcarComoAtendimento?.(item);
              return;
            }
            if (info.event.extendedProps.naoVinculado) {
              onVincularCliente?.(item);
              return;
            }
            onSelecionarConfirmado?.(item);
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
