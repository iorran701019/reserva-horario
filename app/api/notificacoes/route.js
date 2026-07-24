import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

// Recebe o Database Webhook do Supabase em `agendamentos` (INSERT/UPDATE) e
// dispara push notification pra dona do salão via web-push, usando as
// inscrições salvas em `push_subscriptions` (ver components/AtivarNotificacoes.js).
// Protegido por um header secreto — não é um endpoint público de app.
//
// Casos que geram notificação:
//   a) INSERT com status "pendente" -> novo agendamento aguardando confirmação.
//   b) UPDATE pra status "cancelado" com cancelado_por_cliente true (cancelamento
//      pelo painel público, ver components/PainelCliente.js) -> avisa a dona.
// Qualquer outro evento responde 200 sem fazer nada.

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function formatarDataHorario(data, horario) {
  if (!data) return horario ?? "";
  const [ano, mes, dia] = data.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  const dataFormatada = `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")} · ${DIAS_SEMANA[d.getDay()]}`;
  return horario ? `${dataFormatada} às ${horario}` : dataFormatada;
}

export async function POST(request) {
  const segredoRecebido = request.headers.get("x-webhook-secret");
  if (!segredoRecebido || segredoRecebido !== process.env.NOTIFICACAO_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { type, record, old_record } = await request.json();

  const ehNovoPendente = type === "INSERT" && record?.status === "pendente";
  const ehCanceladoPelaCliente =
    type === "UPDATE" &&
    record?.status === "cancelado" &&
    record?.cancelado_por_cliente === true &&
    old_record?.status !== "cancelado";

  if (!ehNovoPendente && !ehCanceladoPelaCliente) {
    return new Response("OK", { status: 200 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const quando = formatarDataHorario(record.data, record.horario);
  let titulo;
  let corpo;

  if (ehNovoPendente) {
    let nomeServico = record.servico_livre;
    if (record.servico_id) {
      const { data: servico } = await supabaseAdmin
        .from("servicos")
        .select("nome")
        .eq("id", record.servico_id)
        .single();
      nomeServico = servico?.nome ?? nomeServico;
    }
    titulo = `Pendente: ${record.nome_cliente}`;
    corpo = `${record.nome_cliente} · ${nomeServico ?? "serviço"} · ${quando}`;
  } else {
    titulo = `Cancelado: ${record.nome_cliente}`;
    corpo = `${record.nome_cliente} · ${quando}`;

    // Além do push (efêmero), deixa um registro persistente na aba Pendentes
    // do /admin (ver sql/pendencias_admin.sql) — a dona pode não estar com o
    // navegador aberto quando o push chega.
    const { error: erroPendencia } = await supabaseAdmin
      .from("pendencias_admin")
      .insert({
        estabelecimento_id: record.estabelecimento_id,
        tipo: "cancelamento_cliente",
        titulo: `Cancelamento: ${record.nome_cliente}`,
        descricao: `Cancelou o agendamento de ${quando}.`,
        agendamento_id: record.id,
      });
    if (erroPendencia) {
      console.error("Falha ao registrar pendência de cancelamento", erroPendencia);
    }
  }

  const { data: estabelecimento } = await supabaseAdmin
    .from("estabelecimentos")
    .select("slug")
    .eq("id", record.estabelecimento_id)
    .single();

  const { data: inscricoes } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, chave_p256dh, chave_auth")
    .eq("estabelecimento_id", record.estabelecimento_id)
    .eq("ativo", true);

  webpush.setVapidDetails(
    "mailto:contato@agendamento-salao.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const url = estabelecimento?.slug ? `/${estabelecimento.slug}/admin` : "/";
  const payloadNotificacao = JSON.stringify({ title: titulo, body: corpo, url });

  await Promise.all(
    (inscricoes ?? []).map(async (inscricao) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: inscricao.endpoint,
            keys: { p256dh: inscricao.chave_p256dh, auth: inscricao.chave_auth },
          },
          payloadNotificacao
        );
      } catch (erro) {
        if (erro.statusCode === 404 || erro.statusCode === 410) {
          await supabaseAdmin
            .from("push_subscriptions")
            .update({ ativo: false })
            .eq("id", inscricao.id);
        } else {
          console.error("Falha ao enviar push notification", inscricao.id, erro);
        }
      }
    })
  );

  return new Response("OK", { status: 200 });
}
