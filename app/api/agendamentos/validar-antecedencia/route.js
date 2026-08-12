import { createClient } from "@supabase/supabase-js";
import { filtrarPorAntecedenciaMinima } from "@/lib/disponibilidade";

// Revalida, no relógio do SERVIDOR, se (data, horario) ainda respeita a
// antecedência mínima do salão — chamada por selecionarHorario/
// finalizarAgendamento (ver components/FormularioAgendamento.js) logo antes
// de qualquer insert em `agendamentos`, pra fechar o caminho de quem
// adianta/atrasa o relógio do navegador pra escapar do filtro client-side
// (mesma checagem, filtrarPorAntecedenciaMinima, só que `new Date()` aqui é
// o relógio do processo Node, não o do cliente).
export async function POST(request) {
  const { estabelecimentoId, data, horario } = await request.json();

  if (!estabelecimentoId || !data || !horario) {
    return Response.json(
      { permitido: false, erro: "Parâmetros obrigatórios ausentes." },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );

  const { data: estabelecimento, error } = await supabase
    .from("estabelecimentos")
    .select("antecedencia_minima_horas, cutoff_dia_seguinte_ativo, cutoff_dia_seguinte_hora")
    .eq("id", estabelecimentoId)
    .single();

  if (error) {
    return Response.json({ permitido: false, erro: error.message }, { status: 500 });
  }

  const horarioHHMM = String(horario).slice(0, 5);
  const restante = filtrarPorAntecedenciaMinima(
    { [horarioHHMM]: true },
    data,
    estabelecimento
  );

  return Response.json({ permitido: Boolean(restante[horarioHHMM]) });
}
