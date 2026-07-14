"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { enderecoCompleto, whatsappConfere } from "@/lib/clienteValidacao";

// Completa o cadastro de endereço de um cliente já identificado (tenant com
// `cadastro_completo = true`), exibido pelo IdentificacaoCliente quando o
// bloco CEP/número/bairro/cidade está pendente — seja um registro mínimo
// recém-criado (nome vazio) ou um cliente antigo com endereço incompleto.
// Faz sempre UPDATE por `clienteId` — quem decide inserir o registro mínimo é
// o IdentificacaoCliente, antes de montar este formulário.
//
// O WhatsApp já foi coletado na etapa anterior: aqui ele só é reexibido como
// texto fixo e reconfirmado num único campo (comparação ignorando
// formatação via whatsappConfere), sem campo de WhatsApp editável.
//
// CEP: ao completar 8 dígitos, busca o ViaCEP e preenche
// endereço/bairro/cidade/estado. Falha de rede ou CEP inexistente não trava
// o formulário — os campos seguem editáveis manualmente.
//
// Props:
//   estabelecimentoId  – dono da linha em `clientes` (não usado no update em
//                        si, mantido por simetria/uso futuro de auditoria).
//   clienteId          – id da linha em `clientes` a ser atualizada.
//   nomeInicial        – nome já existente (pode vir vazio).
//   telefoneReferencia – WhatsApp já digitado na etapa anterior, usado como
//                        referência da reconfirmação.
//   valoresIniciais    – cep/endereco/numero/complemento/bairro/cidade/
//                        estado/nascimento/instagram já existentes.
//   clienteNovo        – repassado ao onCadastrado (registro recém-criado x
//                        cliente antigo só completando endereço).
//   onCadastrado       – recebe { id, nome, telefone, clienteNovo } pronto
//                        pra virar clienteInicial do FormularioAgendamento.
export default function CadastroCliente({
  estabelecimentoId,
  clienteId,
  nomeInicial,
  telefoneReferencia,
  valoresIniciais,
  clienteNovo,
  onCadastrado,
}) {
  const [form, setForm] = useState({
    nome: nomeInicial ?? "",
    cep: valoresIniciais?.cep ?? "",
    endereco: valoresIniciais?.endereco ?? "",
    numero: valoresIniciais?.numero ?? "",
    complemento: valoresIniciais?.complemento ?? "",
    bairro: valoresIniciais?.bairro ?? "",
    cidade: valoresIniciais?.cidade ?? "",
    estado: valoresIniciais?.estado ?? "",
    nascimento: valoresIniciais?.nascimento ?? "",
    instagram: valoresIniciais?.instagram ?? "",
  });
  const [confirmarWhatsapp, setConfirmarWhatsapp] = useState("");
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroWhatsapp, setErroWhatsapp] = useState("");

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
    setErroWhatsapp("");

    if (!form.nome.trim()) {
      setErro("Informe seu nome.");
      return;
    }

    if (!enderecoCompleto(form)) {
      setErro("Preencha CEP, número, bairro e cidade.");
      return;
    }

    if (!whatsappConfere(confirmarWhatsapp, telefoneReferencia)) {
      setErroWhatsapp("O número digitado não confere com o WhatsApp informado.");
      return;
    }

    setEnviando(true);

    const { data, error } = await supabase
      .from("clientes")
      .update({
        nome: form.nome.trim(),
        cep: form.cep,
        endereco: form.endereco || null,
        numero: form.numero,
        complemento: form.complemento || null,
        bairro: form.bairro,
        cidade: form.cidade,
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

    onCadastrado({
      id: data.id,
      nome: data.nome,
      telefone: telefoneReferencia,
      clienteNovo: Boolean(clienteNovo),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-body">
        Complete seu cadastro para continuar.
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
          required
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
          placeholder="Rua"
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cad-numero" className="mb-1 block text-sm font-medium text-body">
            Número
          </label>
          <input
            id="cad-numero"
            name="numero"
            type="text"
            value={form.numero}
            onChange={handleChange}
            required
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>

        <div>
          <label htmlFor="cad-complemento" className="mb-1 block text-sm font-medium text-body">
            Complemento <span className="font-normal text-muted">(opcional)</span>
          </label>
          <input
            id="cad-complemento"
            name="complemento"
            type="text"
            value={form.complemento}
            onChange={handleChange}
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>
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
            required
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
            required
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
          required
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-body">WhatsApp</span>
        <p className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-heading">
          {telefoneReferencia}
        </p>
      </div>

      <div>
        <label htmlFor="cad-whatsapp-confirmacao" className="mb-1 block text-sm font-medium text-body">
          Confirme seu WhatsApp
        </label>
        <input
          id="cad-whatsapp-confirmacao"
          name="confirmarWhatsapp"
          type="tel"
          inputMode="tel"
          value={confirmarWhatsapp}
          onChange={(e) => setConfirmarWhatsapp(e.target.value)}
          required
          placeholder="(24) 99999-9999"
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        {erroWhatsapp && (
          <p className="mt-1 text-sm text-red-700">{erroWhatsapp}</p>
        )}
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
