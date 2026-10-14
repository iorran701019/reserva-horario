"use client";

// Popup "É o mesmo cliente?" aberto pelo botão "Resolver" da caixa de possível
// cadastro duplicado do /admin. Duas fases: comparação dos cadastros e, se a
// dona disser que é a mesma pessoa, uma tela de confirmação — nunca une direto.
// A confirmação é PROTEÇÃO fixa (protocolo §13), sem interruptor.
//
// O cadastro com o número escolhido é o MANTIDO; o outro é o absorvido (vai
// para a lixeira e os dados passam para o mantido). A união em si é a RPC
// clientes_unir; "manter os dois" é clientes_manter_dois.
//
// Props:
//   estabelecimentoId – salão.
//   idA, idB          – ids dos dois cadastros.
//   fidelidadeAtiva   – estabelecimentos.fidelidade_ativa (linhas de resgate e
//                       pendência de fidelidade só aparecem se ativa ou > 0).
//   anamneseAtiva     – existe modelo de anamnese ativo (idem para fichas).
//   onConcluido       – () => void, chamado DEPOIS de juntar ou manter os dois
//                       (quem monta recarrega as listas e fecha).
//   onFechar          – fecha sem fazer nada (também o clique no fundo).
//   onWhatsapp        – (nome, telefone) abre a conversa com aquele cadastro
//                       (pílula do número nos cartões da comparação).
import { useEffect, useState } from "react";
import {
  buscarResumoCadastrosDuplicidade,
  contarDadosDoAbsorvido,
  manterDoisClientes,
  mensagemErroResolverDuplicidade,
  unirClientes,
} from "@/lib/clientesAdmin";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import { formatarDataBR } from "@/lib/data";
import { formatarWhatsappExibicao } from "@/lib/whatsapp";

// Limite da função clientes_unir (atendimentos movidos de uma vez).
const LIMITE_ATENDIMENTOS = 60;

function dataDoTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

function telefoneExibicao(c) {
  return formatarWhatsappExibicao(c.whatsapp) ?? c.whatsapp;
}

function pluralizar(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}

function CartaoCadastro({ cadastro, rotulo, onWhatsapp }) {
  return (
    <div className="rounded-lg bg-surface p-3 text-sm ring-1 ring-border">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{rotulo}</p>
      <p className="mt-1 break-words font-medium text-heading">{cadastro.nome}</p>
      <button
        type="button"
        onClick={() => onWhatsapp(cadastro.nome, cadastro.whatsapp)}
        disabled={!cadastro.whatsapp}
        className="mt-0.5 inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-green-50"
      >
        <IconeWhatsApp className="h-3.5 w-3.5" />
        {telefoneExibicao(cadastro)}
      </button>
      <p className="mt-1 text-xs text-muted">
        Cadastrado em {dataDoTimestamp(cadastro.criado_em) || "—"}
      </p>
      <p className="text-xs text-muted">
        {pluralizar(cadastro.atendimentos, "atendimento", "atendimentos")}
        {cadastro.ultimoAtendimento
          ? `, o último em ${formatarDataBR(cadastro.ultimoAtendimento)}`
          : ""}
      </p>
      {cadastro.etiquetas_cliente?.nome && (
        <p className="text-xs text-muted">Etiqueta: {cadastro.etiquetas_cliente.nome}</p>
      )}
      {cadastro.nascimento && (
        <p className="text-xs text-muted">
          Nascimento: {formatarDataBR(cadastro.nascimento)}
        </p>
      )}
      {cadastro.instagram && (
        <p className="break-words text-xs text-muted">Instagram: {cadastro.instagram}</p>
      )}
    </div>
  );
}

export default function ModalResolverDuplicidade({
  estabelecimentoId,
  fidelidadeAtiva,
  anamneseAtiva,
  idA,
  idB,
  onConcluido,
  onFechar,
  onWhatsapp,
}) {
  const [cadastros, setCadastros] = useState(null); // null = carregando
  const [fase, setFase] = useState("comparar"); // "comparar" | "confirmar"
  const [mantidoId, setMantidoId] = useState(null);
  const [contagens, setContagens] = useState(null); // null = carregando
  const [etiquetaEscolhidaId, setEtiquetaEscolhidaId] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    buscarResumoCadastrosDuplicidade(estabelecimentoId, [idA, idB]).then((lista) => {
      if (!ativo) return;
      // Se um dos dois não voltou (já na lixeira, ou outro salão), não há o que
      // comparar: a lista vazia cai na mensagem de "não encontrados".
      setCadastros(lista.length === 2 ? lista : []);
    });
    return () => {
      ativo = false;
    };
  }, [estabelecimentoId, idA, idB]);

  const ordenados = cadastros
    ? [...cadastros].sort((x, y) => String(x.criado_em).localeCompare(String(y.criado_em)))
    : [];
  const mantido = cadastros?.find((c) => c.id === mantidoId) ?? null;
  const absorvido = mantido ? cadastros.find((c) => c.id !== mantidoId) : null;

  const etiquetaMantido = mantido?.etiquetas_cliente ?? null;
  const etiquetaAbsorvido = absorvido?.etiquetas_cliente ?? null;
  const etiquetaConflito =
    !!etiquetaMantido && !!etiquetaAbsorvido && etiquetaMantido.id !== etiquetaAbsorvido.id;

  const contagemIncompleta =
    !contagens || Object.values(contagens).some((valor) => valor === null);
  const atendimentosDemais = (contagens?.atendimentos ?? 0) > LIMITE_ATENDIMENTOS;
  const aguardandoEtiqueta = etiquetaConflito && etiquetaEscolhidaId == null;
  const bloqueado =
    enviando || contagemIncompleta || atendimentosDemais || aguardandoEtiqueta;

  // Atendimentos sempre; as demais linhas só se a função está ativa no salão
  // ou há algo a mover (anotações contam como sempre ativas).
  const linhasMovidas = contagens
    ? [
        {
          chave: "atendimentos",
          texto: pluralizar(contagens.atendimentos ?? 0, "atendimento", "atendimentos"),
          mostrar: true,
        },
        {
          chave: "anamneses",
          texto: pluralizar(contagens.anamneses ?? 0, "ficha de anamnese", "fichas de anamnese"),
          mostrar: anamneseAtiva || (contagens.anamneses ?? 0) > 0,
        },
        {
          chave: "anotacoes",
          texto: pluralizar(contagens.anotacoes ?? 0, "anotação", "anotações"),
          mostrar: true,
        },
        {
          chave: "resgates",
          texto: pluralizar(
            contagens.resgates ?? 0,
            "resgate de fidelidade",
            "resgates de fidelidade"
          ),
          mostrar: fidelidadeAtiva || (contagens.resgates ?? 0) > 0,
        },
        {
          chave: "pendencias",
          texto: pluralizar(
            contagens.pendencias ?? 0,
            "pendência de fidelidade",
            "pendências de fidelidade"
          ),
          mostrar: fidelidadeAtiva || (contagens.pendencias ?? 0) > 0,
        },
      ].filter((linha) => linha.mostrar)
    : [];

  function escolherMantido(id) {
    setErro("");
    setMantidoId(id);
    setContagens(null);
    setEtiquetaEscolhidaId(null);
    setFase("confirmar");
    const outro = cadastros.find((c) => c.id !== id);
    contarDadosDoAbsorvido(estabelecimentoId, outro).then((resultado) => {
      setContagens(resultado);
    });
  }

  async function manterDois() {
    if (enviando) return;
    setEnviando(true);
    setErro("");
    const { error } = await manterDoisClientes(idA, idB);
    setEnviando(false);
    if (error) {
      setErro(mensagemErroResolverDuplicidade(error));
      return;
    }
    onConcluido();
  }

  async function juntar() {
    if (bloqueado || !mantido || !absorvido) return;
    setEnviando(true);
    setErro("");
    const { error } = await unirClientes({
      mantidoId: mantido.id,
      absorvidoId: absorvido.id,
      etiquetaId: etiquetaConflito ? etiquetaEscolhidaId : null,
    });
    setEnviando(false);
    if (error) {
      setErro(mensagemErroResolverDuplicidade(error));
      return;
    }
    onConcluido();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-resolver-duplicidade"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 px-4"
      onClick={enviando ? undefined : onFechar}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        {cadastros === null && <p className="text-sm text-muted">Carregando…</p>}

        {cadastros !== null && cadastros.length === 0 && (
          <>
            <h2
              id="titulo-resolver-duplicidade"
              className="text-lg font-semibold text-heading"
            >
              Cadastros não encontrados
            </h2>
            <p className="mt-2 text-sm text-body">
              Um dos cadastros não está mais disponível. Feche e atualize a tela.
            </p>
            <button
              type="button"
              onClick={onFechar}
              className="mt-6 w-full rounded-lg px-4 py-2 text-sm font-medium text-body transition hover:bg-surface"
            >
              Fechar
            </button>
          </>
        )}

        {cadastros?.length === 2 && fase === "comparar" && (
          <>
            <h2
              id="titulo-resolver-duplicidade"
              className="text-lg font-semibold text-heading"
            >
              É o mesmo cliente?
            </h2>
            <p className="mt-2 text-sm text-body">
              Recomendamos entrar em contato com o cliente antes da alteração.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <CartaoCadastro
                cadastro={ordenados[0]}
                rotulo="Cadastro mais antigo"
                onWhatsapp={onWhatsapp}
              />
              <CartaoCadastro
                cadastro={ordenados[1]}
                rotulo="Cadastro mais novo"
                onWhatsapp={onWhatsapp}
              />
            </div>

            <div className="mt-5 flex flex-col gap-2">
              {ordenados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => escolherMantido(c.id)}
                  disabled={enviando}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  Sim, número correto: {telefoneExibicao(c)}
                </button>
              ))}
              <button
                type="button"
                onClick={manterDois}
                disabled={enviando}
                className="rounded-lg bg-card px-4 py-2 text-sm font-medium text-on-card ring-1 ring-border transition hover:bg-surface disabled:opacity-50"
              >
                {enviando ? "Salvando…" : "Não, manter os dois cadastros"}
              </button>
            </div>

            {erro && <p className="mt-3 text-sm text-red-700">{erro}</p>}

            <button
              type="button"
              onClick={onFechar}
              disabled={enviando}
              className="mt-4 w-full rounded-lg px-4 py-2 text-sm font-medium text-body transition hover:bg-surface"
            >
              Fechar
            </button>
          </>
        )}

        {cadastros?.length === 2 && fase === "confirmar" && mantido && absorvido && (
          <>
            <h2
              id="titulo-resolver-duplicidade"
              className="text-lg font-semibold text-heading"
            >
              Juntar cadastros
            </h2>
            <p className="mt-3 text-sm text-body">
              Fica: <span className="font-medium text-heading">{mantido.nome}</span> (
              {telefoneExibicao(mantido)}).
            </p>
            <p className="mt-1 text-sm text-body">
              Vai para a lixeira:{" "}
              <span className="font-medium text-heading">{absorvido.nome}</span> (
              {telefoneExibicao(absorvido)}).
            </p>

            <div className="mt-4 rounded-lg bg-surface p-3 text-sm ring-1 ring-border">
              <p className="font-medium text-heading">
                O que passa para o cadastro que fica:
              </p>
              {contagens === null ? (
                <p className="mt-1 text-muted">Contando…</p>
              ) : (
                <ul className="mt-1 list-disc pl-5 text-body">
                  {linhasMovidas.map((linha) => (
                    <li key={linha.chave}>{linha.texto}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted">
                O nome nos atendimentos passa a ser o de {mantido.nome}.
              </p>
            </div>

            {contagens && contagemIncompleta && (
              <p className="mt-3 text-sm text-red-700">
                Não foi possível conferir tudo que será movido. Volte e tente de novo.
              </p>
            )}

            {atendimentosDemais && (
              <p className="mt-3 text-sm text-red-700">
                O cadastro que vai para a lixeira tem mais de {LIMITE_ATENDIMENTOS}{" "}
                atendimentos, e só dá para juntar até {LIMITE_ATENDIMENTOS} de uma vez.
              </p>
            )}

            {etiquetaConflito && (
              <div className="mt-4">
                <p className="text-sm font-medium text-heading">
                  Os dois têm etiquetas diferentes. Qual manter?
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  {[etiquetaMantido, etiquetaAbsorvido].map((etiqueta) => (
                    <label
                      key={etiqueta.id}
                      className="flex items-center gap-2 text-sm text-body"
                    >
                      <input
                        type="radio"
                        name="etiqueta-mantida"
                        checked={etiquetaEscolhidaId === etiqueta.id}
                        onChange={() => setEtiquetaEscolhidaId(etiqueta.id)}
                      />
                      {etiqueta.nome}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!etiquetaConflito && etiquetaAbsorvido && !etiquetaMantido && (
              <p className="mt-3 text-sm text-body">
                O cadastro que fica não tem etiqueta e vai receber a etiqueta “
                {etiquetaAbsorvido.nome}”.
              </p>
            )}

            <p className="mt-4 text-xs text-muted">Você poderá desfazer depois.</p>

            {erro && <p className="mt-3 text-sm text-red-700">{erro}</p>}

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={juntar}
                disabled={bloqueado}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {enviando ? "Juntando…" : "Juntar cadastros"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setErro("");
                  setFase("comparar");
                }}
                disabled={enviando}
                className="rounded-lg px-4 py-2 text-sm font-medium text-body transition hover:bg-surface disabled:opacity-50"
              >
                Voltar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
