"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
// Props:
//   clienteId    – id do cliente em `clientes` a ser editado/buscado.
//   onAtualizado – recebe { id, nome, telefone } com os dados novos após o
//                  update ter sucesso.
//   onCancelar   – botão "Voltar": descarta a edição sem salvar.
export default function AtualizarDadosCliente({ clienteId, onAtualizado, onCancelar }) {
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
  });
  const [carregando, setCarregando] = useState(true);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [mostrarReconfirmacao, setMostrarReconfirmacao] = useState(false);
  const [whatsappReconfirmacao, setWhatsappReconfirmacao] = useState("");

  // Busca os dados atuais do cliente ao montar e pré-preenche o formulário
  // (whatsappConfirmacao também nasce com o valor atual, espelhando o que já
  // está salvo — o cliente só precisa reeditar se quiser trocar o número).
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, whatsapp, cep, endereco, bairro, cidade, estado, nascimento, instagram")
        .eq("id", clienteId)
        .single();

      if (!ativo) return;

      if (error || !data) {
        setErro("Não foi possível carregar seus dados.");
      } else {
        setForm({
          nome: data.nome ?? "",
          whatsapp: data.whatsapp ?? "",
          whatsappConfirmacao: data.whatsapp ?? "",
          cep: data.cep ?? "",
          endereco: data.endereco ?? "",
          bairro: data.bairro ?? "",
          cidade: data.cidade ?? "",
          estado: data.estado ?? "",
          nascimento: data.nascimento ?? "",
          instagram: data.instagram ?? "",
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

  // Ao CEP atingir 8 dígitos, busca o ViaCEP e preenche os campos de
  // endereço — sem sobrescrever o que o cliente já tiver digitado à mão.
  useEffect(() => {
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

    if (!form.nome.trim()) {
      setErro("Informe seu nome.");
      return;
    }

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

    const numeroConfirmado = mostrarReconfirmacao
      ? whatsappReconfirmacao
      : form.whatsappConfirmacao;

    setEnviando(true);

    const { data, error } = await supabase
      .from("clientes")
      .update({
        nome: form.nome.trim(),
        whatsapp: numeroConfirmado.replace(/\D/g, ""),
        cep: form.cep || null,
        endereco: form.endereco || null,
        bairro: form.bairro || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        nascimento: form.nascimento || null,
        instagram: form.instagram || null,
      })
      .eq("id", clienteId)
      .select()
      .single();

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    onAtualizado({
      id: data.id,
      nome: data.nome,
      telefone: numeroConfirmado,
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

      <div>
        <label htmlFor="atu-nascimento" className="mb-1 block text-sm font-medium text-body">
          Nascimento
        </label>
        <input
          id="atu-nascimento"
          name="nascimento"
          type="date"
          value={form.nascimento}
          onChange={handleChange}
          required
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </div>

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

      {mostrarReconfirmacao && (
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
