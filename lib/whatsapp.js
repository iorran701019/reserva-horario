// Helpers para montar links de WhatsApp (wa.me) a partir de um telefone digitado.

// Normaliza um telefone para o formato que o wa.me espera (só dígitos, com DDI).
// Regra: remove tudo que não for dígito; se já vier com "55" e 12/13 dígitos,
// assume que já está internacional e devolve como está; senão tira zeros à
// esquerda e prefixa "55" (Brasil).
export function paraNumeroWhatsApp(telefone) {
  const digitos = String(telefone ?? "").replace(/\D/g, "");

  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    return digitos;
  }

  const semZerosAEsquerda = digitos.replace(/^0+/, "");
  return `55${semZerosAEsquerda}`;
}

// Monta o link clicável do WhatsApp com a mensagem já codificada.
export function linkWhatsApp(telefone, texto) {
  return `https://wa.me/${paraNumeroWhatsApp(telefone)}?text=${encodeURIComponent(texto)}`;
}
