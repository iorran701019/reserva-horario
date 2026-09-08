import { randomBytes } from "node:crypto";

// Cadastro do webhook de pagamento na conta AbacatePay do salão — a segunda
// metade de "conectar a conta". Existe como lib porque DOIS caminhos fazem o
// mesmo cadastro e não podem divergir: o POST de credencial
// (app/api/abacatepay/credenciais/route.js), quando o dono cola a chave, e o
// botão de "tentar de novo" da tela de configurações
// (app/api/abacatepay/credenciais/webhook/route.js), quando esse primeiro
// cadastro falhou.
//
// O `webhook_secret` gerado aqui é o que
// app/api/abacatepay/webhook/route.js usa pra validar a assinatura HMAC dos
// eventos daquele salão — por isso ele é POR TENANT, e não mais a env global
// ABACATEPAY_WEBHOOK_SECRET que a versão anterior usava pra todo mundo.
const ABACATEPAY_WEBHOOKS = "https://api.abacatepay.com/v2/webhooks";

// URL fixa de produção: é o endereço que a AbacatePay vai chamar, então não
// pode ser derivado do host do request (em dev isso viraria um localhost que
// eles nunca alcançam).
const URL_WEBHOOK = "https://reserva-horario.vercel.app/api/abacatepay/webhook";

// Nome fixo: é o rótulo que aparece no painel da AbacatePay do dono do salão,
// então precisa dizer de onde veio sem depender do nome do salão (que ele pode
// renomear depois, deixando o webhook com um nome que não bate com nada).
const NOME_WEBHOOK = "Reserva Horário - Confirmação de Pix";

// Só o evento que app/api/abacatepay/webhook/route.js realmente processa. O QR
// Code Pix daqui é criado via /transparents/create, e o pagamento dele chega
// como `transparent.completed` — NÃO como `checkout.completed`, que é o
// evento do checkout hospedado deles e nunca vai disparar pra nós. Assinar
// refunded/disputed só encheria o endpoint de evento que a rota descarta.
const EVENTOS_WEBHOOK = ["transparent.completed"];

// Um erro sem o corpo da resposta é indiagnosticável: "HTTP 400" não diz qual
// campo do payload eles recusaram. Então o corpo ENTRA no log — mas passando
// por aqui antes.
//
// O motivo do cuidado continua valendo: o corpo que a gente manda no create
// contém o `secret`, e uma resposta de erro que ecoa o payload enviado
// colocaria esse segredo no log — a mesma regra que já vale pra api_key em
// todas as rotas. Por isso nada sai daqui sem passar por semSegredos(), e o
// texto é truncado pra não despejar um HTML de erro inteiro no console.
const CAMPOS_SENSIVEIS = /("(?:secret|apiKey|api_key|token|authorization)"\s*:\s*)"[^"]*"/gi;
const LIMITE_DETALHE = 500;

function semSegredos(texto) {
  return texto.replace(CAMPOS_SENSIVEIS, '$1"[oculto]"');
}

function detalheDoCorpo(json) {
  if (json == null) return null;

  // `error` às vezes é objeto ({ message }), às vezes é a própria string.
  const detalhe = json?.error?.message ?? json?.message ?? json?.error;
  if (typeof detalhe === "string" && detalhe.trim()) {
    return semSegredos(detalhe.trim()).slice(0, LIMITE_DETALHE);
  }

  // Último recurso: o corpo inteiro. É o que salva quando eles devolvem um
  // formato de erro que a gente ainda não conhece.
  try {
    return semSegredos(JSON.stringify(json)).slice(0, LIMITE_DETALHE);
  } catch {
    return null;
  }
}

function mensagemDeErro(resposta, json) {
  const detalhe = detalheDoCorpo(json);
  if (!resposta.ok) {
    return detalhe ? `HTTP ${resposta.status}: ${detalhe}` : `HTTP ${resposta.status}`;
  }
  return detalhe ?? "resposta inesperada";
}

// Remove um webhook da conta do salão. NUNCA lança e nunca bloqueia quem
// chama: é sempre um passo acessório (desconectar a conta, ou limpar o
// cadastro velho antes de criar o novo). Webhook que sobra órfão do lado
// deles é inofensivo — sem o secret correspondente na nossa tabela, todo
// evento que ele entregar é rejeitado com 401 pelo nosso endpoint.
//
// Formato real: POST /v2/webhooks/delete com o `id` na QUERY STRING e corpo
// vazio. A doc oficial (docs.abacatepay.com/pages/webhooks/delete) descreve o
// `id` no corpo JSON, mas o comportamento real é outro — confirmado sondando
// as variantes contra a API em 08/09:
//   POST /delete?id=...            -> passa da validação (chega no 401 de auth)
//   POST /delete + body {"id":...} -> SEMPRE 422 "Expected property 'id' to be
//                                     string but found: undefined" (o corpo é
//                                     ignorado por completo)
//   DELETE /delete?id=...          -> 400 "Not found"
export async function removerWebhookAbacatepay(apiKey, webhookId) {
  try {
    const resposta = await fetch(
      `${ABACATEPAY_WEBHOOKS}/delete?id=${encodeURIComponent(webhookId)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    const json = await resposta.json().catch(() => null);

    if (!resposta.ok || json?.error || json?.success === false) {
      console.error("Falha ao remover webhook na AbacatePay", webhookId, mensagemDeErro(resposta, json));
      return { ok: false };
    }

    return { ok: true };
  } catch (erro) {
    console.error("Falha ao remover webhook na AbacatePay", webhookId, erro?.message ?? "erro de rede");
    return { ok: false };
  }
}

// Cria o webhook e grava id + secret na linha do salão. Devolve { ok } em vez
// de lançar porque a falha aqui é PARCIAL por definição: a api_key do salão já
// está salva e continua servindo pro QR Code (gerar-cobranca e status só
// precisam dela). O que se perde sem webhook é a confirmação automática da
// cliente que paga e fecha o navegador — grave, mas não é motivo pra desfazer
// a conexão inteira.
export async function configurarWebhookAbacatepay(
  estabelecimentoId,
  apiKey,
  supabaseAdmin,
  webhookIdAnterior = null
) {
  // Sem isso, cada clique em "tentar de novo" deixaria mais um webhook vivo no
  // painel deles, todos apontando pra cá e só o último com secret conhecido —
  // os outros virariam 401 permanente e ruído de reentrega.
  if (webhookIdAnterior) {
    await removerWebhookAbacatepay(apiKey, webhookIdAnterior);
  }

  const secret = randomBytes(32).toString("hex");

  let webhookId;
  let secretFinal;
  try {
    const resposta = await fetch(`${ABACATEPAY_WEBHOOKS}/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // Formato documentado do POST /v2/webhooks/create: name, endpoint
      // (NÃO "url"), secret e events como array. A versão anterior mandava
      // { url, secret } e era recusada.
      body: JSON.stringify({
        name: NOME_WEBHOOK,
        endpoint: URL_WEBHOOK,
        secret,
        events: EVENTOS_WEBHOOK,
      }),
    });
    const json = await resposta.json().catch(() => null);

    if (!resposta.ok || json?.error || json?.success === false) {
      throw new Error(mensagemDeErro(resposta, json));
    }

    const dados = json?.data ?? json;
    webhookId = dados?.id;
    if (!webhookId) throw new Error("resposta sem id de webhook");

    // Se eles devolverem o secret, é o dele que vale — pode ser que ignorem o
    // nosso e gerem um próprio. Só cai no nosso quando a resposta não traz
    // nenhum.
    secretFinal = typeof dados?.secret === "string" ? dados.secret : secret;
  } catch (erro) {
    console.error(
      "Falha ao criar webhook na AbacatePay",
      estabelecimentoId,
      erro?.message ?? "erro de rede"
    );
    return { ok: false };
  }

  // .select(...) + checagem de 0 linhas é o padrão do projeto: update que não
  // pega linha nenhuma volta com error null. Aqui isso importa de verdade — o
  // webhook JÁ existe na conta deles, e sem o secret gravado todo evento dele
  // seria rejeitado. Tratar como falha faz a tela mostrar "pendente" e o
  // próximo retry recriar o par inteiro.
  const { data: linhas, error: erroUpdate } = await supabaseAdmin
    .from("abacatepay_credenciais")
    .update({ webhook_id: webhookId, webhook_secret: secretFinal })
    .eq("estabelecimento_id", estabelecimentoId)
    .select("estabelecimento_id");

  if (erroUpdate || !linhas || linhas.length === 0) {
    console.error(
      "Webhook criado na AbacatePay mas NÃO gravado na credencial",
      estabelecimentoId,
      erroUpdate
    );
    return { ok: false };
  }

  return { ok: true };
}
