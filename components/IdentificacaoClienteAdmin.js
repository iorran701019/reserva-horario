"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { normalizarWhatsapp, validarWhatsapp } from "@/lib/whatsappValidacao";
import { buscarPendentesPorTelefones } from "@/lib/agendamentosCliente";
import ModalClientePendente from "@/components/ModalClientePendente";

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
//   onIrParaPendentes – recebe o telefone (dígitos) da cliente escolhida no
//                       modal de pendência; quem monta troca pra aba
//                       Pendentes e destaca o item (ver page.js).
export default function IdentificacaoClienteAdmin({
  estabelecimentoId,
  onIdentificado,
  onIrParaPendentes,
}) {
  const [nome, setNome] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);

  // Telefones (dígitos) dos `resultados` que têm agendamento pendente ativo —
  // Set devolvido por buscarPendentesPorTelefones, alimentado pela MESMA busca
  // do dropdown (ver useEffect). Serve pro selo "pendente" ao lado do nome e
  // pro gate de selecionarCliente. Vazio enquanto a segunda query não volta:
  // o dropdown nunca espera por ela, então o selo aparece um instante depois
  // dos nomes.
  const [pendentesPorTelefone, setPendentesPorTelefone] = useState(new Set());

  // Cliente clicado no dropdown que TEM pendência, segurando o modal de aviso
  // antes de seguir pro wizard — { id, nome, telefone } enquanto aberto, null
  // = sem modal. Não bloqueia nada: "Agendar mesmo assim" chama o
  // onIdentificado que o clique chamaria direto (ver selecionarCliente).
  const [clientePendente, setClientePendente] = useState(null);

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
      setPendentesPorTelefone(new Set());
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
      const encontrados = error ? [] : data ?? [];
      setResultados(encontrados);
      // Zera junto com a lista: sem isso o Set da busca ANTERIOR sobreviveria
      // até a nova checagem voltar, e um telefone repetido entre as duas
      // buscas apareceria com selo antes de ter sido conferido de novo.
      setPendentesPorTelefone(new Set());
      setBuscando(false);

      // Segunda query, com os telefones que a primeira trouxe — encadeada de
      // propósito (precisa dos whatsapps) e DEPOIS do setBuscando(false), pra
      // não segurar o dropdown esperando o selo. Mesmo guard `ativo`: se a
      // dona continuou digitando, o resultado desta busca é descartado.
      const comPendencia = await buscarPendentesPorTelefones(
        estabelecimentoId,
        encontrados.map((cliente) => cliente.whatsapp)
      );

      if (!ativo) return;
      setPendentesPorTelefone(comPendencia);
    }, 300);

    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [nome, estabelecimentoId]);

  // Clique num nome do dropdown. Sem pendência (o caso comum) segue direto
  // pro wizard como sempre; COM pendência abre o modal de aviso e adia o
  // onIdentificado pro "Agendar mesmo assim" — o gate está aqui, e não no
  // wizard, porque é aqui que a dona ainda pode escolher ir tratar o pendente
  // sem ter começado nada.
  function selecionarCliente(cliente) {
    const escolhido = {
      id: cliente.id,
      nome: cliente.nome,
      telefone: cliente.whatsapp ?? "",
    };

    if (escolhido.telefone && pendentesPorTelefone.has(escolhido.telefone)) {
      setClientePendente(escolhido);
      return;
    }

    onIdentificado(escolhido);
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
    <>
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
              {resultados.map((cliente) => {
                // Selo âmbar de "já tem pendente" — mesmas cores do status
                // pendente no /admin (ver classesStatus em page.js), pra ser a
                // mesma linguagem visual do card que espera lá. Só aparece
                // depois da segunda query voltar (ver useEffect).
                const temPendente =
                  !!cliente.whatsapp && pendentesPorTelefone.has(cliente.whatsapp);

                return (
                  <button
                    key={cliente.id}
                    type="button"
                    onClick={() => selecionarCliente(cliente)}
                    className="flex w-full items-center justify-between gap-2 bg-card px-3 py-2 text-left text-sm text-heading transition hover:bg-surface"
                  >
                    <span className="min-w-0 truncate">{cliente.nome}</span>
                    {temPendente && (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                        pendente
                      </span>
                    )}
                  </button>
                );
              })}
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

      {/* Fora do card (irmão, não filho): o overlay é `fixed inset-0` e o
          `space-y-4` do card dava margin-top nele, deslocando o fundo. */}
      <ModalClientePendente
        cliente={clientePendente}
        onIrParaPendentes={() => {
          onIrParaPendentes?.(clientePendente.telefone);
          setClientePendente(null);
        }}
        onAgendarMesmoAssim={() => {
          const escolhido = clientePendente;
          setClientePendente(null);
          onIdentificado(escolhido);
        }}
        onCancelar={() => setClientePendente(null)}
      />
    </>
  );
}
