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

  // Regra do sinal: 'desligado' | 'novos' | 'todos'. undefined = carregando.
  const [sinalRegra, setSinalRegra] = useState(undefined);
  const [sinalValor, setSinalValor] = useState("");
  const [sinalChavePix, setSinalChavePix] = useState("");
  const [erroSinal, setErroSinal] = useState("");
  const [statusSinal, setStatusSinal] = useState("");

  // Carrega os valores atuais ao abrir.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("estabelecimentos")
        .select(
          "escolha_profissional, sinal_regra, sinal_valor_centavos, sinal_chave_pix"
        )
        .eq("id", estabelecimento.id)
        .single();

      if (!ativo) return;

      if (error) {
        setErro(error.message);
        setErroSinal(error.message);
        return;
      }
      setErro("");
      setEscolhaProfissional(Boolean(data?.escolha_profissional));

      setErroSinal("");
      setSinalRegra(data?.sinal_regra ?? "desligado");
      setSinalValor(centavosParaReais(data?.sinal_valor_centavos));
      setSinalChavePix(data?.sinal_chave_pix ?? "");
    }

    carregar();
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

  const carregandoValor = escolhaProfissional === undefined;
  const carregandoSinal = sinalRegra === undefined;
  const sinalDesligado = sinalRegra === "desligado";

  return (
    <>
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
    </>
  );
}
