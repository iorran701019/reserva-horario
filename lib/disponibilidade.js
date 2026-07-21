import { supabase } from "@/lib/supabaseClient";
import { gerarSlotsDaJanela, DURACAO_MINUTOS, GRANULARIDADE_MIN } from "@/lib/horarios";

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

// Reserva provisória (pendente/aguardando_sinal) criada antecipadamente pelo
// wizard público (ver FormularioAgendamento -> selecionarHorario) e nunca
// concluída: depois de `expiraHoras` desde `created_at`, para de contar como
// bloqueio de disponibilidade — só o cálculo de vagas ignora a linha, o
// status/registro no banco não muda. Confirmado nunca expira por esse
// critério (representa um horário de fato ocupado).
function reservaProvisoriaExpirada(reserva, expiraHoras, agoraMs) {
  if (reserva.status !== "pendente" && reserva.status !== "aguardando_sinal") {
    return false;
  }
  const criadoEmMs = new Date(reserva.created_at).getTime();
  if (Number.isNaN(criadoEmMs)) return false;
  return agoraMs - criadoEmMs > expiraHoras * 60 * 60 * 1000;
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
// (mutação in-place do Set). 'ausencia': dia_inteiro limpa tudo; senão remove
// os candidatos cujo horário cai dentro de [hora_inicio, hora_fim).
// 'liberacao': adiciona hora_inicio como candidato extra (ignora dia_inteiro,
// que não faz sentido pra liberação de um horário específico).
function aplicarExcecoes(conjunto, excecoes) {
  for (const ex of excecoes) {
    const tipoRegistro = ex.tipo_registro ?? "ausencia";

    if (tipoRegistro === "liberacao") {
      if (ex.dia_inteiro || !ex.hora_inicio) continue;
      conjunto.add(paraHHMM(ex.hora_inicio));
      continue;
    }

    // tipo_registro === "ausencia" (default, cobre linhas antigas sem a coluna).
    if (ex.dia_inteiro) {
      conjunto.clear();
      continue;
    }
    if (!ex.hora_inicio || !ex.hora_fim) continue;
    const exIni = horaParaMin(ex.hora_inicio);
    const exFim = horaParaMin(ex.hora_fim);
    for (const slot of [...conjunto]) {
      const m = horaParaMin(slot);
      if (m >= exIni && m < exFim) conjunto.delete(slot);
    }
  }
}

// Calcula, para (estabelecimento, serviço, data), quais profissionais estão
// LIVRES em cada horário da grade.
//
// Retorna um mapa { "09:00": [ids...], "09:30": [ids...], ... } onde o array
// lista os profissional_id disponíveis naquele slot. Horários sem ninguém
// livre não aparecem como chave. Retorna {} quando faltam parâmetros, quando
// nenhum profissional ativo atende o serviço, ou quando ninguém trabalha no
// dia.
//
// Um profissional entra num slot quando:
//   1. o horário está nos candidatos DELE (janela OU lista fixa, já com as
//      exceções de ausencias aplicadas); e
//   2. o intervalo [inicio, inicio+duracao) não sobrepõe nenhum agendamento
//      ativo dele no dia.
export async function calcularVagasPorHorario({
  estabelecimentoId,
  servicoId,
  data,
}) {
  const mapa = {};
  if (!estabelecimentoId || !servicoId || !data) return mapa;

  const dia = diaDaSemana(data);

  // Granularidade do estabelecimento (passo da grade no modo 'janela') e a
  // tolerância de reserva provisória (ver reservaProvisoriaExpirada acima).
  const { data: estab, error: erroEstab } = await supabase
    .from("estabelecimentos")
    .select("granularidade_min, reserva_provisoria_expira_horas")
    .eq("id", estabelecimentoId)
    .single();
  if (erroEstab) throw erroEstab;

  const granularidade =
    Number(estab?.granularidade_min) > 0
      ? Number(estab.granularidade_min)
      : GRANULARIDADE_MIN;

  const expiraHoras =
    Number(estab?.reserva_provisoria_expira_horas) > 0
      ? Number(estab.reserva_provisoria_expira_horas)
      : 48;

  // Duração do serviço: define o passo/fechamento dos slots (modo janela) e o
  // tamanho do intervalo candidato na checagem de sobreposição (os dois modos).
  const { data: servico, error: erroServico } = await supabase
    .from("servicos")
    .select("duracao_min")
    .eq("id", servicoId)
    .single();
  if (erroServico) throw erroServico;

  const duracao =
    Number(servico?.duracao_min) > 0
      ? Number(servico.duracao_min)
      : DURACAO_MINUTOS;

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
  if (profissionalIds.length === 0) return mapa;

  const idsJanela = profissionalIds.filter((id) => modoPorProfissional.get(id) !== "fixo");
  const idsFixo = profissionalIds.filter((id) => modoPorProfissional.get(id) === "fixo");

  // Candidatos por profissional: Map profissional_id -> Set("HH:MM").
  const candidatosPorProfissional = new Map();

  // Modo 'janela': grade de trabalho do dia + granularidade do estabelecimento.
  if (idsJanela.length > 0) {
    const { data: grades, error: erroGrades } = await supabase
      .from("horarios_trabalho")
      .select("profissional_id, hora_inicio, hora_fim, almoco_inicio, almoco_fim")
      .in("profissional_id", idsJanela)
      .eq("dia_semana", dia);
    if (erroGrades) throw erroGrades;

    for (const grade of grades ?? []) {
      const slots = gerarSlotsDaJanela(
        {
          inicio: grade.hora_inicio,
          fim: grade.hora_fim,
          almocoInicio: grade.almoco_inicio,
          almocoFim: grade.almoco_fim,
        },
        duracao,
        granularidade
      );
      candidatosPorProfissional.set(grade.profissional_id, new Set(slots));
    }
  }

  // Modo 'fixo': lista fechada de horários do dia (sem geração por passo).
  if (idsFixo.length > 0) {
    const { data: fixos, error: erroFixos } = await supabase
      .from("horarios_fixos")
      .select("profissional_id, horario")
      .in("profissional_id", idsFixo)
      .eq("dia_semana", dia);
    if (erroFixos) throw erroFixos;

    for (const f of fixos ?? []) {
      const conjunto = candidatosPorProfissional.get(f.profissional_id) ?? new Set();
      conjunto.add(paraHHMM(f.horario));
      candidatosPorProfissional.set(f.profissional_id, conjunto);
    }
  }

  // Exceções de ausencias (bloqueio/liberação) dos profissionais candidatos,
  // aplicáveis nesta data. Busca tudo de uma vez e filtra em memória (tabela
  // pequena por profissional).
  const { data: ausenciasRows, error: erroAusencias } = await supabase
    .from("ausencias")
    .select(
      "profissional_id, tipo, tipo_registro, dia_semana, data_inicio, data_fim, dia_inteiro, hora_inicio, hora_fim"
    )
    .in("profissional_id", profissionalIds);
  if (erroAusencias) throw erroAusencias;

  const excecoesAplicaveis = excecoesDoDia(ausenciasRows, dia, data);

  // Aplica as exceções profissional a profissional. Roda sobre TODOS os
  // profissionais candidatos (não só quem já tem slots) porque uma liberação
  // pode adicionar horário pra quem normalmente não trabalha nesse dia.
  for (const profissionalId of profissionalIds) {
    const conjunto = candidatosPorProfissional.get(profissionalId) ?? new Set();
    const excecoes = excecoesAplicaveis.filter((a) => a.profissional_id === profissionalId);
    aplicarExcecoes(conjunto, excecoes);
    candidatosPorProfissional.set(profissionalId, conjunto);
  }

  // Agendamentos ativos (status <> 'cancelado') do dia, para saber quem já
  // está ocupado. Agrupa os intervalos [inicio, fim) por profissional.
  const { data: reservas, error: erroReservas } = await supabase
    .from("agendamentos")
    .select("profissional_id, horario, duracao_min, status, created_at")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("data", data)
    .neq("status", "cancelado");
  if (erroReservas) throw erroReservas;

  const agoraMs = Date.now();
  const ocupadosPorProfissional = new Map();
  for (const r of reservas ?? []) {
    // Reserva sem profissional atribuído não bloqueia ninguém em específico.
    if (r.profissional_id == null) continue;
    // Reserva provisória abandonada há mais de expiraHoras: não bloqueia mais
    // o horário (a linha continua no banco como está, isso é só o cálculo de
    // disponibilidade).
    if (reservaProvisoriaExpirada(r, expiraHoras, agoraMs)) continue;
    const inicio = horaParaMin(r.horario);
    const intervalo = { inicio, fim: inicio + r.duracao_min };
    const lista = ocupadosPorProfissional.get(r.profissional_id) ?? [];
    lista.push(intervalo);
    ocupadosPorProfissional.set(r.profissional_id, lista);
  }

  // Monta o mapa: pra cada profissional candidato, adiciona o id nos
  // horários dele em que não há sobreposição com agendamentos.
  for (const [profissionalId, conjunto] of candidatosPorProfissional) {
    const ocupados = ocupadosPorProfissional.get(profissionalId) ?? [];

    for (const slot of conjunto) {
      const candInicio = horaParaMin(slot);
      const candFim = candInicio + duracao;
      const sobrepoe = ocupados.some(
        (iv) => candInicio < iv.fim && iv.inicio < candFim
      );
      if (sobrepoe) continue;

      (mapa[slot] ??= []).push(profissionalId);
    }
  }

  return mapa;
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
