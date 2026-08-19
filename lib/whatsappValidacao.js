// Validação de formato de números de WhatsApp (celular brasileiro: DDD de 2
// dígitos + 9 dígitos começando em "9"). Usada pelos formulários que pedem
// WhatsApp de cliente/dona antes de gravar em `clientes`/`agendamentos`.

// DDDs brasileiros válidos (ANATEL).
const DDDS_VALIDOS = [
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35,
  37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64,
  65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88,
  89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
];

// Remove tudo que não for dígito e, se sobrarem 13 dígitos começando com
// "55" (código do Brasil colado por engano, ex.: número copiado já
// internacional), tira esse prefixo — devolve só os dígitos nacionais
// (DDD + número).
export function normalizarWhatsapp(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.length === 13 && digitos.startsWith("55")) {
    return digitos.slice(2);
  }
  return digitos;
}

// Valida o formato de um WhatsApp digitado: 11 dígitos (DDD + 9 dígitos),
// DDD numa lista de DDDs brasileiros válidos, e celular (3º dígito "9").
// Não confere se o número existe de fato — só a forma.
export function validarWhatsapp(valor) {
  const digitos = normalizarWhatsapp(valor);

  if (digitos.length !== 11) {
    return { valido: false, erro: "Número precisa ter DDD + 9 dígitos." };
  }

  const ddd = Number(digitos.slice(0, 2));
  if (!DDDS_VALIDOS.includes(ddd)) {
    return { valido: false, erro: "DDD inválido." };
  }

  if (digitos[2] !== "9") {
    return {
      valido: false,
      erro: "Número de celular precisa começar com 9 depois do DDD.",
    };
  }

  return { valido: true, erro: null };
}
