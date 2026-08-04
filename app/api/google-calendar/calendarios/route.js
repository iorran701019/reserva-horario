import { createClient } from "@supabase/supabase-js";
import { autorizarAdminEstabelecimento } from "@/lib/apiAuth";
import { obterAccessTokenDoTenant } from "@/lib/googleCalendarToken";
import { listarCalendarios } from "@/lib/googleCalendarImportacao";

// Lista os calendários da conta Google conectada (ver
// app/api/google-calendar/callback/route.js), pra dona escolher qual é o de
// atendimento real na tela de importação (ver
// components/ModalImportarGoogleCalendar.js) — nunca expõe o refresh_token,
// só os pares {id, summary} necessários pro dropdown.
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

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const accessToken = await obterAccessTokenDoTenant(estabelecimentoId, supabaseAdmin);
  if (!accessToken) {
    return Response.json({ erro: "Google Calendar não conectado." }, { status: 400 });
  }

  try {
    const calendarios = await listarCalendarios(accessToken);
    return Response.json({ calendarios });
  } catch (erro) {
    console.error("Falha ao listar calendários do Google Calendar", estabelecimentoId, erro);
    return Response.json({ erro: "Não foi possível listar os calendários." }, { status: 502 });
  }
}
