-- Prazo mínimo (em horas) para a cliente cancelar um agendamento pelo painel
-- público. Abaixo desse número de horas antes do horário marcado, o botão
-- "Cancelar" some do PainelCliente (o cancelamento pelo /admin não é afetado).
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists cancelamento_prazo_horas integer not null default 24;
