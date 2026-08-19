"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { normalizarWhatsapp, validarWhatsapp } from "@/lib/whatsappValidacao";

// Popup "Alterar WhatsApp" do detalhe do cliente (GerenciarClientes.js), em
// dois passos: 1) novo número com a mesma dupla digitação já usada em
// AtualizarDadosCliente (confirma; se não bater, pede de novo) 2) confirmação
// final explicando que a troca também move o histórico de agendamentos
// vinculado ao número antigo. A troca em si é uma única RPC
// (atualizar_whatsapp_cliente) — nunca dois updates client-side — porque o
// vínculo agendamento↔cliente hoje é por telefone (ver lib/clientesAdmin.js):
// só trocar `clientes.whatsapp` deixaria o histórico órfão. A função no
// banco atualiza cliente e histórico juntos, escopada por
// estabelecimento_id (não mexe em outro salão com cliente no mesmo número
// antigo).
//
// Props:
//   cliente          – { id, nome } do cliente sendo editado, ou null (fecha
//                      o popup, mesmo padrão de ModalVincularCliente).
//   estabelecimentoId
//   onFechar         – cancelar em qualquer um dos dois passos.
//   onAlterado       – (novoWhatsappDigitos) chamado após a RPC ter sucesso.
export default function ModalAlterarWhatsapp({
  cliente,
  estabelecimentoId,
  onFechar,
  onAlterado,
}) {
  const [passo, setPasso] = useState("numero");
  const [novoWhatsapp, setNovoWhatsapp] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrarReconfirmacao, setMostrarReconfirmacao] = useState(false);
  const [reconfirmacao, setReconfirmacao] = useState("");
  const [whatsappValidado, setWhatsappValidado] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Erro de FORMATO (validarWhatsapp) do campo "Novo WhatsApp", em tempo
  // real (onBlur) — separado de `erro`, que segue cobrindo divergência com
  // confirmação/reconfirmação e falhas da RPC.
  const [erroFormatoNovoWhatsapp, setErroFormatoNovoWhatsapp] = useState("");

  useEffect(() => {
    setPasso("numero");
    setNovoWhatsapp("");
    setConfirmacao("");
    setMostrarReconfirmacao(false);
    setReconfirmacao("");
    setWhatsappValidado("");
    setErro("");
    setErroFormatoNovoWhatsapp("");
    setSalvando(false);
  }, [cliente]);

  if (!cliente) return null;

  function handleValidarNumero(e) {
    e.preventDefault();
    setErro("");
    setErroFormatoNovoWhatsapp("");

    const digitosNovo = normalizarWhatsapp(novoWhatsapp);
    if (digitosNovo.length < 10) {
      setErro("Informe um WhatsApp válido com DDD.");
      return;
    }

    const validacaoNovoWhatsapp = validarWhatsapp(novoWhatsapp);
    if (!validacaoNovoWhatsapp.valido) {
      setErroFormatoNovoWhatsapp(validacaoNovoWhatsapp.erro);
      return;
    }

    const digitosBase = mostrarReconfirmacao
      ? confirmacao.replace(/\D/g, "")
      : digitosNovo;
    const digitosParaComparar = mostrarReconfirmacao
      ? reconfirmacao.replace(/\D/g, "")
      : confirmacao.replace(/\D/g, "");

    if (digitosBase !== digitosParaComparar) {
      setMostrarReconfirmacao(true);
      setErro("Os números não coincidem. Confirme novamente abaixo.");
      return;
    }

    setWhatsappValidado(digitosNovo);
    setErro("");
    setPasso("confirmar");
  }

  async function handleConfirmar() {
    setSalvando(true);
    setErro("");

    const { error } = await supabase.rpc("atualizar_whatsapp_cliente", {
      p_cliente_id: cliente.id,
      p_novo_whatsapp: whatsappValidado,
      p_estabelecimento_id: estabelecimentoId,
    });

    setSalvando(false);

    if (error) {
      setErro(`Não foi possível alterar o WhatsApp: ${error.message}`);
      return;
    }

    onAlterado(whatsappValidado);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-alterar-whatsapp"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        {passo === "numero" ? (
          <form onSubmit={handleValidarNumero}>
            <h2 id="titulo-alterar-whatsapp" className="text-lg font-semibold text-heading">
              Alterar WhatsApp
            </h2>
            <p className="mt-2 text-sm text-body">
              Essa troca também atualiza o histórico de agendamentos vinculado
              a esse número.
            </p>

            <div className="mt-4">
              <label htmlFor="alt-whatsapp-novo" className="mb-1 block text-sm font-medium text-body">
                Novo WhatsApp
              </label>
              <input
                id="alt-whatsapp-novo"
                type="tel"
                inputMode="tel"
                value={novoWhatsapp}
                onChange={(e) => {
                  setNovoWhatsapp(e.target.value);
                  setErroFormatoNovoWhatsapp("");
                }}
                onBlur={() => {
                  if (!novoWhatsapp.trim()) return;
                  const validacao = validarWhatsapp(novoWhatsapp);
                  setErroFormatoNovoWhatsapp(validacao.valido ? "" : validacao.erro);
                }}
                required
                placeholder="(24) 99999-9999"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
              {erroFormatoNovoWhatsapp && (
                <p className="mt-1 text-xs text-red-600">{erroFormatoNovoWhatsapp}</p>
              )}
            </div>

            <div className="mt-4">
              <label htmlFor="alt-whatsapp-confirmacao" className="mb-1 block text-sm font-medium text-body">
                Confirme o novo WhatsApp
              </label>
              <input
                id="alt-whatsapp-confirmacao"
                type="tel"
                inputMode="tel"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                required
                placeholder="(24) 99999-9999"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>

            {mostrarReconfirmacao && (
              <div className="mt-4">
                <label htmlFor="alt-whatsapp-reconfirmacao" className="mb-1 block text-sm font-medium text-body">
                  Confirme novamente
                </label>
                <input
                  id="alt-whatsapp-reconfirmacao"
                  type="tel"
                  inputMode="tel"
                  value={reconfirmacao}
                  onChange={(e) => setReconfirmacao(e.target.value)}
                  required
                  placeholder="(24) 99999-9999"
                  className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>
            )}

            {erro && <p className="mt-3 text-xs text-red-600">{erro}</p>}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="submit"
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={onFechar}
                className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <div>
            <h2 id="titulo-alterar-whatsapp" className="text-lg font-semibold text-heading">
              Confirmar alteração
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja alterar o WhatsApp de{" "}
              <span className="font-medium text-heading">{cliente.nome}</span>?
              Isso também atualiza o histórico de agendamentos dele.
            </p>

            {erro && <p className="mt-3 text-xs text-red-600">{erro}</p>}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={handleConfirmar}
                disabled={salvando}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Confirmar"}
              </button>
              <button
                type="button"
                onClick={() => setPasso("numero")}
                disabled={salvando}
                className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
