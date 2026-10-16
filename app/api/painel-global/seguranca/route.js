import { createClient } from "@supabase/supabase-js";
import { autorizarGlobal } from "@/lib/apiAuth";
import { gerarSenhaProvisoria } from "@/lib/senhaProvisoria";

// Aba "Segurança" do /painel-global: estado do acesso da dona de cada salão e
// as duas ações (exigir a troca de credenciais; resetar o acesso com senha
// provisória). SÓ papel 'global' (autorizarGlobal).
//
// O alvo é sempre resolvido aqui, pelo estabelecimento_id: o corpo nunca
// carrega user_id. A conta-alvo é a ÚNICA com papel 'dono' no salão; com 0 ou
// 2+ a ação é recusada (o caso de várias contas fica em aberto no código).
// Nenhuma resposta nem log carrega e-mail; a senha só volta no POST 'resetar',
// uma única vez, com no-store, e nunca é logada.

const SEM_CACHE = { "Cache-Control": "no-store" };

function responder(corpo, status = 200) {
  return Response.json(corpo, { status, headers: SEM_CACHE });
}

function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function negado(auth) {
  return responder(
    auth.status === 401
      ? { codigo: "sem_sessao", erro: "Sua sessão expirou. Entre de novo." }
      : { codigo: "sem_permissao", erro: "Apenas o painel global pode fazer isso." },
    auth.status
  );
}

function estadoDe(donas) {
  if (donas.length === 0) return "sem_dona";
  if (donas.length > 1) return "varias_contas";
  return "ok";
}

export async function GET(request) {
  const auth = await autorizarGlobal(request);
  if (!auth.ok) return negado(auth);

  const admin = supabaseServiceRole();
  const { data: saloes, error: erroSaloes } = await admin
    .from("estabelecimentos")
    .select("id, slug, nome, whatsapp")
    .eq("ativo", true)
    .order("nome");
  if (erroSaloes) {
    console.error("seguranca GET: leitura de estabelecimentos falhou", erroSaloes.code);
    return responder({ codigo: "erro_interno", erro: "Não foi possível carregar os salões." }, 500);
  }

  const { data: perfis, error: erroPerfis } = await admin
    .from("perfis")
    .select("user_id, estabelecimento_id, precisa_trocar_credenciais, troca_exigida_em")
    .eq("papel", "dono")
    .in("estabelecimento_id", saloes.map((s) => s.id));
  if (erroPerfis) {
    console.error("seguranca GET: leitura de perfis falhou", erroPerfis.code);
    return responder({ codigo: "erro_interno", erro: "Não foi possível carregar as contas." }, 500);
  }

  const itens = await Promise.all(
    saloes.map(async (s) => {
      const donas = (perfis ?? []).filter((p) => p.estabelecimento_id === s.id);
      const estado = estadoDe(donas);
      let email = null;
      let credenciaisProprias = false;
      if (estado === "ok") {
        const { data, error } = await admin.auth.admin.getUserById(donas[0].user_id);
        if (error) console.error("seguranca GET: getUserById falhou", error.code, error.status);
        email = data?.user?.email ?? null;
        credenciaisProprias = data?.user?.app_metadata?.credenciais_proprias === true;
      }
      return {
        id: s.id,
        slug: s.slug,
        nome: s.nome,
        whatsapp: s.whatsapp ?? null,
        email,
        credenciais_proprias: credenciaisProprias,
        precisa_trocar_credenciais: estado === "ok" ? donas[0].precisa_trocar_credenciais === true : false,
        troca_exigida_em: estado === "ok" ? donas[0].troca_exigida_em ?? null : null,
        estado,
      };
    })
  );

  return responder({ saloes: itens });
}

export async function POST(request) {
  const auth = await autorizarGlobal(request);
  if (!auth.ok) return negado(auth);

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return responder({ codigo: "corpo_invalido", erro: "Pedido inválido." }, 400);
  }

  const estabelecimentoId = Number(corpo?.estabelecimento_id);
  const acao = corpo?.acao;
  if (!Number.isInteger(estabelecimentoId) || estabelecimentoId <= 0 || !["exigir_troca", "resetar"].includes(acao)) {
    return responder({ codigo: "corpo_invalido", erro: "Pedido inválido." }, 400);
  }

  const admin = supabaseServiceRole();

  const { data: salao, error: erroSalao } = await admin
    .from("estabelecimentos")
    .select("id")
    .eq("id", estabelecimentoId)
    .eq("ativo", true)
    .maybeSingle();
  if (erroSalao) {
    console.error("seguranca POST: leitura do salao falhou", erroSalao.code);
    return responder({ codigo: "erro_interno", erro: "Não foi possível verificar o salão." }, 500);
  }
  if (!salao) return responder({ codigo: "salao_inexistente", erro: "Salão não encontrado." }, 404);

  const { data: donas, error: erroDonas } = await admin
    .from("perfis")
    .select("user_id, papel")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("papel", "dono");
  if (erroDonas) {
    console.error("seguranca POST: leitura de perfis falhou", erroDonas.code);
    return responder({ codigo: "erro_interno", erro: "Não foi possível verificar a conta." }, 500);
  }
  if (donas.length === 0) {
    return responder({ codigo: "sem_dona", erro: "Este salão não tem conta de dona." }, 409);
  }
  if (donas.length > 1) {
    return responder(
      { codigo: "varias_contas", erro: "Este salão tem mais de uma conta de dona. Esta ação ainda não cobre esse caso." },
      409
    );
  }
  const alvo = donas[0];
  // Redundante com o filtro acima; mantido como trava explícita.
  if (alvo.papel === "global" || alvo.user_id === auth.userId) {
    return responder({ codigo: "alvo_invalido", erro: "Esta conta não pode ser alterada aqui." }, 403);
  }

  // Quem já tem e-mail próprio não precisa do modo com e-mail: o caminho é o
  // reset (só senha). Lê antes de alterar qualquer coisa.
  if (acao === "exigir_troca") {
    const { data: alvoAuth, error: erroLeitura } = await admin.auth.admin.getUserById(alvo.user_id);
    if (erroLeitura || !alvoAuth?.user) {
      console.error("seguranca POST: getUserById falhou", erroLeitura?.code, erroLeitura?.status);
      return responder({ codigo: "erro_interno", erro: "Não foi possível verificar a conta agora." }, 500);
    }
    if (alvoAuth.user.app_metadata?.credenciais_proprias === true) {
      return responder(
        {
          codigo: "ja_tem_credenciais_proprias",
          erro: "Esta dona já tem e-mail próprio. Use Resetar acesso para trocar só a senha.",
        },
        409
      );
    }
  }

  // Marca primeiro, nos dois fluxos: se o passo seguinte do reset falhar, a
  // dona fica travada pela troca (seguro), nunca com senha nova sem a marca.
  // troca_exigida_em decide aviso x bloqueio (lib/avisoTrocaCredenciais.js):
  //   - resetar: null (bloqueio na hora);
  //   - exigir_troca: agora, mas SÓ se a marca estava desligada. Com a marca
  //     já ligada, troca_exigida_em fica fora do update: mantém a data
  //     existente (o relógio dos 30 dias não reinicia a cada clique) ou o null
  //     de um reset (continua bloqueada).
  const { data: atual, error: erroAtual } = await admin
    .from("perfis")
    .select("precisa_trocar_credenciais")
    .eq("user_id", alvo.user_id)
    .maybeSingle();
  if (erroAtual || !atual) {
    console.error("seguranca POST: leitura da marca falhou", erroAtual?.code ?? "0 linhas");
    return responder({ codigo: "erro_interno", erro: "Não foi possível exigir a troca agora." }, 500);
  }
  const atualizacao = { precisa_trocar_credenciais: true };
  if (acao === "resetar") atualizacao.troca_exigida_em = null;
  else if (atual.precisa_trocar_credenciais !== true) atualizacao.troca_exigida_em = new Date().toISOString();

  const { data: linhas, error: erroMarca } = await admin
    .from("perfis")
    .update(atualizacao)
    .eq("user_id", alvo.user_id)
    .select("user_id");
  if (erroMarca || !linhas?.length) {
    console.error("seguranca POST: marca nao ligada", erroMarca?.code ?? "0 linhas");
    return responder({ codigo: "erro_interno", erro: "Não foi possível exigir a troca agora." }, 500);
  }

  if (acao === "exigir_troca") {
    // Sai do modo só-senha de um reset anterior: o cartão da dona volta a pedir
    // e-mail e senha. A marca já está ligada; se isto falhar ela fica travada,
    // só que no modo antigo.
    const { error: erroModo } = await admin.auth.admin.updateUserById(alvo.user_id, {
      app_metadata: { troca_so_senha: null },
    });
    if (erroModo) {
      console.error("seguranca POST: limpeza de troca_so_senha falhou", erroModo.code, erroModo.status);
      return responder(
        {
          codigo: "erro_interno",
          erro: "A troca foi exigida, mas não foi possível voltar o cartão ao modo com e-mail. Tente de novo.",
        },
        500
      );
    }
    return responder({ ok: true });
  }

  const senha = gerarSenhaProvisoria();
  const { error: erroAuth } = await admin.auth.admin.updateUserById(alvo.user_id, {
    password: senha,
    app_metadata: { troca_so_senha: true },
  });
  if (erroAuth) {
    console.error("seguranca POST: updateUserById falhou", erroAuth.code, erroAuth.status);
    return responder(
      {
        codigo: "erro_interno",
        erro: "A troca foi exigida, mas a senha não pôde ser redefinida. Tente resetar de novo.",
      },
      500
    );
  }

  // Revogação de sessões: o auth-js do repo (2.108.2) só expõe
  // admin.signOut(jwt, escopo), que exige o JWT da própria sessão. Não há API
  // por user_id, então as sessões abertas da dona NÃO são revogadas aqui; a
  // marca ligada já trava o /admin dela até a troca.
  return responder({ senha });
}
