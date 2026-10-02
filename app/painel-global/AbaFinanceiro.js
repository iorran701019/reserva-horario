"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import AtivarAssinatura from "./financeiro/AtivarAssinatura";
import DetalheSalao from "./financeiro/DetalheSalao";
import SeletorMes from "./financeiro/SeletorMes";
import {
  ROTULO_STATUS,
  classeBadge,
  MES_MINIMO,
  competenciaAtual,
  faturaVencida,
  formatarBRL,
  formatarInstante,
  horizonteGeracao,
  hojeStr,
  rotuloCompetencia,
  valorDaCompetencia,
} from "./financeiro/util";

// Aba "Financeiro" do hub (ver HubPainelGlobal): assinatura mensal de cada
// salão (tabelas assinaturas, assinatura_condicoes, assinatura_faturas). Só o
// papel 'global' escreve; o RLS já cobre. Esta aba carrega tudo de uma vez (a
// lista de salões precisa de faturas e condições de todos) e o detalhe filtra
// em memória.
const CLASSE_BOTAO =
  "rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-heading ring-1 ring-border transition hover:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60";
const CLASSE_BOTAO_PRIMARIO =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

const maisRecente = (a, b) => (a > b ? a : b);

export default function AbaFinanceiro() {
  const [saloes, setSaloes] = useState(null);
  const [assinaturas, setAssinaturas] = useState([]);
  const [condicoes, setCondicoes] = useState([]);
  const [faturas, setFaturas] = useState([]);
  const [erroCarga, setErroCarga] = useState("");
  const [aviso, setAviso] = useState(null); // { tipo: "ok" | "erro", texto }
  const [selecionado, setSelecionado] = useState(null);
  const [mesGerar, setMesGerar] = useState(
    maisRecente(horizonteGeracao(null), MES_MINIMO)
  );
  const [gerando, setGerando] = useState(false);
  const [ocupado, setOcupado] = useState(null);

  const avisar = useCallback((tipo, texto) => setAviso({ tipo, texto }), []);

  const buscar = useCallback(async () => {
    const [rSaloes, rAss, rCond, rFat] = await Promise.all([
      supabase.from("estabelecimentos").select("id, nome, slug").eq("ativo", true).order("nome"),
      supabase.from("assinaturas").select("*"),
      supabase
        .from("assinatura_condicoes")
        .select("*")
        .order("competencia_inicio", { ascending: true }),
      supabase
        .from("assinatura_faturas")
        .select("*")
        .order("competencia", { ascending: false }),
    ]);
    return { rSaloes, rAss, rCond, rFat };
  }, []);

  const aplicar = useCallback(({ rSaloes, rAss, rCond, rFat }) => {
    const erro = rSaloes.error || rAss.error || rCond.error || rFat.error;
    if (erro) {
      setErroCarga(erro.message);
      return;
    }
    setErroCarga("");
    setSaloes(rSaloes.data);
    setAssinaturas(rAss.data);
    setCondicoes(rCond.data);
    setFaturas(rFat.data);
  }, []);

  // Recarga após mutação (chamada de handlers, nunca de efeito).
  const carregar = useCallback(async () => aplicar(await buscar()), [aplicar, buscar]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const resultado = await buscar();
      if (ativo) aplicar(resultado);
    })();
    return () => {
      ativo = false;
    };
  }, [buscar, aplicar]);

  // Gera/recalcula as faturas até o mês informado (RPC) e recarrega. Devolve
  // true se deu certo; em falha o aviso já foi emitido aqui.
  const gerarFaturas = useCallback(
    async (ateCompetencia) => {
      const { error } = await supabase.rpc("assinatura_gerar_faturas", {
        p_ate: ateCompetencia,
      });
      if (error) {
        avisar("erro", `Salvo, mas não foi possível gerar as faturas: ${error.message}`);
        await carregar();
        return false;
      }
      await carregar();
      return true;
    },
    [avisar, carregar]
  );

  const gerarFaturasPadrao = useCallback(
    (inicioCobranca) => gerarFaturas(horizonteGeracao(inicioCobranca)),
    [gerarFaturas]
  );

  const hoje = hojeStr();
  const mesCorrente = competenciaAtual();

  const assPorSalao = useMemo(
    () => new Map(assinaturas.map((a) => [a.estabelecimento_id, a])),
    [assinaturas]
  );

  const nfPendentes = useMemo(
    () =>
      faturas.filter(
        (f) =>
          f.status === "paga" &&
          !f.nf_emitida_em &&
          assPorSalao.get(f.estabelecimento_id)?.exige_nota_fiscal
      ),
    [faturas, assPorSalao]
  );

  const nomeSalao = (id) => saloes?.find((s) => s.id === id)?.nome ?? `Salão ${id}`;

  async function marcarNf(fatura) {
    setOcupado(fatura.id);
    const { data: linhas, error } = await supabase
      .from("assinatura_faturas")
      .update({ nf_emitida_em: new Date().toISOString() })
      .eq("id", fatura.id)
      .eq("status", "paga")
      .select("id");
    if (error || !linhas?.length) {
      setOcupado(null);
      avisar("erro", `Não foi possível marcar a NF: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    await carregar();
    setOcupado(null);
    avisar("ok", "Nota fiscal marcada como emitida.");
  }

  async function ativarAssinatura(salao, campos) {
    setOcupado(`ativar-${salao.id}`);
    const { data: linhas, error } = await supabase
      .from("assinaturas")
      .insert({ estabelecimento_id: salao.id, ...campos })
      .select("estabelecimento_id");
    if (error || !linhas?.length) {
      setOcupado(null);
      avisar("erro", `Não foi possível ativar a assinatura: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    const ok = await gerarFaturasPadrao(campos.inicio_cobranca);
    setOcupado(null);
    if (ok) avisar("ok", `Assinatura de ${salao.nome} ativada.`);
  }

  async function gerarAte() {
    setGerando(true);
    const ok = await gerarFaturas(mesGerar);
    setGerando(false);
    if (ok) avisar("ok", `Faturas geradas até ${rotuloCompetencia(mesGerar)}.`);
  }

  if (erroCarga) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          Erro ao carregar o financeiro: {erroCarga}
        </p>
      </div>
    );
  }

  if (saloes === null) {
    return <p className="mt-6 text-center text-sm text-body">Carregando...</p>;
  }

  const bannerAviso = aviso && (
    <p
      role="status"
      className={`mb-3 rounded-lg px-3 py-2 text-sm ring-1 ${
        aviso.tipo === "ok"
          ? "bg-green-50 text-green-700 ring-green-100"
          : "bg-red-50 text-red-700 ring-red-100"
      }`}
    >
      {aviso.texto}
    </p>
  );

  // Detalhe de um salão.
  const salaoAberto = saloes.find((s) => s.id === selecionado);
  const assAberta = salaoAberto && assPorSalao.get(salaoAberto.id);
  if (salaoAberto) {
    return (
      <div className="mx-auto mt-4 max-w-5xl">
        <button
          type="button"
          onClick={() => {
            setSelecionado(null);
            setAviso(null);
          }}
          className={CLASSE_BOTAO}
        >
          ← Voltar
        </button>
        <h2 className="mb-3 mt-3 text-lg font-bold text-heading">{salaoAberto.nome}</h2>
        {bannerAviso}
        {!assAberta ? (
          <AtivarAssinatura
            key={salaoAberto.id}
            aoAtivar={(campos) => ativarAssinatura(salaoAberto, campos)}
            avisar={avisar}
          />
        ) : (
        <DetalheSalao
          key={salaoAberto.id}
          salao={salaoAberto}
          assinatura={assAberta}
          condicoes={condicoes.filter((c) => c.estabelecimento_id === salaoAberto.id)}
          faturas={faturas.filter((f) => f.estabelecimento_id === salaoAberto.id)}
          aoMudar={carregar}
          avisar={avisar}
          gerarFaturasPadrao={gerarFaturasPadrao}
        />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-4 max-w-5xl">
      {bannerAviso}

      <section className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="mb-3 text-sm font-semibold text-heading">
          Notas fiscais pendentes ({nfPendentes.length})
        </h2>
        {nfPendentes.length === 0 ? (
          <p className="text-sm text-body">Nenhuma nota fiscal pendente.</p>
        ) : (
          <ul className="divide-y divide-border">
            {nfPendentes.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-heading">{nomeSalao(f.estabelecimento_id)}</p>
                  <p className="text-xs capitalize text-body">
                    {rotuloCompetencia(f.competencia)} · {formatarBRL(f.valor_centavos)} · pago em{" "}
                    {formatarInstante(f.pago_em)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={ocupado === f.id}
                  onClick={() => marcarNf(f)}
                  className={CLASSE_BOTAO}
                >
                  Marcar NF emitida
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <span className="text-sm font-semibold text-heading">Gerar faturas até</span>
        <SeletorMes valor={mesGerar} onChange={setMesGerar} rotulo="Gerar faturas até" />
        <button type="button" disabled={gerando} onClick={gerarAte} className={CLASSE_BOTAO_PRIMARIO}>
          {gerando ? "Gerando..." : "Gerar faturas"}
        </button>
      </section>

      <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="mb-3 text-sm font-semibold text-heading">Salões</h2>
        <ul className="divide-y divide-border">
          {saloes.map((s) => {
            const ass = assPorSalao.get(s.id);
            if (!ass) {
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <p className="font-medium text-heading">{s.nome}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelecionado(s.id);
                      setAviso(null);
                    }}
                    className={CLASSE_BOTAO}
                  >
                    Configurar
                  </button>
                </li>
              );
            }

            const doSalao = faturas.filter((f) => f.estabelecimento_id === s.id);
            const faturaMes = doSalao.find((f) => f.competencia === mesCorrente);
            const valorMes = faturaMes
              ? faturaMes.valor_centavos
              : valorDaCompetencia(
                  mesCorrente,
                  ass,
                  condicoes.filter((c) => c.estabelecimento_id === s.id)
                );
            const vencidas = doSalao.filter((f) => faturaVencida(f, hoje)).length;

            return (
              <li key={s.id}>
                <div
                  onClick={() => {
                    setSelecionado(s.id);
                    setAviso(null);
                  }}
                  className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 py-3 text-left text-sm transition hover:bg-surface"
                >
                  <span className="font-medium text-heading">
                    {s.nome}
                    {!ass.ativa && <span className="ml-2 text-xs text-muted">(inativa)</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-xs text-body">
                    <span>{formatarBRL(valorMes)}/mês</span>
                    {faturaMes ? (
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 ${classeBadge(faturaMes, hoje)}`}
                      >
                        {faturaVencida(faturaMes, hoje) ? "Vencida" : ROTULO_STATUS[faturaMes.status]}
                      </span>
                    ) : (
                      <span className="text-muted">Sem fatura no mês</span>
                    )}
                    <span className={vencidas ? "font-semibold text-red-700" : ""}>
                      {vencidas} vencida{vencidas === 1 ? "" : "s"}
                    </span>
                    <button type="button" className={CLASSE_BOTAO}>
                      Configurar
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
