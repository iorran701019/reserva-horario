"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { situacaoAssinatura } from "@/lib/assinatura";
import { linkWhatsApp, msgComprovanteAssinatura } from "@/lib/whatsapp";
import { CHAVE_PIX_ACOLHE, TITULAR_PIX_ACOLHE, WHATSAPP_ACOLHE } from "@/lib/plataforma";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import {
  competenciaAtual,
  faturaRecusada,
  formatarBRL,
  formatarData,
  formatarInstante,
  hojeStr,
  rotuloCompetencia,
} from "../../painel-global/financeiro/util";

// Aba "Assinatura" do /admin: a dona vê as faturas da assinatura Acolhe do
// próprio salão e avisa que pagou (Pix manual + comprovante pelo WhatsApp). Quem
// confirma é o painel global. Erros são LOCAIS (nunca setErro da página, que
// desmonta a aba).

const CLASSE_CARTAO = "rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border";
const CLASSE_BOTAO_PRIMARIO =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";
const CLASSE_BOTAO =
  "rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-heading ring-1 ring-border transition hover:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60";

// Máximo de faturas futuras listadas em "Próximas faturas".
const MAX_PROXIMAS_FATURAS = 6;

const maiuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

// 11 dígitos = CPF: 041.748.327-90. Qualquer outro formato aparece como veio.
function formatarChavePix(chave) {
  const d = String(chave).replace(/\D/g, "");
  return d.length === 11
    ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    : chave;
}

// "dd/mm às HHhMM" no fuso de São Paulo.
function formatarDiaHora(iso) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return `${p.day}/${p.month} às ${p.hour}h${p.minute}`;
}

const informada = (f) => f.status === "aberta" && Boolean(f.pagamento_informado_em);
const vencida = (f, hoje) => situacaoAssinatura([f], hoje).nivel === "vencida";

// "2026-10-05" -> "05/10".
const diaMes = (data) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

function BlocoPagamento({ fatura, nomeSalao, aoInformar, erro }) {
  const [declarou, setDeclarou] = useState(false);
  const [copiada, setCopiada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const travaRef = useRef(false);

  const rotulo = maiuscula(rotuloCompetencia(fatura.competencia));
  const valor = formatarBRL(fatura.valor_centavos);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(CHAVE_PIX_ACOLHE.replace(/\D/g, ""));
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      // Clipboard indisponível: a chave já está visível pra copiar na mão.
    }
  }

  async function informar() {
    if (travaRef.current) return;
    travaRef.current = true;
    setEnviando(true);
    const ok = await aoInformar(fatura);
    // Em sucesso a fatura sai deste bloco (remonta); em falha libera pra nova tentativa.
    if (!ok) {
      travaRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className={`${CLASSE_CARTAO} space-y-3`}>
      {faturaRecusada(fatura) && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          <p className="font-semibold">Seu pagamento de {rotulo} não foi confirmado.</p>
          {fatura.pagamento_recusa_motivo && <p>{fatura.pagamento_recusa_motivo}</p>}
          <p>Faça o pagamento e envie o comprovante novamente.</p>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold text-heading">Pagamento de {rotulo}</h3>
        <p className="mt-1 text-sm text-body">
          {valor} · vence em {formatarData(fatura.vencimento)}
        </p>
      </div>

      <div className="rounded-lg bg-surface px-3 py-2 ring-1 ring-border">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-heading">
            {formatarChavePix(CHAVE_PIX_ACOLHE)}
          </span>
          <button
            type="button"
            onClick={copiar}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition hover:bg-primary-hover"
          >
            {copiada ? "Copiada" : "Copiar"}
          </button>
        </div>
        <p className="mt-1 text-sm text-body">{TITULAR_PIX_ACOLHE}</p>
        <p className="text-xs text-muted">Conta de recebimento da Acolhe</p>
      </div>

      <a
        href={linkWhatsApp(
          WHATSAPP_ACOLHE,
          msgComprovanteAssinatura({ nomeSalao, competencia: rotulo, valor })
        )}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:bg-primary-hover"
      >
        <IconeWhatsApp className="h-4 w-4" />
        Enviar comprovante pelo WhatsApp
      </a>

      <label className="flex items-start gap-2 text-sm text-body">
        <input
          type="checkbox"
          checked={declarou}
          onChange={(e) => setDeclarou(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30"
        />
        Declaro que enviei o comprovante pelo WhatsApp
      </label>

      <button
        type="button"
        disabled={!declarou || enviando}
        onClick={informar}
        className={CLASSE_BOTAO_PRIMARIO}
      >
        {enviando ? "Enviando..." : "Informar pagamento"}
      </button>

      {erro && (
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      )}
    </section>
  );
}

export default function AbaAssinatura({ estabelecimento }) {
  const estabId = estabelecimento?.id;
  const [faturas, setFaturas] = useState(null);
  const [erroCarga, setErroCarga] = useState("");
  const [erroPagamento, setErroPagamento] = useState("");
  const [escolhidaId, setEscolhidaId] = useState(null);

  const buscar = useCallback(async () => {
    const { data, error } = await supabase
      .from("assinatura_faturas")
      .select("*")
      .eq("estabelecimento_id", estabId)
      .neq("status", "cancelada")
      .order("competencia", { ascending: false });
    return { data, error };
  }, [estabId]);

  const aplicar = useCallback(({ data, error }) => {
    if (error) {
      setErroCarga(error.message);
      return;
    }
    setErroCarga("");
    setFaturas(data);
  }, []);

  useEffect(() => {
    if (!estabId) return;
    let ativo = true;
    (async () => {
      const resultado = await buscar();
      if (ativo) aplicar(resultado);
    })();
    return () => {
      ativo = false;
    };
  }, [estabId, buscar, aplicar]);

  // Devolve true se a RPC deu certo (o bloco usa pra liberar o botão em falha).
  async function informarPagamento(fatura) {
    setErroPagamento("");
    const { error } = await supabase.rpc("assinatura_informar_pagamento", {
      p_fatura_id: fatura.id,
    });
    if (error) {
      setErroPagamento(`Não foi possível informar o pagamento: ${mensagemFalhaSalvar(error)}`);
      return false;
    }
    setEscolhidaId(null);
    aplicar(await buscar());
    return true;
  }

  if (erroCarga) {
    return (
      <p className="rounded-lg bg-surface px-3 py-2 text-sm text-red-700 ring-1 ring-border">
        Erro ao carregar a assinatura: {erroCarga}
      </p>
    );
  }
  if (faturas === null) {
    return <p className="mt-6 text-center text-sm text-body">Carregando...</p>;
  }

  const hoje = hojeStr();
  const mesCorrente = competenciaAtual();
  const situacao = situacaoAssinatura(faturas, hoje);
  const faturaMes = faturas.find((f) => f.competencia === mesCorrente);

  // O bloco principal é SEMPRE a aberta mais antiga: informada = protocolo
  // fixo (nunca avança sozinho); senão = bloco de pagamento. Outra fatura só
  // vira bloco de pagamento quando a dona escolhe "Pagar adiantado".
  const abertas = faturas
    .filter((f) => f.status === "aberta")
    .sort((a, b) => (a.competencia < b.competencia ? -1 : 1));
  const maisAntiga = abertas[0] ?? null;
  const proximas = abertas
    .filter(
      (f) =>
        f.id !== maisAntiga?.id && !f.pagamento_informado_em && f.competencia > mesCorrente
    )
    .slice(0, MAX_PROXIMAS_FATURAS); // `abertas` já vem por competência crescente
  // Histórico: até o mês corrente + futuras já pagas ou informadas (adiantadas).
  // Aberta futura não informada nunca entra. `faturas` vem decrescente da query.
  const historico = faturas.filter(
    (f) =>
      f.competencia <= mesCorrente || f.status === "paga" || Boolean(f.pagamento_informado_em)
  );
  const escolhida = proximas.find((f) => f.id === escolhidaId) ?? null;
  const faturaBloco = escolhida ?? (maisAntiga && !maisAntiga.pagamento_informado_em ? maisAntiga : null);

  function destaqueMes() {
    if (!faturaMes) return { texto: "Sem fatura neste mês", detalhe: null };
    if (faturaMes.status === "paga") return { texto: "Pagamento do mês efetuado", detalhe: null };
    if (faturaMes.status === "isenta") return { texto: "Mês isento", detalhe: null };
    if (informada(faturaMes)) return { texto: "Aguardando confirmação", detalhe: null };
    return {
      texto: formatarBRL(faturaMes.valor_centavos),
      detalhe: `Vence em ${formatarData(faturaMes.vencimento)}`,
      vencida: vencida(faturaMes, hoje),
    };
  }
  const destaque = destaqueMes();

  function badge(f) {
    if (f.status === "paga") return `Paga${f.pago_em ? ` (${formatarInstante(f.pago_em)})` : ""}`;
    if (f.status === "isenta") return "Isenta";
    if (informada(f)) return "Aguardando confirmação";
    if (faturaRecusada(f)) return "Recusado";
    return vencida(f, hoje) ? "Vencida" : "Em aberto";
  }

  function classeBadge(f) {
    if (f.status === "paga") return "bg-green-50 text-green-700 ring-green-200";
    if (f.status === "isenta") return "bg-blue-50 text-blue-700 ring-blue-200";
    if (informada(f)) return "bg-amber-50 text-amber-700 ring-amber-200";
    if (faturaRecusada(f) || vencida(f, hoje)) return "bg-red-50 text-red-700 ring-red-200";
    return "bg-surface text-body ring-border";
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div
        role="status"
        className={`rounded-2xl px-4 py-3 text-sm font-medium ring-1 ${
          situacao.nivel === "vencida"
            ? "bg-red-50 text-red-700 ring-red-200"
            : situacao.nivel === "proxima"
              ? "bg-amber-50 text-amber-700 ring-amber-200"
              : "bg-green-50 text-green-700 ring-green-200"
        }`}
      >
        {situacao.nivel === "vencida"
          ? `Sua fatura de ${maiuscula(rotuloCompetencia(situacao.fatura.competencia))} está vencida desde ${diaMes(situacao.fatura.vencimento)}.`
          : situacao.nivel === "proxima"
            ? `Sua fatura de ${maiuscula(rotuloCompetencia(situacao.fatura.competencia))} vence em ${diaMes(situacao.fatura.vencimento)}.`
            : "Você está em dia com a assinatura."}
      </div>

      <section className={CLASSE_CARTAO}>
        <p className="text-xs font-semibold uppercase text-muted">
          {maiuscula(rotuloCompetencia(mesCorrente))}
        </p>
        <p className={`mt-1 text-xl font-bold ${destaque.vencida ? "text-red-700" : "text-heading"}`}>
          {destaque.texto}
        </p>
        {destaque.detalhe && (
          <p className={`text-sm ${destaque.vencida ? "font-semibold text-red-700" : "text-body"}`}>
            {destaque.vencida ? `Vencida · venceu em ${formatarData(faturaMes.vencimento)}` : destaque.detalhe}
          </p>
        )}
      </section>

      {maisAntiga && informada(maisAntiga) && (
        <section className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
          Pagamento de {maiuscula(rotuloCompetencia(maisAntiga.competencia))} informado em{" "}
          {formatarDiaHora(maisAntiga.pagamento_informado_em)}. Aguardando confirmação.
        </section>
      )}

      {faturaBloco && (
        <BlocoPagamento
          key={faturaBloco.id}
          fatura={faturaBloco}
          nomeSalao={estabelecimento.nome}
          aoInformar={informarPagamento}
          erro={erroPagamento}
        />
      )}

      {proximas.length > 0 && (
        <section className={CLASSE_CARTAO}>
          <h3 className="mb-2 text-sm font-semibold text-heading">Próximas faturas</h3>
          <ul className="max-h-[17.5rem] divide-y divide-border overflow-y-auto pr-1">
            {proximas.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-heading">
                    {maiuscula(rotuloCompetencia(f.competencia))} · {formatarBRL(f.valor_centavos)}
                  </p>
                  <p className="text-xs text-body">Vence em {formatarData(f.vencimento)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setErroPagamento("");
                    setEscolhidaId(f.id);
                  }}
                  className={CLASSE_BOTAO}
                >
                  {escolhidaId === f.id ? "Selecionada" : "Pagar adiantado"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={CLASSE_CARTAO}>
        <h3 className="mb-2 text-sm font-semibold text-heading">Histórico</h3>
        {historico.length === 0 ? (
          <p className="text-sm text-body">Nenhuma fatura ainda.</p>
        ) : (
          <ul className="max-h-[17.5rem] divide-y divide-border overflow-y-auto pr-1">
            {historico.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <p className="font-medium text-heading">
                  {maiuscula(rotuloCompetencia(f.competencia))} · {formatarBRL(f.valor_centavos)}
                </p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${classeBadge(f)}`}
                >
                  {badge(f)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
