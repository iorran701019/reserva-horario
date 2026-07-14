"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import CadastroCliente from "@/components/CadastroCliente";
import ModalConflitoWhatsapp from "@/components/ModalConflitoWhatsapp";
import { enderecoCompleto, whatsappConfere } from "@/lib/clienteValidacao";
import { useConflitoWhatsapp } from "@/lib/checagemWhatsapp";

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
// (estabelecimento.cadastro_completo), por tenant. Em AMBOS os ramos,
// encontrar um cliente sempre passa pela etapa "confirmar" ("é você?") — a
// diferença fica em "Sim"/"Não" e em quem nunca encontra:
//
// - true (ex.: Flávia): "Sim" só libera direto pro agendamento se o bloco de
//   endereço (CEP/número/bairro/cidade) já estiver completo; senão abre
//   CadastroCliente pra completar. "Não" ZERA a linha encontrada (nome e
//   endereço voltam a vazio/null — não dá pra INSERIR outra com o mesmo
//   WhatsApp, a coluna é UNIQUE por estabelecimento) e abre CadastroCliente
//   em branco a partir dela. Não encontrar cria um registro mínimo novo
//   (esse caso não colide com ninguém) e segue pro mesmo completar endereço.
// - false (ex.: Laysla): "Sim" libera direto pro agendamento sempre (nunca
//   checa endereço). "Não" (ou não encontrar) mostra um cadastro mínimo
//   (nome + confirmar WhatsApp) — nunca pede endereço.
//
// Props:
//   estabelecimentoId – particiona a busca por salão.
//   cadastroCompleto  – bifurca o fluxo acima (default false).
//   estabelecimentoWhatsapp, nomeContato – repassados ao modal "fale com a
//                       gente" da checagem de WhatsApp já cadastrado (ver
//                       lib/checagemWhatsapp.js) e ao CadastroCliente, que
//                       precisa deles pro mesmo modal na etapa
//                       "completarEndereco".
//   onIdentificado    – recebe { id, nome, telefone, clienteNovo } pronto
//                       pra virar clienteInicial do FormularioAgendamento.
export default function IdentificacaoCliente({
  estabelecimentoId,
  cadastroCompleto = false,
  estabelecimentoWhatsapp,
  nomeContato,
  onIdentificado,
}) {
  // "telefone" (pede WhatsApp) -> "confirmar" (achou, confirma o nome) ->
  // "cadastroSimples" (nome + confirmar WhatsApp, ramo false) ou
  // "completarEndereco" (ramo true).
  const [etapa, setEtapa] = useState("telefone");
  const [telefone, setTelefone] = useState("");
  const [clienteEncontrado, setClienteEncontrado] = useState(null);
  const [clienteNovo, setClienteNovo] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  // Trava os botões "Sim"/"Não" da etapa "confirmar" enquanto o "Não" do
  // ramo cadastroCompleto=true insere o registro mínimo (evita duplo clique).
  const [confirmando, setConfirmando] = useState(false);

  // Campos da etapa "cadastroSimples" (ramo cadastroCompleto=false).
  // `whatsappSimples` nasce com o telefone digitado na etapa 1, mas é
  // editável aqui — "Confirme seu WhatsApp" passa a validar contra ELE, não
  // mais contra `telefone` bruto.
  const [nomeSimples, setNomeSimples] = useState("");
  const [whatsappSimples, setWhatsappSimples] = useState("");
  const [confirmarWhatsappSimples, setConfirmarWhatsappSimples] = useState("");
  const [enviandoSimples, setEnviandoSimples] = useState(false);
  const [erroSimples, setErroSimples] = useState("");
  const [erroWhatsappSimples, setErroWhatsappSimples] = useState("");

  // Checagem de WhatsApp já cadastrado (com trava progressiva), usada pelo
  // cadastro simples — a mesma checagem do completarEndereco vive dentro do
  // CadastroCliente, que recebe o hook próprio dele.
  const conflitoWhatsapp = useConflitoWhatsapp();

  // Cria um registro mínimo (nome vazio, telefone digitado na etapa 1) e abre
  // o completarEndereco em branco a partir dele — usado quando a busca não
  // encontra ninguém (aí sim é seguro fazer INSERT).
  async function criarRegistroMinimoEAvancar() {
    const digitos = telefone.replace(/\D/g, "");
    const { data: novo, error: erroInsert } = await supabase
      .from("clientes")
      .insert({ estabelecimento_id: estabelecimentoId, nome: "", whatsapp: digitos })
      .select()
      .single();

    if (erroInsert) {
      setErro(erroInsert.message);
      return;
    }

    setClienteEncontrado(novo);
    setClienteNovo(true);
    setEtapa("completarEndereco");
  }

  // "Não é meu número" no ramo cadastroCompleto=true: o WhatsApp já pertence
  // a esse registro (UNIQUE estabelecimento_id+whatsapp impede um INSERT com
  // o mesmo número), então reaproveita a MESMA linha, zerando nome e
  // endereço — o efeito pro cliente é idêntico a um cadastro em branco, sem
  // herdar dados de quem foi negado.
  async function limparRegistroEAvancar(clienteId) {
    const { data: limpo, error: erroUpdate } = await supabase
      .from("clientes")
      .update({
        nome: "",
        cep: null,
        endereco: null,
        numero: null,
        complemento: null,
        bairro: null,
        cidade: null,
        estado: null,
        nascimento: null,
        instagram: null,
      })
      .eq("id", clienteId)
      .select()
      .single();

    if (erroUpdate) {
      setErro(erroUpdate.message);
      return;
    }

    setClienteEncontrado(limpo);
    setClienteNovo(true);
    setEtapa("completarEndereco");
  }

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

    // Encontrado: SEMPRE passa por "confirmar" (é você?), nos dois ramos —
    // quem decide o que "Sim"/"Não" fazem é handleConfirmarSim/Nao.
    if (encontrado) {
      setBuscando(false);
      setClienteEncontrado(encontrado);
      setEtapa("confirmar");
      return;
    }

    // Não encontrado: cadastroCompleto=true cria o registro mínimo e vai
    // completar endereço; false mostra o cadastro simples (nome + confirmar).
    if (cadastroCompleto) {
      await criarRegistroMinimoEAvancar();
      setBuscando(false);
      return;
    }

    setBuscando(false);
    setWhatsappSimples(telefone);
    setEtapa("cadastroSimples");
  }

  // "Sim, sou eu": no ramo cadastroCompleto=false libera direto sempre; no
  // ramo true só libera se o bloco de endereço já estiver completo, senão
  // abre CadastroCliente (modo update, pré-preenchido) pra completar.
  function handleConfirmarSim() {
    if (cadastroCompleto && !enderecoCompleto(clienteEncontrado)) {
      setClienteNovo(false);
      setEtapa("completarEndereco");
      return;
    }
    onIdentificado({
      id: clienteEncontrado.id,
      nome: clienteEncontrado.nome,
      telefone,
      clienteNovo: false,
    });
  }

  // "Não é meu número"/"Não sou eu": ramo false vai direto pro cadastro
  // simples (nome + confirmar WhatsApp), sem voltar a pedir o telefone. Ramo
  // true zera a linha encontrada (ver limparRegistroEAvancar) e abre
  // completarEndereco em branco — nunca herda os dados de quem foi negado.
  async function handleConfirmarNao() {
    if (!cadastroCompleto) {
      setWhatsappSimples(telefone);
      setEtapa("cadastroSimples");
      return;
    }

    setConfirmando(true);
    setErro("");
    await limparRegistroEAvancar(clienteEncontrado.id);
    setConfirmando(false);
  }

  async function handleSubmitSimples(e) {
    e.preventDefault();
    setErroSimples("");
    setErroWhatsappSimples("");

    if (!nomeSimples.trim()) {
      setErroSimples("Informe seu nome.");
      return;
    }

    if (!whatsappConfere(confirmarWhatsappSimples, whatsappSimples)) {
      setErroWhatsappSimples("O número digitado não confere com o WhatsApp informado.");
      return;
    }

    const digitos = whatsappSimples.replace(/\D/g, "");

    setEnviandoSimples(true);

    const temConflito = await conflitoWhatsapp.verificar(
      estabelecimentoId,
      digitos,
      clienteEncontrado?.id ?? null
    );
    if (temConflito) {
      setEnviandoSimples(false);
      return;
    }

    const resultado = clienteEncontrado
      ? await supabase
          .from("clientes")
          .update({ nome: nomeSimples.trim(), whatsapp: digitos })
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
      telefone: whatsappSimples,
      clienteNovo: !clienteEncontrado,
    });
  }

  return (
    <>
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
              disabled={confirmando}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sim, sou eu
            </button>
            <button
              type="button"
              onClick={handleConfirmarNao}
              disabled={confirmando}
              className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmando ? "..." : "Não é meu número"}
            </button>
          </div>

          {erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erro}
            </p>
          )}
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
            <label htmlFor="cs-whatsapp" className="mb-1 block text-sm font-medium text-body">
              WhatsApp
            </label>
            <input
              id="cs-whatsapp"
              type="tel"
              inputMode="tel"
              value={whatsappSimples}
              onChange={(e) => setWhatsappSimples(e.target.value)}
              required
              placeholder="(24) 99999-9999"
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
          estabelecimentoWhatsapp={estabelecimentoWhatsapp}
          nomeContato={nomeContato}
          onCadastrado={onIdentificado}
        />
      )}
    </div>

    <ModalConflitoWhatsapp
      clienteConflitante={conflitoWhatsapp.clienteConflitante}
      modalContato={conflitoWhatsapp.modalContato}
      estabelecimentoWhatsapp={estabelecimentoWhatsapp}
      nomeContato={nomeContato}
      onConfirmar={() => conflitoWhatsapp.confirmarConflito(onIdentificado, whatsappSimples)}
      onNegar={conflitoWhatsapp.negarConflito}
      onFecharContato={conflitoWhatsapp.fecharModalContato}
    />
    </>
  );
}
