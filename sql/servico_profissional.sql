-- Fatia "Profissionais" (Janela C): tabela de vínculo `servico_profissional`.
--
-- Rode este arquivo UMA vez no SQL Editor do Supabase (projeto de staging),
-- DEPOIS de sql/profissionais_horarios.sql (depende de `profissionais`).
-- IDs são inteiros (bigint identity), pra casar com `servicos`/`profissionais`.
--
-- >>> IMPORTANTE (RLS): a policy abaixo herda o acesso pelo estabelecimento do
--     profissional dono da linha — MESMA lógica de `horarios_trabalho`. Confira
--     contra as suas policies reais e ajuste o predicado se necessário.

-- ---------------------------------------------------------------------------
-- Tabela: servico_profissional
--   Vínculo N:N entre `servicos` e `profissionais`. Uma linha = "este
--   profissional atende este serviço". A UI regrava "tudo" (apaga os vínculos
--   do profissional e reinsere os marcados), então a PK composta basta.
-- ---------------------------------------------------------------------------
create table if not exists public.servico_profissional (
  servico_id      bigint not null references public.servicos (id)      on delete cascade,
  profissional_id bigint not null references public.profissionais (id) on delete cascade,
  primary key (servico_id, profissional_id)
);

create index if not exists servico_profissional_profissional_idx
  on public.servico_profissional (profissional_id);

create index if not exists servico_profissional_servico_idx
  on public.servico_profissional (servico_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.servico_profissional enable row level security;

-- Acesso herdado pelo estabelecimento do profissional dono da linha; papel
-- 'global' gerencia todos.
create policy "servico_profissional_admin_all"
  on public.servico_profissional
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profissionais pr
      join public.perfis pf on pf.user_id = auth.uid()
      where pr.id = servico_profissional.profissional_id
        and (pf.papel = 'global' or pf.estabelecimento_id = pr.estabelecimento_id)
    )
  )
  with check (
    exists (
      select 1
      from public.profissionais pr
      join public.perfis pf on pf.user_id = auth.uid()
      where pr.id = servico_profissional.profissional_id
        and (pf.papel = 'global' or pf.estabelecimento_id = pr.estabelecimento_id)
    )
  );
