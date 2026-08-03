-- Integração com Google Calendar por tenant (ver ConfiguracoesSalao.js e
-- app/api/google-calendar/callback/route.js). OAuth padrão "authorization
-- code" com access_type=offline: o refresh_token fica guardado à parte, numa
-- tabela sem policy de SELECT/INSERT/UPDATE — só o service role (usado pela
-- rota de callback) lê/grava esse token; o /admin autenticado só pode
-- desconectar (DELETE), nunca ler o token de volta.
--
-- google_calendar_ativo  – liga/desliga a integração pro salão. Default false
--                          preserva o comportamento atual pra todo tenant
--                          existente.
-- google_calendar_email  – e-mail da conta Google conectada, só pra exibir no
--                          /admin ("Conectado como ..."). Não usado na
--                          integração em si.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists google_calendar_ativo boolean not null default false,
  add column if not exists google_calendar_email text;

create table if not exists public.google_calendar_tokens (
  estabelecimento_id bigint primary key references public.estabelecimentos (id) on delete cascade,
  refresh_token       text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.google_calendar_tokens enable row level security;

-- Só permite ao /admin autenticado APAGAR o próprio token (botão
-- "Desconectar" em ConfiguracoesSalao.js) — sem policy de SELECT/INSERT/
-- UPDATE, então ninguém além do service role consegue ler ou gravar o
-- refresh_token pelo cliente. Mesma checagem de papel das demais tabelas do
-- admin (ver pendencias_admin/profissionais).
create policy "google_calendar_tokens_admin_delete"
  on public.google_calendar_tokens
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.perfis pf
      where pf.user_id = auth.uid()
        and (pf.papel = 'global' or pf.estabelecimento_id = google_calendar_tokens.estabelecimento_id)
    )
  );
