"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { enderecoCompleto, whatsappConfere } from "@/lib/clienteValidacao";
import { normalizarWhatsapp, validarWhatsapp } from "@/lib/whatsappValidacao";
import { useConflitoWhatsapp } from "@/lib/checagemWhatsapp";
import ModalConflitoWhatsapp from "@/components/ModalConflitoWhatsapp";
import {
  aplicarMascaraNascimento,
  paraExibicaoNascimento,
  validarNascimento,
} from "@/lib/nascimentoValidacao";
import { lerFatia, salvarFatia, limparFatia } from "@/lib/persistenciaAgendamento";

// Completa o cadastro de endereço de um cliente já identificado (tenant com
// `cadastro_completo = true`), exibido pelo IdentificacaoCliente quando o
// bloco CEP/número/bairro/cidade está pendente — seja um cadastro novo
// (nunca gravado ainda), um "não sou eu" sobre um número de outra pessoa, ou
// um cliente antigo com endereço incompleto.
//
// NENHUMA linha é gravada em `clientes` antes deste formulário ser
// confirmado — o IdentificacaoCliente só lê. No submit, faz UPSERT por
// (estabelecimento_id, whatsapp): existindo já uma linha pra esse telefone
// (a própria cliente voltando, ou "não sou eu" sobre o número de outra
// pessoa), sobrescreve TODOS os campos do cadastro (inclusive zerando
// endereço/contato_emergencia quando o bloco correspondente não está sendo
// coletado agora — exigirEndereco true zera contato_emergencia, false zera o
// bloco de endereço — pra não deixar resíduo do dono anterior do número).
// Não existindo, insere. `clienteId` (id da linha encontrada antes, se
// houver) só serve aqui pra excluir essa linha da checagem de conflito de
// WhatsApp abaixo — não é mais usado como alvo do UPDATE.
//
// O WhatsApp já foi coletado na etapa anterior e vem em `telefoneReferencia`
// só como valor INICIAL do campo — ele agora é editável aqui (a cliente pode
// corrigir um número digitado errado antes de confirmar). "Confirme seu
// WhatsApp" continua existindo, mas passa a validar contra o campo editável
// (whatsappConfere), não mais contra `telefoneReferencia` bruto. Antes de
// gravar, roda a checagem de número já cadastrado (ver
// lib/checagemWhatsapp.js) — se achar outro cliente com esse WhatsApp, abre
// o modal em vez de salvar.
//
// CEP: ao completar 8 dígitos, busca o ViaCEP e preenche
// endereço/bairro/cidade/estado. Falha de rede ou CEP inexistente não trava
// o formulário — os campos seguem editáveis manualmente.
//
// Props:
//   slug                   – slug do salão (rota /[salon]), chave da
//                            persistência em sessionStorage (ver
//                            lib/persistenciaAgendamento) — o `form` inteiro
//                            é salvo como rascunho a cada mudança e restaurado
//                            direto num reload real da página, namespaced por
//                            `clienteId` (um rascunho de OUTRO cliente é
//                            ignorado). Limpo ao submeter com sucesso.
//   estabelecimentoId      – dono da linha em `clientes`; também particiona a
//                            checagem de WhatsApp já cadastrado.
//   clienteId              – id da linha encontrada antes deste formulário
//                            abrir, se houver (null/undefined em cadastro
//                            novo). Usado só como "idAtual" excluído da
//                            checagem de conflito de WhatsApp — o upsert do
//                            submit não depende dele.
//   nomeInicial            – nome já existente (pode vir vazio).
//   telefoneReferencia     – WhatsApp digitado na etapa anterior, usado como
//                            valor INICIAL do campo editável (não mais como
//                            referência fixa de confirmação).
//   valoresIniciais        – cep/endereco/numero/complemento/bairro/cidade/
//                            estado/nascimento/instagram já existentes.
//   clienteNovo            – repassado ao onCadastrado (registro recém-criado
//                            x cliente antigo só completando endereço).
//   estabelecimentoWhatsapp, nomeContato – pro modal "fale com a gente" da
//                            checagem de conflito (mesmo padrão ContatoDono).
//   msgFalhaCadastro        – texto personalizado (estabelecimentos.
//                            msg_falha_cadastro) repassado pro mesmo modal.
//   exigirEndereco          – estabelecimentos.exigir_endereco (default
//                            true, preserva o comportamento atual). false
//                            oculta todo o bloco de CEP/endereço/número/
//                            complemento/bairro/cidade/estado (não renderiza,
//                            não valida, não chama ViaCEP) e mostra no lugar
//                            um campo opcional "Contato de emergência
//                            (WhatsApp)", salvo em clientes.contato_emergencia.
//   onCadastrado           – recebe { id, nome, telefone, clienteNovo }
//                            pronto pra virar clienteInicial do
//                            FormularioAgendamento. Também usado (via modal
//                            de conflito) pra pular direto pro agendamento
//                            de OUTRO cliente, se for o caso.
export default function CadastroCliente({
  slug,
  estabelecimentoId,
  clienteId,
  nomeInicial,
  telefoneReferencia,
  valoresIniciais,
  clienteNovo,
  estabelecimentoWhatsapp,
  nomeContato,
  msgFalhaCadastro,
  exigirEndereco = true,
  onCadastrado,
}) {
  const [form, setForm] = useState(() => {
    const rascunho = lerFatia(slug, "cadastroCliente");
    if (rascunho?.clienteId === clienteId && rascunho?.form) return rascunho.form;
    return {
      nome: nomeInicial ?? "",
      whatsapp: telefoneReferencia ?? "",
      cep: valoresIniciais?.cep ?? "",
      endereco: valoresIniciais?.endereco ?? "",
      numero: valoresIniciais?.numero ?? "",
      complemento: valoresIniciais?.complemento ?? "",
      bairro: valoresIniciais?.bairro ?? "",
      cidade: valoresIniciais?.cidade ?? "",
      estado: valoresIniciais?.estado ?? "",
      nascimento: paraExibicaoNascimento(valoresIniciais?.nascimento),
      instagram: valoresIniciais?.instagram ?? "",
      contatoEmergencia: valoresIniciais?.contato_emergencia ?? "",
    };
  });
  const [confirmarWhatsapp, setConfirmarWhatsapp] = useState("");
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const conflitoWhatsapp = useConflitoWhatsapp();
  const [erro, setErro] = useState("");
  const [erroWhatsapp, setErroWhatsapp] = useState("");
  const [erroNascimento, setErroNascimento] = useState("");
  // Erro de FORMATO (validarWhatsapp) do campo "WhatsApp", em tempo real
  // (onBlur) — separado de `erroWhatsapp`, que segue cobrindo só a
  // divergência com "Confirme seu WhatsApp".
  const [erroFormatoWhatsapp, setErroFormatoWhatsapp] = useState("");
  // Erro de FORMATO (validarWhatsapp) do campo opcional "Contato de
  // emergência", em tempo real (onBlur).
  const [erroContatoEmergencia, setErroContatoEmergencia] = useState("");

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((anterior) => ({ ...anterior, [name]: value }));
  }

  // Grava o rascunho do form a cada mudança, pra sobreviver a um reload real
  // da página (ver lib/persistenciaAgendamento). Limpo ao submeter com
  // sucesso (ou ao pular pro cliente do modal de conflito) — ver mais abaixo.
  useEffect(() => {
    if (!slug) return;
    salvarFatia(slug, "cadastroCliente", { clienteId, form });
  }, [slug, clienteId, form]);

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
    setErroWhatsapp("");
    setErroFormatoWhatsapp("");
    setErroNascimento("");
    setErroContatoEmergencia("");

    if (!form.nome.trim()) {
      setErro("Informe seu nome.");
      return;
    }

    if (exigirEndereco && !enderecoCompleto(form)) {
      setErro("Preencha CEP, número, bairro e cidade.");
      return;
    }

    const { erro: erroData, iso: nascimentoIso } = validarNascimento(form.nascimento);
    if (erroData) {
      setErroNascimento(erroData);
      return;
    }
    if (!nascimentoIso) {
      setErroNascimento("Informe sua data de nascimento.");
      return;
    }

    const validacaoWhatsapp = validarWhatsapp(form.whatsapp);
    if (!validacaoWhatsapp.valido) {
      setErroFormatoWhatsapp(validacaoWhatsapp.erro);
      return;
    }

    if (!whatsappConfere(confirmarWhatsapp, form.whatsapp)) {
      setErroWhatsapp("O número digitado não confere com o WhatsApp informado.");
      return;
    }

    if (!exigirEndereco && form.contatoEmergencia.trim()) {
      const validacaoContatoEmergencia = validarWhatsapp(form.contatoEmergencia);
      if (!validacaoContatoEmergencia.valido) {
        setErroContatoEmergencia(validacaoContatoEmergencia.erro);
        return;
      }
    }

    const digitosWhatsapp = normalizarWhatsapp(form.whatsapp);

    setEnviando(true);

    const temConflito = await conflitoWhatsapp.verificar(
      estabelecimentoId,
      digitosWhatsapp,
      clienteId
    );
    if (temConflito) {
      setEnviando(false);
      return;
    }

    // Sempre grava TODOS os campos abaixo (mesmo os toggle-gated, com null
    // quando não coletados agora) — o upsert pode estar sobrescrevendo a
    // linha de outra pessoa ("não sou eu" sobre um número já cadastrado), e
    // um campo simplesmente omitido do payload manteria o valor antigo dela
    // no banco em vez de zerar.
    const { data, error } = await supabase
      .rpc("cliente_cadastro_completo", {
        p_estabelecimento_id: estabelecimentoId,
        p_nome: form.nome.trim(),
        p_whatsapp: digitosWhatsapp,
        p_nascimento: nascimentoIso,
        p_instagram: form.instagram || null,
        p_cep: exigirEndereco ? form.cep : null,
        p_endereco: exigirEndereco ? form.endereco || null : null,
        p_numero: exigirEndereco ? form.numero : null,
        p_complemento: exigirEndereco ? form.complemento || null : null,
        p_bairro: exigirEndereco ? form.bairro : null,
        p_cidade: exigirEndereco ? form.cidade : null,
        p_estado: exigirEndereco ? form.estado || null : null,
        p_contato_emergencia: exigirEndereco
          ? null
          : normalizarWhatsapp(form.contatoEmergencia) || null,
      })
      .single();

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    limparFatia(slug, "cadastroCliente");
    onCadastrado({
      id: data.id,
      nome: data.nome,
      telefone: form.whatsapp,
      clienteNovo: Boolean(clienteNovo),
    });
  }

  return (
    <>
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

      {exigirEndereco ? (
        <>
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
        </>
      ) : (
        <div>
          <label htmlFor="cad-contato-emergencia" className="mb-1 block text-sm font-medium text-body">
            Contato de emergência (WhatsApp) <span className="font-normal text-muted">(opcional)</span>
          </label>
          <input
            id="cad-contato-emergencia"
            name="contatoEmergencia"
            type="tel"
            inputMode="tel"
            value={form.contatoEmergencia}
            onChange={(e) => {
              handleChange(e);
              setErroContatoEmergencia("");
            }}
            onBlur={() => {
              if (!form.contatoEmergencia.trim()) return;
              const validacao = validarWhatsapp(form.contatoEmergencia);
              setErroContatoEmergencia(validacao.valido ? "" : validacao.erro);
            }}
            placeholder="(24) 99999-9999"
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
          {erroContatoEmergencia && (
            <p className="mt-1 text-sm text-red-700">{erroContatoEmergencia}</p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="cad-nascimento" className="mb-1 block text-sm font-medium text-body">
          Nascimento
        </label>
        <input
          id="cad-nascimento"
          name="nascimento"
          type="text"
          inputMode="numeric"
          value={form.nascimento}
          onChange={handleChangeNascimento}
          required
          placeholder="dd/mm/aaaa"
          maxLength={10}
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        {erroNascimento && (
          <p className="mt-1 text-sm text-red-700">{erroNascimento}</p>
        )}
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
          onChange={(e) => {
            handleChange(e);
            setErroFormatoWhatsapp("");
          }}
          onBlur={() => {
            if (!form.whatsapp.trim()) return;
            const validacao = validarWhatsapp(form.whatsapp);
            setErroFormatoWhatsapp(validacao.valido ? "" : validacao.erro);
          }}
          required
          placeholder="(24) 99999-9999"
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        {erroFormatoWhatsapp && (
          <p className="mt-1 text-sm text-red-700">{erroFormatoWhatsapp}</p>
        )}
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

    <ModalConflitoWhatsapp
      clienteConflitante={conflitoWhatsapp.clienteConflitante}
      modalContato={conflitoWhatsapp.modalContato}
      estabelecimentoWhatsapp={estabelecimentoWhatsapp}
      nomeContato={nomeContato}
      msgFalhaCadastro={msgFalhaCadastro}
      onConfirmar={() => {
        limparFatia(slug, "cadastroCliente");
        conflitoWhatsapp.confirmarConflito(onCadastrado, form.whatsapp);
      }}
      onNegar={conflitoWhatsapp.negarConflito}
      onFecharContato={conflitoWhatsapp.fecharModalContato}
    />
    </>
  );
}
