"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// Lê o ?next= da URL e o valida como destino interno seguro. Só roda no browser
// (usa window.location) — chamada dentro do handler de submit. Aceita apenas
// caminhos que começam com "/" e NÃO com "//" (evita open-redirect pra
// //dominio-externo.com). Ausente ou inválido => /[salon]/admin (o admin do
// salão atual, derivado do slug do path).
function destinoPosLogin(salon) {
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return `/${salon}/admin`;
}

export default function LoginPage() {
  const router = useRouter();

  // Slug do salão no path (/[salon]/admin/login): fallback de destino quando o
  // ?next= está ausente/inválido.
  const { salon } = useParams();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setEntrando(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    setEntrando(false);

    if (error) {
      // Não vaza o detalhe técnico do Supabase — qualquer falha de login
      // vira a mesma mensagem genérica.
      setErro("E-mail ou senha incorretos.");
      return;
    }

    router.push(destinoPosLogin(salon));
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-heading">Entrar</h1>
          <p className="mt-1 text-sm text-body">
            Acesso restrito.
          </p>
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

          {erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erro}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
