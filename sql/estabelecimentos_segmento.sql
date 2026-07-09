-- Adiciona a coluna `segmento` em `estabelecimentos` para permitir
-- customizações futuras por segmento (ex.: textos, regras de UI) sem
-- alterar nada do que já está em produção — este migration é só marcação.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists segmento text not null default 'manicure_podologia';

alter table public.estabelecimentos
  drop constraint if exists estabelecimentos_segmento_check;

alter table public.estabelecimentos
  add constraint estabelecimentos_segmento_check
  check (segmento in ('manicure_podologia', 'salao_barbershop'));

-- Marca os salões do Júnior e da Valéria como 'salao_barbershop'.
-- Os demais (incl. Salão de Teste, slug `teste`) mantêm o default.
update public.estabelecimentos
  set segmento = 'salao_barbershop'
  where slug in ('junior', 'valeria');
