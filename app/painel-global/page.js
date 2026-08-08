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

// Modelo novo, ainda não gravado em anamnese_modelos (id null é o sinal pro
// handleSalvarModelo decidir entre INSERT e UPDATE).
const MODELO_ANAMNESE_VAZIO = {
  id: null,
  titulo: "",
  ativo: false,
  secoes: [],
  declaracoes: [],
};

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

  // Aba Anamnese: modelo único do salão selecionado (no máximo 1 linha em
  // anamnese_modelos, mas sem constraint no banco — se vier mais de uma, usa
  // a primeira). id null = modelo novo, ainda não gravado (form começa
  // vazio).
  const [modeloAnamnese, setModeloAnamnese] = useState(MODELO_ANAMNESE_VAZIO);
  const [carregandoModelo, setCarregandoModelo] = useState(false);
  const [statusModelo, setStatusModelo] = useState("");
  const [erroModelo, setErroModelo] = useState("");

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

  // Busca o modelo de anamnese do salão selecionado. Limpa o form pro
  // estado vazio ANTES de checar se há id — mesma disciplina do efeito de
  // cadastro logo acima, cobrindo tanto "carregando" quanto "troquei de
  // salão, esquece o formulário anterior".
  useEffect(() => {
    let ativo = true;

    (async () => {
      setModeloAnamnese(MODELO_ANAMNESE_VAZIO);
      setStatusModelo("");
      setErroModelo("");

      if (!estabelecimentoId) return;

      setCarregandoModelo(true);

      const { data, error } = await supabase
        .from("anamnese_modelos")
        .select("*")
        .eq("estabelecimento_id", estabelecimentoId);

      if (!ativo) return;
      setCarregandoModelo(false);

      if (error) {
        setErroModelo(error.message);
        return;
      }

      // Sem constraint no banco garantindo no máximo 1 linha — usa a
      // primeira se vier mais de uma, em vez de quebrar.
      const linha = data?.[0];
      if (linha) {
        setModeloAnamnese({
          id: linha.id,
          titulo: linha.titulo ?? "",
          ativo: Boolean(linha.ativo),
          secoes: linha.secoes ?? [],
          declaracoes: linha.declaracoes ?? [],
        });
      }
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimentoId]);

  // "Salvo ✓" some sozinho depois de um tempo — mesmo padrão de cima.
  useEffect(() => {
    if (statusModelo !== "salvo") return;
    const t = setTimeout(() => setStatusModelo(""), 2500);
    return () => clearTimeout(t);
  }, [statusModelo]);

  function alterarTituloModelo(valor) {
    setModeloAnamnese((atual) => ({ ...atual, titulo: valor }));
  }

  function alternarAtivoModelo() {
    setModeloAnamnese((atual) => ({ ...atual, ativo: !atual.ativo }));
  }

  function adicionarDeclaracao() {
    setModeloAnamnese((atual) => ({
      ...atual,
      declaracoes: [...atual.declaracoes, ""],
    }));
  }

  function removerDeclaracao(indice) {
    setModeloAnamnese((atual) => ({
      ...atual,
      declaracoes: atual.declaracoes.filter((_, i) => i !== indice),
    }));
  }

  function alterarDeclaracao(indice, valor) {
    setModeloAnamnese((atual) => ({
      ...atual,
      declaracoes: atual.declaracoes.map((d, i) => (i === indice ? valor : d)),
    }));
  }

  // Reordenação local (troca de posição no array) — o array inteiro só vai
  // pro banco no clique de "Salvar", não há `ordem` persistida por item.
  function moverDeclaracao(indice, direcao) {
    setModeloAnamnese((atual) => {
      const alvo = indice + direcao;
      if (alvo < 0 || alvo >= atual.declaracoes.length) return atual;
      const declaracoes = [...atual.declaracoes];
      [declaracoes[indice], declaracoes[alvo]] = [declaracoes[alvo], declaracoes[indice]];
      return { ...atual, declaracoes };
    });
  }

  function adicionarSecao() {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: [...atual.secoes, { titulo: "", perguntas: [] }],
    }));
  }

  function removerSecao(indiceSecao) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.filter((_, i) => i !== indiceSecao),
    }));
  }

  function alterarTituloSecao(indiceSecao, valor) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.map((s, i) => (i === indiceSecao ? { ...s, titulo: valor } : s)),
    }));
  }

  function moverSecao(indiceSecao, direcao) {
    setModeloAnamnese((atual) => {
      const alvo = indiceSecao + direcao;
      if (alvo < 0 || alvo >= atual.secoes.length) return atual;
      const secoes = [...atual.secoes];
      [secoes[indiceSecao], secoes[alvo]] = [secoes[alvo], secoes[indiceSecao]];
      return { ...atual, secoes };
    });
  }

  function adicionarPergunta(indiceSecao) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.map((s, i) =>
        i === indiceSecao ? { ...s, perguntas: [...s.perguntas, ""] } : s
      ),
    }));
  }

  function removerPergunta(indiceSecao, indicePergunta) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.map((s, i) =>
        i === indiceSecao
          ? { ...s, perguntas: s.perguntas.filter((_, j) => j !== indicePergunta) }
          : s
      ),
    }));
  }

  function alterarPergunta(indiceSecao, indicePergunta, valor) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.map((s, i) =>
        i === indiceSecao
          ? {
              ...s,
              perguntas: s.perguntas.map((p, j) => (j === indicePergunta ? valor : p)),
            }
          : s
      ),
    }));
  }

  function moverPergunta(indiceSecao, indicePergunta, direcao) {
    setModeloAnamnese((atual) => {
      const secao = atual.secoes[indiceSecao];
      const alvo = indicePergunta + direcao;
      if (alvo < 0 || alvo >= secao.perguntas.length) return atual;
      const perguntas = [...secao.perguntas];
      [perguntas[indicePergunta], perguntas[alvo]] = [perguntas[alvo], perguntas[indicePergunta]];
      return {
        ...atual,
        secoes: atual.secoes.map((s, i) => (i === indiceSecao ? { ...s, perguntas } : s)),
      };
    });
  }

  // Salva título/ativo/declarações/seções do modelo. Sem id ainda (nenhuma
  // linha veio da busca) faz INSERT. Com id faz UPDATE dos campos deste
  // formulário. Seções com título vazio e zero perguntas são descartadas
  // por inteiro; dentro das seções mantidas, perguntas em branco são
  // filtradas (mesmo padrão de trim+filter usado em declaracoes).
  async function handleSalvarModelo() {
    setStatusModelo("salvando");
    setErroModelo("");

    const payload = {
      titulo: modeloAnamnese.titulo.trim(),
      ativo: modeloAnamnese.ativo,
      declaracoes: modeloAnamnese.declaracoes.map((d) => d.trim()).filter((d) => d !== ""),
      secoes: modeloAnamnese.secoes
        .map((s) => ({
          titulo: s.titulo.trim(),
          perguntas: s.perguntas.map((p) => p.trim()).filter((p) => p !== ""),
        }))
        .filter((s) => s.titulo !== "" || s.perguntas.length > 0),
    };

    if (modeloAnamnese.id == null) {
      const { data, error } = await supabase
        .from("anamnese_modelos")
        .insert({ estabelecimento_id: estabelecimentoId, ...payload })
        .select("id")
        .single();

      if (error) {
        setStatusModelo("");
        setErroModelo(error.message);
        return;
      }

      setModeloAnamnese((atual) => ({ ...atual, id: data.id }));
      setStatusModelo("salvo");
      return;
    }

    const { error } = await supabase
      .from("anamnese_modelos")
      .update(payload)
      .eq("id", modeloAnamnese.id);

    if (error) {
      setStatusModelo("");
      setErroModelo(error.message);
      return;
    }

    setStatusModelo("salvo");
  }

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
          <>
            {!estabelecimentoId ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-sm text-body">Selecione um salão para configurar.</p>
              </div>
            ) : carregandoModelo ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-xs text-muted">Carregando...</p>
              </div>
            ) : (
              <section className="space-y-5 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <div>
                  <label htmlFor="titulo-anamnese" className="mb-1 block text-sm font-medium text-body">
                    Título
                  </label>
                  <input
                    id="titulo-anamnese"
                    type="text"
                    value={modeloAnamnese.titulo}
                    onChange={(e) => alterarTituloModelo(e.target.value)}
                    placeholder="Ex.: Ficha de anamnese"
                    className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <label
                      htmlFor="toggle-ativo-anamnese"
                      className="block text-sm font-medium text-heading"
                    >
                      Modelo ativo
                    </label>
                    <p className="mt-1 text-xs text-muted">
                      Só o modelo ativo é exibido pro cliente no fluxo público.
                    </p>
                  </div>

                  <button
                    id="toggle-ativo-anamnese"
                    type="button"
                    role="switch"
                    aria-checked={modeloAnamnese.ativo}
                    onClick={alternarAtivoModelo}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                      modeloAnamnese.ativo ? "bg-primary" : "bg-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                        modeloAnamnese.ativo ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-heading">Declarações</p>

                  {modeloAnamnese.declaracoes.length === 0 && (
                    <p className="mb-2 text-xs text-muted">Nenhuma declaração ainda.</p>
                  )}

                  <div className="space-y-2">
                    {modeloAnamnese.declaracoes.map((declaracao, indice) => (
                      <div key={indice} className="flex items-start gap-2">
                        <div className="flex shrink-0 flex-col pt-0.5">
                          <button
                            type="button"
                            onClick={() => moverDeclaracao(indice, -1)}
                            disabled={indice === 0}
                            aria-label="Mover para cima"
                            className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => moverDeclaracao(indice, 1)}
                            disabled={indice === modeloAnamnese.declaracoes.length - 1}
                            aria-label="Mover para baixo"
                            className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ▼
                          </button>
                        </div>

                        <textarea
                          value={declaracao}
                          onChange={(e) => alterarDeclaracao(indice, e.target.value)}
                          rows={2}
                          className="w-full flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                        />

                        <button
                          type="button"
                          onClick={() => removerDeclaracao(indice)}
                          className="shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={adicionarDeclaracao}
                    className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                  >
                    Adicionar declaração
                  </button>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-heading">Seções</p>

                  {modeloAnamnese.secoes.length === 0 && (
                    <p className="mb-2 text-xs text-muted">Nenhuma seção ainda.</p>
                  )}

                  <div className="space-y-4">
                    {modeloAnamnese.secoes.map((secao, indiceSecao) => (
                      <div key={indiceSecao} className="rounded-lg border border-border p-3">
                        <div className="flex items-start gap-2">
                          <div className="flex shrink-0 flex-col pt-0.5">
                            <button
                              type="button"
                              onClick={() => moverSecao(indiceSecao, -1)}
                              disabled={indiceSecao === 0}
                              aria-label="Mover seção para cima"
                              className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => moverSecao(indiceSecao, 1)}
                              disabled={indiceSecao === modeloAnamnese.secoes.length - 1}
                              aria-label="Mover seção para baixo"
                              className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              ▼
                            </button>
                          </div>

                          <input
                            type="text"
                            value={secao.titulo}
                            onChange={(e) => alterarTituloSecao(indiceSecao, e.target.value)}
                            placeholder="Título da seção"
                            className="w-full flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                          />

                          <button
                            type="button"
                            onClick={() => removerSecao(indiceSecao)}
                            className="shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                          >
                            Remover
                          </button>
                        </div>

                        <div className="mt-2 space-y-2 border-l-2 border-border pl-4">
                          {secao.perguntas.map((pergunta, indicePergunta) => (
                            <div key={indicePergunta} className="flex items-start gap-2">
                              <div className="flex shrink-0 flex-col pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => moverPergunta(indiceSecao, indicePergunta, -1)}
                                  disabled={indicePergunta === 0}
                                  aria-label="Mover pergunta para cima"
                                  className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moverPergunta(indiceSecao, indicePergunta, 1)}
                                  disabled={indicePergunta === secao.perguntas.length - 1}
                                  aria-label="Mover pergunta para baixo"
                                  className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  ▼
                                </button>
                              </div>

                              <input
                                type="text"
                                value={pergunta}
                                onChange={(e) =>
                                  alterarPergunta(indiceSecao, indicePergunta, e.target.value)
                                }
                                className="w-full flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                              />

                              <button
                                type="button"
                                onClick={() => removerPergunta(indiceSecao, indicePergunta)}
                                className="shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                              >
                                Remover
                              </button>
                            </div>
                          ))}

                          <button
                            type="button"
                            onClick={() => adicionarPergunta(indiceSecao)}
                            className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                          >
                            Adicionar pergunta
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={adicionarSecao}
                    className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                  >
                    Adicionar seção
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSalvarModelo}
                  disabled={statusModelo === "salvando"}
                  className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Salvar
                </button>

                {statusModelo === "salvando" && (
                  <p className="text-xs text-muted">Salvando…</p>
                )}
                {statusModelo === "salvo" && !erroModelo && (
                  <p className="text-xs font-medium text-green-600">Salvo ✓</p>
                )}
                {erroModelo && <p className="text-xs text-red-600">{erroModelo}</p>}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
