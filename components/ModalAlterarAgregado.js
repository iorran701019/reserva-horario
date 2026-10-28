"use client";

import { useEffect, useState } from "react";
import { Check, MessageCircleOff } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { formatarPreco } from "@/lib/preco";
import { DURACAO_MAXIMA_MIN, nomeComAgregado, resumoPreco } from "@/lib/servicoAgregado";
import {
  agendamentoTemAcrescimo,
  textoAcrescimoDona,
  valorTotalAgendamento,
} from "@/lib/acrescimoDomingo";
import { somarAjustesPreco } from "@/lib/agendamentoRespostas";
import { buscarAgregadosDoServico, buscarSomaTempoAgregado } from "@/lib/agregadosServico";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import PopupConfirmarSemAviso from "@/components/PopupConfirmarSemAviso";

const ERRO_SOBREPOSICAO =
  "O tempo adicional não cabe antes do próximo agendamento deste profissional.";

function precoParaTexto(centavos) {
  return ((centavos ?? 0) / 100).toFixed(2).replace(".", ",");
}

// Modo "agregado" do /admin (MenuAlterar -> "Alterar serviço agregado"): troca,
// remove ou reprecifica o serviço agregado de UMA reserva existente, isolado
// de troca de serviço e de data. Grava pela RPC agendamento_alterar_agregado
// (que recalcula a duração e valida status, par e destino). Só apresentação e
// gravação: quem chama (page.js) cuida do estado local e do aviso por WhatsApp,
// via onSalvo(linha, notificar). `agendamento` é a linha VIVA (com servicos).
export default function ModalAlterarAgregado({ agendamento, estabelecimento, onSalvo, onFechar }) {
  const ag = agendamento;
  const [opcoes, setOpcoes] = useState(null);
  const [somaTempo, setSomaTempo] = useState(null);
  const [escolhidoId, setEscolhidoId] = useState(ag.servico_agregado_id ?? null);
  const [precoTexto, setPrecoTexto] = useState(precoParaTexto(ag.agregado_preco_centavos));
  const [duracaoTexto, setDuracaoTexto] = useState(String(ag.agregado_duracao_min ?? 0));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmandoSemAviso, setConfirmandoSemAviso] = useState(false);
  const [ajustes, setAjustes] = useState({ id: null, status: "carregando", centavos: 0 });
  const temAcrescimo = agendamentoTemAcrescimo(ag);

  // Com acréscimo de domingo gravado, o total soma os ajustes das perguntas
  // ANTES do acréscimo (como o cron); busca uma vez por reserva. Sem acréscimo
  // o resumo segue o de sempre, sem busca.
  useEffect(() => {
    if (!temAcrescimo) return undefined;
    let ativo = true;
    somarAjustesPreco(ag.id)
      .then((r) => {
        if (ativo) setAjustes({ id: ag.id, status: r.ok ? "ok" : "erro", centavos: r.centavos });
      })
      .catch(() => {
        if (ativo) setAjustes({ id: ag.id, status: "erro", centavos: 0 });
      });
    return () => {
      ativo = false;
    };
  }, [ag.id, temAcrescimo]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data, error } = await supabase
        .from("servicos")
        .select("id, nome, eh_manutencao, exige_segunda_data, manutencao_externa")
        .eq("estabelecimento_id", estabelecimento.id)
        .eq("ativo", true);
      if (!ativo) return;
      if (error) {
        setErro(`Não foi possível carregar os agregados: ${error.message}`);
        setOpcoes([]);
        return;
      }
      const [lista, soma] = await Promise.all([
        buscarAgregadosDoServico(ag.servico_id, data ?? [], estabelecimento),
        buscarSomaTempoAgregado(ag.servico_id, estabelecimento.id),
      ]);
      if (!ativo) return;
      setSomaTempo(soma);
      setOpcoes(lista);
    })();
    return () => {
      ativo = false;
    };
  }, [ag.servico_id, estabelecimento]);

  // O agregado atual continua selecionável mesmo que tenha saído da lista
  // configurada (desativado ou removido): senão ele sumiria da tela marcada.
  const atualId = ag.servico_agregado_id ?? null;
  const lista = (opcoes ?? []).slice();
  if (atualId != null && !lista.some((o) => o.servico_agregado_id === atualId)) {
    lista.push({
      id: `atual-${atualId}`,
      servico_agregado_id: atualId,
      nome: ag.agregado_nome ?? "Agregado atual",
      preco_centavos: ag.agregado_preco_centavos ?? 0,
      duracao_min: ag.agregado_duracao_min ?? 0,
    });
  }

  function escolher(opcao) {
    const id = opcao ? opcao.servico_agregado_id : null;
    setEscolhidoId(id);
    setErro("");
    if (!opcao) return;
    // O agregado atual volta com os valores GRAVADOS na reserva; um outro
    // parte dos configurados.
    const ehAtual = id === atualId;
    setPrecoTexto(
      precoParaTexto(ehAtual ? ag.agregado_preco_centavos : opcao.preco_centavos)
    );
    setDuracaoTexto(String(ehAtual ? (ag.agregado_duracao_min ?? 0) : (opcao.duracao_min ?? 0)));
  }

  const escolhida = lista.find((o) => o.servico_agregado_id === escolhidoId) ?? null;
  const preco = Math.round(Number(String(precoTexto).replace(",", ".")) * 100);
  const duracao = Number(duracaoTexto);
  const valoresValidos =
    precoTexto.trim() !== "" &&
    Number.isFinite(preco) &&
    preco >= 0 &&
    Number.isInteger(duracao) &&
    duracao >= 0 &&
    duracao <= DURACAO_MAXIMA_MIN;
  const mudou =
    escolhidoId !== atualId ||
    (escolhidoId != null &&
      (preco !== (ag.agregado_preco_centavos ?? 0) || duracao !== (ag.agregado_duracao_min ?? 0)));
  const travado =
    salvando || opcoes === null || !mudou || (escolhidoId != null && !valoresValidos);

  async function salvar(notificar) {
    if (travado) return;
    setSalvando(true);
    setErro("");
    const { data, error } = await supabase.rpc("agendamento_alterar_agregado", {
      p_agendamento_id: ag.id,
      p_servico_agregado_id: escolhidoId,
      p_preco_centavos: escolhidoId != null ? preco : null,
      p_duracao_min: escolhidoId != null ? duracao : null,
    });
    setSalvando(false);

    if (error?.code === "23P01") {
      setErro(ERRO_SOBREPOSICAO);
      return;
    }
    const linha = Array.isArray(data) ? data[0] : data;
    if (error || !linha) {
      setErro(`Não foi possível alterar o agregado: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    onSalvo(linha, notificar);
  }

  // Total da reserva como está gravada, com o acréscimo de domingo; a troca de
  // agregado não mexe no percentual.
  const ajustesProntos = ajustes.id === ag.id && ajustes.status === "ok";
  const totalComAcrescimo =
    temAcrescimo && ajustesProntos
      ? valorTotalAgendamento(ag, ajustes.centavos)
      : null;

  const semAgregados = opcoes !== null && lista.length === 0;
  const nomeAtual = nomeComAgregado(ag.servicos?.nome, ag.agregado_nome) ?? "Serviço";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-alterar-agregado"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 px-4"
      onClick={() => {
        if (!salvando) onFechar();
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="titulo-alterar-agregado" className="text-lg font-semibold text-heading">
          Alterar serviço agregado
        </h2>
        <div className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-body">
          <p className="font-medium text-heading">
            {nomeAtual}
            {ag.duracao_min != null && <> · {ag.duracao_min} min</>}
          </p>
          {ag.servicos?.preco_centavos != null &&
            (temAcrescimo ? (
              <>
                <p className="mt-0.5">
                  {ajustes.id !== ag.id || ajustes.status === "carregando" ? (
                    "…"
                  ) : ajustes.status === "erro" ? (
                    <span className="text-xs">
                      Não foi possível conferir o valor; confira os ajustes de preço das
                      perguntas.
                    </span>
                  ) : totalComAcrescimo == null ? (
                    "—"
                  ) : (
                    formatarPreco(totalComAcrescimo)
                  )}
                </p>
                <p className="mt-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200">
                  {textoAcrescimoDona(ag.acrescimo_percentual_aplicado)}
                </p>
              </>
            ) : (
              <p className="mt-0.5">
                {resumoPreco(ag.servicos.preco_centavos, ag.agregado_preco_centavos)}
              </p>
            ))}
        </div>

        {opcoes === null ? (
          <p className="mt-4 text-sm text-body">Carregando agregados...</p>
        ) : semAgregados ? (
          <>
            <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-sm text-body">
              Este serviço não tem agregados cadastrados.
            </p>
            {erro && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erro}
              </p>
            )}
            <button
              type="button"
              onClick={onFechar}
              className="mt-6 w-full rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Voltar
            </button>
          </>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-2">
              {[...lista, null].map((opcao) => {
                const id = opcao ? opcao.servico_agregado_id : null;
                const sel = id === escolhidoId;
                return (
                  <button
                    key={opcao ? opcao.id : "sem-agregado"}
                    type="button"
                    onClick={() => escolher(opcao)}
                    disabled={salvando}
                    aria-pressed={sel}
                    className={[
                      "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-60",
                      sel
                        ? "bg-primary text-on-primary ring-primary"
                        : "bg-card text-body ring-border hover:border-primary hover:ring-primary",
                    ].join(" ")}
                  >
                    <span>{opcao ? opcao.nome : "Sem agregado"}</span>
                    {opcao && (
                      <span className="shrink-0 text-xs font-normal opacity-80">
                        {opcao.duracao_min} min · {formatarPreco(opcao.preco_centavos)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {escolhida && (
              <div className="mt-4 flex flex-col gap-3">
                <label className="block text-sm font-medium text-body">
                  Valor (R$)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={precoTexto}
                    onChange={(e) => {
                      setPrecoTexto(e.target.value);
                      setErro("");
                    }}
                    disabled={salvando}
                    className="mt-1 w-full rounded-lg bg-card px-3 py-2 text-sm text-on-card ring-1 ring-border"
                  />
                </label>
                <label className="block text-sm font-medium text-body">
                  Tempo (min)
                  <input
                    type="text"
                    inputMode="numeric"
                    value={duracaoTexto}
                    onChange={(e) => {
                      setDuracaoTexto(e.target.value);
                      setErro("");
                    }}
                    disabled={salvando}
                    className="mt-1 w-full rounded-lg bg-card px-3 py-2 text-sm text-on-card ring-1 ring-border"
                  />
                </label>
                {somaTempo === false && (
                  <p className="text-xs text-muted">
                    Informativo: a agenda é fixa, o tempo não altera os horários.
                  </p>
                )}
                {!valoresValidos && (
                  <p className="text-xs text-muted">
                    Informe um valor válido e um tempo inteiro de 0 a {DURACAO_MAXIMA_MIN} minutos.
                  </p>
                )}
              </div>
            )}

            {erro && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erro}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <div className="flex items-stretch overflow-hidden rounded-lg bg-green-50 ring-1 ring-green-100">
                <button
                  type="button"
                  onClick={() => salvar(true)}
                  disabled={travado}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-green-700 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <IconeWhatsApp />
                  {salvando ? "Salvando..." : "Confirmar alteração"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmandoSemAviso(true)}
                  disabled={travado}
                  aria-label="Confirmar sem avisar a cliente"
                  title="Confirmar sem avisar a cliente"
                  className="inline-flex w-16 shrink-0 items-center justify-center gap-1 border-l border-green-100 text-green-700 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <MessageCircleOff className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                onClick={onFechar}
                disabled={salvando}
                className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
              >
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
      {confirmandoSemAviso && (
        <PopupConfirmarSemAviso
          desabilitado={salvando}
          onVoltar={() => setConfirmandoSemAviso(false)}
          onConfirmar={() => {
            setConfirmandoSemAviso(false);
            salvar(false);
          }}
        />
      )}
    </div>
  );
}
