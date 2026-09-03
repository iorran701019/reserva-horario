import { supabase } from "@/lib/supabaseClient";
import { gerarSlotsDaJanela, DURACAO_MINUTOS, GRANULARIDADE_MIN } from "@/lib/horarios";
import {
  dentroDaJanelaAgendamento,
  diaLiberadoPorEtiqueta,
} from "@/lib/janelaAgendamento";

// Disponibilidade POR PROFISSIONAL de um serviço numa data.
//
// Diferente de lib/horarios.js (grade única da loja), aqui cada profissional
// tem a SUA agenda para o dia da semana, e a vaga de um horário depende de
// quem, entre os que atendem o serviço, ainda está livre naquele instante. O
// resultado é um mapa horário → profissionais livres, que a UI de
// agendamento usa depois para oferecer/atribuir.
//
// Cada profissional trabalha num de dois MODOS (profissionais.modo_horario):
//   'janela' – janela contínua de trabalho (horarios_trabalho), com os
//              candidatos gerados de granularidade_min em granularidade_min
//              (gerarSlotsDaJanela).
//   'fixo'   – lista fechada de horários (horarios_fixos): cada linha do dia
//              é um candidato, sem geração por passo.
// Em ambos os modos, os candidatos passam pelas exceções de `ausencias`:
// tipo_registro='ausencia' REMOVE horário(s) da lista; tipo_registro=
// 'liberacao' ADICIONA um horário extra, mesmo fora da janela/lista normal.
//
// Função PURA de LEITURA: só consulta o banco, nunca escreve.

// "YYYY-MM-DD" -> dia da semana LOCAL (0=domingo … 6=sábado). Mesma construção
// componente-a-componente de lib/horarios.js, que evita o deslocamento de fuso
// de new Date("YYYY-MM-DD") (interpretado como UTC).
function diaDaSemana(data) {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(ano, mes - 1, dia).getDay();
}

// "HH:MM" ou "HH:MM:SS" -> minutos desde a meia-noite. Colunas `time` do
// Postgres chegam como "HH:MM:SS"; só os dois primeiros campos importam.
function horaParaMin(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// "HH:MM:SS"/"HH:MM" -> "HH:MM", pra usar como chave do mapa de vagas.
function paraHHMM(hora) {
  return String(hora).slice(0, 5);
}

// Minutos desde a meia-noite -> "HH:MM". Inverso de horaParaMin; usado só
// pela grade "dia inteiro" do contexto='admin' (ver calcularVagasPorHorario).
function minParaHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "YYYY-MM-DD" + "HH:MM" -> Date em horário LOCAL. Mesma construção
// componente-a-componente do resto do app (evita o deslocamento de fuso de
// interpretar a string como UTC).
function construirDataHora(data, horario) {
  const [ano, mes, dia] = data.split("-").map(Number);
  const [h, m] = horario.split(":").map(Number);
  return new Date(ano, mes - 1, dia, h, m);
}

// Date -> "YYYY-MM-DD" em horário LOCAL.
function paraISO(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Exceções de `ausencias` que valem NESTA data: recorrente casa pelo dia da
// semana, periodo casa pelo intervalo data_inicio..data_fim (comparação
// lexicográfica ISO, sem construir Date).
function excecoesDoDia(ausencias, dia, data) {
  return (ausencias ?? []).filter((a) => {
    if (a.tipo === "recorrente") return a.dia_semana === dia;
    if (a.tipo === "periodo") return a.data_inicio <= data && data <= a.data_fim;
    return false;
  });
}

// Aplica as exceções de um profissional sobre o conjunto de candidatos DELE
// (mutação in-place do Set), em DOIS PASSES determinísticos — o resultado não
// pode depender da ordem em que os registros chegam do banco (a query não tem
// ORDER BY, então essa ordem não é garantida):
//   PASSO 1 — todas as liberações: cada uma adiciona hora_inicio como
//             candidato extra (ignora dia_inteiro, que não faz sentido pra
//             liberação de um horário específico).
//   PASSO 2 — todas as ausências, sempre DEPOIS do passo 1: dia_inteiro limpa
//             o conjunto inteiro; senão remove só os candidatos cujo horário
//             cai dentro de [hora_inicio, hora_fim). Assim um bloqueio sempre
//             vence uma liberação no mesmo dia, não importa qual registro foi
//             criado primeiro.
function aplicarExcecoes(conjunto, excecoes, duracaoMin) {
  for (const ex of excecoes) {
    const tipoRegistro = ex.tipo_registro ?? "ausencia";
    if (tipoRegistro !== "liberacao") continue;
    if (ex.dia_inteiro || !ex.hora_inicio) continue;
    conjunto.add(paraHHMM(ex.hora_inicio));
  }

  for (const ex of excecoes) {
    // tipo_registro === "ausencia" (default, cobre linhas antigas sem a coluna).
    if ((ex.tipo_registro ?? "ausencia") === "liberacao") continue;

    if (ex.dia_inteiro) {
      conjunto.clear();
      continue;
    }
    if (!ex.hora_inicio || !ex.hora_fim) continue;
    const exIni = horaParaMin(ex.hora_inicio);
    const exFim = horaParaMin(ex.hora_fim);
    for (const slot of [...conjunto]) {
      const slotIni = horaParaMin(slot);
      const slotFim = slotIni + duracaoMin;
      if (slotIni < exFim && exIni < slotFim) conjunto.delete(slot);
    }
  }
}

// --- Núcleo compartilhado por calcularVagasPorHorario (um dia) e
// --- calcularVagasDoMes (o mês inteiro de uma vez).
//
// A divisão segue o que de fato depende da DATA: de todas as consultas que a
// disponibilidade precisa, só a de `agendamentos` é por dia — as outras
// (estabelecimento, profissionais do serviço, grades de trabalho, horários
// fixos, ausências) dependem no máximo do DIA DA SEMANA. Por isso elas são
// carregadas UMA vez por (estabelecimento, serviço) em
// carregarBaseDisponibilidade e reaproveitadas dia a dia por candidatosDoDia
// e montarMapaDoDia, que são funções PURAS (nenhum acesso ao banco). É o que
// permite calcular um mês inteiro com o mesmo número de consultas de um único
// dia, em vez de repetir tudo 30 vezes.

// Restrições de agenda por etiqueta ATIVAS do salão (ver
// diaLiberadoPorEtiqueta em lib/janelaAgendamento.js, que é quem aplica a
// regra). Consulta INDEPENDENTE da data — o filtro de período acontece em
// memória, dia a dia, exatamente como excecoesDoDia faz com `ausencias`.
//
// Erro de consulta devolve [] de propósito: sem restrição carregada nenhum dia
// é bloqueado por esta regra. É a mesma escolha de dentroDaJanelaAgendamento
// com janela nula — uma falha de leitura não pode fechar a agenda inteira.
// Exportada porque o calendário do wizard (FormularioAgendamento) precisa das
// MESMAS linhas pra cinzar os dias antes de qualquer clique.
export async function buscarRestricoesAtivas(estabelecimentoId) {
  if (!estabelecimentoId) return [];

  const { data, error } = await supabase
    .from("restricoes_agenda")
    .select("id, nome, data_inicio, data_fim, etiqueta_liberada_id, abre_para_todos_em, ativa")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("ativa", true);

  if (error) return [];
  return data ?? [];
}

// Consultas INDEPENDENTES da data. Devolve tudo o que candidatosDoDia e
// montarMapaDoDia precisam:
//   estab           – { granularidade_min, janela_agendamento_fim }
//   granularidade   – passo da grade no modo 'janela' (minutos)
//   duracao         – duração efetiva do serviço (minutos)
//   profissionalIds – profissionais ATIVOS do salão que atendem o serviço
//   gradesPorDia    – Map dia_semana -> linhas de horarios_trabalho ('janela')
//   fixosPorDia     – Map dia_semana -> linhas de horarios_fixos ('fixo')
//   ausenciasRows   – exceções (bloqueio/liberação) de todos eles, sem filtro
//                     de data (excecoesDoDia filtra em memória, por dia)
//   restricoes      – restrições de agenda por etiqueta ATIVAS do salão, sem
//                     filtro de data (diaLiberadoPorEtiqueta filtra em
//                     memória, por dia — ver buscarRestricoesAtivas acima)
//   etiquetaClienteId – etiqueta da cliente que está agendando (null quando
//                     não há cliente identificado), guardada na base pra que
//                     calcularVagasDoMes possa aplicar a regra dia a dia mesmo
//                     recebendo uma base já pronta
//
// `dataParaJanela` (opcional) preserva o curto-circuito que existia antes de
// qualquer consulta pesada: quando a data pedida está além de
// janela_agendamento_fim, devolve `foraDaJanela: true` logo depois de ler o
// estabelecimento, sem disparar as demais consultas. Quem calcula o mês não
// passa esse parâmetro — lá a checagem é dia a dia (ver calcularVagasDoMes).
async function carregarBaseDisponibilidade({
  estabelecimentoId,
  servicoId,
  duracaoMinOverride = null,
  dataParaJanela = null,
  // Etiqueta da cliente que está agendando (clientes.etiqueta_id), pra regra
  // de restrição de agenda. null = sem cliente identificado / sem etiqueta:
  // então só uma restrição já aberta pra todos libera o dia.
  etiquetaClienteId = null,
  // 'admin' desliga as duas checagens de dia (janela e restrição) — o modo
  // livre do /admin decide no submit, não aqui (ver calcularVagasPorHorario).
  contexto = "publico",
}) {
  const vazio = {
    estab: null,
    granularidade: GRANULARIDADE_MIN,
    duracao: DURACAO_MINUTOS,
    profissionalIds: [],
    gradesPorDia: new Map(),
    fixosPorDia: new Map(),
    ausenciasRows: [],
    restricoes: [],
    etiquetaClienteId,
    foraDaJanela: false,
    restritoPorEtiqueta: false,
  };

  // Granularidade do estabelecimento (passo da grade no modo 'janela') +
  // janela_agendamento_fim, pra rejeitar datas além do limite configurado
  // ANTES de gerar qualquer slot (mesma checagem do calendário do wizard —
  // ver lib/janelaAgendamento.js). Fecha o caminho de quem tentasse pedir a
  // grade de um dia fora da janela direto por API, sem passar pela UI.
  const { data: estab, error: erroEstab } = await supabase
    .from("estabelecimentos")
    .select("granularidade_min, janela_agendamento_fim")
    .eq("id", estabelecimentoId)
    .single();
  if (erroEstab) throw erroEstab;

  if (dataParaJanela && !dentroDaJanelaAgendamento(dataParaJanela, estab)) {
    return { ...vazio, estab, foraDaJanela: true };
  }

  // Restrições por etiqueta: MESMO papel da janela acima (fechar o dia antes
  // de gerar qualquer slot), só que a regra depende de quem está agendando.
  // Carregadas aqui, junto do estabelecimento, porque não dependem da data —
  // quem calcula o mês reusa esta mesma lista dia a dia.
  const restricoes = await buscarRestricoesAtivas(estabelecimentoId);

  if (
    dataParaJanela &&
    !diaLiberadoPorEtiqueta(dataParaJanela, restricoes, etiquetaClienteId, { contexto })
  ) {
    return { ...vazio, estab, restricoes, restritoPorEtiqueta: true };
  }

  const granularidade =
    Number(estab?.granularidade_min) > 0
      ? Number(estab.granularidade_min)
      : GRANULARIDADE_MIN;

  // Duração do serviço: define o passo/fechamento dos slots (modo janela) e o
  // tamanho do intervalo candidato na checagem de sobreposição (os dois
  // modos). `duracaoMinOverride` pula esta busca e usa o valor já calculado
  // por quem chama (ver o parâmetro em calcularVagasPorHorario).
  let duracao;
  if (Number(duracaoMinOverride) > 0) {
    duracao = Number(duracaoMinOverride);
  } else {
    const { data: servico, error: erroServico } = await supabase
      .from("servicos")
      .select("duracao_min")
      .eq("id", servicoId)
      .single();
    if (erroServico) throw erroServico;

    duracao =
      Number(servico?.duracao_min) > 0
        ? Number(servico.duracao_min)
        : DURACAO_MINUTOS;
  }

  // Profissionais ATIVOS do estabelecimento que atendem este serviço, com o
  // modo de agenda de cada um. O !inner com filtros na tabela embutida
  // transforma o vínculo N:N em um filtro efetivo (só volta linha cujo
  // profissional casa ativo + salão).
  const { data: vinculos, error: erroVinculos } = await supabase
    .from("servico_profissional")
    .select(
      "profissional_id, profissionais!inner(ativo, estabelecimento_id, modo_horario)"
    )
    .eq("servico_id", servicoId)
    .eq("profissionais.ativo", true)
    .eq("profissionais.estabelecimento_id", estabelecimentoId);
  if (erroVinculos) throw erroVinculos;

  const profissionalIds = [];
  const modoPorProfissional = new Map();
  for (const v of vinculos ?? []) {
    profissionalIds.push(v.profissional_id);
    modoPorProfissional.set(v.profissional_id, v.profissionais?.modo_horario ?? "janela");
  }
  if (profissionalIds.length === 0)
    return { ...vazio, estab, granularidade, duracao, restricoes };

  const idsJanela = profissionalIds.filter((id) => modoPorProfissional.get(id) !== "fixo");
  const idsFixo = profissionalIds.filter((id) => modoPorProfissional.get(id) === "fixo");

  // Grades e listas fixas de TODOS os dias da semana de uma vez (no máximo 7
  // linhas por profissional) — é o que torna a base reaproveitável por
  // qualquer data. Agrupadas por dia_semana pra candidatosDoDia pegar só as
  // linhas do dia que está calculando, exatamente como o filtro
  // .eq("dia_semana", dia) fazia no banco.
  const gradesPorDia = new Map();
  if (idsJanela.length > 0) {
    const { data: grades, error: erroGrades } = await supabase
      .from("horarios_trabalho")
      .select(
        "profissional_id, dia_semana, hora_inicio, hora_fim, almoco_inicio, almoco_fim"
      )
      .in("profissional_id", idsJanela);
    if (erroGrades) throw erroGrades;

    for (const grade of grades ?? []) {
      const lista = gradesPorDia.get(grade.dia_semana) ?? [];
      lista.push(grade);
      gradesPorDia.set(grade.dia_semana, lista);
    }
  }

  const fixosPorDia = new Map();
  if (idsFixo.length > 0) {
    const { data: fixos, error: erroFixos } = await supabase
      .from("horarios_fixos")
      .select("profissional_id, dia_semana, horario")
      .in("profissional_id", idsFixo);
    if (erroFixos) throw erroFixos;

    for (const f of fixos ?? []) {
      const lista = fixosPorDia.get(f.dia_semana) ?? [];
      lista.push(f);
      fixosPorDia.set(f.dia_semana, lista);
    }
  }

  // Exceções de ausencias (bloqueio/liberação) dos profissionais candidatos.
  // Busca tudo de uma vez e filtra em memória (tabela pequena por
  // profissional) — já era assim no cálculo de um dia só.
  const { data: ausenciasRows, error: erroAusencias } = await supabase
    .from("ausencias")
    .select(
      "profissional_id, tipo, tipo_registro, dia_semana, data_inicio, data_fim, dia_inteiro, hora_inicio, hora_fim"
    )
    .in("profissional_id", profissionalIds);
  if (erroAusencias) throw erroAusencias;

  return {
    estab,
    granularidade,
    duracao,
    profissionalIds,
    gradesPorDia,
    fixosPorDia,
    ausenciasRows: ausenciasRows ?? [],
    restricoes,
    etiquetaClienteId,
    foraDaJanela: false,
    restritoPorEtiqueta: false,
  };
}

// PURA. Candidatos "HH:MM" de cada profissional NESTA data, já com as
// exceções aplicadas: Map profissional_id -> Set("HH:MM").
//
// `comSnapshot` (contexto='admin') devolve também `candidatosAntes` — cópia
// do conjunto ANTES das exceções, pra distinguir depois um slot removido por
// ausência ('excecao_ausencia') de um que nunca teria sido candidato do
// expediente/modo normal ('fora_do_modo').
function candidatosDoDia(base, data, comSnapshot = false) {
  const dia = diaDaSemana(data);
  const candidatos = new Map();

  // Modo 'janela': grade de trabalho do dia + granularidade do estabelecimento.
  for (const grade of base.gradesPorDia.get(dia) ?? []) {
    const slots = gerarSlotsDaJanela(
      {
        inicio: grade.hora_inicio,
        fim: grade.hora_fim,
        almocoInicio: grade.almoco_inicio,
        almocoFim: grade.almoco_fim,
      },
      base.duracao,
      base.granularidade
    );
    candidatos.set(grade.profissional_id, new Set(slots));
  }

  // Modo 'fixo': lista fechada de horários do dia (sem geração por passo).
  for (const f of base.fixosPorDia.get(dia) ?? []) {
    const conjunto = candidatos.get(f.profissional_id) ?? new Set();
    conjunto.add(paraHHMM(f.horario));
    candidatos.set(f.profissional_id, conjunto);
  }

  const excecoesAplicaveis = excecoesDoDia(base.ausenciasRows, dia, data);

  // Clona os Sets: aplicarExcecoes muta in-place o conjunto original logo
  // abaixo.
  const candidatosAntes = comSnapshot
    ? new Map(
        base.profissionalIds.map((id) => [id, new Set(candidatos.get(id) ?? [])])
      )
    : null;

  // Aplica as exceções profissional a profissional. Roda sobre TODOS os
  // profissionais candidatos (não só quem já tem slots) porque uma liberação
  // pode adicionar horário pra quem normalmente não trabalha nesse dia.
  for (const profissionalId of base.profissionalIds) {
    const conjunto = candidatos.get(profissionalId) ?? new Set();
    const excecoes = excecoesAplicaveis.filter((a) => a.profissional_id === profissionalId);
    aplicarExcecoes(conjunto, excecoes, base.duracao);
    candidatos.set(profissionalId, conjunto);
  }

  return { candidatos, candidatosAntes };
}

// PURA. Agrupa as reservas ativas de UM dia em intervalos [inicio, fim) por
// profissional: Map profissional_id -> [{ inicio, fim }].
function agruparOcupados(reservas) {
  const ocupadosPorProfissional = new Map();
  for (const r of reservas ?? []) {
    // Reserva sem profissional atribuído não bloqueia ninguém em específico.
    if (r.profissional_id == null) continue;
    const inicio = horaParaMin(r.horario);
    const intervalo = { inicio, fim: inicio + r.duracao_min };
    const lista = ocupadosPorProfissional.get(r.profissional_id) ?? [];
    lista.push(intervalo);
    ocupadosPorProfissional.set(r.profissional_id, lista);
  }
  return ocupadosPorProfissional;
}

// PURA. Mapa final de UM dia, no formato do `contexto` (ver o comentário de
// calcularVagasPorHorario, que documenta os dois shapes).
function montarMapaDoDia({
  base,
  contexto,
  candidatos,
  candidatosAntes,
  ocupadosPorProfissional,
}) {
  const mapa = {};

  if (contexto === "admin") {
    // Grade "dia inteiro": 00:00 até o último horário em que o serviço ainda
    // termina dentro do dia (m + duracao <= 24h), na granularidade do salão —
    // independente do expediente/modo configurado de cada profissional.
    const gradeCompleta = [];
    for (let m = 0; m + base.duracao <= 24 * 60; m += base.granularidade) {
      gradeCompleta.push(minParaHHMM(m));
    }

    for (const profissionalId of base.profissionalIds) {
      const ocupados = ocupadosPorProfissional.get(profissionalId) ?? [];
      const candidatosFinal = candidatos.get(profissionalId) ?? new Set();
      const antes = candidatosAntes?.get(profissionalId) ?? new Set();

      for (const slot of gradeCompleta) {
        const candInicio = horaParaMin(slot);
        const candFim = candInicio + base.duracao;
        const sobrepoe = ocupados.some(
          (iv) => candInicio < iv.fim && iv.inicio < candFim
        );
        // Sobreposição com agendamento real: nunca aparece, nem livre nem
        // bloqueado — igual ao contexto público.
        if (sobrepoe) continue;

        const entrada = (mapa[slot] ??= { livres: [], bloqueados: [] });

        if (candidatosFinal.has(slot)) {
          entrada.livres.push(profissionalId);
        } else if (antes.has(slot)) {
          entrada.bloqueados.push({ profissionalId, motivo: "excecao_ausencia" });
        } else {
          entrada.bloqueados.push({ profissionalId, motivo: "fora_do_modo" });
        }
      }
    }

    return mapa;
  }

  // Monta o mapa: pra cada profissional candidato, adiciona o id nos
  // horários dele em que não há sobreposição com agendamentos.
  for (const [profissionalId, conjunto] of candidatos) {
    const ocupados = ocupadosPorProfissional.get(profissionalId) ?? [];

    for (const slot of conjunto) {
      const candInicio = horaParaMin(slot);
      const candFim = candInicio + base.duracao;
      const sobrepoe = ocupados.some(
        (iv) => candInicio < iv.fim && iv.inicio < candFim
      );
      if (sobrepoe) continue;

      (mapa[slot] ??= []).push(profissionalId);
    }
  }

  return mapa;
}

// Calcula, para (estabelecimento, serviço, data), quais profissionais estão
// LIVRES em cada horário da grade.
//
// contexto='publico' (default): comportamento de sempre — retorna um mapa
// { "09:00": [ids...], "09:30": [ids...], ... } onde o array lista os
// profissional_id disponíveis naquele slot. Horários sem ninguém livre não
// aparecem como chave. Retorna {} quando faltam parâmetros, quando a data
// está além de estabelecimentos.janela_agendamento_fim (ver
// lib/janelaAgendamento.js), quando nenhum profissional ativo atende o
// serviço, quando a data cai numa restrição de agenda por etiqueta que não
// libera esta cliente (ver diaLiberadoPorEtiqueta + o parâmetro
// etiquetaClienteId abaixo), ou quando ninguém trabalha no dia.
//
// Um profissional entra num slot quando:
//   1. o horário está nos candidatos DELE (janela OU lista fixa, já com as
//      exceções de ausencias aplicadas); e
//   2. o intervalo [inicio, inicio+duracao) não sobrepõe nenhum agendamento
//      ativo dele no dia.
//
// contexto='admin': usado só pelo modo livre do /admin (ver FormularioAgendamento,
// modoLivre). Nenhum filtro de negócio remove profissional/slot do resultado —
// em vez disso o formato vira ENRIQUECIDO: { "HH:MM": { livres: [id...],
// bloqueados: [{ profissionalId, motivo }] } }, cobrindo o DIA INTEIRO
// (00:00 até 24:00 - duração, na granularidade do salão), independente do
// expediente/modo configurado e da janela_agendamento_fim. motivo é
// 'excecao_ausencia' (o slot seria candidato normal, mas uma ausência
// removeu) ou 'fora_do_modo' (o slot nunca seria candidato — fora do
// expediente/lista fixa/dia da semana configurados). A ÚNICA coisa que
// continua removendo de vez, nos dois contextos: sobreposição com um
// agendamento ativo já confirmado (esse profissional/slot simplesmente não
// aparece nem em livres nem em bloqueados).
//
// A regra em si mora nos helpers acima (carregarBaseDisponibilidade +
// candidatosDoDia + montarMapaDoDia), compartilhados com calcularVagasDoMes —
// as duas nunca podem divergir, senão o calendário cinzaria um dia que a
// grade de horários mostra como livre.
export async function calcularVagasPorHorario({
  estabelecimentoId,
  servicoId,
  data,
  // Reserva a IGNORAR na checagem de ocupados — usado quando o próprio
  // cliente já tem uma linha gravada (insert antecipado do fluxo público, ver
  // FormularioAgendamento) pra ela não aparecer como "ocupada" pro seu
  // próprio profissional/horário.
  excluirAgendamentoId = null,
  contexto = "publico",
  // Duração (minutos) a usar no lugar da busca em `servicos.duracao_min` —
  // usada pelo fluxo de perguntas de serviço (ver calcularAjusteDuracao em
  // FormularioAgendamento) pra refletir a duração EFETIVA (base + ajustes das
  // opções respondidas) no cálculo de slots e na checagem de sobreposição.
  // Sem efeito nos demais chamadores, que não passam este parâmetro.
  duracaoMinOverride = null,
  // Etiqueta da cliente (clientes.etiqueta_id) pra regra de restrição de
  // agenda — ver diaLiberadoPorEtiqueta em lib/janelaAgendamento.js. Omitida
  // (ou null), só uma restrição já aberta pra todos libera um dia restrito.
  etiquetaClienteId = null,
}) {
  const mapa = {};
  if (!estabelecimentoId || !servicoId || !data) return mapa;

  const base = await carregarBaseDisponibilidade({
    estabelecimentoId,
    servicoId,
    duracaoMinOverride,
    // No modo livre do /admin (contexto='admin') nem a janela de agendamento
    // nem a restrição por etiqueta bloqueiam o cálculo — o dia já foi liberado
    // antes, no calendário (ver CalendarioDias/modoLivre). No público,
    // comportamento de sempre.
    dataParaJanela: contexto === "admin" ? null : data,
    etiquetaClienteId,
    contexto,
  });
  if (
    base.foraDaJanela ||
    base.restritoPorEtiqueta ||
    base.profissionalIds.length === 0
  ) {
    return mapa;
  }

  // Agendamentos ativos (status <> 'cancelado') do dia, para saber quem já
  // está ocupado. Única consulta que depende da data específica.
  let queryReservas = supabase
    .from("agendamentos")
    .select("profissional_id, horario, duracao_min")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("data", data)
    .neq("status", "cancelado");
  if (excluirAgendamentoId != null) {
    queryReservas = queryReservas.neq("id", excluirAgendamentoId);
  }
  const { data: reservas, error: erroReservas } = await queryReservas;
  if (erroReservas) throw erroReservas;

  const { candidatos, candidatosAntes } = candidatosDoDia(
    base,
    data,
    contexto === "admin"
  );

  return montarMapaDoDia({
    base,
    contexto,
    candidatos,
    candidatosAntes,
    ocupadosPorProfissional: agruparOcupados(reservas),
  });
}

// Mesma coisa que calcularVagasPorHorario, só que para TODOS os dias de um
// mês de uma vez — o que o calendário do wizard precisa pra cinzar de
// antemão os dias sem nenhum horário livre, sem esperar um clique por dia.
//
// `mes` é 1–12 (não o índice 0–11 de Date). Retorna
// { "YYYY-MM-DD": mapaDeVagas } com uma entrada para CADA dia do mês —
// inclusive dias sem nenhuma vaga, que vêm como {}. Um mapa de retorno vazio
// significa "não deu pra calcular" (faltou parâmetro), nunca "nenhum dia tem
// vaga"; quem consome precisa dessa distinção pra não cinzar o mês inteiro
// por engano (ver diasSemVagaDoMes).
//
// Custo: as MESMAS 4–6 consultas de um único dia, não uma por dia. Só a de
// `agendamentos` muda — vem o mês inteiro por intervalo (.gte/.lte) e é
// agrupada por data em memória; o resto da base não depende da data, e o
// cálculo por dia é puro (ver o bloco de helpers acima).
//
// `base` (opcional) permite passar uma base JÁ carregada por
// carregarBaseDisponibilidade, em vez de recarregá-la aqui — nada nela
// depende da data (profissionais do serviço, grade dos 7 dias da semana,
// ausências), então varrer VÁRIOS meses seguidos com a mesma base custa
// apenas 1 consulta de `agendamentos` por mês (ver
// calcularPrimeiroMesComVaga). Omitida, o comportamento é exatamente o de
// sempre: a base é carregada aqui dentro.
export async function calcularVagasDoMes({
  estabelecimentoId,
  servicoId,
  ano,
  mes,
  excluirAgendamentoId = null,
  contexto = "publico",
  duracaoMinOverride = null,
  base: baseRecebida = null,
  // Ver o mesmo parâmetro em calcularVagasPorHorario. Ignorado quando `base`
  // já vem pronta: nesse caso vale a etiqueta com que a base foi carregada
  // (base.etiquetaClienteId), pra não haver duas verdades no mesmo cálculo.
  etiquetaClienteId = null,
}) {
  const porData = {};
  if (!estabelecimentoId || !servicoId || !ano || !mes) return porData;

  const base =
    baseRecebida ??
    (await carregarBaseDisponibilidade({
      estabelecimentoId,
      servicoId,
      duracaoMinOverride,
      etiquetaClienteId,
      contexto,
    }));

  const diasNoMes = new Date(ano, mes, 0).getDate();
  const primeiroDia = paraISO(new Date(ano, mes - 1, 1));
  const ultimoDia = paraISO(new Date(ano, mes - 1, diasNoMes));

  let queryReservas = supabase
    .from("agendamentos")
    .select("profissional_id, horario, duracao_min, data")
    .eq("estabelecimento_id", estabelecimentoId)
    .gte("data", primeiroDia)
    .lte("data", ultimoDia)
    .neq("status", "cancelado");
  if (excluirAgendamentoId != null) {
    queryReservas = queryReservas.neq("id", excluirAgendamentoId);
  }
  const { data: reservas, error: erroReservas } = await queryReservas;
  if (erroReservas) throw erroReservas;

  const reservasPorData = new Map();
  for (const r of reservas ?? []) {
    const lista = reservasPorData.get(r.data) ?? [];
    lista.push(r);
    reservasPorData.set(r.data, lista);
  }

  for (let d = 1; d <= diasNoMes; d++) {
    const iso = paraISO(new Date(ano, mes - 1, d));

    // Sem ninguém que atenda o serviço, dia além da janela de agendamento, ou
    // dia dentro de uma restrição por etiqueta que não libera esta cliente:
    // entra no resultado como dia sem vaga nenhuma (e não como dia ausente,
    // que significaria "não calculado"). As duas checagens de dia são
    // independentes — o dia precisa passar nas DUAS (ver
    // dentroDaJanelaAgendamento/diaLiberadoPorEtiqueta em
    // lib/janelaAgendamento.js).
    if (
      base.profissionalIds.length === 0 ||
      (contexto !== "admin" && !dentroDaJanelaAgendamento(iso, base.estab)) ||
      !diaLiberadoPorEtiqueta(iso, base.restricoes, base.etiquetaClienteId, {
        contexto,
      })
    ) {
      porData[iso] = {};
      continue;
    }

    const { candidatos, candidatosAntes } = candidatosDoDia(
      base,
      iso,
      contexto === "admin"
    );

    porData[iso] = montarMapaDoDia({
      base,
      contexto,
      candidatos,
      candidatosAntes,
      ocupadosPorProfissional: agruparOcupados(reservasPorData.get(iso) ?? []),
    });
  }

  return porData;
}

// Profissionais LIVRES para atender (serviço, data, horário) — usado pela troca
// de profissional no /admin. Reaproveita calcularVagasPorHorario (a mesma regra
// de candidatos + anti-sobreposição) e só resolve os NOMES dos ids livres
// naquele horário. Retorna [{ id, nome }] ordenado por nome; [] se ninguém livre.
//
// Observação: o profissional já reservado NESTE horário aparece como ocupado (a
// própria reserva o bloqueia), então ele não vem na lista — o que é o desejado
// numa troca (só faz sentido oferecer OUTRO profissional).
export async function profissionaisLivresNoHorario({
  estabelecimentoId,
  servicoId,
  data,
  horario,
}) {
  if (!estabelecimentoId || !servicoId || !data || !horario) return [];

  const vagas = await calcularVagasPorHorario({
    estabelecimentoId,
    servicoId,
    data,
  });

  // As chaves do mapa são "HH:MM"; o horário do agendamento vem "HH:MM:SS".
  const ids = vagas[String(horario).slice(0, 5)] ?? [];
  if (ids.length === 0) return [];

  const { data: profissionais, error } = await supabase
    .from("profissionais")
    .select("id, nome")
    .in("id", ids)
    .order("nome");

  if (error) throw error;
  return profissionais ?? [];
}

// Hora fixa (não configurável) a partir da qual o corte do dia seguinte para
// de valer — ver regra (b) abaixo.
const LIMITE_MANHA_CORTE = "13:00";

// Remove, do mapa de horários já calculado (ver calcularVagasPorHorario), as
// chaves bloqueadas por uma checagem INCONDICIONAL mais QUALQUER UMA de duas
// regras opcionais — (a) antecedência mínima e (b) corte da manhã seguinte —
// cada uma some do resultado se a outra nem estivesse configurada.
//
// Checagem incondicional (sempre roda, não depende de nenhuma configuração):
//     na data de HOJE, remove qualquer slot cujo horário já passou do agora.
//     Vale mesmo com antecedência "Nenhum" e corte desativado.
// (a) Antecedência mínima (estabelecimentos.antecedencia_minima_horas): só
//     roda se o campo NÃO for null. Bloqueia qualquer slot mais cedo que
//     agora + antecedencia_minima_horas.
// (b) Corte da manhã seguinte (cutoff_dia_seguinte_ativo/
//     cutoff_dia_seguinte_hora): só roda se cutoff_dia_seguinte_ativo for
//     true. Se a hora atual já passou de cutoff_dia_seguinte_hora HOJE,
//     bloqueia os slots do DIA SEGUINTE (relativo a agora) com horário antes
//     de LIMITE_MANHA_CORTE (13:00, fixo — não vem de configuração). A partir
//     de 13:00 do dia seguinte, os slots ficam livres desta regra (mas ainda
//     passam pela regra (a), se ela estiver ativa).
//
// Compara sempre contra `new Date()` de ONDE a função roda — no client isso é
// a hora do navegador (só filtro de UX); a garantia de verdade vem de rodar
// esta mesma função dentro de uma rota server-side (Node), cujo relógio não
// pode ser manipulado pelo cliente (ver app/api/agendamentos/
// validar-antecedencia/route.js, chamada por finalizarAgendamento/
// selecionarHorario em FormularioAgendamento antes de qualquer insert).
//
// contexto='admin' (ver FormularioAgendamento, modoLivre): em vez de REMOVER
// a chave bloqueada, anota — o(s) profissional(is) que estavam em `livres`
// migram pra `bloqueados` com motivo 'antecedencia', e a chave permanece no
// resultado (mesmo shape enriquecido de calcularVagasPorHorario). Espera
// `horariosDisponiveis` já no formato enriquecido nesse contexto.
export function filtrarPorAntecedenciaMinima(
  horariosDisponiveis,
  data,
  estabelecimento,
  contexto = "publico"
) {
  if (!data) return horariosDisponiveis;

  const antecedenciaHoras = estabelecimento?.antecedencia_minima_horas;
  const antecedenciaAtiva = antecedenciaHoras != null;

  const cutoffAtivo =
    Boolean(estabelecimento?.cutoff_dia_seguinte_ativo) &&
    estabelecimento?.cutoff_dia_seguinte_hora != null;

  const agora = new Date();
  const ehHoje = data === paraISO(agora);

  let cutoffBloqueiaODiaSeguinte = false;
  if (cutoffAtivo) {
    const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
    cutoffBloqueiaODiaSeguinte =
      data === paraISO(amanha) &&
      agora.getHours() >= Number(estabelecimento.cutoff_dia_seguinte_hora);
  }

  const resultado = {};
  for (const horario of Object.keys(horariosDisponiveis)) {
    const bloqueado =
      (ehHoje && construirDataHora(data, horario).getTime() < agora.getTime()) ||
      (antecedenciaAtiva &&
        (construirDataHora(data, horario).getTime() - agora.getTime()) / (1000 * 60 * 60) <
          Number(antecedenciaHoras)) ||
      (cutoffBloqueiaODiaSeguinte && horario < LIMITE_MANHA_CORTE);

    if (contexto !== "admin") {
      if (!bloqueado) resultado[horario] = horariosDisponiveis[horario];
      continue;
    }

    const entrada = horariosDisponiveis[horario];
    if (!bloqueado) {
      resultado[horario] = entrada;
      continue;
    }
    resultado[horario] = {
      livres: [],
      bloqueados: [
        ...(entrada?.bloqueados ?? []),
        ...(entrada?.livres ?? []).map((profissionalId) => ({
          profissionalId,
          motivo: "antecedencia",
        })),
      ],
    };
  }
  return resultado;
}

// PURA (nenhum acesso ao banco). Reduz o resultado de calcularVagasDoMes ao
// que o calendário precisa: o Set de datas "YYYY-MM-DD" que NÃO têm nenhum
// horário oferecível — os dias que nascem cinza/indisponíveis (ver
// CalendarioDias/diasSemVaga em components/FormularioAgendamento.js).
//
// Aplica exatamente os dois filtros que a etapa "data" do wizard já aplica em
// memória sobre o dia clicado, pra que calendário e grade de horários nunca
// discordem:
//   1. profissional — no fluxo "cliente escolhe", só conta horário em que o
//      profissional selecionado (`profissionalId`) está livre; no encaixe
//      automático (`profissionalId` null) basta >= 1 profissional livre.
//      É o mesmo critério de `horariosBase` lá.
//   2. antecedência mínima / corte do dia seguinte / horário já passado —
//      via filtrarPorAntecedenciaMinima, a MESMA função (por isso um dia
//      inteiro que só tinha horários cedo demais também cinza).
//
// Só faz sentido no contexto='publico' (valores do mapa são arrays de ids).
// Um `vagasPorData` vazio devolve Set vazio: "não calculado" nunca vira "mês
// inteiro indisponível".
export function diasSemVagaDoMes(
  vagasPorData,
  { estabelecimento, profissionalId = null } = {}
) {
  const semVaga = new Set();

  for (const [data, mapa] of Object.entries(vagasPorData ?? {})) {
    const dentroDaAntecedencia = filtrarPorAntecedenciaMinima(
      mapa,
      data,
      estabelecimento
    );
    const temVaga = Object.keys(dentroDaAntecedencia).some((horario) =>
      profissionalId == null
        ? true
        : (dentroDaAntecedencia[horario] ?? []).includes(profissionalId)
    );
    if (!temVaga) semVaga.add(data);
  }

  return semVaga;
}

// Teto de segurança da varredura de calcularPrimeiroMesComVaga. Só entra em
// jogo quando o salão NÃO configurou janela_agendamento_fim (a janela, quando
// existe, corta o loop bem antes): sem ela não há futuro máximo, e varrer
// indefinidamente meses vazios seria um loop infinito de consultas.
const MAX_MESES_VARREDURA = 12;

// Primeiro mês, a partir de `mesInicial` (INCLUSIVE), que tem pelo menos um
// dia agendável — o que o calendário do wizard precisa pra abrir já num mês
// útil em vez de num mês inteiro cinza (ver mesVisivel/CalendarioDias em
// components/FormularioAgendamento.js).
//
// Retorna { ano, mes } (mes 1–12, mesmo formato de calcularVagasDoMes) do
// primeiro mês com vaga, ou null quando nenhum mês dentro da janela tem — e
// também quando falta parâmetro ou ninguém atende o serviço, pelo mesmo
// motivo de calcularVagasDoMes devolver mapa vazio nesses casos: "não deu pra
// responder" nunca deve virar "pule o mês atual".
//
// Params:
//   mesInicial      – { ano, mes } (mes 1–12). Omitido, começa no mês corrente.
//   profissionalId  – MESMA convenção de diasSemVagaDoMes: com id, só conta
//                   horário em que AQUELE profissional está livre; null =
//                   encaixe automático (basta >= 1 profissional livre).
//                   Atenção, quem chama: no fluxo "cliente escolhe", enquanto
//                   não houver profissional escolhido a resposta dependeria de
//                   quem — é o caso em que o wizard desliga o cinza inteiro
//                   (NENHUM_DIA_SEM_VAGA), e aqui o correto é não chamar, não
//                   chamar com null.
//   estabelecimento – linha do salão com os campos de antecedência mínima /
//                   corte do dia seguinte / janela_agendamento_fim, os mesmos
//                   que diasSemVagaDoMes usa. Omitido, cai no que a base
//                   carregou (que só traz janela_agendamento_fim).
//
// Custo: 1 carga de base + 1 consulta de `agendamentos` por mês varrido, e o
// loop PARA no primeiro mês com vaga — não varre a janela inteira à toa.
export async function calcularPrimeiroMesComVaga({
  estabelecimentoId,
  servicoId,
  duracaoMinOverride = null,
  excluirAgendamentoId = null,
  profissionalId = null,
  estabelecimento = null,
  mesInicial = null,
  // Ver o mesmo parâmetro em calcularVagasPorHorario: entra na base carregada
  // aqui e, por ela, em todos os meses varridos — o primeiro mês "com vaga"
  // precisa respeitar a restrição por etiqueta, senão o calendário abriria num
  // mês inteiro cinza.
  etiquetaClienteId = null,
}) {
  if (!estabelecimentoId || !servicoId) return null;

  const agora = new Date();
  let ano = Number(mesInicial?.ano) || agora.getFullYear();
  let mes = Number(mesInicial?.mes) || agora.getMonth() + 1;

  // Base carregada UMA vez e reaproveitada em todos os meses do loop: nada
  // nela depende da data (ver o param `base` de calcularVagasDoMes).
  const base = await carregarBaseDisponibilidade({
    estabelecimentoId,
    servicoId,
    duracaoMinOverride,
    etiquetaClienteId,
  });
  if (base.profissionalIds.length === 0) return null;

  const dadosEstabelecimento = estabelecimento ?? base.estab;
  const janelaFim = dadosEstabelecimento?.janela_agendamento_fim ?? null;
  // Dia de hoje: dias já passados nunca contam como vaga. diasSemVagaDoMes
  // sozinho não cobre isso (o calendário é que cinza o passado, por `min`),
  // então filtramos antes de perguntar a ela.
  const hojeISO = paraISO(agora);

  for (let varridos = 0; varridos < MAX_MESES_VARREDURA; varridos++) {
    // O mês inteiro está além da janela: como os meses só avançam, daqui pra
    // frente todos estarão — não há mais o que varrer.
    if (janelaFim && paraISO(new Date(ano, mes - 1, 1)) > janelaFim) return null;

    const vagasPorData = await calcularVagasDoMes({
      estabelecimentoId,
      servicoId,
      ano,
      mes,
      excluirAgendamentoId,
      duracaoMinOverride,
      base,
    });

    const diasFuturos = {};
    for (const [data, mapa] of Object.entries(vagasPorData)) {
      if (data >= hojeISO) diasFuturos[data] = mapa;
    }

    // MESMA regra do calendário: um dia é agendável quando não está no Set
    // que diasSemVagaDoMes devolve (profissional + antecedência mínima).
    const semVaga = diasSemVagaDoMes(diasFuturos, {
      estabelecimento: dadosEstabelecimento,
      profissionalId,
    });
    if (Object.keys(diasFuturos).some((data) => !semVaga.has(data))) {
      return { ano, mes };
    }

    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }

  return null;
}
