"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSessaoAdmin } from "@/hooks/useSessaoAdmin";

// Shell do /painel-global (Concern 1/3): só a guarda de acesso + seletor de
// salão + as duas abas vazias. Cadastro e Anamnese ganham lógica própria nos
// próximos concerns — aqui é só "Em construção".
const ABAS = [
  { id: "cadastro", rotulo: "Cadastro" },
  { id: "anamnese", rotulo: "Anamnese" },
];

export default function PainelGlobalPage() {
  // Sem `salon`: useSessaoAdmin não redireciona sozinho quando não há sessão
  // (ver hooks/useSessaoAdmin.js) — esta página decide o que renderizar em
  // cada estado, sem sair do próprio /painel-global.
  const { autenticado, perfil } = useSessaoAdmin();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [erroLogin, setErroLogin] = useState("");

  const [estabelecimentos, setEstabelecimentos] = useState([]);
  const [estabelecimentoId, setEstabelecimentoId] = useState("");
  const [aba, setAba] = useState("cadastro");

  // Aba Cadastro: valor atual de cadastro_completo do salão selecionado.
  // undefined = carregando (ou nenhum salão selecionado ainda).
  const [cadastroCompleto, setCadastroCompleto] = useState(undefined);
  const [statusCadastro, setStatusCadastro] = useState("");
  const [erroCadastro, setErroCadastro] = useState("");

  const autorizado = perfil?.papel === "global";

  // Lista de salões ativos pro seletor — só busca depois que o papel já foi
  // confirmado como 'global' (evita a query pra quem não vai ver o painel).
  useEffect(() => {
    if (!autorizado) return;
    let ativo = true;

    (async () => {
      const { data } = await supabase
        .from("estabelecimentos")
        .select("id, slug, nome")
        .eq("ativo", true)
        .order("nome");
      if (ativo) setEstabelecimentos(data ?? []);
    })();

    return () => {
      ativo = false;
    };
  }, [autorizado]);

  // Busca o cadastro_completo do salão selecionado sempre que a seleção muda.
  // Começa zerando pra undefined/""/"" ANTES de checar se há id — isso cobre
  // tanto "carregando o novo valor" quanto "limpa Salvo./erro do salão
  // anterior" (mesmo efeito cuida das duas coisas).
  useEffect(() => {
    let ativo = true;

    (async () => {
      setCadastroCompleto(undefined);
      setStatusCadastro("");
      setErroCadastro("");

      if (!estabelecimentoId) return;

      const { data, error } = await supabase
        .from("estabelecimentos")
        .select("cadastro_completo")
        .eq("id", estabelecimentoId)
        .single();

      if (!ativo) return;

      if (error) {
        setErroCadastro(error.message);
        return;
      }
      setCadastroCompleto(Boolean(data?.cadastro_completo));
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimentoId]);

  // "Salvo ✓" some sozinho depois de um tempo — mesmo padrão do toggle
  // escolha_profissional em ConfiguracoesSalao.js.
  useEffect(() => {
    if (statusCadastro !== "salvo") return;
    const t = setTimeout(() => setStatusCadastro(""), 2500);
    return () => clearTimeout(t);
  }, [statusCadastro]);

  // Clique na opção diferente da atual grava na hora — sem botão "Salvar"
  // separado, mesma filosofia do toggle escolha_profissional. Em erro,
  // reverte a seleção visual pro valor anterior (mesmo padrão do toggle de
  // ConfiguracoesSalao.js).
  async function salvarCadastroCompleto(novoValor) {
    if (novoValor === cadastroCompleto) return;

    const anterior = cadastroCompleto;
    setCadastroCompleto(novoValor);
    setStatusCadastro("salvando");
    setErroCadastro("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ cadastro_completo: novoValor })
      .eq("id", estabelecimentoId);

    if (error) {
      setCadastroCompleto(anterior);
      setStatusCadastro("");
      setErroCadastro(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusCadastro("salvo");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErroLogin("");
    setEntrando(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    setEntrando(false);

    if (error) {
      // Mesmo padrão de mensagem genérica do login do /[salon]/admin — não
      // vaza o detalhe técnico do Supabase.
      setErroLogin("E-mail ou senha incorretos.");
      return;
    }

    // Sucesso: sem redirect aqui. O onAuthStateChange dentro de
    // useSessaoAdmin atualiza `autenticado` sozinho e o render abaixo troca
    // de tela.
  }

  async function handleSair() {
    await supabase.auth.signOut();
  }

  // Ainda verificando a sessão (getSession inicial não voltou).
  if (autenticado === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  // Sem sessão: formulário de login inline, na própria página (sem página de
  // login separada nem redirect, diferente do /[salon]/admin/login).
  if (autenticado === false) {
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

  // Autenticado, mas o perfil ainda não voltou (undefined) — mesma tela de
  // carregamento de cima, não "Acesso restrito.": senão uma conta 'global'
  // genuína vê um flash de acesso negado entre o login e o perfil chegar.
  if (perfil === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  // Perfil já resolvido, mas sem papel 'global' — inclui conta órfã
  // (perfil null). Sem redirect, só troca de tela.
  if (!autorizado) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h1 className="text-2xl font-bold text-heading">Acesso restrito.</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-heading">
            Painel Global
          </h1>
          <button
            type="button"
            onClick={handleSair}
            className="text-sm font-semibold text-red-600 transition hover:underline"
          >
            Sair
          </button>
        </header>

        <div className="mb-6">
          <label htmlFor="estabelecimento" className="mb-1 block text-sm font-medium text-body">
            Salão
          </label>
          <select
            id="estabelecimento"
            value={estabelecimentoId}
            onChange={(e) => setEstabelecimentoId(e.target.value)}
            className="w-full rounded-lg bg-card px-3 py-2 text-sm font-medium text-heading shadow-sm ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-border"
          >
            <option value="">Selecione um salão</option>
            {estabelecimentos.map((estab) => (
              <option key={estab.id} value={estab.id}>
                {estab.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 flex gap-2">
          {ABAS.map((item) => {
            const ativa = aba === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAba(item.id)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  ativa
                    ? "bg-primary text-white"
                    : "bg-card text-body ring-1 ring-border hover:text-heading"
                }`}
              >
                {item.rotulo}
              </button>
            );
          })}
        </div>

        {aba === "cadastro" && (
          <>
            {!estabelecimentoId ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-sm text-body">Selecione um salão para configurar.</p>
              </div>
            ) : (
              <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <p className="text-sm font-medium text-heading">
                  Tipo de cadastro do cliente
                </p>
                <p className="mt-1 text-xs text-muted">
                  Define se o fluxo público pede só nome e WhatsApp, ou o
                  cadastro completo (endereço, nascimento etc.).
                </p>

                {cadastroCompleto === undefined ? (
                  <p className="mt-3 text-xs text-muted">Carregando...</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={cadastroCompleto === false}
                      onClick={() => salvarCadastroCompleto(false)}
                      disabled={statusCadastro === "salvando"}
                      className={`block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        cadastroCompleto === false
                          ? "bg-primary text-white"
                          : "bg-surface text-body ring-1 ring-border hover:text-heading"
                      }`}
                    >
                      Cadastro rápido (nome + WhatsApp)
                    </button>

                    <button
                      type="button"
                      role="radio"
                      aria-checked={cadastroCompleto === true}
                      onClick={() => salvarCadastroCompleto(true)}
                      disabled={statusCadastro === "salvando"}
                      className={`block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        cadastroCompleto === true
                          ? "bg-primary text-white"
                          : "bg-surface text-body ring-1 ring-border hover:text-heading"
                      }`}
                    >
                      Cadastro completo (endereço, nascimento, etc.)
                    </button>
                  </div>
                )}

                {statusCadastro === "salvando" && (
                  <p className="mt-2 text-xs text-muted">Salvando…</p>
                )}
                {statusCadastro === "salvo" && !erroCadastro && (
                  <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
                )}
                {erroCadastro && (
                  <p className="mt-2 text-xs text-red-600">{erroCadastro}</p>
                )}
              </section>
            )}
          </>
        )}

        {aba === "anamnese" && (
          <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
            <p className="text-sm text-body">Em construção.</p>
          </div>
        )}
      </div>
    </main>
  );
}
