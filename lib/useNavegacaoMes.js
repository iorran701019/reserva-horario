"use client";

import { useState } from "react";
import { chaveMes, mesDeHoje, rotuloMes } from "@/lib/mes";

// Agrupa `itens` (cada um com `.data` "YYYY-MM-DD") por mês de calendário e
// expõe a navegação mensal — mesmo princípio de lib/useNavegacaoTrimestre.js
// (Histórico), só que por mês: abre no mês corrente; "anterior"/"próximo"
// pulam direto pro mês vizinho que tem pelo menos um item (nunca pra um mês
// vazio); "voltar para o atual" pula de volta em um clique.
//
// Também expõe `mesSelecionado` (a chave crua, não só `itensDoMes`) — quem
// precisa navegar MAIS DE UMA lista com a mesma seleção de mês (caso da aba
// Ausências: períodos de um dia, vários dias e grupos avulsos são listas
// separadas) filtra cada lista por fora comparando com essa chave, em vez de
// depender de `itensDoMes` (que só serve pra uma lista única).
export function useNavegacaoMes(itens) {
  const [mesSelecionado, setMesSelecionado] = useState(() => mesDeHoje());

  const porMes = new Map();
  for (const item of itens) {
    const chave = chaveMes(item.data);
    if (!porMes.has(chave)) porMes.set(chave, []);
    porMes.get(chave).push(item);
  }

  const chavesComDados = [...porMes.keys()].sort();
  const chaveAnterior = [...chavesComDados].reverse().find((c) => c < mesSelecionado);
  const chaveSeguinte = chavesComDados.find((c) => c > mesSelecionado);
  const atual = mesDeHoje();

  return {
    mesSelecionado,
    rotulo: rotuloMes(mesSelecionado),
    itensDoMes: porMes.get(mesSelecionado) ?? [],
    temAnterior: chaveAnterior !== undefined,
    temProximo: chaveSeguinte !== undefined,
    noAtual: mesSelecionado === atual,
    irParaAnterior: () => {
      if (chaveAnterior !== undefined) setMesSelecionado(chaveAnterior);
    },
    irParaProximo: () => {
      if (chaveSeguinte !== undefined) setMesSelecionado(chaveSeguinte);
    },
    voltarParaAtual: () => setMesSelecionado(atual),
  };
}
