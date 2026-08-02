-- Programa de fidelidade por tenant (ver lib/fidelidade.js). Fidelidade é
-- 100% DERIVADA: nenhum contador persistido — cada verificação conta os
-- agendamentos concluídos do cliente desde o último fidelidade_resgates
-- (ver sql/fidelidade_resgates.sql).
--
-- fidelidade_ativa            liga/desliga o programa pro salão. Default
--                              false preserva o comportamento atual pra todo
--                              tenant existente.
-- fidelidade_conta_manutencao quando false, agendamentos de serviços com
--                              eh_manutencao=true não contam pra meta.
--                              Default true (conta tudo, comportamento mais
--                              simples de entender).
-- fidelidade_meta_servicos    quantos atendimentos concluídos até liberar o
--                              brinde. Nulo = fidelidade não configurada
--                              ainda, mesmo com fidelidade_ativa=true
--                              (verificarFidelidadeClientes não roda sem
--                              meta).
-- fidelidade_descricao_brinde texto livre do que a cliente ganha (vai na
--                              descrição do card da pendência).
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists fidelidade_ativa boolean not null default false,
  add column if not exists fidelidade_conta_manutencao boolean not null default true,
  add column if not exists fidelidade_meta_servicos integer,
  add column if not exists fidelidade_descricao_brinde text;
