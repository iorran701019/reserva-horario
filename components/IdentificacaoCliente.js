"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import CadastroCliente from "@/components/CadastroCliente";
import { enderecoCompleto, whatsappConfere } from "@/lib/clienteValidacao";

// Tela exibida ANTES do FormularioAgendamento no fluxo público: pede só o
// WhatsApp, busca o cliente em `clientes` (por estabelecimento_id + telefone
// normalizado) e decide o próximo passo. O resultado vira `clienteInicial` do
// FormularioAgendamento, que passa a pular os campos de nome/WhatsApp na
// etapa "dados".
//
// A coluna em `clientes` chama-se `whatsapp` (confirmado direto no banco) e é
// tratada aqui como dígitos apenas — por isso a busca compara dígitos, não a
// string digitada. O `telefone` repassado a onIdentificado é a string bruta
// digitada na etapa 1 (mesma convenção usada pelo FormularioAgendamento, que
// não normaliza).
//
// O comportamento depois da busca depende de `cadastroCompleto`
// (estabelecimento.cadastro_completo), por tenant:
//
// - true (ex.: Flávia): sem tela de confirmação "é você?". Se não encontrar,
//   cria um registro mínimo (nome vazio) na hora. Em seguida, se o bloco de
//   endereço (CEP/número/bairro/cidade) estiver incompleto — inclusive no
//   registro recém-criado — abre CadastroCliente pra completar; se já
//   estiver completo, pula direto pro agendamento.
// - false (ex.: Laysla): mantém a tela "é você, [nome]?" de hoje. Se não
//   encontrar, ou se a resposta for "não", mostra um cadastro mínimo (nome +
//   confirmar WhatsApp) — nunca pede endereço.
//
// Props:
//   estabelecimentoId – particiona a busca por salão.
//   cadastroCompleto  – bifurca o fluxo acima (default false).
//   onIdentificado    – recebe { id, nome, telefone, clienteNovo } pronto
//                       pra virar clienteInicial do FormularioAgendamento.
export default function IdentificacaoCliente({
  estabelecimentoId,
  cadastroCompleto = false,
  onIdentificado,
}) {
  // "telefone" (pede WhatsApp) -> "confirmar" (achou, confirma o nome, só no
  // ramo cadastroCompleto=false) -> "cadastroSimples" (nome + confirmar
  // WhatsApp, ramo false) ou "completarEndereco" (ramo true).
  const [etapa, setEtapa] = useState("telefone");
  const [telefone, setTelefone] = useState("");
  const [clienteEncontrado, setClienteEncontrado] = useState(null);
  const [clienteNovo, setClienteNovo] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");

  // Campos da etapa "cadastroSimples" (ramo cadastroCompleto=false).
  const [nomeSimples, setNomeSimples] = useState("");
  const [confirmarWhatsappSimples, setConfirmarWhatsappSimples] = useState("");
  const [enviandoSimples, setEnviandoSimples] = useState(false);
  const [erroSimples, setErroSimples] = useState("");
  const [erroWhatsappSimples, setErroWhatsappSimples] = useState("");

  async function handleBuscar(e) {
    e.preventDefault();
    setErro("");

    const digitos = telefone.replace(/\D/g, "");
    if (digitos.length < 10) {
      setErro("Informe um WhatsApp válido com DDD.");
      return;
    }

    setBuscando(true);
    const { data } = await supabase
      .from("clientes")
      .select(
        "id, nome, whatsapp, cep, endereco, numero, complemento, bairro, cidade, estado, nascimento, instagram"
      )
      .eq("estabelecimento_id", estabelecimentoId)
      .eq("whatsapp", digitos)
      .limit(1);

    const encontrado = data && data.length > 0 ? data[0] : null;

    if (cadastroCompleto) {
      if (encontrado) {
        if (enderecoCompleto(encontrado)) {
          setBuscando(false);
          onIdentificado({
            id: encontrado.id,
            nome: encontrado.nome,
            telefone,
            clienteNovo: false,
          });
          return;
        }
        setClienteEncontrado(encontrado);
        setClienteNovo(false);
        setBuscando(false);
        setEtapa("completarEndereco");
        return;
      }

      const { data: novo, error: erroInsert } = await supabase
        .from("clientes")
        .insert({ estabelecimento_id: estabelecimentoId, nome: "", whatsapp: digitos })
        .select()
        .single();

      setBuscando(false);

      if (erroInsert) {
        setErro(erroInsert.message);
        return;
      }

      setClienteEncontrado(novo);
      setClienteNovo(true);
      setEtapa("completarEndereco");
      return;
    }

    setBuscando(false);
    if (encontrado) {
      setClienteEncontrado(encontrado);
      setEtapa("confirmar");
    } else {
      setEtapa("cadastroSimples");
    }
  }

  function handleConfirmarSim() {
    onIdentificado({
      id: clienteEncontrado.id,
      nome: clienteEncontrado.nome,
      telefone,
      clienteNovo: false,
    });
  }

  // "Não é meu número": vai direto pro cadastro simples (nome + confirmar
  // WhatsApp), sem voltar a pedir o telefone.
  function handleConfirmarNao() {
    setEtapa("cadastroSimples");
  }

  async function handleSubmitSimples(e) {
    e.preventDefault();
    setErroSimples("");
    setErroWhatsappSimples("");

    if (!nomeSimples.trim()) {
      setErroSimples("Informe seu nome.");
      return;
    }

    if (!whatsappConfere(confirmarWhatsappSimples, telefone)) {
      setErroWhatsappSimples("O número digitado não confere com o WhatsApp informado.");
      return;
    }

    setEnviandoSimples(true);
    const digitos = telefone.replace(/\D/g, "");

    const resultado = clienteEncontrado
      ? await supabase
          .from("clientes")
          .update({ nome: nomeSimples.trim() })
          .eq("id", clienteEncontrado.id)
          .select()
          .single()
      : await supabase
          .from("clientes")
          .insert({ estabelecimento_id: estabelecimentoId, nome: nomeSimples.trim(), whatsapp: digitos })
          .select()
          .single();

    setEnviandoSimples(false);

    if (resultado.error) {
      setErroSimples(resultado.error.message);
      return;
    }

    onIdentificado({
      id: resultado.data.id,
      nome: resultado.data.nome,
      telefone,
      clienteNovo: !clienteEncontrado,
    });
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

      {etapa === "cadastroSimples" && (
        <form onSubmit={handleSubmitSimples} className="space-y-4">
          <p className="text-sm text-body">
            Não encontramos esse número. Informe seu nome para continuar.
          </p>

          <div>
            <label htmlFor="cs-nome" className="mb-1 block text-sm font-medium text-body">
              Nome completo
            </label>
            <input
              id="cs-nome"
              type="text"
              value={nomeSimples}
              onChange={(e) => setNomeSimples(e.target.value)}
              required
              placeholder="Seu nome completo"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div>
            <label htmlFor="cs-whatsapp-confirmacao" className="mb-1 block text-sm font-medium text-body">
              Confirme seu WhatsApp
            </label>
            <input
              id="cs-whatsapp-confirmacao"
              type="tel"
              inputMode="tel"
              value={confirmarWhatsappSimples}
              onChange={(e) => setConfirmarWhatsappSimples(e.target.value)}
              required
              placeholder="(24) 99999-9999"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            {erroWhatsappSimples && (
              <p className="mt-1 text-sm text-red-700">{erroWhatsappSimples}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={enviandoSimples}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviandoSimples ? "Enviando..." : "Continuar"}
          </button>

          {erroSimples && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erroSimples}
            </p>
          )}
        </form>
      )}

      {etapa === "completarEndereco" && clienteEncontrado && (
        <CadastroCliente
          estabelecimentoId={estabelecimentoId}
          clienteId={clienteEncontrado.id}
          nomeInicial={clienteEncontrado.nome}
          telefoneReferencia={telefone}
          valoresIniciais={clienteEncontrado}
          clienteNovo={clienteNovo}
          onCadastrado={onIdentificado}
        />
      )}
    </div>
  );
}
