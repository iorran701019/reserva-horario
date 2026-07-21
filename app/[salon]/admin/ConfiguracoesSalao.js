"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Configurações do salão (tabela `estabelecimentos`) editáveis pelo dono direto
// no admin:
//   escolha_profissional (boolean) – se o cliente pode escolher o profissional
//   ao agendar. O efeito real no fluxo de agendamento/disponibilidade vem numa
//   fatia seguinte; AQUI é só persistir a preferência.
//   sinal_regra/sinal_valor_centavos/sinal_chave_pix – regra do sinal de
//   reserva exigido no FormularioAgendamento (ver precisaSinal lá).
//
// O objeto `estabelecimento` (prop) traz só { id, nome, whatsapp, slug, ... },
// então o valor atual de cada campo é lido do banco ao montar. O update
// filtra por id e depende da RLS existente (só dono/global edita o próprio
// salão) — se o banco recusar, o campo reverte e mostra o erro.

// Reais digitado ("35" ou "35,50") -> centavos inteiros. 0 quando vazio ou
// não numérico — mesmo padrão de reaisParaCentavos do GerenciarServicos.
function reaisParaCentavos(reais) {
  if (!reais) return 0;
  const numero = Number(String(reais).replace(",", "."));
  return Number.isNaN(numero) ? 0 : Math.round(numero * 100);
}

// centavos -> string em reais pro input ("3550" -> "35.50"; null/0 -> "").
function centavosParaReais(centavos) {
  if (!centavos) return "";
  return (centavos / 100).toFixed(2);
}

export default function ConfiguracoesSalao({ estabelecimento }) {
  // Valor do toggle. undefined = ainda carregando o estado atual do banco.
  const [escolhaProfissional, setEscolhaProfissional] = useState(undefined);
  const [erro, setErro] = useState("");
  // Feedback de gravação: "" | "salvando" | "salvo".
  const [status, setStatus] = useState("");

  // Contagem de profissionais ATIVOS do salão, recontada a cada carga (nunca
  // hardcoded) — com 1 só, o cliente não tem outro pra escolher de qualquer
  // forma, então o toggle não faz sentido nessa tela. null = ainda carregando
  // (mantém o toggle oculto até saber o número de verdade, pra não piscar).
  const [qtdProfissionaisAtivos, setQtdProfissionaisAtivos] = useState(null);

  // Regra do sinal: 'desligado' | 'novos' | 'todos'. undefined = carregando.
  const [sinalRegra, setSinalRegra] = useState(undefined);
  const [sinalValor, setSinalValor] = useState("");
  const [sinalChavePix, setSinalChavePix] = useState("");
  const [erroSinal, setErroSinal] = useState("");
  const [statusSinal, setStatusSinal] = useState("");

  // Dias pra manter a manutenção vencida em destaque. String vazia = nunca
  // caduca (grava null). undefined = ainda carregando o estado atual do banco.
  const [caducidadeDias, setCaducidadeDias] = useState(undefined);
  const [erroCaducidade, setErroCaducidade] = useState("");
  const [statusCaducidade, setStatusCaducidade] = useState("");

  // Cobrar o valor cheio do serviço de origem quando a manutenção é feita
  // depois do prazo (ver lib/manutencaoSugerida.js -> calcularPrecoManutencao,
  // usado pelo wizard de agendamento). undefined = ainda carregando.
  const [valorCheioAposPrazo, setValorCheioAposPrazo] = useState(undefined);
  const [erroValorCheio, setErroValorCheio] = useState("");
  const [statusValorCheio, setStatusValorCheio] = useState("");

  // Horas até uma reserva provisória (pendente/aguardando_sinal, criada
  // antecipadamente pelo wizard público — ver FormularioAgendamento) parar de
  // bloquear disponibilidade (ver lib/disponibilidade.js ->
  // calcularVagasPorHorario). String pro input; undefined = ainda carregando.
  const [reservaExpiraHoras, setReservaExpiraHoras] = useState(undefined);
  const [erroReservaExpira, setErroReservaExpira] = useState("");
  const [statusReservaExpira, setStatusReservaExpira] = useState("");

  // Carrega os valores atuais ao abrir.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("estabelecimentos")
        .select(
          "escolha_profissional, sinal_regra, sinal_valor_centavos, sinal_chave_pix, manutencao_caducidade_dias, manutencao_valor_cheio_apos_prazo, reserva_provisoria_expira_horas"
        )
        .eq("id", estabelecimento.id)
        .single();

      if (!ativo) return;

      if (error) {
        setErro(error.message);
        setErroSinal(error.message);
        setErroCaducidade(error.message);
        setErroValorCheio(error.message);
        setErroReservaExpira(error.message);
        return;
      }
      setErro("");
      setEscolhaProfissional(Boolean(data?.escolha_profissional));

      setErroSinal("");
      setSinalRegra(data?.sinal_regra ?? "desligado");
      setSinalValor(centavosParaReais(data?.sinal_valor_centavos));
      setSinalChavePix(data?.sinal_chave_pix ?? "");

      setErroCaducidade("");
      setCaducidadeDias(
        data?.manutencao_caducidade_dias == null
          ? ""
          : String(data.manutencao_caducidade_dias)
      );

      setErroValorCheio("");
      setValorCheioAposPrazo(Boolean(data?.manutencao_valor_cheio_apos_prazo));

      setErroReservaExpira("");
      setReservaExpiraHoras(
        data?.reserva_provisoria_expira_horas == null
          ? ""
          : String(data.reserva_provisoria_expira_horas)
      );
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Conta os profissionais ATIVOS do salão (pra decidir se o toggle acima
  // aparece). Separado do carregar() de cima pra não acoplar as duas queries.
  useEffect(() => {
    let ativo = true;

    async function contar() {
      const { count, error } = await supabase
        .from("profissionais")
        .select("id", { count: "exact", head: true })
        .eq("estabelecimento_id", estabelecimento.id)
        .eq("ativo", true);

      if (!ativo) return;
      if (!error) setQtdProfissionaisAtivos(count ?? 0);
    }

    contar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // "Salvo ✓" some sozinho depois de um instante, pra não ficar preso na tela.
  useEffect(() => {
    if (status !== "salvo") return;
    const t = setTimeout(() => setStatus(""), 2500);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (statusSinal !== "salvo") return;
    const t = setTimeout(() => setStatusSinal(""), 2500);
    return () => clearTimeout(t);
  }, [statusSinal]);

  useEffect(() => {
    if (statusCaducidade !== "salvo") return;
    const t = setTimeout(() => setStatusCaducidade(""), 2500);
    return () => clearTimeout(t);
  }, [statusCaducidade]);

  useEffect(() => {
    if (statusValorCheio !== "salvo") return;
    const t = setTimeout(() => setStatusValorCheio(""), 2500);
    return () => clearTimeout(t);
  }, [statusValorCheio]);

  useEffect(() => {
    if (statusReservaExpira !== "salvo") return;
    const t = setTimeout(() => setStatusReservaExpira(""), 2500);
    return () => clearTimeout(t);
  }, [statusReservaExpira]);

  // Alterna e grava na hora. Otimista: reflete o novo valor imediatamente e, se
  // o banco recusar (ex.: RLS), reverte e mostra o erro.
  async function alternar() {
    const novo = !escolhaProfissional;
    setEscolhaProfissional(novo);
    setStatus("salvando");
    setErro("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ escolha_profissional: novo })
      .eq("id", estabelecimento.id);

    if (error) {
      setEscolhaProfissional(!novo);
      setStatus("");
      setErro(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatus("salvo");
  }

  // Grava os 3 campos do sinal juntos (mesma linha). `patch` sobrepõe o state
  // atual pra casos em que o campo que disparou o save ainda não commitou no
  // state (ex.: o próprio onChange da regra).
  async function salvarSinal(patch = {}) {
    const regra = patch.sinalRegra ?? sinalRegra;
    const valor = patch.sinalValor ?? sinalValor;
    const chavePix = patch.sinalChavePix ?? sinalChavePix;

    setStatusSinal("salvando");
    setErroSinal("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({
        sinal_regra: regra,
        sinal_valor_centavos: reaisParaCentavos(valor),
        sinal_chave_pix: chavePix || null,
      })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusSinal("");
      setErroSinal(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusSinal("salvo");
  }

  function handleSinalRegraChange(e) {
    const nova = e.target.value;
    setSinalRegra(nova);
    salvarSinal({ sinalRegra: nova });
  }

  // Vazio grava null (nunca caduca); caso contrário grava o inteiro digitado.
  async function salvarCaducidade() {
    const dias = caducidadeDias === "" ? null : parseInt(caducidadeDias, 10);

    setStatusCaducidade("salvando");
    setErroCaducidade("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ manutencao_caducidade_dias: dias })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusCaducidade("");
      setErroCaducidade(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusCaducidade("salvo");
  }

  // Alterna e grava na hora, mesmo padrão otimista de `alternar` acima.
  async function alternarValorCheioAposPrazo() {
    const novo = !valorCheioAposPrazo;
    setValorCheioAposPrazo(novo);
    setStatusValorCheio("salvando");
    setErroValorCheio("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ manutencao_valor_cheio_apos_prazo: novo })
      .eq("id", estabelecimento.id);

    if (error) {
      setValorCheioAposPrazo(!novo);
      setStatusValorCheio("");
      setErroValorCheio(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusValorCheio("salvo");
  }

  // Exige um inteiro > 0 (não faz sentido "nunca expira" aqui — a coluna já
  // nasce com default 48 no banco). Valor inválido/vazio reverte pro último
  // válido carregado, sem gravar.
  async function salvarReservaExpira() {
    const horas = parseInt(reservaExpiraHoras, 10);

    if (!Number.isInteger(horas) || horas <= 0) {
      setErroReservaExpira("Informe um número de horas maior que 0.");
      return;
    }

    setStatusReservaExpira("salvando");
    setErroReservaExpira("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ reserva_provisoria_expira_horas: horas })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusReservaExpira("");
      setErroReservaExpira(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setReservaExpiraHoras(String(horas));
    setStatusReservaExpira("salvo");
  }

  const carregandoValor = escolhaProfissional === undefined;
  const carregandoSinal = sinalRegra === undefined;
  const carregandoCaducidade = caducidadeDias === undefined;
  const carregandoValorCheio = valorCheioAposPrazo === undefined;
  const carregandoReservaExpira = reservaExpiraHoras === undefined;
  const sinalDesligado = sinalRegra === "desligado";
  // Com 1 só profissional ativo (ou enquanto a contagem ainda carrega), o
  // toggle some — não há outro profissional pro cliente escolher de qualquer
  // forma. Se o salão já tinha o valor "true" salvo de quando tinha 2+
  // profissionais, ele fica preservado no banco (não escrevemos nada aqui),
  // mas some da tela e não tem efeito prático nesse cenário. Volta a
  // aparecer normalmente assim que houver 2+ profissionais ativos de novo.
  const mostrarToggleEscolha =
    qtdProfissionaisAtivos != null && qtdProfissionaisAtivos >= 2;

  return (
    <>
    {mostrarToggleEscolha && (
    <section className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label
            htmlFor="toggle-escolha-prof"
            className="block text-sm font-medium text-heading"
          >
            Permitir que o cliente escolha o profissional ao agendar
          </label>
          <p className="mt-1 text-xs text-muted">
            Se desligado, o sistema encaixa automaticamente em um profissional
            disponível.
          </p>
        </div>

        <button
          id="toggle-escolha-prof"
          type="button"
          role="switch"
          aria-checked={Boolean(escolhaProfissional)}
          onClick={alternar}
          disabled={carregandoValor}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
            escolhaProfissional ? "bg-primary" : "bg-border"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              escolhaProfissional ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Feedback de gravação (some após "salvo"; erro persiste até o próximo OK). */}
      {status === "salvando" && (
        <p className="mt-2 text-xs text-muted">Salvando…</p>
      )}
      {status === "salvo" && !erro && (
        <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
      )}
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
    </section>
    )}

    <section className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <h3 className="text-sm font-medium text-heading">Sinal de reserva</h3>
      <p className="mt-1 text-xs text-muted">
        Exige que o cliente declare o pagamento de um sinal via Pix antes de
        confirmar o agendamento.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="sinal-regra"
            className="mb-1 block text-sm font-medium text-body"
          >
            Regra
          </label>
          <select
            id="sinal-regra"
            value={sinalRegra ?? "desligado"}
            onChange={handleSinalRegraChange}
            disabled={carregandoSinal}
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="desligado">Desligado</option>
            <option value="novos">Obrigatório para clientes novos</option>
            <option value="todos">Obrigatório para todos</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="sinal-valor"
            className="mb-1 block text-sm font-medium text-body"
          >
            Valor do sinal (R$)
          </label>
          <input
            id="sinal-valor"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={sinalValor}
            onChange={(e) => setSinalValor(e.target.value)}
            onBlur={() => salvarSinal()}
            disabled={carregandoSinal || sinalDesligado}
            placeholder="0,00"
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div>
          <label
            htmlFor="sinal-chave-pix"
            className="mb-1 block text-sm font-medium text-body"
          >
            Chave Pix
          </label>
          <input
            id="sinal-chave-pix"
            type="text"
            value={sinalChavePix}
            onChange={(e) => setSinalChavePix(e.target.value)}
            onBlur={() => salvarSinal()}
            disabled={carregandoSinal || sinalDesligado}
            placeholder="CPF, e-mail, telefone ou chave aleatória"
            className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </div>

      {statusSinal === "salvando" && (
        <p className="mt-2 text-xs text-muted">Salvando…</p>
      )}
      {statusSinal === "salvo" && !erroSinal && (
        <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
      )}
      {erroSinal && <p className="mt-2 text-xs text-red-600">{erroSinal}</p>}
    </section>

    <section className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <h3 className="text-sm font-medium text-heading">
        Tolerância após o vencimento (dias)
      </h3>

      <div className="mt-3">
        <label
          htmlFor="manutencao-caducidade-dias"
          className="mb-1 block text-sm font-medium text-body"
        >
          Depois de vencida, destacar por quantos dias? (deixe em branco para
          nunca caducar)
        </label>
        <input
          id="manutencao-caducidade-dias"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={caducidadeDias ?? ""}
          onChange={(e) => setCaducidadeDias(e.target.value)}
          onBlur={salvarCaducidade}
          disabled={carregandoCaducidade}
          placeholder="Nunca caduca"
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {statusCaducidade === "salvando" && (
        <p className="mt-2 text-xs text-muted">Salvando…</p>
      )}
      {statusCaducidade === "salvo" && !erroCaducidade && (
        <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
      )}
      {erroCaducidade && (
        <p className="mt-2 text-xs text-red-600">{erroCaducidade}</p>
      )}
    </section>

    <section className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <label className="flex items-start gap-2 text-sm text-body">
        <input
          type="checkbox"
          checked={Boolean(valorCheioAposPrazo)}
          onChange={alternarValorCheioAposPrazo}
          disabled={carregandoValorCheio}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span>
          <span className="block font-medium text-heading">
            Cobrar valor cheio do serviço quando a manutenção passar do prazo
          </span>
          <span className="mt-1 block text-xs text-muted">
            Se a última manutenção da cliente já venceu, o wizard de
            agendamento cobra o preço do serviço original em vez do preço da
            manutenção.
          </span>
        </span>
      </label>

      {statusValorCheio === "salvando" && (
        <p className="mt-2 text-xs text-muted">Salvando…</p>
      )}
      {statusValorCheio === "salvo" && !erroValorCheio && (
        <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
      )}
      {erroValorCheio && (
        <p className="mt-2 text-xs text-red-600">{erroValorCheio}</p>
      )}
    </section>

    <section className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <h3 className="text-sm font-medium text-heading">
        Expiração de reservas provisórias
      </h3>

      <div className="mt-3">
        <label
          htmlFor="reserva-expira-horas"
          className="mb-1 block text-sm font-medium text-body"
        >
          Cancelar reservas pendentes não confirmadas após quantas horas?
        </label>
        <input
          id="reserva-expira-horas"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={reservaExpiraHoras ?? ""}
          onChange={(e) => setReservaExpiraHoras(e.target.value)}
          onBlur={salvarReservaExpira}
          disabled={carregandoReservaExpira}
          placeholder="48"
          className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {statusReservaExpira === "salvando" && (
        <p className="mt-2 text-xs text-muted">Salvando…</p>
      )}
      {statusReservaExpira === "salvo" && !erroReservaExpira && (
        <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
      )}
      {erroReservaExpira && (
        <p className="mt-2 text-xs text-red-600">{erroReservaExpira}</p>
      )}
    </section>
    </>
  );
}
