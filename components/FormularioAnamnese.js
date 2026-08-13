"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { lerFatia, salvarFatia, limparFatia } from "@/lib/persistenciaAgendamento";

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
//   slug              – slug do salão (rota /[salon]), chave da persistência
//                       em sessionStorage (ver lib/persistenciaAgendamento) —
//                       respostas/observacoes/aceite sobrevivem a um reload
//                       real da página. O MODELO em si nunca é restaurado do
//                       storage: é sempre recarregado do banco (ver efeito
//                       abaixo), e as respostas salvas são casadas com as
//                       perguntas do modelo ATUAL pelo TEXTO da pergunta —
//                       perguntas que não existem mais nele têm a resposta
//                       salva descartada silenciosamente.
//   estabelecimentoId – filtra o modelo ativo e vai no insert de resposta.
//   clienteId         – dono da resposta (uuid de `clientes.id`).
//   onConcluido       – chamado após o insert (ou de cara, se não há modelo
//                       ativo) pra o consumidor seguir pro FormularioAgendamento.
//   onVisivel         – opcional; chamado UMA vez, assim que `modelo` resolve
//                       pra um objeto real (formulário de verdade prestes a
//                       renderizar) — nunca chamado no caminho "sem modelo
//                       ativo" (ver efeito de onConcluido acima, que nesse
//                       caso conclui sozinho sem o usuário ver nada). Permite
//                       o consumidor (app/[salon]/page.js) só armar o voltar
//                       físico depois que a tela é realmente mostrada, e não
//                       nesse flash-through de "modelo === null".
//   modoAdmin         – uso pelo /admin (GerenciarClientes, seção Anamnese
//                       do detalhe do cliente): pré-carrega o formulário com
//                       a resposta mais recente do cliente (se houver, pra
//                       dona corrigir/completar em vez de partir em branco)
//                       e NUNCA lê/grava em sessionStorage (a persistência
//                       de rascunho é só do wizard público, por `slug` —
//                       nada a ver com a dona editando pelo /admin). Salvar
//                       segue gravando um INSERT novo, igual ao fluxo
//                       público (renova a validade de 12 meses, preserva o
//                       histórico de respostas anteriores).
export default function FormularioAnamnese({
  slug,
  estabelecimentoId,
  clienteId,
  onConcluido,
  onVisivel,
  modoAdmin = false,
}) {
  // undefined = carregando; null = nenhum modelo ativo encontrado; objeto = ok.
  const [modelo, setModelo] = useState(undefined);
  const [respostas, setRespostas] = useState(
    () => (modoAdmin ? {} : lerFatia(slug, "anamnese")?.respostas ?? {})
  );
  const [observacoes, setObservacoes] = useState(
    () => (modoAdmin ? {} : lerFatia(slug, "anamnese")?.observacoes ?? {})
  );
  const [aceite, setAceite] = useState(
    () => (modoAdmin ? false : lerFatia(slug, "anamnese")?.aceite ?? false)
  );
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

  // Modelo real carregado: a tela está de fato prestes a aparecer pro
  // cliente (ver comentário de `onVisivel` acima).
  useEffect(() => {
    if (modelo) onVisivel?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo]);

  // modoAdmin: pré-carrega a resposta MAIS RECENTE do cliente (se houver),
  // pra dona corrigir/completar em vez de partir em branco (ver comentário
  // de `modoAdmin` acima). Roda uma vez só — não some ao trocar seção/aba de
  // pergunta, já que respostas/observacoes/aceite não estão nas deps.
  useEffect(() => {
    if (!modoAdmin || !clienteId || !estabelecimentoId) return;
    let ativo = true;

    (async () => {
      const { data } = await supabase
        .from("anamnese_respostas")
        .select("respostas, observacoes, termos_aceitos")
        .eq("cliente_id", clienteId)
        .eq("estabelecimento_id", estabelecimentoId)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!ativo || !data) return;
      setRespostas(data.respostas ?? {});
      setObservacoes(data.observacoes ?? {});
      setAceite(Boolean(data.termos_aceitos));
    })();

    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoAdmin, clienteId, estabelecimentoId]);

  // Grava a fatia "anamnese" a cada mudança relevante, pra sobreviver a um
  // reload real da página (ver lib/persistenciaAgendamento). Limpa ao
  // submeter com sucesso (ver handleSubmit). Só grava com um modelo REAL
  // carregado — sem isso, todo estabelecimento sem anamnese ativa deixaria
  // um retalho vazio no storage a cada visita (o suficiente pra confundir a
  // heurística de modoNovoAgendamento em app/[salon]/page.js). Nunca roda em
  // modoAdmin (ver comentário de `modoAdmin` acima) — a dona editando pelo
  // /admin não deve tocar no rascunho por slug do fluxo público.
  useEffect(() => {
    if (modoAdmin || !slug || !modelo) return;
    salvarFatia(slug, "anamnese", { respostas, observacoes, aceite });
  }, [modoAdmin, slug, modelo, respostas, observacoes, aceite]);

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

    // Restauração de sessão pode ter trazido respostas/observacoes de um
    // modelo antigo (ver `slug` acima) — descarta em silêncio, na hora de
    // gravar, qualquer entrada cuja pergunta/seção não existe mais no modelo
    // ATUAL. respostas/observacoes são keyed pelo TEXTO da pergunta/título da
    // seção (ver responder/anotarObservacao), então a comparação é direta.
    const secoesValidas = new Set((modelo.secoes ?? []).map((secao) => secao.titulo));
    const respostasValidas = Object.fromEntries(
      Object.entries(respostas).filter(([pergunta]) => todasPerguntas.includes(pergunta))
    );
    const observacoesValidas = Object.fromEntries(
      Object.entries(observacoes).filter(([secao]) => secoesValidas.has(secao))
    );

    const { error } = await supabase.from("anamnese_respostas").insert({
      cliente_id: clienteId,
      estabelecimento_id: estabelecimentoId,
      modelo_id: modelo.id,
      respostas: respostasValidas,
      observacoes: observacoesValidas,
      termos_aceitos: aceite,
    });

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    if (!modoAdmin) limparFatia(slug, "anamnese");
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
