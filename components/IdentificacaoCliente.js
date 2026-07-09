"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Tela exibida ANTES do FormularioAgendamento no fluxo público: pede só o
// WhatsApp, busca o cliente em `clientes` (por estabelecimento_id + telefone
// normalizado) e confirma o nome. O resultado vira `clienteInicial` do
// FormularioAgendamento, que passa a pular os campos de nome/WhatsApp na
// etapa "dados".
//
// A coluna em `clientes` chama-se `whatsapp` (confirmado direto no banco) e é
// tratada aqui como dígitos apenas — por isso a busca compara dígitos, não a
// string digitada. Cadastro completo (criar a linha quando não encontrado) é
// da PRÓXIMA fase: por ora, o não encontrado só colhe o nome aqui mesmo e
// segue com id null.
//
// Props:
//   estabelecimentoId – particiona a busca por salão.
//   onIdentificado    – recebe { id, nome, telefone } pronto pra virar
//                       clienteInicial do FormularioAgendamento.
export default function IdentificacaoCliente({ estabelecimentoId, onIdentificado }) {
  // "telefone" (pede WhatsApp) -> "confirmar" (achou, confirma o nome) ou
  // "nome" (não achou, colhe o nome direto).
  const [etapa, setEtapa] = useState("telefone");
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [clienteEncontrado, setClienteEncontrado] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");

  async function handleBuscar(e) {
    e.preventDefault();
    setErro("");

    const digitos = telefone.replace(/\D/g, "");
    if (digitos.length < 10) {
      setErro("Informe um WhatsApp válido com DDD.");
      return;
    }

    setBuscando(true);
    const { data, error } = await supabase
      .from("clientes")
      .select("id, nome, whatsapp")
      .eq("estabelecimento_id", estabelecimentoId)
      .eq("whatsapp", digitos)
      .limit(1);
    setBuscando(false);

    if (!error && data && data.length > 0) {
      setClienteEncontrado(data[0]);
      setEtapa("confirmar");
    } else {
      setEtapa("nome");
    }
  }

  function handleConfirmarSim() {
    onIdentificado({
      id: clienteEncontrado.id,
      nome: clienteEncontrado.nome,
      telefone,
    });
  }

  // Número achou outra pessoa: volta pra corrigir o WhatsApp, sem carregar o
  // cliente encontrado adiante.
  function handleConfirmarNao() {
    setClienteEncontrado(null);
    setEtapa("telefone");
  }

  function handleSubmitNome(e) {
    e.preventDefault();
    if (!nome.trim()) {
      setErro("Informe seu nome.");
      return;
    }
    onIdentificado({ id: null, nome: nome.trim(), telefone });
  }

  return (
    <div className="space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border">
      {etapa === "telefone" && (
        <form onSubmit={handleBuscar} className="space-y-4">
          <div>
            <label
              htmlFor="whatsapp-identificacao"
              className="mb-1 block text-sm font-medium text-body"
            >
              Seu WhatsApp
            </label>
            <input
              id="whatsapp-identificacao"
              type="tel"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              required
              placeholder="(24) 99999-9999"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <button
            type="submit"
            disabled={buscando}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {buscando ? "Buscando..." : "Continuar"}
          </button>

          {erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erro}
            </p>
          )}
        </form>
      )}

      {etapa === "confirmar" && clienteEncontrado && (
        <div className="space-y-4">
          <p className="text-sm text-body">
            Você é{" "}
            <span className="font-medium text-heading">
              {clienteEncontrado.nome}
            </span>
            ?
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirmarSim}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
            >
              Sim, sou eu
            </button>
            <button
              type="button"
              onClick={handleConfirmarNao}
              className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Não é meu número
            </button>
          </div>
        </div>
      )}

      {etapa === "nome" && (
        <form onSubmit={handleSubmitNome} className="space-y-4">
          <p className="text-sm text-body">
            Não encontramos esse número. Como você se chama?
          </p>

          <div>
            <label
              htmlFor="nome-identificacao"
              className="mb-1 block text-sm font-medium text-body"
            >
              Nome
            </label>
            <input
              id="nome-identificacao"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              placeholder="Seu nome"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
          >
            Continuar
          </button>

          {erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erro}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
