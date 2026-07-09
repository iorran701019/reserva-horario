"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Cadastro completo do cliente, exibido pelo IdentificacaoCliente quando o
// WhatsApp digitado não é encontrado em `clientes` (substitui o trecho
// provisório da fase anterior, que só colhia o nome). Ao enviar, faz o
// insert e entrega o registro criado como `clienteInicial` do
// FormularioAgendamento — mesma prop já usada quando o cliente É encontrado.
//
// CEP: ao completar 8 dígitos, busca o ViaCEP e preenche
// endereço/bairro/cidade/estado. Falha de rede ou CEP inexistente não trava
// o formulário — os campos seguem editáveis manualmente.
//
// Props:
//   estabelecimentoId – dono da linha inserida em `clientes`.
//   telefoneInicial   – WhatsApp já digitado na etapa anterior (editável aqui).
//   onCadastrado      – recebe { id, nome, telefone } pronto pra virar
//                       clienteInicial do FormularioAgendamento.
export default function CadastroCliente({
  estabelecimentoId,
  telefoneInicial,
  onCadastrado,
}) {
  const [form, setForm] = useState({
    nome: "",
    whatsapp: telefoneInicial ?? "",
    cep: "",
    endereco: "",
    bairro: "",
    cidade: "",
    estado: "",
    nascimento: "",
    instagram: "",
  });
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

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

    setEnviando(true);

    const { data, error } = await supabase
      .from("clientes")
      .insert({
        estabelecimento_id: estabelecimentoId,
        nome: form.nome.trim(),
        whatsapp: digitosWhatsapp,
        cep: form.cep || null,
        endereco: form.endereco || null,
        bairro: form.bairro || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        nascimento: form.nascimento || null,
        instagram: form.instagram || null,
      })
      .select()
      .single();

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    onCadastrado({
      id: data.id,
      nome: data.nome,
      telefone: form.whatsapp,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-body">
        Não encontramos esse número. Complete seu cadastro para continuar.
      </p>

      <div>
        <label htmlFor="cad-nome" className="mb-1 block text-sm font-medium text-body">
          Nome
        </label>
        <input
          id="cad-nome"
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
        <label htmlFor="cad-whatsapp" className="mb-1 block text-sm font-medium text-body">
          WhatsApp
        </label>
        <input
          id="cad-whatsapp"
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
        <label htmlFor="cad-cep" className="mb-1 block text-sm font-medium text-body">
          CEP
        </label>
        <input
          id="cad-cep"
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
        <label htmlFor="cad-endereco" className="mb-1 block text-sm font-medium text-body">
          Endereço
        </label>
        <input
          id="cad-endereco"
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
          <label htmlFor="cad-bairro" className="mb-1 block text-sm font-medium text-body">
            Bairro
          </label>
          <input
            id="cad-bairro"
            name="bairro"
            type="text"
            value={form.bairro}
            onChange={handleChange}
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>

        <div>
          <label htmlFor="cad-cidade" className="mb-1 block text-sm font-medium text-body">
            Cidade
          </label>
          <input
            id="cad-cidade"
            name="cidade"
            type="text"
            value={form.cidade}
            onChange={handleChange}
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>
      </div>

      <div>
        <label htmlFor="cad-estado" className="mb-1 block text-sm font-medium text-body">
          Estado
        </label>
        <input
          id="cad-estado"
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
        <label htmlFor="cad-nascimento" className="mb-1 block text-sm font-medium text-body">
          Nascimento
        </label>
        <input
          id="cad-nascimento"
          name="nascimento"
          type="date"
          value={form.nascimento}
          onChange={handleChange}
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </div>

      <div>
        <label htmlFor="cad-instagram" className="mb-1 block text-sm font-medium text-body">
          Instagram <span className="font-normal text-muted">(opcional)</span>
        </label>
        <input
          id="cad-instagram"
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
        {enviando ? "Enviando..." : "Continuar"}
      </button>

      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}
    </form>
  );
}
