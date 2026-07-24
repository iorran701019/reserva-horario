-- Marca se um cancelamento partiu do painel público da cliente (PainelCliente)
-- em vez do /admin. Usado pelo webhook de notificações (app/api/notificacoes)
-- pra só avisar a dona quando é a cliente quem cancela — cancelamentos feitos
-- pelo próprio admin não geram notificação.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.agendamentos
  add column if not exists cancelado_por_cliente boolean not null default false;
