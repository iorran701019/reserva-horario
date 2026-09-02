"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";

// Importação em massa de eventos do Google Calendar pro reserva-horario (ver
// app/api/google-calendar/calendarios/route.js e
// app/api/google-calendar/importar/route.js, que fazem o trabalho pesado —
// aqui é só a tela de escolha do calendário + a lista dos candidatos, direto
// pro botão de importar. Sem revisão linha-a-linha: cada candidato vira um
// agendamento 'confirmado' já ocupando o horário, sem cliente/serviço
// vinculado (ver POST em importar/route.js); o vínculo com a ficha real
// acontece depois, pelo botão "Vincular cliente" no Painel. Só é montado
// quando `aberto` é true (ver ConfiguracoesSalao -> bloco Google Calendar),
// então cada abertura recomeça do zero.
//
// `estabelecimento` só precisa de `id` — o resto (calendário escolhido, lista
// de candidatos) é buscado aqui dentro.

// "2026-08-10" -> "10/08". Mesmo padrão de formatarData em
// app/[salon]/admin/page.js (sem libs de data).
function formatarData(data) {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

async function cabecalhoAutorizacao() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data?.session?.access_token ?? ""}` };
}

export default function ModalImportarGoogleCalendar({ estabelecimento, aberto, onFechar }) {
  const [calendarioId, setCalendarioId] = useState(undefined);
  const [calendarios, setCalendarios] = useState(null);
  const [calendarioEscolha, setCalendarioEscolha] = useState("");
  const [carregandoCalendarios, setCarregandoCalendarios] = useState(false);
  const [salvandoCalendario, setSalvandoCalendario] = useState(false);
  const [erroCalendario, setErroCalendario] = useState("");

  const [candidatos, setCandidatos] = useState(null);
  const [ignoradosPorCatalogo, setIgnoradosPorCatalogo] = useState(0);
  const [buscandoCandidatos, setBuscandoCandidatos] = useState(false);
  const [erroCandidatos, setErroCandidatos] = useState("");
  const [listaExpandida, setListaExpandida] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [resumoImportacao, setResumoImportacao] = useState(null);

  // Carrega o calendário já escolhido (se houver) ao abrir. Sem policy nova:
  // é só mais uma coluna de `estabelecimentos`, mesma leitura/gravação das
  // demais preferências desta tela.
  useEffect(() => {
    if (!aberto) return;
    let ativo = true;

    supabase
      .from("estabelecimentos")
      .select("google_calendar_id_importacao")
      .eq("id", estabelecimento.id)
      .single()
      .then(({ data }) => {
        if (!ativo) return;
        setCalendarioId(data?.google_calendar_id_importacao ?? null);
      });

    return () => {
      ativo = false;
    };
  }, [aberto, estabelecimento.id]);

  async function buscarCalendarios() {
    setCarregandoCalendarios(true);
    setErroCalendario("");
    try {
      const headers = await cabecalhoAutorizacao();
      const resposta = await fetch(
        `/api/google-calendar/calendarios?estabelecimento_id=${estabelecimento.id}`,
        { headers }
      );
      const corpo = await resposta.json();
      if (!resposta.ok || corpo.erro) throw new Error(corpo.erro ?? "Falha ao listar calendários.");
      const lista = corpo.calendarios ?? [];
      setCalendarios(lista);
      if (calendarioId && lista.some((c) => c.id === calendarioId)) {
        setCalendarioEscolha(calendarioId);
      } else {
        // Sem escolha salva ainda: pré-seleciona o calendário primário (já
        // vem primeiro na lista, ver listarCalendarios) em vez de deixar
        // "Selecione..." — é o palpite certo na maioria dos casos.
        const primario = lista.find((c) => c.primary);
        if (primario) setCalendarioEscolha(primario.id);
      }
    } catch (erro) {
      setErroCalendario(erro.message);
    } finally {
      setCarregandoCalendarios(false);
    }
  }

  async function salvarCalendario() {
    if (!calendarioEscolha) return;
    setSalvandoCalendario(true);
    setErroCalendario("");

    const { data: linhas, error } = await supabase
      .from("estabelecimentos")
      .update({ google_calendar_id_importacao: calendarioEscolha })
      .eq("id", estabelecimento.id)
      .select("id");

    setSalvandoCalendario(false);
    if (error || !linhas?.length) {
      setErroCalendario(`Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    setCalendarioId(calendarioEscolha);
  }

  async function buscarCandidatos() {
    setBuscandoCandidatos(true);
    setErroCandidatos("");
    setResumoImportacao(null);
    setListaExpandida(false);
    try {
      const headers = await cabecalhoAutorizacao();
      const resposta = await fetch(
        `/api/google-calendar/importar?estabelecimento_id=${estabelecimento.id}`,
        { headers }
      );
      const corpo = await resposta.json();
      if (!resposta.ok || corpo.erro) throw new Error(corpo.erro ?? "Falha ao buscar candidatos.");
      setCandidatos(corpo.candidatos ?? []);
      setIgnoradosPorCatalogo(corpo.ignorados_por_catalogo ?? 0);
    } catch (erro) {
      setErroCandidatos(erro.message);
    } finally {
      setBuscandoCandidatos(false);
    }
  }

  // Importação direta: manda TODO o lote de candidatos de uma vez — sem
  // seleção por linha, sem cliente/serviço (ver POST em
  // app/api/google-calendar/importar/route.js). Os que falharem (ex.: horário
  // sobreposto) continuam na lista, marcados com o motivo; os que deram certo
  // somem dela.
  async function confirmarImportacao() {
    setEnviando(true);
    setResumoImportacao(null);

    const itens = candidatos.map((c) => ({
      google_event_id: c.google_event_id,
      titulo_original: c.titulo_original,
      data: c.data,
      horario: c.horario,
      duracao_min: c.duracao_min,
    }));

    try {
      const headers = await cabecalhoAutorizacao();
      const resposta = await fetch("/api/google-calendar/importar", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ estabelecimento_id: estabelecimento.id, itens }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao confirmar a importação.");

      const motivoPorId = new Map((corpo.falhas ?? []).map((f) => [f.google_event_id, f.motivo]));
      setCandidatos((atual) => atual.filter((c) => motivoPorId.has(c.google_event_id)));
      setResumoImportacao({
        importados: corpo.importados,
        falhas: corpo.falhas?.length ?? 0,
      });
    } catch (erro) {
      setErroCandidatos(erro.message);
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-importar-google-calendar"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4 py-8"
      onClick={onFechar}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="titulo-importar-google-calendar" className="text-lg font-semibold text-heading">
            Importar do Google Calendar
          </h2>
          <button
            type="button"
            onClick={onFechar}
            className="text-body hover:text-heading"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {calendarioId === undefined && (
            <p className="text-sm text-body">Carregando...</p>
          )}

          {calendarioId !== undefined && (
            <>
              <div className="rounded-xl bg-surface p-4">
                <p className="text-sm font-medium text-heading">Calendário de atendimento</p>
                <p className="mt-1 text-xs text-muted">
                  Qual calendário da sua conta Google tem os atendimentos reais (não o de
                  feriados/pessoal).
                </p>

                {calendarioId && !calendarios && (
                  <p className="mt-3 text-sm text-body">
                    Calendário já escolhido.{" "}
                    <button
                      type="button"
                      onClick={buscarCalendarios}
                      className="font-medium text-primary underline"
                    >
                      Trocar
                    </button>
                  </p>
                )}

                {(!calendarioId || calendarios) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!calendarios && !carregandoCalendarios && (
                      <button
                        type="button"
                        onClick={buscarCalendarios}
                        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
                      >
                        Listar calendários
                      </button>
                    )}
                    {carregandoCalendarios && <p className="text-sm text-body">Carregando calendários...</p>}
                    {calendarios && calendarios.length > 0 && (
                      <>
                        <select
                          value={calendarioEscolha}
                          onChange={(e) => setCalendarioEscolha(e.target.value)}
                          className="rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                        >
                          <option value="">Selecione...</option>
                          {calendarios.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.primary ? "Sua agenda principal (email)" : c.summary}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={salvarCalendario}
                          disabled={!calendarioEscolha || salvandoCalendario}
                          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {salvandoCalendario ? "Salvando..." : "Salvar"}
                        </button>
                      </>
                    )}
                    {calendarios && calendarios.length === 0 && (
                      <p className="text-sm text-body">Nenhum calendário editável encontrado.</p>
                    )}
                  </div>
                )}

                {erroCalendario && <p className="mt-2 text-xs text-red-600">{erroCalendario}</p>}
              </div>

              {calendarioId && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={buscarCandidatos}
                    disabled={buscandoCandidatos}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {buscandoCandidatos ? "Buscando..." : "Buscar candidatos"}
                  </button>
                  {erroCandidatos && <p className="mt-2 text-xs text-red-600">{erroCandidatos}</p>}

                  {resumoImportacao && (
                    <p className="mt-2 text-xs font-medium text-green-600">
                      {resumoImportacao.importados} importado(s)
                      {resumoImportacao.falhas > 0 && `, ${resumoImportacao.falhas} com erro`}.
                    </p>
                  )}

                  {candidatos && candidatos.length === 0 && (
                    <p className="mt-3 text-sm text-body">Nenhum candidato novo encontrado.</p>
                  )}

                  {candidatos && ignoradosPorCatalogo > 0 && (
                    <p className="mt-1 text-xs text-muted">
                      {ignoradosPorCatalogo === 1
                        ? "1 evento foi ignorado por não parecer atendimento."
                        : `${ignoradosPorCatalogo} eventos foram ignorados por não parecerem atendimento.`}
                    </p>
                  )}

                  {/* Resumo retrátil: por padrão só mostra a contagem. A lista
                      só-leitura (data/horário/título) fica escondida atrás do
                      link "Visualizar lista detalhada" — cada candidato vira
                      um agendamento 'confirmado' ocupando o horário, sem
                      cliente/serviço; o vínculo com a ficha real acontece
                      depois, pelo botão "Vincular cliente" no Painel. */}
                  {candidatos && candidatos.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2.5">
                        <p className="text-sm text-body">
                          Foram encontrados {candidatos.length} agendamento
                          {candidatos.length === 1 ? "" : "s"}.
                        </p>
                        <button
                          type="button"
                          onClick={() => setListaExpandida((v) => !v)}
                          className="shrink-0 text-sm font-medium text-primary underline"
                        >
                          {listaExpandida ? "Ocultar lista" : "Visualizar lista detalhada"}
                        </button>
                      </div>

                      {listaExpandida && (
                        <ul className="mt-2 divide-y divide-border/60 rounded-xl bg-surface">
                          {candidatos.map((c) => (
                            <li key={c.google_event_id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-heading">
                                  {c.titulo_original || "(sem título)"}
                                </p>
                                <p className="text-xs text-muted">
                                  {formatarData(c.data)} às {c.horario} · {c.duracao_min} min
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}

                      <button
                        type="button"
                        onClick={confirmarImportacao}
                        disabled={enviando}
                        className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {enviando
                          ? "Importando..."
                          : `Importar ${candidatos.length} agendamento${candidatos.length === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
