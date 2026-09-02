// Texto único pro caso "0 linhas afetadas, sem erro": o UPDATE chegou no
// banco, o Postgres respondeu OK, mas o RLS filtrou a linha antes de aplicar
// a alteração. Nesse caminho o supabase-js devolve `error: null`, então sem
// um `.select()` na query (pra contar as linhas que voltaram) a tela mostra
// "Salvo ✓" em cima de um banco que não gravou nada.
export const ERRO_NENHUMA_LINHA =
  "nenhuma linha foi alterada (sem permissão ou registro não encontrado).";

// Monta o trecho de mensagem de erro pros dois casos de uma vez, pra quem
// checa `if (error || !linhas?.length)`.
export function mensagemFalhaSalvar(error) {
  return error ? error.message : ERRO_NENHUMA_LINHA;
}
