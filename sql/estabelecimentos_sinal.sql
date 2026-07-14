-- Sinal de reserva: regra + valor + chave Pix no estabelecimento, e a
-- declaração do cliente (não comprovante) no agendamento.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists sinal_regra text not null default 'desligado';

alter table public.estabelecimentos
  drop constraint if exists estabelecimentos_sinal_regra_check;

alter table public.estabelecimentos
  add constraint estabelecimentos_sinal_regra_check
  check (sinal_regra in ('desligado', 'novos', 'todos'));

alter table public.estabelecimentos
  add column if not exists sinal_valor_centavos integer;

alter table public.estabelecimentos
  add column if not exists sinal_chave_pix text;

alter table public.agendamentos
  add column if not exists sinal_declarado_pago boolean not null default false;
