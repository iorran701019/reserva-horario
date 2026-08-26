// preco_centavos (ex.: 3500) -> "R$ 35,00".
//
// Morava em components/FormularioAgendamento.js (que continua reexportando,
// pros importadores antigos). Foi pra cá quando BlocoConfirmacaoPix passou a
// precisar dela: o bloco é importado PELO FormularioAgendamento, então
// importar de volta de lá fecharia um ciclo de módulos.
export function formatarPreco(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
