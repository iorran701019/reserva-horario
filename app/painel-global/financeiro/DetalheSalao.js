"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import SeletorMes from "./SeletorMes";
import {
  ROTULO_STATUS,
  centavosParaInput,
  classeBadge,
  faturaVencida,
  formatarBRL,
  formatarData,
  formatarInstante,
  hojeStr,
  inputParaCentavos,
  rotuloCompetencia,
} from "./util";

const CLASSE_INPUT =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10";
const CLASSE_BOTAO =
  "rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-heading ring-1 ring-border transition hover:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60";
const CLASSE_BOTAO_PERIGO =
  "rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60";
const CLASSE_BOTAO_PRIMARIO =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

function Secao({ titulo, children }) {
  return (
    <section className="mt-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <h3 className="mb-3 text-sm font-semibold text-heading">{titulo}</h3>
      {children}
    </section>
  );
}

// Detalhe de um salão: configuração da assinatura, condições especiais e
// faturas. Todas as mutações usam .select() e tratam 0 linhas como falha (RLS
// filtra em silêncio) — o aviso sobe pelo `avisar` do pai.
export default function DetalheSalao({
  salao,
  assinatura,
  condicoes,
  faturas,
  aoMudar,
  avisar,
  gerarFaturasPadrao,
}) {
  const [valorPadrao, setValorPadrao] = useState(
    centavosParaInput(assinatura.valor_padrao_centavos)
  );
  const [diaVencimento, setDiaVencimento] = useState(assinatura.dia_vencimento);
  const [inicioCobranca, setInicioCobranca] = useState(assinatura.inicio_cobranca);
  const [exigeNf, setExigeNf] = useState(assinatura.exige_nota_fiscal);
  const [ativa, setAtiva] = useState(assinatura.ativa);
  const [observacao, setObservacao] = useState(assinatura.observacao ?? "");
  const [salvandoConfig, setSalvandoConfig] = useState(false);

  const [condInicio, setCondInicio] = useState(assinatura.inicio_cobranca);
  const [condFim, setCondFim] = useState("");
  const [condValor, setCondValor] = useState("");
  const [condObs, setCondObs] = useState("");
  const [salvandoCond, setSalvandoCond] = useState(false);

  const [ocupada, setOcupada] = useState(null); // id da fatura/condição em ação

  const [mostrarCanceladas, setMostrarCanceladas] = useState(false);

  const hoje = hojeStr();
  // Mais recente (maior id = cadastrada por último) primeiro.
  const condicoesOrdenadas = [...condicoes].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const canceladas = faturas.filter((f) => f.status === "cancelada");
  const faturasVisiveis = mostrarCanceladas ? faturas : faturas.filter((f) => f.status !== "cancelada");
  // Faturas anteriores ao início da cobrança, sem pagamento nem cobrança gerada.
  const foraDoPeriodo = faturas.filter(
    (f) => f.competencia < assinatura.inicio_cobranca && !f.pago_em && !f.abacatepay_cobranca_id
  );

  async function limparForaDoPeriodo() {
    if (
      !window.confirm(
        `Excluir ${foraDoPeriodo.length} fatura(s) anteriores ao início da cobrança, sem pagamento e sem cobrança gerada?`
      )
    )
      return;
    setOcupada("limpar");
    const { data: linhas, error } = await supabase
      .from("assinatura_faturas")
      .delete()
      .eq("estabelecimento_id", salao.id)
      .lt("competencia", assinatura.inicio_cobranca)
      .is("pago_em", null)
      .is("abacatepay_cobranca_id", null)
      .select("id");
    if (error || !linhas?.length) {
      setOcupada(null);
      avisar("erro", `Não foi possível limpar: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    await aoMudar();
    setOcupada(null);
    avisar("ok", `${linhas.length} fatura(s) fora do período removida(s).`);
  }

  async function salvarConfig(e) {
    e.preventDefault();
    const centavos = inputParaCentavos(valorPadrao);
    if (centavos === null) {
      avisar("erro", "Valor padrão inválido.");
      return;
    }
    setSalvandoConfig(true);
    const { data: linhas, error } = await supabase
      .from("assinaturas")
      .update({
        valor_padrao_centavos: centavos,
        dia_vencimento: Number(diaVencimento),
        inicio_cobranca: inicioCobranca,
        exige_nota_fiscal: exigeNf,
        ativa,
        observacao: observacao.trim() || null,
      })
      .eq("estabelecimento_id", salao.id)
      .select("estabelecimento_id");
    if (error || !linhas?.length) {
      setSalvandoConfig(false);
      avisar("erro", `Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    const ok = await gerarFaturasPadrao(inicioCobranca);
    setSalvandoConfig(false);
    if (ok) avisar("ok", "Configuração salva e faturas atualizadas.");
  }

  async function adicionarCondicao(e) {
    e.preventDefault();
    const centavos = inputParaCentavos(condValor);
    if (centavos === null) {
      avisar("erro", "Valor da condição inválido (use 0 para isento).");
      return;
    }
    if (!condInicio) {
      avisar("erro", "Informe o mês de início da condição.");
      return;
    }
    if (condFim && condFim < condInicio) {
      avisar("erro", "O mês de fim não pode ser anterior ao de início.");
      return;
    }
    setSalvandoCond(true);
    const { data: linhas, error } = await supabase
      .from("assinatura_condicoes")
      .insert({
        estabelecimento_id: salao.id,
        competencia_inicio: condInicio,
        competencia_fim: condFim || null,
        valor_centavos: centavos,
        observacao: condObs.trim() || null,
      })
      .select("id");
    if (error || !linhas?.length) {
      setSalvandoCond(false);
      avisar("erro", `Não foi possível adicionar: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    setCondFim("");
    setCondValor("");
    setCondObs("");
    const ok = await gerarFaturasPadrao(assinatura.inicio_cobranca);
    setSalvandoCond(false);
    if (ok) avisar("ok", "Condição adicionada e faturas atualizadas.");
  }

  async function excluirCondicao(cond) {
    if (!window.confirm("Excluir esta condição especial?")) return;
    setOcupada(cond.id);
    const { data: linhas, error } = await supabase
      .from("assinatura_condicoes")
      .delete()
      .eq("id", cond.id)
      .select("id");
    if (error || !linhas?.length) {
      setOcupada(null);
      avisar("erro", `Não foi possível excluir: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    // Excluir uma condição muda o valor das faturas ainda abertas: recalcula.
    const ok = await gerarFaturasPadrao(assinatura.inicio_cobranca);
    setOcupada(null);
    if (ok) avisar("ok", "Condição excluída e faturas atualizadas.");
  }

  async function mutarFatura(fatura, campos, restricao, mensagemOk) {
    setOcupada(fatura.id);
    let consulta = supabase.from("assinatura_faturas").update(campos).eq("id", fatura.id);
    if (restricao) consulta = restricao(consulta);
    const { data: linhas, error } = await consulta.select("id");
    if (error || !linhas?.length) {
      setOcupada(null);
      avisar("erro", `Não foi possível atualizar a fatura: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    await aoMudar();
    setOcupada(null);
    avisar("ok", mensagemOk);
  }

  const marcarPaga = (f) =>
    mutarFatura(
      f,
      { status: "paga", pago_em: new Date().toISOString(), forma_pagamento: "manual" },
      (q) => q.eq("status", "aberta"),
      "Fatura marcada como paga."
    );

  const desfazerPagamento = (f) =>
    mutarFatura(
      f,
      { status: "aberta", pago_em: null, forma_pagamento: null },
      (q) => q.eq("status", "paga").eq("forma_pagamento", "manual").is("nf_emitida_em", null),
      "Pagamento desfeito."
    );

  const cancelarFatura = (f) => {
    if (!window.confirm(`Cancelar a fatura de ${rotuloCompetencia(f.competencia)}?`)) return;
    return mutarFatura(
      f,
      { status: "cancelada" },
      (q) => q.eq("status", "aberta"),
      "Fatura cancelada."
    );
  };

  // Cancelada sem pagamento nem cobrança volta a aberta; a RPC recalcula
  // valor/status pelas condições atuais.
  async function reabrirFatura(fatura) {
    setOcupada(fatura.id);
    const { data: linhas, error } = await supabase
      .from("assinatura_faturas")
      .update({ status: "aberta" })
      .eq("id", fatura.id)
      .eq("status", "cancelada")
      .is("pago_em", null)
      .is("abacatepay_cobranca_id", null)
      .select("id");
    if (error || !linhas?.length) {
      setOcupada(null);
      avisar("erro", `Não foi possível reabrir a fatura: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    const ok = await gerarFaturasPadrao(assinatura.inicio_cobranca);
    setOcupada(null);
    if (ok) avisar("ok", "Fatura reaberta e recalculada.");
  }

  const marcarNf = (f) =>
    mutarFatura(
      f,
      { nf_emitida_em: new Date().toISOString() },
      (q) => q.eq("status", "paga"),
      "Nota fiscal marcada como emitida."
    );

  return (
    <div>
      <Secao titulo="Configuração">
        <form onSubmit={salvarConfig} className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-body">
            Valor padrão (R$)
            <input
              inputMode="decimal"
              value={valorPadrao}
              onChange={(e) => setValorPadrao(e.target.value)}
              className={`mt-1 ${CLASSE_INPUT}`}
            />
          </label>
          <label className="block text-sm text-body">
            Dia de vencimento
            <select
              value={diaVencimento}
              onChange={(e) => setDiaVencimento(e.target.value)}
              className={`mt-1 ${CLASSE_INPUT}`}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm text-body">
            Início da cobrança
            <div className="mt-1">
              <SeletorMes
                valor={inicioCobranca}
                onChange={setInicioCobranca}
                rotulo="Início da cobrança"
              />
            </div>
          </div>
          <div className="flex flex-col justify-end gap-2 text-sm text-body">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={exigeNf}
                onChange={(e) => setExigeNf(e.target.checked)}
              />
              Exige nota fiscal
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
              Assinatura ativa
            </label>
          </div>
          <label className="block text-sm text-body sm:col-span-2">
            Observação
            <textarea
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className={`mt-1 ${CLASSE_INPUT}`}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={salvandoConfig} className={CLASSE_BOTAO_PRIMARIO}>
              {salvandoConfig ? "Salvando..." : "Salvar configuração"}
            </button>
          </div>
        </form>
      </Secao>

      <Secao titulo="Condições especiais">
        {condicoes.length === 0 ? (
          <p className="mb-3 text-sm text-body">Nenhuma condição especial.</p>
        ) : (
          <ul className="mb-4 divide-y divide-border">
            {condicoesOrdenadas.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-heading">
                    {rotuloCompetencia(c.competencia_inicio)} →{" "}
                    {c.competencia_fim ? rotuloCompetencia(c.competencia_fim) : "sem fim"}
                    {" · "}
                    {c.valor_centavos === 0 ? "Isento" : formatarBRL(c.valor_centavos)}
                  </p>
                  {c.observacao && <p className="truncate text-xs text-body">{c.observacao}</p>}
                </div>
                <button
                  type="button"
                  disabled={ocupada === c.id}
                  onClick={() => excluirCondicao(c)}
                  className={CLASSE_BOTAO_PERIGO}
                >
                  Excluir
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mb-3 text-xs text-muted">
          Se dois períodos se sobrepuserem, vale o cadastrado por último.
        </p>

        <form onSubmit={adicionarCondicao} className="grid gap-3 sm:grid-cols-2">
          <div className="text-sm text-body">
            Mês de início
            <div className="mt-1">
              <SeletorMes valor={condInicio} onChange={setCondInicio} rotulo="Início da condição" />
            </div>
          </div>
          <div className="text-sm text-body">
            Mês de fim (opcional)
            <div className="mt-1">
              <SeletorMes
                valor={condFim}
                onChange={setCondFim}
                opcional
                rotulo="Fim da condição"
              />
            </div>
          </div>
          <label className="block text-sm text-body">
            Valor (R$) — 0 = isento
            <input
              inputMode="decimal"
              value={condValor}
              onChange={(e) => setCondValor(e.target.value)}
              placeholder="0,00"
              className={`mt-1 ${CLASSE_INPUT}`}
            />
          </label>
          <label className="block text-sm text-body">
            Observação
            <input
              value={condObs}
              onChange={(e) => setCondObs(e.target.value)}
              className={`mt-1 ${CLASSE_INPUT}`}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={salvandoCond} className={CLASSE_BOTAO_PRIMARIO}>
              {salvandoCond ? "Adicionando..." : "Adicionar condição"}
            </button>
          </div>
        </form>
      </Secao>

      <Secao titulo="Faturas">
        {(canceladas.length > 0 || foraDoPeriodo.length > 0) && (
          <div className="mb-3 flex flex-wrap gap-2">
            {canceladas.length > 0 && (
              <button
                type="button"
                onClick={() => setMostrarCanceladas((v) => !v)}
                className={CLASSE_BOTAO}
              >
                {mostrarCanceladas
                  ? "Esconder canceladas"
                  : `Mostrar canceladas (${canceladas.length})`}
              </button>
            )}
            {foraDoPeriodo.length > 0 && (
              <button
                type="button"
                disabled={ocupada === "limpar"}
                onClick={limparForaDoPeriodo}
                className={CLASSE_BOTAO_PERIGO}
              >
                Limpar faturas fora do período
              </button>
            )}
          </div>
        )}
        {faturasVisiveis.length === 0 ? (
          <p className="text-sm text-body">
            Nenhuma fatura gerada ainda. A cobrança começa em{" "}
            {rotuloCompetencia(assinatura.inicio_cobranca)}.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {faturasVisiveis.map((f) => {
              const vencida = faturaVencida(f, hoje);
              const livre = ocupada === f.id;
              return (
                <li key={f.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium capitalize text-heading">
                        {rotuloCompetencia(f.competencia)} · {formatarBRL(f.valor_centavos)}
                      </p>
                      <p className="text-xs text-body">
                        Vence em {formatarData(f.vencimento)}
                        {f.pago_em && ` · pago em ${formatarInstante(f.pago_em)}`}
                        {f.status === "paga" && assinatura.exige_nota_fiscal && (
                          <>
                            {" · "}
                            {f.nf_emitida_em
                              ? `NF emitida em ${formatarInstante(f.nf_emitida_em)}`
                              : "NF pendente"}
                          </>
                        )}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${classeBadge(f, hoje)}`}
                    >
                      {vencida ? "Vencida" : ROTULO_STATUS[f.status]}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {f.status === "aberta" && (
                      <>
                        <button
                          type="button"
                          disabled={livre}
                          onClick={() => marcarPaga(f)}
                          className={CLASSE_BOTAO}
                        >
                          Marcar como paga
                        </button>
                        <button
                          type="button"
                          disabled={livre}
                          onClick={() => cancelarFatura(f)}
                          className={CLASSE_BOTAO_PERIGO}
                        >
                          Cancelar fatura
                        </button>
                      </>
                    )}
                    {f.status === "cancelada" && !f.pago_em && !f.abacatepay_cobranca_id && (
                      <button
                        type="button"
                        disabled={livre}
                        onClick={() => reabrirFatura(f)}
                        className={CLASSE_BOTAO}
                      >
                        Reabrir
                      </button>
                    )}
                    {f.status === "paga" &&
                      f.forma_pagamento === "manual" &&
                      !f.nf_emitida_em && (
                        <button
                          type="button"
                          disabled={livre}
                          onClick={() => desfazerPagamento(f)}
                          className={CLASSE_BOTAO}
                        >
                          Desfazer pagamento
                        </button>
                      )}
                    {f.status === "paga" && assinatura.exige_nota_fiscal && !f.nf_emitida_em && (
                      <button
                        type="button"
                        disabled={livre}
                        onClick={() => marcarNf(f)}
                        className={CLASSE_BOTAO}
                      >
                        Marcar NF emitida
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Secao>
    </div>
  );
}
