-- Adiciona a coluna `oculto` em `servicos`, independente de `ativo`. Usada
-- quando a dona tenta excluir permanentemente um serviço (ou manutenção) que
-- ainda tem agendamentos vinculados: como o DELETE físico quebraria a FK, o
-- serviço fica com ativo=false (já era) E oculto=true, saindo de qualquer
-- listagem/consulta do admin sem apagar o registro (preserva o histórico dos
-- agendamentos antigos).
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.servicos
  add column if not exists oculto boolean not null default false;
