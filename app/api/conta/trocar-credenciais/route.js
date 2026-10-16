import { createClient } from "@supabase/supabase-js";
import { validarEmail, validarSenha } from "@/lib/credenciaisDona";

// Troca obrigatória de e-mail e senha da dona, de dentro do /admin.
//
// Age SÓ no usuário do token (Authorization: Bearer <access_token>, validado
// com a publishable key como em lib/apiAuth.js). O corpo nunca carrega
// user_id nem estabelecimento_id. O perfil é lido com o token do usuário
// (RLS), e a troca só acontece para papel 'dono' com a marca
// perfis.precisa_trocar_credenciais ligada.
//
// Repetível por desenho. A troca tem dois passos que não são atômicos: (1)
// atualizar o Auth, (2) desligar a marca. Se o passo 2 falhar, a marca segue
// ligada e a dona chama a rota de novo com o mesmo token. Dois cuidados fazem
// essa segunda chamada fechar sem depender da senha antiga:
//   - o passo 1 grava em app_metadata o e-mail que a rota acabou de definir
//     (troca_credenciais_email); na repetição, o e-mail já igual ao da conta
//     só é aceito quando bate com essa marca, senão "e-mail novo diferente do
//     atual" continuaria valendo e travaria a dona;
//   - o passo 1 é idempotente (mesmos e-mail e senha), então rodar de novo é
//     seguro. A marca de app_metadata é limpa ao final, em melhor esforço.
//
// Senha nova igual à atual: antes de alterar qualquer coisa (e só quando NÃO é
// retomada), a rota tenta entrar com o e-mail ATUAL da conta e a senha nova,
// num cliente isolado (sem persistir sessão). Se entrar, a senha é a mesma de
// hoje: 400 senha_igual_a_atual, e a sessão criada pela tentativa é revogada
// em melhor esforço (admin.signOut, escopo local). Credenciais inválidas =
// senhas diferentes, segue o fluxo. Limite de requisições (429) ou qualquer
// outro erro inesperado: responde 429/500 sem alterar nada. Na retomada a
// senha atual JÁ é a nova, então a checagem seria sempre positiva e não roda.
//
// Nenhuma resposta nem log carrega senha, chave ou e-mail: o log só leva
// código e status do erro.

const SEM_CACHE = { "Cache-Control": "no-store" };

function responder(corpo, status) {
  return Response.json(corpo, { status, headers: SEM_CACHE });
}

function supabaseServiceRole() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function ehEmailEmUso(erro) {
  return (
    erro?.code === "email_exists" ||
    (erro?.status === 422 && /already|registered|exists/i.test(erro?.message ?? ""))
  );
}

export async function POST(request) {
  const cabecalho = request.headers.get("authorization") ?? "";
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : null;
  if (!token) {
    return responder({ codigo: "sem_sessao", erro: "Sua sessão expirou. Entre de novo." }, 401);
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return responder({ codigo: "corpo_invalido", erro: "Pedido inválido." }, 400);
  }

  const supabaseUsuario = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: erroUser } = await supabaseUsuario.auth.getUser(token);
  const user = userData?.user;
  if (erroUser || !user) {
    return responder({ codigo: "sem_sessao", erro: "Sua sessão expirou. Entre de novo." }, 401);
  }

  const { data: perfil, error: erroPerfil } = await supabaseUsuario
    .from("perfis")
    .select("papel, precisa_trocar_credenciais")
    .eq("user_id", user.id)
    .maybeSingle();

  if (erroPerfil) {
    console.error("trocar-credenciais: leitura do perfil falhou", erroPerfil.code);
    return responder({ codigo: "erro_interno", erro: "Não foi possível verificar sua conta agora." }, 500);
  }
  if (!perfil) {
    return responder({ codigo: "sem_perfil", erro: "Conta sem salão vinculado." }, 403);
  }
  if (perfil.papel !== "dono") {
    return responder({ codigo: "papel_invalido", erro: "Esta troca não se aplica a esta conta." }, 403);
  }
  if (perfil.precisa_trocar_credenciais !== true) {
    return responder({ codigo: "sem_troca_pendente", erro: "Não há troca de dados pendente nesta conta." }, 409);
  }

  // Reset de acesso pelo painel global (troca_so_senha): só a senha muda. O
  // e-mail do corpo é ignorado, não validado nem exigido.
  const soSenha = user.app_metadata?.troca_so_senha === true;
  const emailNovo = soSenha ? { ok: true, email: "" } : validarEmail(corpo?.email);
  const emailConf = soSenha ? { ok: true, email: "" } : validarEmail(corpo?.emailConfirmacao);
  const senha = typeof corpo?.senha === "string" ? corpo.senha : "";
  const senhaConf = typeof corpo?.senhaConfirmacao === "string" ? corpo.senhaConfirmacao : "";

  if (!emailNovo.ok) {
    return responder({ codigo: "email_invalido", erro: "Digite um e-mail válido." }, 400);
  }
  if (emailNovo.email !== emailConf.email) {
    return responder({ codigo: "emails_diferentes", erro: "Os dois e-mails não são iguais." }, 400);
  }
  if (senha !== senhaConf) {
    return responder({ codigo: "senhas_diferentes", erro: "As duas senhas não são iguais." }, 400);
  }
  if (!validarSenha(senha).ok) {
    return responder(
      { codigo: "senha_fraca", erro: "A senha não atende a todos os requisitos." },
      400
    );
  }

  // Repetição de uma troca que já passou no Auth mas não fechou a marca: o
  // e-mail igual ao atual vale se foi esta rota que o definiu.
  const emailAtual = String(user.email ?? "").toLowerCase();
  const retomada = !soSenha && user.app_metadata?.troca_credenciais_email === emailNovo.email;
  if (!soSenha && emailNovo.email === emailAtual && !retomada) {
    return responder(
      { codigo: "email_igual_ao_atual", erro: "O e-mail novo precisa ser diferente do e-mail atual." },
      400
    );
  }

  const admin = supabaseServiceRole();

  if (!retomada) {
    const supabaseTeste = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: tentativa, error: erroTentativa } = await supabaseTeste.auth.signInWithPassword({
      email: user.email,
      password: senha,
    });
    if (!erroTentativa) {
      const tokenTentativa = tentativa?.session?.access_token;
      if (tokenTentativa) {
        const { error: erroSaida } = await admin.auth.admin.signOut(tokenTentativa, "local");
        if (erroSaida) console.error("trocar-credenciais: revogacao da tentativa falhou", erroSaida.code);
      }
      return responder(
        { codigo: "senha_igual_a_atual", erro: "Escolha uma senha diferente da que você usa hoje." },
        400
      );
    }
    if (erroTentativa.code !== "invalid_credentials") {
      const limite = erroTentativa.status === 429 || erroTentativa.code === "over_request_rate_limit";
      console.error("trocar-credenciais: checagem da senha atual falhou", erroTentativa.code, erroTentativa.status);
      return responder(
        limite
          ? { codigo: "muitas_tentativas", erro: "Muitas tentativas seguidas. Aguarde um minuto e tente de novo." }
          : { codigo: "erro_interno", erro: "Não foi possível trocar seus dados agora. Tente de novo." },
        limite ? 429 : 500
      );
    }
  }

  const { error: erroAuth } = await admin.auth.admin.updateUserById(
    user.id,
    soSenha
      ? { password: senha }
      : {
          email: emailNovo.email,
          password: senha,
          email_confirm: true,
          // credenciais_proprias: a dona já escolheu o próprio e-mail (a aba
          // Segurança usa isso para não oferecer "Exigir troca"). Não é limpa
          // pelo rastro final.
          app_metadata: { troca_credenciais_email: emailNovo.email, credenciais_proprias: true },
        }
  );
  if (erroAuth) {
    if (ehEmailEmUso(erroAuth)) {
      return responder({ codigo: "email_em_uso", erro: "Este e-mail já está em uso em outra conta." }, 409);
    }
    if (erroAuth.code === "weak_password") {
      return responder({ codigo: "senha_fraca", erro: "Essa senha não foi aceita. Escolha outra." }, 400);
    }
    console.error("trocar-credenciais: updateUserById falhou", erroAuth.code, erroAuth.status);
    return responder({ codigo: "erro_interno", erro: "Não foi possível trocar seus dados agora. Tente de novo." }, 500);
  }

  const { data: linhas, error: erroMarca } = await admin
    .from("perfis")
    .update({ precisa_trocar_credenciais: false, troca_exigida_em: null })
    .eq("user_id", user.id)
    .select("user_id");
  if (erroMarca || !linhas?.length) {
    console.error("trocar-credenciais: marca nao desligada", erroMarca?.code ?? "0 linhas");
    return responder(
      {
        codigo: "marca_nao_desligada",
        erro: "Seus dados foram trocados, mas não conseguimos finalizar. Toque em salvar de novo.",
      },
      500
    );
  }

  // Melhor esforço: tira o rastro da retomada. Falhar aqui não desfaz nada.
  const { error: erroLimpeza } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { troca_credenciais_email: null, troca_so_senha: null },
  });
  if (erroLimpeza) console.error("trocar-credenciais: limpeza do rastro falhou", erroLimpeza.code);

  return responder({ ok: true }, 200);
}
