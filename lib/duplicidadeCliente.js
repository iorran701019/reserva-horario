// Detecção de possível cadastro duplicado de cliente (aviso no card pendente do
// /admin). Funções puras, sem React nem banco: quem chama traz a lista de
// clientes do estabelecimento. Nada aqui grava ou bloqueia coisa alguma.
//
// Regra: nome normalizado igual (sem acento, minúscula, espaços colapsados;
// vazio ou com menos de 3 caracteres nunca dispara). Com 2+ palavras no nome,
// qualquer telefone dispara (inclusive DDD diferente); com 1 palavra só dispara
// se o telefone for parecido (mesmo DDD, 11 dígitos, 1 ou 2 dígitos
// diferentes). A própria cliente (mesmo id ou mesmo telefone normalizado)
// nunca conta. Os candidatos de telefone parecido vêm primeiro.

import { normalizarWhatsapp } from "@/lib/whatsappValidacao";

const TAMANHO_TELEFONE = 11;
const MAX_DIGITOS_DIFERENTES = 2;
const MIN_CARACTERES_NOME = 3;

export function normalizarNomeComparacao(nome) {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Mesma normalização de gravação (só dígitos, tira o 55 de 13 dígitos).
// Cobre também linhas legadas gravadas com máscara.
export function normalizarTelefoneComparacao(telefone) {
  return normalizarWhatsapp(telefone);
}

// Dois telefones DIFERENTES e parecidos: 11 dígitos, mesmo DDD, 1 a 2 posições
// diferentes. Telefone igual devolve false (é a mesma cliente, não duplicata).
export function telefonesParecidos(a, b) {
  const x = normalizarTelefoneComparacao(a);
  const y = normalizarTelefoneComparacao(b);
  if (x.length !== TAMANHO_TELEFONE || y.length !== TAMANHO_TELEFONE) return false;
  if (x.slice(0, 2) !== y.slice(0, 2)) return false;

  let diferentes = 0;
  for (let i = 0; i < TAMANHO_TELEFONE; i += 1) {
    if (x[i] !== y[i]) diferentes += 1;
    if (diferentes > MAX_DIGITOS_DIFERENTES) return false;
  }
  return diferentes > 0;
}

// Clientes de `clientes` ({ id, nome, whatsapp }) que podem ser a mesma pessoa
// de { id, nome, telefone }, os de telefone parecido primeiro. Lista vazia se
// não houver nenhum.
export function acharPossiveisDuplicados({ id, nome, telefone, clientes }) {
  const nomeNormalizado = normalizarNomeComparacao(nome);
  if (nomeNormalizado.length < MIN_CARACTERES_NOME) return [];

  const telefoneNormalizado = normalizarTelefoneComparacao(telefone);
  const nomeComVariasPalavras = nomeNormalizado.includes(" ");

  const parecidos = [];
  const outros = [];

  for (const outro of clientes ?? []) {
    if (id != null && outro.id === id) continue;
    if (
      telefoneNormalizado &&
      normalizarTelefoneComparacao(outro.whatsapp) === telefoneNormalizado
    ) {
      continue;
    }
    if (normalizarNomeComparacao(outro.nome) !== nomeNormalizado) continue;

    if (telefonesParecidos(telefone, outro.whatsapp)) parecidos.push(outro);
    else if (nomeComVariasPalavras) outros.push(outro);
  }

  return [...parecidos, ...outros];
}
