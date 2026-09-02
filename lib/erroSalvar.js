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

// Texto pro caso "DELETE não confirmado" nas gravações que apagam tudo e
// reinserem do zero (grade de horários, vínculos de serviço, opções de
// pergunta). Se o DELETE volta com error null mas sem confirmar as linhas
// esperadas (RLS filtrou), inserir em seguida deixa a grade ANTIGA e a NOVA
// convivendo no banco — dado duplicado de verdade, que a disponibilidade
// passaria a ler errado. Nesses pontos o INSERT é abortado e a dona vê esta
// mensagem: nada foi gravado por cima, e ela recarrega pra ver o estado real
// antes de mexer de novo.
export const ERRO_DELETE_NAO_CONFIRMADO =
  "não foi possível confirmar a remoção dos dados antigos, então nada foi gravado por cima. Recarregue a página para conferir o estado real antes de tentar de novo.";

// Mesmo papel de mensagemFalhaSalvar, pro caminho do delete em cascata.
export function mensagemFalhaDelete(error) {
  return error ? error.message : ERRO_DELETE_NAO_CONFIRMADO;
}
