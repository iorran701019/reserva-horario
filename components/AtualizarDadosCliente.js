"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  aplicarMascaraNascimento,
  paraExibicaoNascimento,
  validarNascimento,
} from "@/lib/nascimentoValidacao";

// Edição dos dados do cliente, reaproveitando a MESMA estrutura de campos e
// validação do CadastroCliente (nome, whatsapp com dupla confirmação, CEP
// com autofill via ViaCEP, endereço, bairro, cidade, estado, nascimento,
// instagram) — a diferença é que aqui os campos nascem pré-preenchidos com
// os dados atuais (buscados por `clienteId` ao montar) e o envio faz UPDATE
// em vez de INSERT.
//
// CEP: mesmo comportamento do CadastroCliente — ao completar 8 dígitos,
// busca o ViaCEP e preenche endereço/bairro/cidade/estado; falha de rede ou
// CEP inexistente não trava o formulário.
//
// WhatsApp: só faz parte deste formulário quando !modoAdmin (fluxo público,
// PainelCliente) — o cliente ainda troca o próprio número aqui, com a mesma
// dupla digitação de sempre, mas a persistência vai por
// supabase.rpc("atualizar_whatsapp_cliente", ...) em vez do UPDATE direto em
// `clientes`, porque o vínculo agendamento↔cliente hoje é por telefone (ver
// lib/clientesAdmin.js) — só trocar a coluna deixaria o histórico órfão; a
// RPC atualiza cliente e histórico juntos. Em modoAdmin (GerenciarClientes) o
// campo nem aparece aqui: a troca de WhatsApp em nome do cliente tem fluxo
// próprio (popup "Alterar WhatsApp" no detalhe), com uma confirmação extra
// que não faz sentido pro cliente editando os próprios dados.
//
// Props:
//   clienteId    – id do cliente em `clientes` a ser editado/buscado.
//   estabelecimentoId – necessário só quando !modoAdmin, pra RPC de troca de
//                  WhatsApp (p_estabelecimento_id, escopa a atualização do
//                  histórico ao salão certo).
//   exigirEndereco – estabelecimentos.exigir_endereco (default true,
//                  preserva o comportamento atual). false oculta todo o
//                  bloco de CEP/endereço/bairro/cidade/estado (não renderiza,
//                  não valida, não chama ViaCEP) e mostra no lugar um campo
//                  opcional "Contato de emergência (WhatsApp)", salvo em
//                  clientes.contato_emergencia.
//   onAtualizado – recebe { id, nome, telefone } com os dados novos após o
//                  update ter sucesso.
//   onCancelar   – botão "Voltar": descarta a edição sem salvar.
//   modoAdmin    – uso pelo /admin (GerenciarClientes), editando em nome do
//                  cliente: torna nascimento opcional (único campo, além de
//                  endereço/instagram/contato de emergência, que hoje é
//                  obrigatório aqui) — nome continua exigido; WhatsApp não
//                  faz parte do formulário (ver acima). Ausente/false
//                  preserva o comportamento atual do fluxo público.
export default function AtualizarDadosCliente({
  clienteId,
  estabelecimentoId,
  exigirEndereco = true,
  onAtualizado,
  onCancelar,
  modoAdmin = false,
}) {
  const [form, setForm] = useState({
    nome: "",
    whatsapp: "",
    whatsappConfirmacao: "",
    cep: "",
    endereco: "",
    bairro: "",
    cidade: "",
    estado: "",
    nascimento: "",
    instagram: "",
    contatoEmergencia: "",
  });
  const [carregando, setCarregando] = useState(true);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroNascimento, setErroNascimento] = useState("");
  const [mostrarReconfirmacao, setMostrarReconfirmacao] = useState(false);
  const [whatsappReconfirmacao, setWhatsappReconfirmacao] = useState("");

  // Valor de whatsapp como carregado do banco (dígitos), pra saber no submit
  // se o cliente de fato trocou o número — só então vale a pena chamar a RPC
  // de troca (ver handleSubmit). Não usado em modoAdmin.
  const [whatsappOriginal, setWhatsappOriginal] = useState("");

  // Busca os dados atuais do cliente ao montar e pré-preenche o formulário
  // (whatsappConfirmacao também nasce com o valor atual, espelhando o que já
  // está salvo — o cliente só precisa reeditar se quiser trocar o número).
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("clientes")
        .select(
          "id, nome, whatsapp, cep, endereco, bairro, cidade, estado, nascimento, instagram, contato_emergencia"
        )
        .eq("id", clienteId)
        .single();

      if (!ativo) return;

      if (error || !data) {
        setErro("Não foi possível carregar seus dados.");
      } else {
        setWhatsappOriginal(String(data.whatsapp ?? "").replace(/\D/g, ""));
        setForm({
          nome: data.nome ?? "",
          whatsapp: data.whatsapp ?? "",
          whatsappConfirmacao: data.whatsapp ?? "",
          cep: data.cep ?? "",
          endereco: data.endereco ?? "",
          bairro: data.bairro ?? "",
          cidade: data.cidade ?? "",
          estado: data.estado ?? "",
          nascimento: paraExibicaoNascimento(data.nascimento),
          instagram: data.instagram ?? "",
          contatoEmergencia: data.contato_emergencia ?? "",
        });
      }
      setCarregando(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [clienteId]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((anterior) => ({ ...anterior, [name]: value }));
  }

  function handleChangeNascimento(e) {
    const valor = aplicarMascaraNascimento(form.nascimento, e.target.value);
    setForm((anterior) => ({ ...anterior, nascimento: valor }));
    setErroNascimento("");
  }

  // Ao CEP atingir 8 dígitos, busca o ViaCEP e preenche os campos de
  // endereço — sem sobrescrever o que o cliente já tiver digitado à mão.
  useEffect(() => {
    if (!exigirEndereco) return;

    const digitos = form.cep.replace(/\D/g, "");
    if (digitos.length !== 8) return;

    let ativo = true;

    async function buscarCep() {
      setBuscandoCep(true);
      try {
        const res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
        const dados = await res.json();
        if (!ativo || dados.erro) return;

        setForm((anterior) => ({
          ...anterior,
          endereco: dados.logradouro || anterior.endereco,
          bairro: dados.bairro || anterior.bairro,
          cidade: dados.localidade || anterior.cidade,
          estado: dados.uf || anterior.estado,
        }));
      } catch {
        // ViaCEP fora do ar ou rede falhou: os campos seguem manuais.
      } finally {
        if (ativo) setBuscandoCep(false);
      }
    }

    buscarCep();
    return () => {
      ativo = false;
    };
  }, [form.cep]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setErroNascimento("");

    if (!form.nome.trim()) {
      setErro("Informe seu nome.");
      return;
    }

    const { erro: erroData, iso: nascimentoIso } = validarNascimento(form.nascimento);
    if (erroData) {
      setErroNascimento(erroData);
      return;
    }
    if (!nascimentoIso && !modoAdmin) {
      setErroNascimento("Informe sua data de nascimento.");
      return;
    }

    let novoWhatsappDigitos = null;

    if (!modoAdmin) {
      const digitosWhatsapp = form.whatsapp.replace(/\D/g, "");
      if (digitosWhatsapp.length < 10) {
        setErro("Informe um WhatsApp válido com DDD.");
        return;
      }

      const digitosBase = mostrarReconfirmacao
        ? form.whatsappConfirmacao.replace(/\D/g, "")
        : digitosWhatsapp;

      const digitosParaComparar = mostrarReconfirmacao
        ? whatsappReconfirmacao.replace(/\D/g, "")
        : form.whatsappConfirmacao.replace(/\D/g, "");

      if (digitosBase !== digitosParaComparar) {
        setMostrarReconfirmacao(true);
        setErro("Os números não coincidem. Confirme novamente abaixo.");
        return;
      }

      novoWhatsappDigitos = (mostrarReconfirmacao
        ? whatsappReconfirmacao
        : form.whatsappConfirmacao
      ).replace(/\D/g, "");
    }

    setEnviando(true);

    // Troca de número: só quando de fato mudou, via RPC (nunca um UPDATE
    // direto aqui — ver comentário no topo do arquivo). Se a RPC falhar,
    // interrompe antes de tocar no resto dos dados.
    if (!modoAdmin && novoWhatsappDigitos !== whatsappOriginal) {
      const { error: erroWhatsapp } = await supabase.rpc(
        "atualizar_whatsapp_cliente",
        {
          p_cliente_id: clienteId,
          p_novo_whatsapp: novoWhatsappDigitos,
          p_estabelecimento_id: estabelecimentoId,
        }
      );

      if (erroWhatsapp) {
        setEnviando(false);
        setErro(erroWhatsapp.message);
        return;
      }
    }

    const dadosCliente = {
      nome: form.nome.trim(),
      nascimento: nascimentoIso,
      instagram: form.instagram || null,
    };

    if (exigirEndereco) {
      dadosCliente.cep = form.cep || null;
      dadosCliente.endereco = form.endereco || null;
      dadosCliente.bairro = form.bairro || null;
      dadosCliente.cidade = form.cidade || null;
      dadosCliente.estado = form.estado || null;
    } else {
      dadosCliente.contato_emergencia =
        form.contatoEmergencia.replace(/\D/g, "") || null;
    }

    const { data, error } = await supabase
      .from("clientes")
      .update(dadosCliente)
      .eq("id", clienteId)
      .select()
      .single();

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    onAtualizado({
      ...data,
      telefone: data.whatsapp,
    });
  }

  if (carregando) {
    return <p className="text-sm text-body">Carregando seus dados...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-body">Atualize seus dados abaixo.</p>

      <div>
        <label htmlFor="atu-nome" className="mb-1 block text-sm font-medium text-body">
          Nome
        </label>
        <input
          id="atu-nome"
          name="nome"
          type="text"
          value={form.nome}
          onChange={handleChange}
          required
          placeholder="Seu nome"
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </div>

      {!modoAdmin && (
        <div>
          <label htmlFor="atu-whatsapp" className="mb-1 block text-sm font-medium text-body">
            WhatsApp
          </label>
          <input
            id="atu-whatsapp"
            name="whatsapp"
            type="tel"
            inputMode="tel"
            value={form.whatsapp}
            onChange={handleChange}
            required
            placeholder="(24) 99999-9999"
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>
      )}

      {exigirEndereco ? (
        <>
          <div>
            <label htmlFor="atu-cep" className="mb-1 block text-sm font-medium text-body">
              CEP
            </label>
            <input
              id="atu-cep"
              name="cep"
              type="text"
              inputMode="numeric"
              value={form.cep}
              onChange={handleChange}
              placeholder="28000-000"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            {buscandoCep && <p className="mt-1 text-xs text-muted">Buscando CEP...</p>}
          </div>

          <div>
            <label htmlFor="atu-endereco" className="mb-1 block text-sm font-medium text-body">
              Endereço
            </label>
            <input
              id="atu-endereco"
              name="endereco"
              type="text"
              value={form.endereco}
              onChange={handleChange}
              placeholder="Rua, número"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="atu-bairro" className="mb-1 block text-sm font-medium text-body">
                Bairro
              </label>
              <input
                id="atu-bairro"
                name="bairro"
                type="text"
                value={form.bairro}
                onChange={handleChange}
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>

            <div>
              <label htmlFor="atu-cidade" className="mb-1 block text-sm font-medium text-body">
                Cidade
              </label>
              <input
                id="atu-cidade"
                name="cidade"
                type="text"
                value={form.cidade}
                onChange={handleChange}
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
          </div>

          <div>
            <label htmlFor="atu-estado" className="mb-1 block text-sm font-medium text-body">
              Estado
            </label>
            <input
              id="atu-estado"
              name="estado"
              type="text"
              maxLength={2}
              value={form.estado}
              onChange={handleChange}
              placeholder="RJ"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading uppercase outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="atu-contato-emergencia" className="mb-1 block text-sm font-medium text-body">
            Contato de emergência (WhatsApp) <span className="font-normal text-muted">(opcional)</span>
          </label>
          <input
            id="atu-contato-emergencia"
            name="contatoEmergencia"
            type="tel"
            inputMode="tel"
            value={form.contatoEmergencia}
            onChange={handleChange}
            placeholder="(24) 99999-9999"
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>
      )}

      <div>
        <label htmlFor="atu-nascimento" className="mb-1 block text-sm font-medium text-body">
          Nascimento{" "}
          {modoAdmin && <span className="font-normal text-muted">(opcional)</span>}
        </label>
        <input
          id="atu-nascimento"
          name="nascimento"
          type="text"
          inputMode="numeric"
          value={form.nascimento}
          onChange={handleChangeNascimento}
          required={!modoAdmin}
          placeholder="dd/mm/aaaa"
          maxLength={10}
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        {erroNascimento && (
          <p className="mt-1 text-sm text-red-700">{erroNascimento}</p>
        )}
      </div>

      {!modoAdmin && (
        <div>
          <label htmlFor="atu-whatsapp-confirmacao" className="mb-1 block text-sm font-medium text-body">
            Confirme seu WhatsApp
          </label>
          <input
            id="atu-whatsapp-confirmacao"
            name="whatsappConfirmacao"
            type="tel"
            inputMode="tel"
            value={form.whatsappConfirmacao}
            onChange={handleChange}
            required
            placeholder="(24) 99999-9999"
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>
      )}

      {!modoAdmin && mostrarReconfirmacao && (
        <div>
          <label htmlFor="atu-whatsapp-reconfirmacao" className="mb-1 block text-sm font-medium text-body">
            Confirme seu WhatsApp novamente
          </label>
          <input
            id="atu-whatsapp-reconfirmacao"
            name="whatsappReconfirmacao"
            type="tel"
            inputMode="tel"
            value={whatsappReconfirmacao}
            onChange={(e) => setWhatsappReconfirmacao(e.target.value)}
            required
            placeholder="(24) 99999-9999"
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>
      )}

      <div>
        <label htmlFor="atu-instagram" className="mb-1 block text-sm font-medium text-body">
          Instagram <span className="font-normal text-muted">(opcional)</span>
        </label>
        <input
          id="atu-instagram"
          name="instagram"
          type="text"
          value={form.instagram}
          onChange={handleChange}
          placeholder="@seu.perfil"
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {enviando ? "Salvando..." : "Salvar alterações"}
      </button>

      <button
        type="button"
        onClick={onCancelar}
        className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
      >
        Voltar
      </button>

      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}
    </form>
  );
}
