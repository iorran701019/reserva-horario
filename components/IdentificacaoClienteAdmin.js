"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { normalizarWhatsapp, validarWhatsapp } from "@/lib/whatsappValidacao";

// Pré-passo do admin (aba Agendar) antes de montar o FormularioAgendamento —
// identifica o cliente por NOME (diferente do público, que identifica por
// WhatsApp em IdentificacaoCliente.js: a dona normalmente já sabe o nome de
// quem está atendendo, não o telefone de cor). Busca ao vivo em `clientes`
// (debounce ~300ms, ilike no nome) — mesma lógica que antes vivia dentro da
// etapa "dados" do FormularioAgendamento, movida pra cá pra rodar ANTES do
// wizard existir, isolada do campo WhatsApp dele (era a causa do bug do card
// de sugestão cobrindo aquele campo — o dropdown e o WhatsApp do wizard
// nunca mais coexistem na mesma tela).
//
// Encontrado no dropdown -> segue direto pro wizard via onIdentificado, sem
// passo extra de confirmação. Não encontrado -> a busca por nome sozinha não
// basta pra cadastrar, então exige WhatsApp e faz UPSERT em `clientes` por
// (estabelecimento_id, whatsapp) — mesmo padrão de CadastroCliente.js — antes
// de seguir.
//
// Props:
//   estabelecimentoId – particiona a busca e o upsert.
//   onIdentificado    – recebe { id, nome, telefone }, pronto pra virar
//                       clienteInicial do FormularioAgendamento.
export default function IdentificacaoClienteAdmin({ estabelecimentoId, onIdentificado }) {
  const [nome, setNome] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);

  const [whatsapp, setWhatsapp] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  // Erro de FORMATO (validarWhatsapp) do campo "WhatsApp", em tempo real
  // (onBlur) — separado de `erro`, que segue cobrindo nome/busca/upsert.
  const [erroFormatoWhatsapp, setErroFormatoWhatsapp] = useState("");
  // Cliente já cadastrado sob esse WhatsApp com um nome DIFERENTE do
  // digitado (ver cadastrarNovo) — { id, nome } enquanto pede confirmação
  // explícita antes de sobrescrever; null = sem conflito pendente. Qualquer
  // edição de nome/whatsapp depois de detectado invalida o aviso (ver
  // handlers dos inputs), pra nunca confirmar substituição contra um valor
  // que não é mais o digitado.
  const [conflito, setConflito] = useState(null);

  // Debounce ~300ms, mesmo padrão que já existia dentro do wizard (e ainda
  // existe em ModalVincularCliente.js, pro caso de vínculo de importado do
  // Calendar — não é o MESMO componente, contexto diferente). Exige 2+
  // caracteres, senão zera a lista.
  useEffect(() => {
    const termo = nome.trim();
    if (termo.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }

    let ativo = true;
    setBuscando(true);

    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, whatsapp")
        .eq("estabelecimento_id", estabelecimentoId)
        .ilike("nome", `%${termo}%`)
        .order("nome", { ascending: true })
        .limit(8);

      if (!ativo) return;
      setResultados(error ? [] : data ?? []);
      setBuscando(false);
    }, 300);

    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [nome, estabelecimentoId]);

  function selecionarCliente(cliente) {
    onIdentificado({ id: cliente.id, nome: cliente.nome, telefone: cliente.whatsapp ?? "" });
  }

  // Upsert de fato — só chamado depois de já ter decidido que não há
  // conflito (mesmo nome, ou nenhum cliente com esse WhatsApp) ou que a
  // dona confirmou a substituição explicitamente (ver confirmarSubstituicao).
  async function upsertar(nomeLimpo, digitos) {
    setEnviando(true);

    const { data, error } = await supabase
      .from("clientes")
      .upsert(
        { estabelecimento_id: estabelecimentoId, nome: nomeLimpo, whatsapp: digitos },
        { onConflict: "estabelecimento_id,whatsapp" }
      )
      .select()
      .single();

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    onIdentificado({ id: data.id, nome: data.nome, telefone: whatsapp });
  }

  async function cadastrarNovo(e) {
    e.preventDefault();
    setErro("");
    setErroFormatoWhatsapp("");

    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErro("Informe o nome do cliente.");
      return;
    }

    const digitos = normalizarWhatsapp(whatsapp);
    if (digitos.length < 10) {
      setErro("Informe um WhatsApp válido com DDD.");
      return;
    }

    const validacaoWhatsapp = validarWhatsapp(whatsapp);
    if (!validacaoWhatsapp.valido) {
      setErroFormatoWhatsapp(validacaoWhatsapp.erro);
      return;
    }

    // Checa ANTES de gravar se esse WhatsApp já pertence a outro cadastro —
    // o upsert por (estabelecimento_id, whatsapp) é uma substituição
    // silenciosa (sobrescreve o nome existente), então uma divergência aqui
    // pode ser a dona confirmando um número errado ou mesclando duas
    // pessoas sem querer. Mesmo nome (ou nada encontrado) -> segue direto,
    // sem interromper o fluxo comum de cliente realmente novo.
    setEnviando(true);
    const { data: existente, error: erroSelect } = await supabase
      .from("clientes")
      .select("id, nome")
      .eq("estabelecimento_id", estabelecimentoId)
      .eq("whatsapp", digitos)
      .maybeSingle();
    setEnviando(false);

    if (erroSelect) {
      setErro(erroSelect.message);
      return;
    }

    if (existente && existente.nome.trim().toLowerCase() !== nomeLimpo.toLowerCase()) {
      setConflito(existente);
      return;
    }

    await upsertar(nomeLimpo, digitos);
  }

  function cancelarSubstituicao() {
    setConflito(null);
  }

  async function confirmarSubstituicao() {
    const nomeLimpo = nome.trim();
    const digitos = normalizarWhatsapp(whatsapp);
    setConflito(null);
    await upsertar(nomeLimpo, digitos);
  }

  const termo = nome.trim();
  const mostrarNaoEncontrado = termo.length >= 2 && !buscando && resultados.length === 0;

  return (
    <div className="space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border">
      <div>
        <label htmlFor="admin-busca-nome" className="mb-1 block text-sm font-medium text-body">
          Nome do cliente
        </label>
        <input
          id="admin-busca-nome"
          type="text"
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            setConflito(null);
          }}
          autoComplete="off"
          placeholder="Buscar cliente pelo nome"
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />

        {/* Renderizado no fluxo normal (não absolute) — não há campo abaixo
            pra cobrir: o WhatsApp só aparece depois, no bloco "não
            encontrado", e é mutuamente exclusivo com este dropdown. */}
        {termo.length >= 2 && buscando && (
          <p className="mt-1 rounded-lg bg-surface px-3 py-2 text-sm text-body">Buscando...</p>
        )}

        {termo.length >= 2 && !buscando && resultados.length > 0 && (
          <div className="mt-1 overflow-hidden rounded-lg ring-1 ring-border">
            {resultados.map((cliente) => (
              <button
                key={cliente.id}
                type="button"
                onClick={() => selecionarCliente(cliente)}
                className="block w-full bg-card px-3 py-2 text-left text-sm text-heading transition hover:bg-surface"
              >
                {cliente.nome}
              </button>
            ))}
          </div>
        )}
      </div>

      {mostrarNaoEncontrado && (
        <form onSubmit={cadastrarNovo} className="space-y-4">
          <p className="text-sm text-body">
            Nenhum cliente encontrado com esse nome. Informe o WhatsApp para cadastrar.
          </p>

          <div>
            <label htmlFor="admin-busca-whatsapp" className="mb-1 block text-sm font-medium text-body">
              WhatsApp
            </label>
            <input
              id="admin-busca-whatsapp"
              type="tel"
              inputMode="tel"
              value={whatsapp}
              onChange={(e) => {
                setWhatsapp(e.target.value);
                setConflito(null);
                setErroFormatoWhatsapp("");
              }}
              onBlur={() => {
                if (!whatsapp.trim()) return;
                const validacao = validarWhatsapp(whatsapp);
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

          {conflito ? (
            <div className="space-y-3 rounded-lg bg-red-50 p-3 ring-1 ring-red-200">
              <p className="text-sm font-medium text-red-700">
                Esse WhatsApp já está cadastrado para{" "}
                <strong>{conflito.nome}</strong>. Continuar vai substituir esse
                cadastro pelo nome digitado agora — essa ação não pode ser
                desfeita.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelarSubstituicao}
                  className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarSubstituicao}
                  disabled={enviando}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {enviando ? "Substituindo..." : "Confirmar substituição"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="submit"
              disabled={enviando}
              className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? "Cadastrando..." : "Cadastrar e continuar"}
            </button>
          )}

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
