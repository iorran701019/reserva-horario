import { createClient } from "@supabase/supabase-js";
import { autorizarAdminEstabelecimento } from "@/lib/apiAuth";
import { obterAccessTokenDoTenant } from "@/lib/googleCalendarToken";
import { listarEventosFuturos, montarCandidatos } from "@/lib/googleCalendarImportacao";

function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Candidatos a importar do calendário de atendimento escolhido (ver
// ConfiguracoesSalao.js -> estabelecimentos.google_calendar_id_importacao):
// importação DIRETA, sem revisão linha-a-linha — só data/horário/duração/
// título bruto do evento (ver lib/googleCalendarImportacao). Também resolve o
// profissional ATIVO do tenant aqui (não hardcoded), pro POST gravar o
// agendamento já ocupando a agenda dele.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const estabelecimentoId = Number(searchParams.get("estabelecimento_id"));

  if (!estabelecimentoId || Number.isNaN(estabelecimentoId)) {
    return new Response("estabelecimento_id ausente.", { status: 400 });
  }

  const autorizado = await autorizarAdminEstabelecimento(request, estabelecimentoId);
  if (!autorizado) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseAdmin = supabaseServiceRole();

  const accessToken = await obterAccessTokenDoTenant(estabelecimentoId, supabaseAdmin);
  if (!accessToken) {
    return Response.json({ erro: "Google Calendar não conectado." }, { status: 400 });
  }

  const { data: estabelecimento } = await supabaseAdmin
    .from("estabelecimentos")
    .select("google_calendar_id_importacao")
    .eq("id", estabelecimentoId)
    .single();

  const calendarId = estabelecimento?.google_calendar_id_importacao;
  if (!calendarId) {
    return Response.json(
      { erro: "Escolha o calendário de atendimento antes de buscar candidatos." },
      { status: 400 }
    );
  }

  const [profissionalRes, jaImportadosRes, ignoradosRes, servicosRes] = await Promise.all([
    supabaseAdmin
      .from("profissionais")
      .select("id")
      .eq("estabelecimento_id", estabelecimentoId)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("agendamentos")
      .select("google_event_id")
      .eq("estabelecimento_id", estabelecimentoId)
      .not("google_event_id", "is", null),
    supabaseAdmin
      .from("calendar_import_ignorados")
      .select("google_event_id")
      .eq("estabelecimento_id", estabelecimentoId),
    // Catálogo ativo do tenant — sinal de categoria em montarCandidatos (ver
    // categoriaPorTitulo em lib/googleCalendarImportacao): título do evento
    // batendo com o nome de um serviço cadastrado vira 'servico', senão
    // 'pessoal'.
    supabaseAdmin
      .from("servicos")
      .select("nome")
      .eq("estabelecimento_id", estabelecimentoId)
      .eq("ativo", true),
  ]);

  const profissionalId = profissionalRes.data?.id ?? null;
  const idsExcluidos = new Set([
    ...(jaImportadosRes.data ?? []).map((r) => r.google_event_id),
    ...(ignoradosRes.data ?? []).map((r) => r.google_event_id),
  ]);
  const servicos = servicosRes.data ?? [];

  try {
    const eventos = await listarEventosFuturos(accessToken, calendarId);
    const { candidatos, ignoradosPorCatalogo } = montarCandidatos({ eventos, idsExcluidos, servicos });
    return Response.json({ candidatos, ignorados_por_catalogo: ignoradosPorCatalogo, profissional_id: profissionalId });
  } catch (erro) {
    console.error("Falha ao buscar candidatos de importação do Google Calendar", estabelecimentoId, erro);
    return Response.json({ erro: "Não foi possível buscar os eventos do Google Calendar." }, { status: 502 });
  }
}

// Confirma a importação DIRETA: todo candidato do lote vira um agendamento
// 'confirmado' já ocupando o horário, sem cliente/serviço vinculado —
// nome_cliente = título bruto do evento, telefone/servico_id nulos (o vínculo
// com a ficha real acontece depois, ver botão "Vincular cliente" no Painel).
// origem='importado' sempre (mesma convenção da importação por PDF) — o GET
// já filtra pra só devolver candidatos que bateram com o catálogo de serviços
// (ver montarCandidatos em lib/googleCalendarImportacao), então não existe
// mais candidato "pessoal" chegando aqui. 'importado_pessoal' continua sendo
// tratado por PainelCalendario.js só por causa de registros antigos já
// importados antes dessa mudança. O google_event_id original evita duplicar
// no sync de saída (ver
// lib/googleCalendarSync.js). Reconfere o dedup aqui dentro (não confia só no
// que o GET calculou), evitando corrida com uma importação/sync concorrente —
// o filtro é só por google_event_id, então cobre as duas origens igual.
// Uma falha isolada (ex.: 23P01 de horário sobreposto) não derruba o resto do
// lote.
export async function POST(request) {
  const corpo = await request.json();
  const estabelecimentoId = Number(corpo?.estabelecimento_id);
  const itens = Array.isArray(corpo?.itens) ? corpo.itens : [];

  if (!estabelecimentoId || Number.isNaN(estabelecimentoId)) {
    return new Response("estabelecimento_id ausente.", { status: 400 });
  }

  const autorizado = await autorizarAdminEstabelecimento(request, estabelecimentoId);
  if (!autorizado) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseAdmin = supabaseServiceRole();

  const { data: profissional } = await supabaseAdmin
    .from("profissionais")
    .select("id")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();
  const profissionalId = profissional?.id ?? null;

  const { data: jaImportados } = await supabaseAdmin
    .from("agendamentos")
    .select("google_event_id")
    .eq("estabelecimento_id", estabelecimentoId)
    .not("google_event_id", "is", null);
  const idsJaImportados = new Set((jaImportados ?? []).map((r) => r.google_event_id));

  let importados = 0;
  const falhas = [];

  for (const item of itens) {
    if (!item?.google_event_id || !item.data || !item.horario) continue;

    if (idsJaImportados.has(item.google_event_id)) {
      falhas.push({ google_event_id: item.google_event_id, motivo: "Já importado." });
      continue;
    }

    const { error: erroInsert } = await supabaseAdmin.from("agendamentos").insert({
      nome_cliente: (item.titulo_original || "Evento importado").trim() || "Evento importado",
      telefone: null,
      data: item.data,
      horario: item.horario,
      servico_id: null,
      duracao_min: item.duracao_min,
      estabelecimento_id: estabelecimentoId,
      profissional_id: profissionalId,
      status: "confirmado",
      finalizado: false,
      origem: "importado",
      google_event_id: item.google_event_id,
    });

    if (erroInsert) {
      const sobreposicao =
        erroInsert.code === "23P01" || /exclusion constraint/i.test(erroInsert.message ?? "");
      falhas.push({
        google_event_id: item.google_event_id,
        motivo: sobreposicao ? "Horário sobreposto a outro agendamento." : erroInsert.message,
      });
      continue;
    }

    idsJaImportados.add(item.google_event_id);
    importados += 1;
  }

  return Response.json({ importados, falhas });
}
