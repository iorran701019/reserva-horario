"use client";

import { useEffect, useState } from "react";
import { Check, Circle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { validarEmail, validarSenha } from "@/lib/credenciaisDona";
import BotaoWhatsappLimiteTentativas from "@/components/BotaoWhatsappLimiteTentativas";

const CLASSE_CAMPO =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading outline-none focus:border-primary";

// Chama a rota com o access_token da sessão atual. Devolve { ok, codigo, erro }.
async function chamarRota(corpo, token) {
  try {
    const resposta = await fetch("/api/conta/trocar-credenciais", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(corpo),
    });
    const json = await resposta.json().catch(() => ({}));
    return {
      ok: resposta.ok && json.ok === true,
      codigo: json.codigo,
      erro: json.erro || "Não foi possível salvar agora. Tente de novo.",
    };
  } catch {
    return { ok: false, codigo: "rede", erro: "Sem conexão. Tente de novo." };
  }
}

// Cartão fixo no topo de Pendentes: a dona troca e-mail e senha uma única vez.
// `onConcluido` roda depois do novo login e recarrega o perfil no /admin. Erros
// ficam aqui, no cartão (nunca no erro global da página).
export default function TrocarCredenciais({ onConcluido }) {
  const [email, setEmail] = useState("");
  const [emailConfirmacao, setEmailConfirmacao] = useState("");
  const [senha, setSenha] = useState("");
  const [senhaConfirmacao, setSenhaConfirmacao] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [limite, setLimite] = useState(false);
  // Reset de acesso pelo painel global: o e-mail fica como está, só a senha troca.
  const [soSenha, setSoSenha] = useState(false);
  // Só renderiza o formulário depois do getUser resolver (com ou sem erro), para
  // não mostrar os campos de e-mail e trocá-los na frente da dona.
  const [pronto, setPronto] = useState(false);
  const [emailSessao, setEmailSessao] = useState("");

  useEffect(() => {
    let vivo = true;
    // Falha do getUser cai no modo com e-mail.
    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (!vivo || error) return;
        setSoSenha(data?.user?.app_metadata?.troca_so_senha === true);
        setEmailSessao(data?.user?.email ?? "");
      })
      .catch(() => {})
      .finally(() => {
        if (vivo) setPronto(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const { requisitos, ok: senhaOk } = validarSenha(senha);
  const emailOk = validarEmail(email).ok;
  const emailsIguais = soSenha || (emailOk && validarEmail(emailConfirmacao).email === validarEmail(email).email);
  const senhasIguais = senha.length > 0 && senha === senhaConfirmacao;
  const podeEnviar = emailsIguais && senhaOk && senhasIguais && !enviando;

  async function salvar(evento) {
    evento.preventDefault();
    if (!podeEnviar) return;
    setEnviando(true);
    setMensagem("");
    setLimite(false);

    const corpo = soSenha ? { senha, senhaConfirmacao } : { email, emailConfirmacao, senha, senhaConfirmacao };
    const emailLogin = soSenha ? emailSessao : validarEmail(email).email;
    const { data } = await supabase.auth.getSession();
    let resultado = await chamarRota(corpo, data?.session?.access_token ?? "");

    // Se a troca no Auth já passou mas a sessão antiga deixou de valer, entra
    // com os dados novos e tenta de novo (a rota é repetível).
    if (!resultado.ok && resultado.codigo === "sem_sessao") {
      const login = await supabase.auth.signInWithPassword({
        email: emailLogin,
        password: senha,
      });
      if (!login.error) {
        resultado = await chamarRota(corpo, login.data.session?.access_token ?? "");
      }
    }

    if (!resultado.ok) {
      setMensagem(resultado.erro);
      setLimite(resultado.codigo === "muitas_tentativas");
      setEnviando(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: emailLogin,
      password: senha,
    });
    if (error) {
      setMensagem("Seus dados foram trocados. Entre de novo com o e-mail e a senha novos.");
      setEnviando(false);
      return;
    }
    await onConcluido?.();
    setEnviando(false);
  }

  const tipoSenha = mostrar ? "text" : "password";

  return (
    <section className="mb-6 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-primary sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div>
          <h2 className="text-base font-semibold text-heading">Proteja sua conta</h2>
          <p className="mt-1 text-sm text-body">
            {!pronto
              ? "Carregando..."
              : soSenha
              ? "Para a segurança da sua conta, escolha agora uma senha nova, só sua. Você faz isso uma vez só, e depois o sistema é liberado."
              : "Para a segurança da sua conta, escolha agora o seu e-mail e uma senha só sua. Você faz isso uma vez só, e depois o sistema é liberado."}
          </p>
        </div>
      </div>

      {pronto && (
      <form onSubmit={salvar} className="mt-4 space-y-3" noValidate>
        {!soSenha && (
          <>
            <label className="block text-sm font-medium text-heading">
              Seu e-mail
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={CLASSE_CAMPO}
              />
            </label>
            <label className="block text-sm font-medium text-heading">
              Repita o e-mail
              <input
                type="email"
                autoComplete="off"
                value={emailConfirmacao}
                onChange={(e) => setEmailConfirmacao(e.target.value)}
                className={CLASSE_CAMPO}
              />
            </label>
            {emailConfirmacao && !emailsIguais && (
              <p className="text-xs text-red-700">Os dois e-mails precisam ser iguais.</p>
            )}
          </>
        )}

        <label className="block text-sm font-medium text-heading">
          Nova senha
          <input
            type={tipoSenha}
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className={CLASSE_CAMPO}
          />
        </label>
        <label className="block text-sm font-medium text-heading">
          Repita a nova senha
          <input
            type={tipoSenha}
            autoComplete="new-password"
            value={senhaConfirmacao}
            onChange={(e) => setSenhaConfirmacao(e.target.value)}
            className={CLASSE_CAMPO}
          />
        </label>
        {senhaConfirmacao && !senhasIguais && (
          <p className="text-xs text-red-700">As duas senhas precisam ser iguais.</p>
        )}

        <button
          type="button"
          onClick={() => setMostrar((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-body transition hover:text-heading"
        >
          {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {mostrar ? "Ocultar senha" : "Mostrar senha"}
        </button>

        <ul className="space-y-1" aria-label="Requisitos da senha">
          {requisitos.map((r) => (
            <li
              key={r.id}
              className={`flex items-center gap-2 text-sm ${r.ok ? "text-green-700" : "text-body"}`}
            >
              {r.ok ? <Check className="h-4 w-4 shrink-0" /> : <Circle className="h-4 w-4 shrink-0" />}
              {r.rotulo}
            </li>
          ))}
        </ul>

        {mensagem && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
            {mensagem}
          </p>
        )}
        {limite && <BotaoWhatsappLimiteTentativas />}

        <button
          type="submit"
          disabled={!podeEnviar}
          className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-on-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? "Salvando..." : "Salvar e liberar o sistema"}
        </button>
      </form>
      )}
    </section>
  );
}
