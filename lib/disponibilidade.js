import { supabase } from "@/lib/supabaseClient";
import { gerarSlotsDaJanela, DURACAO_MINUTOS } from "@/lib/horarios";

// Disponibilidade POR PROFISSIONAL de um serviço numa data.
//
// Diferente de lib/horarios.js (grade única da loja), aqui cada profissional
// tem a SUA janela de trabalho (horarios_trabalho) para o dia da semana, e a
// vaga de um horário depende de quem, entre os que atendem o serviço, ainda
// está livre naquele instante. O resultado é um mapa horário → profissionais
// livres, que a UI de agendamento usa depois para oferecer/atribuir.
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
//   1. o horário está na grade DELE (gerarSlotsDaJanela sobre a janela do dia); e
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

  // Duração do serviço: define o passo/fechamento dos slots e o tamanho do
  // intervalo candidato na checagem de sobreposição.
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

  // Profissionais ATIVOS do estabelecimento que atendem este serviço.
  // O !inner com filtros na tabela embutida transforma o vínculo N:N em um
  // filtro efetivo (só volta linha cujo profissional casa ativo + salão).
  const { data: vinculos, error: erroVinculos } = await supabase
    .from("servico_profissional")
    .select("profissional_id, profissionais!inner(ativo, estabelecimento_id)")
    .eq("servico_id", servicoId)
    .eq("profissionais.ativo", true)
    .eq("profissionais.estabelecimento_id", estabelecimentoId);
  if (erroVinculos) throw erroVinculos;

  const profissionalIds = (vinculos ?? []).map((v) => v.profissional_id);
  if (profissionalIds.length === 0) return mapa;

  // Grade de trabalho de cada profissional NESTE dia da semana. Sem linha =
  // não trabalha no dia; esse profissional simplesmente não aparece aqui.
  const { data: grades, error: erroGrades } = await supabase
    .from("horarios_trabalho")
    .select("profissional_id, hora_inicio, hora_fim, almoco_inicio, almoco_fim")
    .in("profissional_id", profissionalIds)
    .eq("dia_semana", dia);
  if (erroGrades) throw erroGrades;

  // Agendamentos ativos (status <> 'cancelado') do dia, para saber quem já
  // está ocupado. Agrupa os intervalos [inicio, fim) por profissional.
  const { data: reservas, error: erroReservas } = await supabase
    .from("agendamentos")
    .select("profissional_id, horario, duracao_min")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("data", data)
    .neq("status", "cancelado");
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

  // Monta o mapa: para cada profissional que trabalha no dia, gera os slots da
  // janela dele e adiciona o id nos horários em que não há sobreposição.
  for (const grade of grades ?? []) {
    const slots = gerarSlotsDaJanela(
      {
        inicio: grade.hora_inicio,
        fim: grade.hora_fim,
        almocoInicio: grade.almoco_inicio,
        almocoFim: grade.almoco_fim,
      },
      duracao
    );

    const ocupados = ocupadosPorProfissional.get(grade.profissional_id) ?? [];

    for (const slot of slots) {
      const candInicio = horaParaMin(slot);
      const candFim = candInicio + duracao;
      const sobrepoe = ocupados.some(
        (iv) => candInicio < iv.fim && iv.inicio < candFim
      );
      if (sobrepoe) continue;

      (mapa[slot] ??= []).push(grade.profissional_id);
    }
  }

  return mapa;
}

// Profissionais LIVRES para atender (serviço, data, horário) — usado pela troca
// de profissional no /admin. Reaproveita calcularVagasPorHorario (a mesma regra
// de janela + anti-sobreposição) e só resolve os NOMES dos ids livres naquele
// horário. Retorna [{ id, nome }] ordenado por nome; [] se ninguém livre.
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
