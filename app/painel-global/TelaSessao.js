"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Tela mínima do /painel-global/entrar, pra onde o servidor manda quem não
// liberou (ver page.js). O Hub também a renderiza se a sessão cair com o painel
// aberto. Importa SÓ React e o cliente Supabase: nada do HubPainelGlobal nem das abas,
// pra que o HTML/JS entregue ao anônimo não referencie os chunks do painel.
//
// Fluxo: o navegador é quem renova o token (getSession renova sozinho se
// estiver vencido e regrava o cookie). Com sessão → vai a /painel-global (com
// ?aba= preservado) pro servidor reler o cookie. Sem sessão → login. Se o
// servidor negar de novo e mandar de volta com o mesmo token, trava e mostra
// mensagem — nunca o login (a sessão existe) e nunca um loop de idas e voltas.
// A trava é a marca do token no sessionStorage; sem sessionStorage, `recarga=1`
// na URL (page.js repassa o parâmetro no redirect de volta).

const CHAVE_TRAVA = "painel-global:recarga";

// Impressão digital do token (cauda da assinatura), pra não deixar o token em
// si no sessionStorage.
function marca(token) {
  return token.slice(-16);
}

// Chamada pelo Hub quando o painel abre: a ida e volta terminou bem, a marca
// não deve sobrar e bloquear a próxima (token igual, falha passageira).
export function limparTrava() {
  try {
    window.sessionStorage.removeItem(CHAVE_TRAVA);
  } catch {
    // sem sessionStorage não há marca a limpar.
  }
}

function lerTrava() {
  try {
    return window.sessionStorage.getItem(CHAVE_TRAVA);
  } catch {
    return null;
  }
}

// Devolve true se gravou/limpou no sessionStorage; false se ele estiver
// indisponível (aí a trava passa a ser o parâmetro `recarga=1` na URL).
function gravarTrava(valor) {
  try {
    if (valor) window.sessionStorage.setItem(CHAVE_TRAVA, valor);
    else window.sessionStorage.removeItem(CHAVE_TRAVA);
    return true;
  } catch {
    return false;
  }
}

// Trava de reserva, sem sessionStorage: `recarga=1` na URL marca "já fui ao
// painel uma vez" (ida e volta /entrar → /painel-global → /entrar). O ?aba= é
// preservado na ida.
const PARAM_RECARGA = "recarga";

// Destino da volta ao painel: /painel-global com SÓ o ?aba= preservado (motivo
// e recarga da URL atual ficam pra trás). `comRecarga` acrescenta recarga=1 —
// page.js repassa esse parâmetro no redirect de volta pra /entrar.
function urlPainel(comRecarga) {
  const atuais = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const aba = atuais.get("aba");
  if (aba) params.set("aba", aba);
  if (comRecarga) params.set(PARAM_RECARGA, "1");
  const qs = params.toString();
  return qs ? `/painel-global?${qs}` : "/painel-global";
}

function abriuComRecarga() {
  return new URLSearchParams(window.location.search).get(PARAM_RECARGA) === "1";
}

export default function TelaSessao({ motivo }) {
  // "verificando" | "login" | "falhou" | "restrito"
  const [estado, setEstado] = useState(motivo === "restrito" ? "restrito" : "verificando");

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [erroLogin, setErroLogin] = useState("");

  useEffect(() => {
    // "restrito": o servidor validou o token e o papel não é global. Não há o
    // que renovar nem navegar.
    if (motivo === "restrito") return undefined;

    let ativo = true;

    (async () => {
      let resposta;
      try {
        resposta = await supabase.auth.getSession();
      } catch {
        if (ativo) setEstado("falhou");
        return;
      }
      if (!ativo) return;

      const { data, error } = resposta;
      const sessao = data?.session;

      if (sessao?.access_token) {
        const atual = marca(sessao.access_token);
        // Já recarregamos e o servidor negou de novo: pára aqui. Vale tanto
        // pro token marcado no sessionStorage quanto pro `recarga=1` da URL
        // (trava de reserva, quando o sessionStorage não existe).
        if (abriuComRecarga() || lerTrava() === atual) {
          setEstado("falhou");
          return;
        }
        // Tem sessão no navegador: vai ao painel pro servidor reler o cookie.
        // Se o servidor negar, volta pra cá e a trava acima pára o ciclo.
        window.location.replace(urlPainel(!gravarTrava(atual)));
        return;
      }

      // Sem sessão por ERRO (ex.: falha de rede ao renovar) não é sessão
      // perdida: não mostra o login, deixa tentar de novo.
      if (error) {
        setEstado("falhou");
        return;
      }

      setEstado("login");
    })();

    return () => {
      ativo = false;
    };
  }, [motivo]);

  function tentarDeNovo() {
    gravarTrava(null);
    window.location.replace(urlPainel(false));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErroLogin("");
    setEntrando(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error) {
      setEntrando(false);
      // Mesmo padrão de mensagem genérica do login do /[salon]/admin — não
      // vaza o detalhe técnico do Supabase.
      setErroLogin("E-mail ou senha incorretos.");
      return;
    }

    // Login novo: libera uma ida ao painel pro servidor ler o cookie recém-gravado.
    gravarTrava(null);
    window.location.replace(urlPainel(false));
  }

  if (estado === "verificando") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  if (estado === "restrito" || estado === "falhou") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h1 className="text-2xl font-bold text-heading">
            {estado === "restrito" ? "Acesso restrito." : "Não foi possível abrir o painel."}
          </h1>
          <button
            type="button"
            onClick={tentarDeNovo}
            className="mt-4 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
          >
            Tentar de novo
          </button>
        </div>
      </main>
    );
  }

  // Sem sessão: formulário de login inline, na própria página (sem página de
  // login separada nem redirect, diferente do /[salon]/admin/login).
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-heading">Painel Global</h1>
          <p className="mt-1 text-sm text-body">Acesso restrito.</p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-body">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="voce@exemplo.com"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div>
            <label htmlFor="senha" className="mb-1 block text-sm font-medium text-body">
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              placeholder="Sua senha"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <button
            type="submit"
            disabled={entrando}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {entrando ? "Entrando..." : "Entrar"}
          </button>

          {erroLogin && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erroLogin}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
