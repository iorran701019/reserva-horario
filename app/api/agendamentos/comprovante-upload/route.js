import { createClient } from "@supabase/supabase-js";

// Emite um token de upload assinado pro comprovante de Pix de UM agendamento —
// o que substitui as policies anon de INSERT/UPDATE/SELECT no bucket privado
// `comprovantes-pix`.
//
// O problema que essa rota existe pra resolver: o `upsert: true` do upload
// direto exigia SELECT anon no bucket, e SELECT anon num bucket inteiro
// significa qualquer anônimo listando e baixando o comprovante de TODAS as
// clientes; as policies de INSERT/UPDATE deixavam gravar qualquer arquivo em
// qualquer caminho. Com o token assinado, o `uploadToSignedUrl` do navegador
// não precisa de policy NENHUMA (quem autoriza é o token, não o papel), e a
// decisão de "pode gravar? em que caminho?" passa a morar aqui, no service
// role.
//
// Rota PÚBLICA (a cliente ainda não tem sessão), pelo mesmo motivo e com a
// mesma defesa de abacatepay/status: o único parâmetro é o id de um
// agendamento que a própria cliente acabou de criar, e o token que volta só
// serve pro caminho DAQUELE agendamento. O pior caso de quem conhece um id é
// sobrescrever o comprovante daquele agendamento — exatamente o que a policy
// antiga já permitia, só que agora sem poder tocar no de mais ninguém.
//
// As validações são deliberadamente as MESMAS de
// `agendamento_anexar_comprovante` (sql/rpcs_agendamento_publico.sql): salão
// ativo e status em ('aguardando_sinal', 'pendente'). A RPC continua rodando
// depois do upload e segue sendo a segunda trava — quem grava o caminho na
// linha é ela, não esta rota.
function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const BUCKET_COMPROVANTES = "comprovantes-pix";

// Lista FECHADA de tipos aceitos, e a única fonte da extensão do arquivo —
// antes ela vinha de `arquivo.name.split(".").pop()` no navegador, sem
// sanitização nenhuma.
//
// Cada entrada devolve também o contentType CANÔNICO, não o que o navegador
// mandou: `image/jpg` (variante que aparece em alguns Androids) vira
// `image/jpeg`. Isso importa porque o `allowed_mime_types` do bucket é
// conferido contra o content-type do upload — um alias não-canônico seria
// recusado pelo Storage depois que o bucket for apertado.
const TIPOS_ACEITOS = {
  "image/jpeg": { extensao: "jpg", contentType: "image/jpeg" },
  "image/jpg": { extensao: "jpg", contentType: "image/jpeg" },
  "image/png": { extensao: "png", contentType: "image/png" },
  "image/webp": { extensao: "webp", contentType: "image/webp" },
  "image/heic": { extensao: "heic", contentType: "image/heic" },
  "image/heif": { extensao: "heif", contentType: "image/heif" },
  "application/pdf": { extensao: "pdf", contentType: "application/pdf" },
};

// Mesma lista, indexada por extensão: é o fallback pro Android que manda
// `file.type === ""` (arquivo escolhido num gerenciador de arquivos em vez da
// galeria). Só é consultada quando NÃO veio contentType — um contentType
// presente e fora da lista é 400, nunca cai aqui.
const EXTENSOES_ACEITAS = {
  jpg: TIPOS_ACEITOS["image/jpeg"],
  jpeg: TIPOS_ACEITOS["image/jpeg"],
  png: TIPOS_ACEITOS["image/png"],
  webp: TIPOS_ACEITOS["image/webp"],
  heic: TIPOS_ACEITOS["image/heic"],
  heif: TIPOS_ACEITOS["image/heif"],
  pdf: TIPOS_ACEITOS["application/pdf"],
};

// Formato do id, conferido antes de ir ao banco: um `agendamentoId` que não é
// uuid faria o PostgREST devolver 22P02, que viraria um 500 enganoso pra
// aquilo que é só um id inexistente.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolverTipo(contentType, nomeArquivo) {
  // `split(";")` porque o navegador pode mandar parâmetros junto
  // ("image/jpeg; charset=..."), que não fazem parte da chave.
  const tipo = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (tipo) return TIPOS_ACEITOS[tipo] ?? null;

  const extensao = String(nomeArquivo || "")
    .toLowerCase()
    .split(".")
    .pop();

  return EXTENSOES_ACEITAS[extensao] ?? null;
}

export async function POST(request) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    corpo = null;
  }

  const { agendamentoId, contentType, nomeArquivo } = corpo ?? {};

  if (!agendamentoId || !UUID.test(String(agendamentoId))) {
    return Response.json({ erro: "agendamentoId inválido." }, { status: 400 });
  }

  const tipo = resolverTipo(contentType, nomeArquivo);

  if (!tipo) {
    return Response.json(
      { erro: "Tipo de arquivo não aceito. Envie uma imagem ou um PDF." },
      { status: 400 }
    );
  }

  const supabaseAdmin = supabaseServiceRole();

  const { data: agendamento, error: erroAgendamento } = await supabaseAdmin
    .from("agendamentos")
    .select("id, status, estabelecimento_id")
    .eq("id", agendamentoId)
    .maybeSingle();

  if (erroAgendamento) {
    console.error("Falha ao buscar agendamento pro upload do comprovante", agendamentoId, erroAgendamento);
    return Response.json({ erro: "Não foi possível enviar o comprovante agora." }, { status: 500 });
  }

  if (!agendamento) {
    return Response.json({ erro: "Agendamento não encontrado." }, { status: 404 });
  }

  const { data: estabelecimento, error: erroEstabelecimento } = await supabaseAdmin
    .from("estabelecimentos")
    .select("ativo")
    .eq("id", agendamento.estabelecimento_id)
    .maybeSingle();

  if (erroEstabelecimento) {
    console.error("Falha ao buscar estabelecimento pro upload do comprovante", agendamentoId, erroEstabelecimento);
    return Response.json({ erro: "Não foi possível enviar o comprovante agora." }, { status: 500 });
  }

  // 409, não 404: o agendamento existe, o que não vale é o ESTADO dele. Um
  // 'confirmado' já foi conferido pelo salão e não aceita comprovante novo; um
  // 'cancelado' não ressuscita por anexo. Mesma régua da RPC.
  if (!estabelecimento?.ativo || !["aguardando_sinal", "pendente"].includes(agendamento.status)) {
    return Response.json(
      { erro: "Esta reserva não aceita mais o envio de comprovante." },
      { status: 409 }
    );
  }

  // O mesmo padrão que a RPC valida na hora de gravar na linha:
  // '<id do agendamento>/comprovante.<extensao>'. Montado AQUI, com a extensão
  // da lista fechada — o navegador não escolhe mais o caminho.
  const caminho = `${agendamento.id}/comprovante.${tipo.extensao}`;

  // `upsert: true` precisa vir daqui: no `uploadToSignedUrl` do cliente a
  // opção é ignorada (é o token que carrega a permissão de sobrescrever). Sem
  // ela o reenvio do mesmo tipo de arquivo falharia com "já existe".
  const { data: assinatura, error: erroAssinatura } = await supabaseAdmin.storage
    .from(BUCKET_COMPROVANTES)
    .createSignedUploadUrl(caminho, { upsert: true });

  if (erroAssinatura || !assinatura?.token) {
    console.error("Falha ao assinar upload do comprovante", agendamentoId, erroAssinatura);
    return Response.json({ erro: "Não foi possível enviar o comprovante agora." }, { status: 500 });
  }

  // Só `caminho`, `token` e o contentType canônico. A `signedUrl` completa NÃO
  // volta de propósito: o `uploadToSignedUrl` remonta a URL a partir do
  // caminho + token, e devolver a URL inteira só aumentaria a superfície do
  // que aparece em log de rede.
  return Response.json({
    caminho,
    token: assinatura.token,
    contentType: tipo.contentType,
  });
}
