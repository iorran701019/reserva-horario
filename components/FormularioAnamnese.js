"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Roda depois do CadastroCliente no fluxo público — ou no lugar dele, quando
// o cliente já existe mas a anamnese está vencida (ver lib/anamnese.js) —
// SEMPRE antes do FormularioAgendamento. Busca o modelo ATIVO do
// estabelecimento em `anamnese_modelos` e renderiza as seções dele.
//
// Formato assumido de `anamnese_modelos` (tabela nova, sem convenção prévia
// no código — ajuste aqui se o formato real divergir):
//   secoes:       [{ titulo: string, perguntas: string[] }, ...]
//   declaracoes:  [string, ...]
//
// Sem modelo ativo cadastrado pro estabelecimento, não há o que preencher:
// avisa `onConcluido` direto, sem travar o cliente no meio do fluxo.
//
// Props:
//   estabelecimentoId – filtra o modelo ativo e vai no insert de resposta.
//   clienteId         – dono da resposta (uuid de `clientes.id`).
//   onConcluido       – chamado após o insert (ou de cara, se não há modelo
//                       ativo) pra o consumidor seguir pro FormularioAgendamento.
export default function FormularioAnamnese({
  estabelecimentoId,
  clienteId,
  onConcluido,
}) {
  // undefined = carregando; null = nenhum modelo ativo encontrado; objeto = ok.
  const [modelo, setModelo] = useState(undefined);
  const [respostas, setRespostas] = useState({});
  const [observacoes, setObservacoes] = useState({});
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      console.log("estabelecimentoId:", estabelecimentoId, typeof estabelecimentoId);
      const { data, error } = await supabase
        .from("anamnese_modelos")
        .select("id, titulo, secoes, declaracoes")
        .eq("estabelecimento_id", estabelecimentoId)
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();

      if (!ativo) return;
      setModelo(error || !data ? null : data);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimentoId]);

  // Nenhum modelo ativo: não há anamnese a preencher, segue o fluxo.
  useEffect(() => {
    if (modelo === null) onConcluido?.();
  }, [modelo, onConcluido]);

  function responder(pergunta, valor) {
    setRespostas((anterior) => ({ ...anterior, [pergunta]: valor }));
  }

  function anotarObservacao(tituloSecao, texto) {
    setObservacoes((anterior) => ({ ...anterior, [tituloSecao]: texto }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");

    const todasPerguntas = (modelo.secoes ?? []).flatMap(
      (secao) => secao.perguntas ?? []
    );
    const faltaResponder = todasPerguntas.some(
      (pergunta) => respostas[pergunta] !== "sim" && respostas[pergunta] !== "nao"
    );
    if (faltaResponder) {
      setErro("Responda todas as perguntas para continuar.");
      return;
    }

    const declaracoes = modelo.declaracoes ?? [];
    if (declaracoes.length > 0 && !aceite) {
      setErro("É preciso concordar com os termos para continuar.");
      return;
    }

    setEnviando(true);

    const { error } = await supabase.from("anamnese_respostas").insert({
      cliente_id: clienteId,
      estabelecimento_id: estabelecimentoId,
      modelo_id: modelo.id,
      respostas,
      observacoes,
      termos_aceitos: aceite,
    });

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    onConcluido?.();
  }

  if (modelo === undefined) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border">
        <p className="text-sm text-body">Carregando anamnese...</p>
      </div>
    );
  }

  // modelo === null: o efeito acima já chamou onConcluido; nada pra renderizar.
  if (!modelo) return null;

  const declaracoes = modelo.declaracoes ?? [];

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border"
    >
      {modelo.titulo && (
        <h2 className="text-lg font-semibold text-heading">{modelo.titulo}</h2>
      )}

      {(modelo.secoes ?? []).map((secao, si) => (
        <div
          key={si}
          className="space-y-3 rounded-xl bg-surface p-4 ring-1 ring-border"
        >
          <h3 className="font-medium text-heading">{secao.titulo}</h3>

          <div className="space-y-3">
            {(secao.perguntas ?? []).map((pergunta, pi) => (
              <div
                key={pi}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-sm text-body">{pergunta}</span>
                <div className="flex shrink-0 gap-3">
                  <label className="flex items-center gap-1 text-sm text-body">
                    <input
                      type="radio"
                      name={`pergunta-${si}-${pi}`}
                      checked={respostas[pergunta] === "sim"}
                      onChange={() => responder(pergunta, "sim")}
                    />
                    Sim
                  </label>
                  <label className="flex items-center gap-1 text-sm text-body">
                    <input
                      type="radio"
                      name={`pergunta-${si}-${pi}`}
                      checked={respostas[pergunta] === "nao"}
                      onChange={() => responder(pergunta, "nao")}
                    />
                    Não
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label
              htmlFor={`obs-${si}`}
              className="mb-1 block text-xs font-medium text-muted"
            >
              Observações
            </label>
            <textarea
              id={`obs-${si}`}
              value={observacoes[secao.titulo] ?? ""}
              onChange={(e) => anotarObservacao(secao.titulo, e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>
        </div>
      ))}

      {declaracoes.length > 0 && (
        <div className="space-y-3 rounded-xl bg-surface p-4 ring-1 ring-border">
          <ul className="list-disc space-y-1 pl-5 text-sm text-body">
            {declaracoes.map((declaracao, di) => (
              <li key={di}>{declaracao}</li>
            ))}
          </ul>

          <label className="flex items-start gap-2 text-sm text-body">
            <input
              type="checkbox"
              checked={aceite}
              onChange={(e) => setAceite(e.target.checked)}
              className="mt-1"
            />
            Li e concordo com os termos acima
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {enviando ? "Enviando..." : "Continuar"}
      </button>

      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}
    </form>
  );
}
