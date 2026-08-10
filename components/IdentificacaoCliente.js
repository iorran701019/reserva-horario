"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import CadastroCliente from "@/components/CadastroCliente";
import ModalConflitoWhatsapp from "@/components/ModalConflitoWhatsapp";
import { enderecoCompleto, whatsappConfere } from "@/lib/clienteValidacao";
import { useConflitoWhatsapp } from "@/lib/checagemWhatsapp";
import { lerFatia, salvarFatia, limparFatia } from "@/lib/persistenciaAgendamento";

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
//   slug              – slug do salão (rota /[salon]), chave da persistência
//                       em sessionStorage (ver lib/persistenciaAgendamento) —
//                       restaura etapa/telefone/clienteEncontrado/clienteNovo
//                       depois de um reload real da página (ex.: WhatsApp
//                       recarregando a aba ao voltar de segundo plano).
//                       Restaurado direto, sem revalidação especial: é dado
//                       que a própria cliente digitou, recuperável do banco
//                       se o telefone bater de qualquer jeito.
//   estabelecimentoId – particiona a busca por salão.
//   cadastroCompleto  – bifurca o fluxo acima (default false).
//   estabelecimentoWhatsapp, nomeContato – repassados ao modal "fale com a
//                       gente" da checagem de WhatsApp já cadastrado (ver
//                       lib/checagemWhatsapp.js) e ao CadastroCliente, que
//                       precisa deles pro mesmo modal na etapa
//                       "completarEndereco".
//   msgFalhaCadastro  – texto personalizado (estabelecimentos.
//                       msg_falha_cadastro) repassado pro mesmo modal.
//   onIdentificado    – recebe { id, nome, telefone, clienteNovo } pronto
//                       pra virar clienteInicial do FormularioAgendamento.
//   onEtapaChange     – opcional; recebe a etapa interna atual sempre que ela
//                       mudar (inclusive no mount, com "telefone"). Permite o
//                       pai reagir a qual das 4 telas está visível.
export default function IdentificacaoCliente({
  slug,
  estabelecimentoId,
  cadastroCompleto = false,
  exigirEndereco = true,
  estabelecimentoWhatsapp,
  nomeContato,
  msgFalhaCadastro,
  onIdentificado,
  onEtapaChange,
}) {
  // "telefone" (pede WhatsApp) -> "confirmar" (achou, confirma o nome) ->
  // "cadastroSimples" (nome + confirmar WhatsApp, ramo false) ou
  // "completarEndereco" (ramo true). Restaurada da sessão (ver `slug`) se
  // houver uma etapa salva ainda dentro da janela de validade.
  const [etapa, setEtapa] = useState(
    () => lerFatia(slug, "identificacao")?.etapa ?? "telefone"
  );

  useEffect(() => {
    onEtapaChange?.(etapa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa]);
  const [telefone, setTelefone] = useState(
    () => lerFatia(slug, "identificacao")?.telefone ?? ""
  );
  const [clienteEncontrado, setClienteEncontrado] = useState(
    () => lerFatia(slug, "identificacao")?.clienteEncontrado ?? null
  );
  const [clienteNovo, setClienteNovo] = useState(
    () => lerFatia(slug, "identificacao")?.clienteNovo ?? false
  );
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  // Trava os botões "Sim"/"Não" da etapa "confirmar" enquanto o "Não" do
  // ramo cadastroCompleto=true insere o registro mínimo (evita duplo clique).
  const [confirmando, setConfirmando] = useState(false);

  // Campos da etapa "cadastroSimples" (ramo cadastroCompleto=false).
  // `whatsappSimples` nasce com o telefone digitado na etapa 1, mas é
  // editável aqui — "Confirme seu WhatsApp" passa a validar contra ELE, não
  // mais contra `telefone` bruto. Restaurando direto na etapa "cadastroSimples",
  // nasce com o telefone salvo — mesmo comportamento de quem acabou de
  // chegar nela (handleBuscar/handleConfirmarNao).
  const [nomeSimples, setNomeSimples] = useState("");
  const [whatsappSimples, setWhatsappSimples] = useState(() => {
    const rascunho = lerFatia(slug, "identificacao");
    return rascunho?.etapa === "cadastroSimples" ? rascunho?.telefone ?? "" : "";
  });
  const [confirmarWhatsappSimples, setConfirmarWhatsappSimples] = useState("");
  const [enviandoSimples, setEnviandoSimples] = useState(false);
  const [erroSimples, setErroSimples] = useState("");
  const [erroWhatsappSimples, setErroWhatsappSimples] = useState("");

  // Checagem de WhatsApp já cadastrado (com trava progressiva), usada pelo
  // cadastro simples — a mesma checagem do completarEndereco vive dentro do
  // CadastroCliente, que recebe o hook próprio dele.
  const conflitoWhatsapp = useConflitoWhatsapp();

  // Grava a fatia "identificacao" a cada mudança relevante, pra sobreviver a
  // um reload real da página (ver lib/persistenciaAgendamento). Limpa
  // (ver os pontos de saída abaixo) assim que a cliente é identificada — a
  // partir daí quem manda é a fatia "clienteIdentificado" do page.js.
  useEffect(() => {
    if (!slug) return;
    salvarFatia(slug, "identificacao", {
      etapa,
      telefone,
      clienteEncontrado,
      clienteNovo,
    });
  }, [slug, etapa, telefone, clienteEncontrado, clienteNovo]);

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
    limparFatia(slug, "identificacao");
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

    limparFatia(slug, "identificacao");
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
          slug={slug}
          estabelecimentoId={estabelecimentoId}
          clienteId={clienteEncontrado.id}
          nomeInicial={clienteEncontrado.nome}
          telefoneReferencia={telefone}
          valoresIniciais={clienteEncontrado}
          clienteNovo={clienteNovo}
          exigirEndereco={exigirEndereco}
          estabelecimentoWhatsapp={estabelecimentoWhatsapp}
          nomeContato={nomeContato}
          msgFalhaCadastro={msgFalhaCadastro}
          onCadastrado={(dados) => {
            limparFatia(slug, "identificacao");
            onIdentificado(dados);
          }}
        />
      )}
    </div>

    <ModalConflitoWhatsapp
      clienteConflitante={conflitoWhatsapp.clienteConflitante}
      modalContato={conflitoWhatsapp.modalContato}
      estabelecimentoWhatsapp={estabelecimentoWhatsapp}
      nomeContato={nomeContato}
      msgFalhaCadastro={msgFalhaCadastro}
      onConfirmar={() => {
        limparFatia(slug, "identificacao");
        conflitoWhatsapp.confirmarConflito(onIdentificado, whatsappSimples);
      }}
      onNegar={conflitoWhatsapp.negarConflito}
      onFecharContato={conflitoWhatsapp.fecharModalContato}
    />
    </>
  );
}
