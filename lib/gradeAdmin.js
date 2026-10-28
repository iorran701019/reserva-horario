import {
  CLASSE_GRADE_ACRESCIMO,
  chaveGradeComAcrescimo,
  ehDomingoISO,
  horarioTemAcrescimo,
} from "./acrescimoDomingo.js";

// Rótulos pt-BR dos `motivo` que calcularVagasPorHorario/filtrarPorAntecedenciaMinima
// anotam no formato enriquecido (contexto='admin') — usado só pelo tooltip da
// grade do dia inteiro do admin (Agendar e Alterar).
export const ROTULOS_MOTIVO_BLOQUEIO = {
  excecao_ausencia: "ausência cadastrada",
  exclusividade_servico: "serviço restrito a outros horários (restrição de serviço)",
  fora_do_modo: "fora do expediente/modo configurado",
  antecedencia: "fora da antecedência mínima do salão",
};

// Visual de cada estado da grade do admin. Só tokens/escalas de tema (o
// noturno remapeia as escalas em globals.css), nunca hex. `rotulo` é o texto
// curto dentro do quadrado (null = sem texto); `legenda` é o nome na legenda
// acima da grade. Nenhum estado usa ring junto de borda tracejada.
export const ESTADOS_GRADE_ADMIN = {
  livre: {
    legenda: "Disponível",
    rotulo: null,
    classe: "grade-livre border-2 border-heading/60 bg-white font-semibold text-heading",
  },
  foraDoModo: {
    legenda: "Fora do expediente",
    rotulo: null,
    classe: "grade-fora border-2 border-dashed border-heading/50 bg-white text-heading",
  },
  liberacao: {
    legenda: "Horário aberto por você",
    rotulo: null,
    classe: "border-2 border-blue-300 bg-blue-50 text-on-card",
  },
  ausencia: {
    legenda: "Ausência",
    rotulo: "Ausência",
    classe: "border-[3px] border-rose-300 bg-gray-100 text-body",
  },
  exclusividade: {
    legenda: "Restrição de serviço",
    rotulo: "Restrição",
    classe: "border-[3px] border-rose-300 bg-gray-100 text-body",
  },
  antecedencia: {
    legenda: "Antecedência",
    rotulo: "Antecedência",
    classe: "border-2 border-amber-300 bg-amber-50 text-on-card",
  },
  // Mesmo visual do dia com acréscimo no calendário (borda escura + âmbar 100).
  acrescimo: {
    legenda: "Com acréscimo de domingo",
    rotulo: null,
    classe: CLASSE_GRADE_ACRESCIMO,
  },
  ocupado: {
    legenda: "Ocupado",
    rotulo: null,
    classe: "border-2 border-heading/40 bg-slate-200 text-body",
  },
};

// Status de `agendamentos` que ocupam o horário (rotulam o quadrado "Ocupado").
export const STATUS_OCUPAM_HORARIO = ["confirmado", "pendente", "aguardando_sinal", "concluido"];

export function minutosDoHorario(horario) {
  const [h, m] = String(horario ?? "").split(":").map(Number);
  return h * 60 + (m || 0);
}

// motivo (disponibilidade.js) -> chave de ESTADOS_GRADE_ADMIN.
export const CHAVE_POR_MOTIVO = {
  excecao_ausencia: "ausencia",
  exclusividade_servico: "exclusividade",
  antecedencia: "antecedencia",
  fora_do_modo: "foraDoModo",
};

function isoLocal(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// true quando `data` é HOJE (relógio de `agora`) e `horario` ("HH:MM") já
// começou. Só esconde esses slots da grade do dia inteiro; dias que não são
// hoje sempre retornam false.
export function horarioJaPassouHoje(data, horario, agora = new Date()) {
  if (data !== isoLocal(agora)) return false;
  const [h, m] = horario.split(":").map(Number);
  const alvo = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), h, m);
  return alvo.getTime() < agora.getTime();
}

// Classifica CADA horário do mapa filtrado pela antecedência (formato
// enriquecido de calcularVagasPorHorario, contexto='admin') para o
// profissional alvo (null = qualquer: encaixe automático). A marca de
// acréscimo é lida do mapa CRU (`vagasCru`: o filtrado perde a propriedade não
// enumerável), só em domingo, como o banco exige. Devolve
// [{ horario, status, chave, motivo?, agendamentoId?, rotuloOcupado? }].
export function montarGradeAdmin({
  vagasCru,
  vagasFiltradas,
  data,
  profissionalId,
  liberacoes,
  agendamentosDoDia,
  agora = new Date(),
}) {
  // Horários "HH:MM" abertos por uma liberação cobrindo `data` (a liberação
  // entra em `livres` no motor, sem marca).
  const horariosDeLiberacaoDoDia = new Set(
    data
      ? (liberacoes ?? [])
          .filter(
            (a) =>
              a.hora_inicio &&
              !a.dia_inteiro &&
              a.data_inicio <= data &&
              data <= a.data_fim
          )
          .map((a) => String(a.hora_inicio).slice(0, 5))
      : []
  );
  const idAlvo = profissionalId ?? null;

  return Object.keys(vagasFiltradas ?? {})
    .sort()
    .map((horario) => {
      const entrada = vagasFiltradas[horario];
      const temAcrescimo = ehDomingoISO(data) && horarioTemAcrescimo(vagasCru, horario, idAlvo);
      const livre = () => ({
        horario,
        status: "livre",
        chave: chaveGradeComAcrescimo(
          horariosDeLiberacaoDoDia.has(horario) ? "liberacao" : "livre",
          temAcrescimo
        ),
      });
      const bloqueadoPor = (motivo) => ({
        horario,
        status: "bloqueado",
        motivo,
        chave: CHAVE_POR_MOTIVO[motivo] ?? "foraDoModo",
      });
      // Casa o intervalo ocupado com o agendamento do Painel (mesmo
      // profissional e mesmo início). Sem correspondência: Ocupado sem rótulo
      // e sem id (clique inerte).
      const ocupadoPor = (oc) => {
        const ag = (agendamentosDoDia ?? []).find(
          (a) =>
            a.data === data &&
            a.profissional_id === oc.profissionalId &&
            STATUS_OCUPAM_HORARIO.includes(a.status) &&
            minutosDoHorario(a.horario) === oc.inicio
        );
        const nomeServico = ag?.servicos?.nome ?? ag?.servico_livre ?? null;
        return {
          horario,
          status: "ocupado",
          chave: "ocupado",
          agendamentoId: ag?.id ?? null,
          rotuloOcupado: ag
            ? [ag.nome_cliente, nomeServico].filter(Boolean).join(" · ")
            : null,
        };
      };
      const ocupados = entrada.ocupados ?? [];
      if (idAlvo != null) {
        const oc = ocupados.find((o) => o.profissionalId === idAlvo);
        if (oc) return ocupadoPor(oc);
        if (entrada.livres.includes(idAlvo)) return livre();
        const bloqueio = entrada.bloqueados.find((b) => b.profissionalId === idAlvo);
        return bloqueio ? bloqueadoPor(bloqueio.motivo) : null;
      }
      if (entrada.livres.length > 0) return livre();
      if (entrada.bloqueados.length > 0) {
        return bloqueadoPor(entrada.bloqueados[0].motivo);
      }
      if (ocupados.length > 0) return ocupadoPor(ocupados[0]);
      return null;
    })
    .filter(Boolean)
    .filter(({ horario }) => !horarioJaPassouHoje(data, horario, agora));
}

// Só "fora do expediente" fica recolhido por padrão. O horário selecionado
// nunca é escondido. Expandido, a faixa 05:00–22:00 aparece inteira; fora dela
// só entra quem tem regra (itens visíveis, sempre renderizados).
export function separarGradeAdmin(grade, horarioSelecionado) {
  const visiveis = grade.filter(
    (g) => g.chave !== "foraDoModo" || g.horario === horarioSelecionado
  );
  const recolhidos = grade.filter(
    (g) =>
      g.chave === "foraDoModo" &&
      g.horario !== horarioSelecionado &&
      g.horario >= "05:00" &&
      g.horario <= "22:00"
  );
  const selecionadoNoRecolhido = grade.some(
    (g) => g.chave === "foraDoModo" && g.horario === horarioSelecionado
  );
  return { visiveis, recolhidos, selecionadoNoRecolhido };
}

// `aberto`: a dona pediu "Ver outros horários" para este dia. Expande também
// quando não há nada visível ou o selecionado está entre os recolhidos.
export function exibirGradeAdmin({ visiveis, recolhidos, selecionadoNoRecolhido, aberto }) {
  const expandido =
    recolhidos.length > 0 &&
    (Boolean(aberto) || visiveis.length === 0 || selecionadoNoRecolhido);
  const exibida = expandido
    ? [...visiveis, ...recolhidos].sort((a, b) => a.horario.localeCompare(b.horario))
    : visiveis;
  return { expandido, exibida };
}
