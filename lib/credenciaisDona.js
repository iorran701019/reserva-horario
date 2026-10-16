// Regras da troca obrigatória de e-mail e senha da dona (módulo puro, sem
// supabase). Usado pelo formulário (components/TrocarCredenciais.js), que
// mostra o que falta em tempo real, e pela rota que decide de verdade
// (app/api/conta/trocar-credenciais), que repete a validação no servidor.

// Palavras-base óbvias, comparadas em minúsculas e sem acento. A senha é
// reduzida às letras (sem dígitos, símbolos e maiúsculas) antes da
// comparação, então "Mudar@123" e "SENHA#1" caem na mesma base que "mudar"
// e "senha".
const BASES_OBVIAS = [
  "senha",
  "mudar",
  "mudar123",
  "salao",
  "qwerty",
  "qwertyuiop",
  "asdfgh",
  "password",
  "passw",
  "admin",
  "administrador",
  "abcdef",
  "abcdefgh",
  "agenda",
  "acolhe",
  "teste",
  "bemvindo",
  "dona",
  "dono",
  "unha",
  "unhas",
];

function semAcento(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Sequência de 5 ou mais dígitos seguidos em ordem (12345, 98765) ou 5 ou mais
// caracteres iguais seguidos (aaaaa, 11111).
function temSequenciaOuRepeticao(minuscula) {
  if (/(.)\1{4,}/.test(minuscula)) return true;
  const digitos = minuscula.replace(/\D/g, "");
  const crescente = "01234567890";
  const decrescente = "09876543210";
  for (let i = 0; i + 5 <= digitos.length; i++) {
    const trecho = digitos.slice(i, i + 5);
    if (crescente.includes(trecho) || decrescente.includes(trecho)) return true;
  }
  return false;
}

export function senhaEhObvia(senha) {
  const minuscula = semAcento(String(senha ?? "")).toLowerCase();
  if (!minuscula) return false;
  const base = minuscula.replace(/[^a-z]/g, "");
  if (BASES_OBVIAS.includes(minuscula) || BASES_OBVIAS.includes(base)) return true;
  // Só dígitos/símbolos (ex.: 12345678): sem letra, cai na checagem de sequência.
  return temSequenciaOuRepeticao(minuscula);
}

// Devolve { requisitos: [{ id, rotulo, ok }], ok }. `ok` só é true quando
// TODOS os requisitos passam. "Não ser uma senha óbvia" fica falso enquanto a
// senha está vazia, para a tela não mostrar um check verde sem ter digitado.
export function validarSenha(senha) {
  const valor = String(senha ?? "");
  const requisitos = [
    { id: "tamanho", rotulo: "Pelo menos 8 caracteres", ok: valor.length >= 8 },
    { id: "maiuscula", rotulo: "Uma letra maiúscula", ok: /\p{Lu}/u.test(valor) },
    { id: "numero", rotulo: "Um número", ok: /\d/.test(valor) },
    { id: "especial", rotulo: "Um símbolo (como ! @ # $)", ok: /[^\p{L}\p{N}\s]/u.test(valor) },
    { id: "obvia", rotulo: "Nada fácil de adivinhar", ok: valor.length > 0 && !senhaEhObvia(valor) },
  ];
  return { requisitos, ok: requisitos.every((r) => r.ok) };
}

// Devolve { ok, email } com o e-mail já em minúsculas e sem espaços nas pontas.
export function validarEmail(email) {
  const limpo = String(email ?? "").trim().toLowerCase();
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo) && limpo.length <= 254;
  return { ok, email: limpo };
}
