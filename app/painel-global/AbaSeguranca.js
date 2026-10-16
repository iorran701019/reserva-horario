"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mascararEmail } from "@/lib/credenciaisDona";
import { modoTrocaCredenciais } from "@/lib/avisoTrocaCredenciais";
import {
  linkWhatsApp,
  mensagemSenhaProvisoriaExplicacao,
  mensagemSenhaProvisoriaSenha,
} from "@/lib/whatsapp";

// Aba "Segurança" do hub: estado do acesso da dona de cada salão, "Exigir
// troca" e "Resetar acesso" (rota app/api/painel-global/seguranca). Só renderiza
// com papel 'global' já liberado pelo shell. A senha provisória vive apenas em
// estado React (`reset`): é descartada ao iniciar outra ação, ao confirmar outro
// salão ou ao desmontar a aba; nunca vai para storage, console ou URL interna.
const AVISOS_ESTADO = {
  sem_dona: "Este salão não tem conta de dona.",
  varias_contas: "Este salão tem mais de uma conta de dona. Esta aba ainda não cobre esse caso.",
};

const CLASSE_ENVIO = "rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary";
// Link "desabilitado": a navegação já saiu no clique anterior (ou ainda não é a
// vez dele); sem pointer-events nem foco, e esmaecido.
const CLASSE_ENVIO_OFF = "pointer-events-none opacity-50";

async function chamar(metodo, corpo) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { ok: false, erro: "Sua sessão expirou. Entre de novo." };
  try {
    const resposta = await fetch("/api/painel-global/seguranca", {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: "no-store",
    });
    const json = await resposta.json().catch(() => ({}));
    if (!resposta.ok) return { ok: false, erro: json?.erro ?? "Não foi possível concluir. Tente de novo." };
    return { ok: true, json };
  } catch {
    return { ok: false, erro: "Sem conexão. Tente de novo." };
  }
}

export default function AbaSeguranca() {
  const [saloes, setSaloes] = useState(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(null);
  const [confirmando, setConfirmando] = useState(null); // { id, acao }
  const [reset, setReset] = useState(null); // { id, senha }
  // Passo do envio depois do reset: 0 = nada enviado, 1 = mensagem 1 enviada
  // (ou copiada), 2 = as duas. Zerado a cada reset e a cada troca de salão.
  const [passo, setPasso] = useState(0);

  const carregar = useCallback(async () => {
    const r = await chamar("GET");
    if (!r.ok) {
      setErro(r.erro);
      setSaloes((atual) => atual ?? []);
      return;
    }
    setSaloes(r.json.saloes ?? []);
  }, []);

  useEffect(() => {
    let vivo = true;
    chamar("GET").then((r) => {
      if (!vivo) return;
      if (!r.ok) {
        setErro(r.erro);
        setSaloes((atual) => atual ?? []);
        return;
      }
      setSaloes(r.json.saloes ?? []);
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function executar(salao, acao) {
    setConfirmando(null);
    setErro("");
    setPasso(0);
    setReset(null);
    setOcupado(salao.id);
    const r = await chamar("POST", { estabelecimento_id: salao.id, acao });
    setOcupado(null);
    if (!r.ok) {
      setErro(r.erro);
      carregar();
      return;
    }
    if (acao === "resetar") setReset({ id: salao.id, senha: r.json.senha });
    carregar();
  }

  async function copiar(numero, texto) {
    try {
      await navigator.clipboard.writeText(texto);
      setPasso(numero);
    } catch {
      setErro("Não foi possível copiar. Copie manualmente.");
    }
  }

  function pedirConfirmacao(salaoId, acao) {
    // Trocar de salão (ou de ação) descarta a senha que estava na tela.
    setReset(null);
    setPasso(0);
    setConfirmando({ id: salaoId, acao });
  }

  if (saloes === null) {
    return <p className="mx-auto max-w-2xl py-6 text-sm text-body">Carregando...</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-4">
      {erro && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}

      {saloes.map((s) => {
        const pronto = s.estado === "ok";
        // Selo da marca: 'aviso' (cartão sem travar) ou 'bloqueio'; 'nenhum' = Em dia.
        const modoMarca = modoTrocaCredenciais({
          papel: "dono",
          precisa_trocar_credenciais: s.precisa_trocar_credenciais,
          troca_exigida_em: s.troca_exigida_em,
        });
        const mostrandoReset = reset?.id === s.id;
        const msg1 = mensagemSenhaProvisoriaExplicacao(s.nome, mascararEmail(s.email));
        const msg2 = mostrandoReset ? mensagemSenhaProvisoriaSenha(reset.senha) : "";
        return (
          <section key={s.id} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-heading">{s.nome}</h2>
                {pronto && <p className="truncate text-sm text-body">{s.email ?? "E-mail indisponível"}</p>}
              </div>
              {pronto && (
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    modoMarca === "bloqueio"
                      ? "bg-red-100 text-red-800"
                      : modoMarca === "aviso"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-green-100 text-green-800"
                  }`}
                >
                  {modoMarca === "bloqueio" ? "Bloqueada" : modoMarca === "aviso" ? "Aviso ativo" : "Em dia"}
                </span>
              )}
            </div>

            {!pronto && <p className="mt-3 text-sm text-body">{AVISOS_ESTADO[s.estado]}</p>}

            {pronto && (
              <div className="mt-3 flex flex-wrap gap-2">
                {!s.credenciais_proprias && (
                  <button
                    type="button"
                    disabled={ocupado === s.id}
                    onClick={() => pedirConfirmacao(s.id, "exigir_troca")}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-heading ring-1 ring-border transition hover:ring-primary/40 disabled:opacity-60"
                  >
                    Exigir troca
                  </button>
                )}
                <button
                  type="button"
                  disabled={ocupado === s.id}
                  onClick={() => pedirConfirmacao(s.id, "resetar")}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
                >
                  {ocupado === s.id ? "Aguarde..." : "Resetar acesso"}
                </button>
              </div>
            )}

            {confirmando?.id === s.id && (
              <div className="mt-3 rounded-lg bg-surface px-3 py-3 ring-1 ring-border">
                <p className="text-sm text-body">
                  {confirmando.acao === "resetar"
                    ? "Resetar o acesso desta dona? A senha atual deixa de valer agora e ela só entra com a senha provisória."
                    : "Exigir que esta dona troque e-mail e senha no próximo acesso?"}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => executar(s, confirmando.acao)}
                    className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(null)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-heading ring-1 ring-border"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {mostrandoReset && (
              <div className="mt-3 space-y-2 rounded-lg bg-surface px-3 py-3 ring-1 ring-border">
                <p className="text-sm text-body">
                  {passo >= 2 ? "Mensagens enviadas!" : "Senha gerada. Envie na ordem 1 e 2. Ela não será mostrada de novo."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {s.whatsapp ? (
                    <>
                      <a
                        href={linkWhatsApp(s.whatsapp, msg1)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setPasso((p) => Math.max(p, 1))}
                        aria-disabled={passo >= 1}
                        tabIndex={passo >= 1 ? -1 : undefined}
                        className={`${CLASSE_ENVIO} ${passo >= 1 ? CLASSE_ENVIO_OFF : ""}`}
                      >
                        {passo >= 1 ? "Mensagem 1 enviada" : "Enviar mensagem 1 (explicação)"}
                      </a>
                      <a
                        href={linkWhatsApp(s.whatsapp, msg2)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setPasso(2)}
                        aria-disabled={passo !== 1}
                        tabIndex={passo !== 1 ? -1 : undefined}
                        className={`${CLASSE_ENVIO} ${passo !== 1 ? CLASSE_ENVIO_OFF : ""}`}
                      >
                        {passo >= 2 ? "Mensagem 2 enviada" : "Enviar mensagem 2 (só a senha)"}
                      </a>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={passo >= 1}
                        onClick={() => copiar(1, msg1)}
                        className={`${CLASSE_ENVIO} disabled:opacity-50`}
                      >
                        {passo >= 1 ? "Mensagem 1 copiada" : "Copiar mensagem 1"}
                      </button>
                      <button
                        type="button"
                        disabled={passo !== 1}
                        onClick={() => copiar(2, msg2)}
                        className={`${CLASSE_ENVIO} disabled:opacity-50`}
                      >
                        {passo >= 2 ? "Mensagem 2 copiada" : "Copiar mensagem 2"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
