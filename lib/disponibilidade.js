import { supabase } from "@/lib/supabaseClient";
import { gerarSlotsDaJanela, DURACAO_MINUTOS, GRANULARIDADE_MIN } from "@/lib/horarios";
import { dentroDaJanelaAgendamento } from "@/lib/janelaAgendamento";

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
function aplicarExcecoes(conjunto, excecoes) {
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
      const m = horaParaMin(slot);
      if (m >= exIni && m < exFim) conjunto.delete(slot);
    }
  }
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
// serviço, ou quando ninguém trabalha no dia.
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
}) {
  const mapa = {};
  if (!estabelecimentoId || !servicoId || !data) return mapa;

  const dia = diaDaSemana(data);

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

  // No modo livre do /admin (contexto='admin') a janela de agendamento não
  // bloqueia mais o cálculo — o dia já foi liberado antes, no calendário (ver
  // CalendarioDias/modoLivre). No público, comportamento de sempre.
  if (contexto !== "admin" && !dentroDaJanelaAgendamento(data, estab)) return mapa;

  const granularidade =
    Number(estab?.granularidade_min) > 0
      ? Number(estab.granularidade_min)
      : GRANULARIDADE_MIN;

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

  // Snapshot dos candidatos ANTES das exceções — só usado no contexto='admin',
  // pra distinguir depois um slot removido por ausência ('excecao_ausencia')
  // de um que nunca teria sido candidato do expediente/modo normal
  // ('fora_do_modo'). Clona os Sets: aplicarExcecoes muta in-place o
  // conjunto original logo abaixo.
  const candidatosAntesDeExcecoes =
    contexto === "admin"
      ? new Map(
          profissionalIds.map((id) => [
            id,
            new Set(candidatosPorProfissional.get(id) ?? []),
          ])
        )
      : null;

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

  if (contexto === "admin") {
    // Grade "dia inteiro": 00:00 até o último horário em que o serviço ainda
    // termina dentro do dia (m + duracao <= 24h), na granularidade do salão —
    // independente do expediente/modo configurado de cada profissional.
    const gradeCompleta = [];
    for (let m = 0; m + duracao <= 24 * 60; m += granularidade) {
      gradeCompleta.push(minParaHHMM(m));
    }

    for (const profissionalId of profissionalIds) {
      const ocupados = ocupadosPorProfissional.get(profissionalId) ?? [];
      const candidatosFinal = candidatosPorProfissional.get(profissionalId) ?? new Set();
      const candidatosAntes = candidatosAntesDeExcecoes.get(profissionalId) ?? new Set();

      for (const slot of gradeCompleta) {
        const candInicio = horaParaMin(slot);
        const candFim = candInicio + duracao;
        const sobrepoe = ocupados.some(
          (iv) => candInicio < iv.fim && iv.inicio < candFim
        );
        // Sobreposição com agendamento real: nunca aparece, nem livre nem
        // bloqueado — igual ao contexto público.
        if (sobrepoe) continue;

        const entrada = (mapa[slot] ??= { livres: [], bloqueados: [] });

        if (candidatosFinal.has(slot)) {
          entrada.livres.push(profissionalId);
        } else if (candidatosAntes.has(slot)) {
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
