-- Faixa de dias em que uma manutenção (eh_manutencao=true) vale, substituindo
-- o antigo prazo_manutencao_dias único do serviço original pra esse propósito.
-- Cada manutenção agora carrega sua própria faixa: prazo_inicio_dias (opcional
-- — null significa "vale desde o início do prazo") e prazo_fim_dias
-- (opcional — sem ele a faixa nunca é considerada preenchida, ver
-- lib/manutencaoSugerida.js). Um mesmo serviço original pode ter várias
-- manutenções com faixas diferentes (ex.: "20 a 30 dias", "30 a 45 dias").
--
-- prazo_manutencao_dias (coluna já existente em `servicos`) continua intacta
-- e ainda é usada por calcularPrecoManutencao/buscarVencimentoManutencao
-- (lib/manutencaoSugerida.js) e pelo fluxo manual de agendamento — só deixou
-- de ser editável no formulário do serviço original.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.servicos
  add column if not exists prazo_inicio_dias integer,
  add column if not exists prazo_fim_dias integer;
