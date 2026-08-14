"use client";

import { useState } from "react";
import { chaveTrimestre, trimestreDeHoje, rotuloTrimestre } from "@/lib/trimestre";

// Agrupa `itens` (cada um com `.data` "YYYY-MM-DD", já na ordem de exibição
// desejada dentro do grupo — ver lib/particao ordenarHistoricoPorStatus) por
// trimestre de calendário e expõe a navegação usada pelas duas telas de
// Histórico (admin geral e ficha do cliente, ver components/NavegacaoTrimestre):
// abre no trimestre corrente; "anterior"/"próximo" pulam direto pro trimestre
// vizinho que tem pelo menos um item (nunca pra um vazio, nunca criam
// categoria adiantada); "voltar para o atual" pula de volta em um clique.
export function useNavegacaoTrimestre(itens) {
  const [trimestreSelecionado, setTrimestreSelecionado] = useState(() => trimestreDeHoje());

  const porTrimestre = new Map();
  for (const item of itens) {
    const chave = chaveTrimestre(item.data);
    if (!porTrimestre.has(chave)) porTrimestre.set(chave, []);
    porTrimestre.get(chave).push(item);
  }

  const chavesComDados = [...porTrimestre.keys()].sort();
  const chaveAnterior = [...chavesComDados].reverse().find((c) => c < trimestreSelecionado);
  const chaveSeguinte = chavesComDados.find((c) => c > trimestreSelecionado);
  const atual = trimestreDeHoje();

  return {
    rotulo: rotuloTrimestre(trimestreSelecionado),
    itensDoTrimestre: porTrimestre.get(trimestreSelecionado) ?? [],
    temAnterior: chaveAnterior !== undefined,
    temProximo: chaveSeguinte !== undefined,
    noAtual: trimestreSelecionado === atual,
    irParaAnterior: () => {
      if (chaveAnterior !== undefined) setTrimestreSelecionado(chaveAnterior);
    },
    irParaProximo: () => {
      if (chaveSeguinte !== undefined) setTrimestreSelecionado(chaveSeguinte);
    },
    voltarParaAtual: () => setTrimestreSelecionado(atual),
  };
}
