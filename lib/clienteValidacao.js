// Regras reutilizadas pelos dois fluxos de identificação de cliente
// (cadastro_completo true/false) em IdentificacaoCliente e CadastroCliente.

// Bloco de endereço tratado como unidade: CEP, número, bairro e cidade. Se
// qualquer um estiver vazio, o bloco inteiro é considerado pendente.
export function enderecoCompleto(cliente) {
  if (!cliente) return false;
  return Boolean(
    (cliente.cep ?? "").trim() &&
      (cliente.numero ?? "").trim() &&
      (cliente.bairro ?? "").trim() &&
      (cliente.cidade ?? "").trim()
  );
}

// Compara dois números de WhatsApp ignorando máscara/formatação.
export function whatsappConfere(digitado, referencia) {
  const a = (digitado ?? "").replace(/\D/g, "");
  const b = (referencia ?? "").replace(/\D/g, "");
  return a.length > 0 && a === b;
}
