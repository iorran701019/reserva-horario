import { randomInt } from "node:crypto";
import { validarSenha } from "./credenciaisDona.js";

// Senha provisória do reset de acesso da dona (módulo puro, só node:crypto).
// Sem caracteres ambíguos (0 O 1 l I) para ser digitada sem erro; garante uma
// maiúscula, uma minúscula, um número e um símbolo, e passa em validarSenha.
const MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MINUSCULAS = "abcdefghijkmnopqrstuvwxyz";
const NUMEROS = "23456789";
const SIMBOLOS = "!@#$%&*?";
const TODOS = MAIUSCULAS + MINUSCULAS + NUMEROS + SIMBOLOS;
const TAMANHO = 12;

function sortear(conjunto) {
  return conjunto[randomInt(conjunto.length)];
}

export function gerarSenhaProvisoria() {
  for (;;) {
    const chars = [sortear(MAIUSCULAS), sortear(MINUSCULAS), sortear(NUMEROS), sortear(SIMBOLOS)];
    while (chars.length < TAMANHO) chars.push(sortear(TODOS));
    // Fisher-Yates com randomInt para a posição das obrigatórias não ser fixa.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const senha = chars.join("");
    // Raríssimo (ex.: sequência repetida); sorteia de novo em vez de recusar.
    if (validarSenha(senha).ok) return senha;
  }
}
