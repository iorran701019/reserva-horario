"use client";

// Uniões ATIVAS ("Cadastros juntados", tabela clientes_uniao) de um cliente,
// com o botão Desfazer. Usada na seção "Cadastros duplicados" da ficha do
// cliente (CadastrosDuplicadosFicha). Uniões já desfeitas não aparecem, e sem
// união ativa a lista não renderiza nada. A confirmação do Desfazer é PROTEÇÃO
// fixa (protocolo §13), sem interruptor.
//
// A tela nunca mostra o novo estado antes de a RPC voltar: a lista é relida
// do banco depois do sucesso ou de um erro de "mudou".
//
// Props:
//   estabelecimentoId – salão.
//   mantidoId         – cliente que ficou (recorta as uniões da ficha).
//   onDesfeita        – () => void, chamado DEPOIS de a RPC ter sucesso (quem
//                       monta recarrega clientes/agendamentos).
//   onContagem        – opcional; (n) => void com o total de uniões ativas a
//                       cada leitura.
//   versao            – opcional; muda quando quem monta precisa que a lista
//                       seja relida (ex.: depois de juntar pelo popup).
import { useEffect, useRef, useState } from "react";
import {
  buscarUnioes,
  desfazerUniao,
  erroDesfazerExigeRecarga,
  mensagemErroDesfazerUniao,
} from "@/lib/clientesAdmin";
import { formatarWhatsappExibicao } from "@/lib/whatsapp";

function dataDoTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

function telefoneExibicao(whatsapp) {
  return formatarWhatsappExibicao(whatsapp) ?? whatsapp ?? "";
}

function pluralizar(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}

// Contagem de um item: tamanho do array (ausente ou inválido conta 0). Vale
// para as chaves de `detalhes` e para os números devolvidos pela RPC.
function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function tamanho(lista) {
  return Array.isArray(lista) ? lista.length : 0;
}

// O que a união moveu, lido de `detalhes` (jsonb): cada chave é um array
// (agendamentos = [{id, nome}], as demais = ids em texto); a contagem é o
// length.
function contagensDeDetalhes(detalhes) {
  const d = detalhes && typeof detalhes === "object" ? detalhes : {};
  return {
    atendimentos: tamanho(d.agendamentos),
    anamneses: tamanho(d.anamneses),
    anotacoes: tamanho(d.anotacoes),
    resgates: tamanho(d.resgates),
    pendencias: tamanho(d.pendencias),
  };
}

// Linhas "N coisas" para uma contagem; atendimentos sempre, o resto só > 0.
function linhasDeContagem(c, rotulos) {
  const linhas = [
    pluralizar(c.atendimentos, rotulos.atendimento[0], rotulos.atendimento[1]),
  ];
  if (c.anamneses > 0) linhas.push(pluralizar(c.anamneses, ...rotulos.anamnese));
  if (c.anotacoes > 0) linhas.push(pluralizar(c.anotacoes, ...rotulos.anotacao));
  if (c.resgates > 0) linhas.push(pluralizar(c.resgates, ...rotulos.resgate));
  if (c.pendencias > 0) linhas.push(pluralizar(c.pendencias, ...rotulos.pendencia));
  return linhas;
}

const ROTULOS_MOVIDOS = {
  atendimento: ["atendimento", "atendimentos"],
  anamnese: ["ficha de anamnese", "fichas de anamnese"],
  anotacao: ["anotação", "anotações"],
  resgate: ["resgate de fidelidade", "resgates de fidelidade"],
  pendencia: ["pendência de fidelidade", "pendências de fidelidade"],
};

const ROTULOS_DEVOLVIDOS = {
  atendimento: ["atendimento voltou", "atendimentos voltaram"],
  anamnese: ["ficha de anamnese voltou", "fichas de anamnese voltaram"],
  anotacao: ["anotação voltou", "anotações voltaram"],
  resgate: ["resgate de fidelidade voltou", "resgates de fidelidade voltaram"],
  pendencia: ["pendência de fidelidade voltou", "pendências de fidelidade voltaram"],
};

export default function ListaUnioes({
  estabelecimentoId,
  mantidoId,
  onDesfeita,
  onContagem,
  versao,
}) {
  const [unioes, setUnioes] = useState(null); // null = carregando
  const [falhaLeitura, setFalhaLeitura] = useState(false);

  // União com a confirmação aberta, e o ciclo do envio.
  const [alvo, setAlvo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState(null); // contagens devolvidas

  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // onContagem fica em ref: o pai costuma passar uma função nova a cada
  // render, e isso não pode religar a leitura.
  const onContagemRef = useRef(onContagem);
  onContagemRef.current = onContagem;

  async function carregar() {
    const { dados, erro: falhou } = await buscarUnioes(estabelecimentoId, mantidoId);
    if (!montadoRef.current) return;
    setFalhaLeitura(falhou);
    setUnioes(dados);
    onContagemRef.current?.(dados.filter((u) => !u.desfeito_em).length);
  }

  useEffect(() => {
    setUnioes(null);
    carregar();
  }, [estabelecimentoId, mantidoId]);

  // Releitura pedida por quem monta, sem voltar ao "carregando" (o popup de
  // resultado do Desfazer vive aqui dentro e não pode ser desmontado).
  const primeiraVersaoRef = useRef(true);
  useEffect(() => {
    if (primeiraVersaoRef.current) {
      primeiraVersaoRef.current = false;
      return;
    }
    carregar();
  }, [versao]);

  function abrirConfirmacao(uniao) {
    setErro("");
    setResultado(null);
    setAlvo(uniao);
  }

  function fecharConfirmacao() {
    if (enviando) return;
    setAlvo(null);
    setErro("");
    setResultado(null);
  }

  async function confirmarDesfazer() {
    if (enviando || !alvo) return;
    setEnviando(true);
    setErro("");

    const { data, error } = await desfazerUniao(alvo.id);

    if (!montadoRef.current) return;
    setEnviando(false);

    if (error) {
      setErro(mensagemErroDesfazerUniao(error));
      // O banco mudou (ou a união não existe mais): reler a lista para a
      // linha refletir o estado real.
      if (erroDesfazerExigeRecarga(error) || error.code === "P0002") carregar();
      return;
    }

    const linha = Array.isArray(data) ? data[0] : data;
    setResultado({
      atendimentos: numero(linha?.agendamentos_devolvidos),
      anamneses: numero(linha?.anamneses_devolvidas),
      anotacoes: numero(linha?.anotacoes_devolvidas),
      resgates: numero(linha?.resgates_devolvidos),
      pendencias: numero(linha?.pendencias_devolvidas),
    });
    carregar();
    onDesfeita?.();
  }

  const ativas = (unioes ?? []).filter((u) => !u.desfeito_em);

  return (
    <>
      {falhaLeitura && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          Não foi possível carregar os cadastros juntados. Atualize a tela.
        </p>
      )}

      {!falhaLeitura && ativas.length > 0 && (
        <ul className="space-y-2">
          {ativas.map((uniao) => {
            const numeroAbsorvido = telefoneExibicao(uniao.whatsapp_absorvido);
            return (
              <li
                key={uniao.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-border"
              >
                <p className="min-w-[10rem] flex-1 break-words text-body">
                  <span className="font-medium text-heading">{uniao.nome_absorvido}</span>
                  {numeroAbsorvido ? ` (${numeroAbsorvido})` : ""} foi juntado aqui em{" "}
                  {dataDoTimestamp(uniao.criado_em) || "—"}
                </p>
                <button
                  type="button"
                  onClick={() => abrirConfirmacao(uniao)}
                  className="shrink-0 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-200 transition hover:bg-red-50"
                >
                  Desfazer
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {alvo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-desfazer-uniao"
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 px-4"
          onClick={enviando ? undefined : fecharConfirmacao}
        >
          <div
            className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            {resultado ? (
              <>
                <h2 id="titulo-desfazer-uniao" className="text-lg font-semibold text-heading">
                  Junção desfeita
                </h2>
                <p className="mt-2 text-sm text-body">
                  <span className="font-medium text-heading">{alvo.nome_absorvido}</span>{" "}
                  voltou a ser um cadastro separado.
                </p>
                <ul className="mt-3 list-disc pl-5 text-sm text-body">
                  {linhasDeContagem(resultado, ROTULOS_DEVOLVIDOS).map((linha) => (
                    <li key={linha}>{linha}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={fecharConfirmacao}
                  className="mt-6 w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary transition hover:opacity-90"
                >
                  Fechar
                </button>
              </>
            ) : (
              <>
                <h2 id="titulo-desfazer-uniao" className="text-lg font-semibold text-heading">
                  Desfazer junção
                </h2>
                <p className="mt-2 text-sm text-body">
                  O cadastro de{" "}
                  <span className="font-medium text-heading">{alvo.nome_absorvido}</span>{" "}
                  volta com o número{" "}
                  <span className="font-medium text-heading">
                    {telefoneExibicao(alvo.whatsapp_absorvido) || "anterior"}
                  </span>{" "}
                  e leva de volta o que veio na junção:
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm text-body">
                  {linhasDeContagem(contagensDeDetalhes(alvo.detalhes), ROTULOS_MOVIDOS).map(
                    (linha) => (
                      <li key={linha}>{linha}</li>
                    )
                  )}
                </ul>

                {erro && <p className="mt-3 text-sm text-red-700">{erro}</p>}

                <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
                  <button
                    type="button"
                    onClick={confirmarDesfazer}
                    disabled={enviando}
                    className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {enviando ? "Desfazendo..." : "Desfazer junção"}
                  </button>
                  <button
                    type="button"
                    onClick={fecharConfirmacao}
                    disabled={enviando}
                    className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Voltar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
