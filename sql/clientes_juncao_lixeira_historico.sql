-- =============================================================================
-- Junção de cadastros duplicados, lixeira de clientes e histórico de números
-- Sessão 88 (14/10/2026)
--
-- Já aplicado em: STAGING (13–14/10/2026) e PRODUÇÃO (14/10/2026).
-- Este arquivo é o registro consolidado, na ordem em que foi rodado na produção.
-- Para um banco novo: rodar os blocos NA ORDEM, um por execução no SQL Editor do
-- Supabase (o editor se perde com blocos grandes ou com "select ... into").
--
-- Desenho:
--  * O cadastro absorvido numa junção vai para a "lixeira" (excluido_em) e seu
--    whatsapp vira 'excluido-<id>', liberando o número (UNIQUE estabelecimento_id,
--    whatsapp). O número real fica em whatsapp_original.
--  * clientes_uniao guarda o que foi movido (detalhes jsonb) para o Desfazer.
--  * clientes_dispensadas guarda os pares "manter os dois" (cliente_a_id < cliente_b_id).
--  * clientes_whatsapp_historico guarda números antigos (motivo 'troca' ou 'uniao').
--  * Escrita só por RPC (security definer); leitura por policy de salão ou global.
--  * Histórico do cliente liga a agendamentos pelo TELEFONE (agendamentos.telefone
--    = clientes.whatsapp) e às demais tabelas por cliente_id.
--  * Cada UPDATE em agendamentos dispara notificação e Google Calendar: a junção
--    é limitada a 60 atendimentos.
-- =============================================================================


-- BANCO: STAGING e PRODUÇÃO | Passo 1 | colunas novas em clientes
alter table public.clientes
  add column excluido_em timestamptz null,
  add column unido_a_cliente_id uuid null references public.clientes(id) on delete set null,
  add column whatsapp_original text null;


-- BANCO: STAGING e PRODUÇÃO | Passo 2 | tabela clientes_dispensadas
create table public.clientes_dispensadas (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id bigint not null references public.estabelecimentos(id),
  cliente_a_id uuid not null references public.clientes(id) on delete cascade,
  cliente_b_id uuid not null references public.clientes(id) on delete cascade,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  constraint clientes_dispensadas_ordem check (cliente_a_id < cliente_b_id),
  constraint clientes_dispensadas_par unique (cliente_a_id, cliente_b_id)
);


-- BANCO: STAGING e PRODUÇÃO | Passo 3 | tabelas clientes_uniao e clientes_whatsapp_historico
create table public.clientes_uniao (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id bigint not null references public.estabelecimentos(id),
  mantido_id uuid not null references public.clientes(id) on delete cascade,
  absorvido_id uuid null references public.clientes(id) on delete set null,
  nome_mantido text not null,
  nome_absorvido text not null,
  whatsapp_absorvido text not null,
  detalhes jsonb not null default '{}'::jsonb,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  desfeito_em timestamptz null,
  desfeito_por uuid null
);
create index clientes_uniao_estab_idx on public.clientes_uniao (estabelecimento_id, criado_em desc);

create table public.clientes_whatsapp_historico (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id bigint not null references public.estabelecimentos(id),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  whatsapp text not null,
  motivo text not null,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  constraint clientes_whatsapp_historico_motivo_check check (motivo in ('troca','uniao'))
);
create index clientes_whatsapp_historico_idx on public.clientes_whatsapp_historico (cliente_id, criado_em desc);


-- BANCO: STAGING e PRODUÇÃO | Passo 4 | RLS, policies de leitura e bloqueio do anon
alter table public.clientes_dispensadas enable row level security;
alter table public.clientes_uniao enable row level security;
alter table public.clientes_whatsapp_historico enable row level security;

create policy clientes_dispensadas_select on public.clientes_dispensadas
  for select to authenticated
  using (exists (select 1 from public.perfis pf where pf.user_id = auth.uid()
    and (pf.papel = 'global' or pf.estabelecimento_id = clientes_dispensadas.estabelecimento_id)));

create policy clientes_uniao_select on public.clientes_uniao
  for select to authenticated
  using (exists (select 1 from public.perfis pf where pf.user_id = auth.uid()
    and (pf.papel = 'global' or pf.estabelecimento_id = clientes_uniao.estabelecimento_id)));

create policy clientes_whatsapp_historico_select on public.clientes_whatsapp_historico
  for select to authenticated
  using (exists (select 1 from public.perfis pf where pf.user_id = auth.uid()
    and (pf.papel = 'global' or pf.estabelecimento_id = clientes_whatsapp_historico.estabelecimento_id)));

revoke all on public.clientes_dispensadas from anon;
revoke all on public.clientes_uniao from anon;
revoke all on public.clientes_whatsapp_historico from anon;


-- BANCO: STAGING e PRODUÇÃO | Passo 5 | função clientes_unir_conferir (auxiliar)
create or replace function public.clientes_unir_conferir(p_mantido_id uuid, p_absorvido_id uuid, p_etiqueta_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m clientes%rowtype;
  v_a clientes%rowtype;
begin
  if p_mantido_id is null or p_absorvido_id is null or p_mantido_id = p_absorvido_id then
    raise exception 'Cadastros inválidos' using errcode = 'P0001';
  end if;
  perform 1 from clientes where id in (p_mantido_id, p_absorvido_id) order by id for update;
  v_m := (select c from clientes c where c.id = p_mantido_id);
  v_a := (select c from clientes c where c.id = p_absorvido_id);
  if v_m.id is null or v_a.id is null then
    raise exception 'Cadastro não encontrado' using errcode = 'P0002';
  end if;
  if v_m.estabelecimento_id <> v_a.estabelecimento_id then
    raise exception 'Cadastros de salões diferentes' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from perfis p
    where p.user_id = auth.uid()
      and (p.papel = 'global' or p.estabelecimento_id = v_m.estabelecimento_id)
  ) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if v_m.excluido_em is not null or v_a.excluido_em is not null then
    raise exception 'Um dos cadastros já está na lixeira' using errcode = 'P0001';
  end if;
  if v_m.etiqueta_id is not null and v_a.etiqueta_id is not null and v_m.etiqueta_id <> v_a.etiqueta_id then
    if p_etiqueta_id is null or p_etiqueta_id not in (v_m.etiqueta_id, v_a.etiqueta_id) then
      raise exception 'Escolha qual etiqueta manter' using errcode = 'P0001', hint = 'ETIQUETA_CONFLITO';
    end if;
    return p_etiqueta_id;
  end if;
  return coalesce(v_m.etiqueta_id, v_a.etiqueta_id);
end;
$function$;


-- BANCO: STAGING e PRODUÇÃO | Passo 6 | função clientes_unir_mover (auxiliar)
create or replace function public.clientes_unir_mover(p_mantido_id uuid, p_absorvido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m clientes%rowtype;
  v_a clientes%rowtype;
  v_ag jsonb;
  v_det jsonb;
begin
  v_m := (select c from clientes c where c.id = p_mantido_id);
  v_a := (select c from clientes c where c.id = p_absorvido_id);
  perform 1 from agendamentos a
   where a.estabelecimento_id = v_m.estabelecimento_id and a.telefone = v_a.whatsapp for update;
  v_ag := (select coalesce(jsonb_agg(jsonb_build_object('id', a.id::text, 'nome', a.nome_cliente)), '[]'::jsonb)
             from agendamentos a
            where a.estabelecimento_id = v_m.estabelecimento_id and a.telefone = v_a.whatsapp);
  if jsonb_array_length(v_ag) > 60 then
    raise exception 'Atendimentos demais para juntar de uma vez (%)', jsonb_array_length(v_ag) using errcode = 'P0001';
  end if;
  v_det := jsonb_build_object(
    'agendamentos', v_ag,
    'anamneses', (select coalesce(jsonb_agg(t.id::text), '[]'::jsonb) from anamnese_respostas t where t.cliente_id = v_a.id),
    'anotacoes', (select coalesce(jsonb_agg(t.id::text), '[]'::jsonb) from anotacoes_clientes t where t.cliente_id = v_a.id),
    'resgates', (select coalesce(jsonb_agg(t.id::text), '[]'::jsonb) from fidelidade_resgates t where t.cliente_id = v_a.id),
    'pendencias', (select coalesce(jsonb_agg(t.id::text), '[]'::jsonb) from pendencias_admin t where t.cliente_id = v_a.id));
  update agendamentos a set telefone = v_m.whatsapp, nome_cliente = v_m.nome
   where a.estabelecimento_id = v_m.estabelecimento_id and a.telefone = v_a.whatsapp;
  update anamnese_respostas t set cliente_id = v_m.id where t.cliente_id = v_a.id;
  update anotacoes_clientes t set cliente_id = v_m.id where t.cliente_id = v_a.id;
  update fidelidade_resgates t set cliente_id = v_m.id where t.cliente_id = v_a.id;
  update pendencias_admin t set cliente_id = v_m.id where t.cliente_id = v_a.id;
  return v_det;
end;
$function$;


-- BANCO: STAGING e PRODUÇÃO | Passo 7 | função clientes_unir (principal; apaga o par dispensado ao juntar)
create or replace function public.clientes_unir(p_mantido_id uuid, p_absorvido_id uuid, p_etiqueta_id uuid default null)
returns table(uniao_id uuid, agendamentos_movidos integer, anamneses_movidas integer, anotacoes_movidas integer, resgates_movidos integer, pendencias_movidas integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m clientes%rowtype;
  v_a clientes%rowtype;
  v_etq uuid;
  v_det jsonb;
  v_uniao uuid := gen_random_uuid();
begin
  v_etq := public.clientes_unir_conferir(p_mantido_id, p_absorvido_id, p_etiqueta_id);
  v_m := (select c from clientes c where c.id = p_mantido_id);
  v_a := (select c from clientes c where c.id = p_absorvido_id);
  v_det := public.clientes_unir_mover(p_mantido_id, p_absorvido_id)
    || jsonb_build_object('etiqueta_mantido_antes', v_m.etiqueta_id, 'etiqueta_absorvido', v_a.etiqueta_id, 'etiqueta_final', v_etq);

  update clientes set whatsapp_original = v_a.whatsapp, whatsapp = 'excluido-' || v_a.id::text,
         excluido_em = now(), unido_a_cliente_id = v_m.id
   where id = v_a.id;
  update clientes set etiqueta_id = v_etq where id = v_m.id;

  delete from clientes_dispensadas
   where cliente_a_id = least(v_m.id, v_a.id)
     and cliente_b_id = greatest(v_m.id, v_a.id);

  insert into clientes_whatsapp_historico (estabelecimento_id, cliente_id, whatsapp, motivo)
  values (v_m.estabelecimento_id, v_m.id, v_a.whatsapp, 'uniao');

  insert into clientes_uniao (id, estabelecimento_id, mantido_id, absorvido_id, nome_mantido, nome_absorvido, whatsapp_absorvido, detalhes)
  values (v_uniao, v_m.estabelecimento_id, v_m.id, v_a.id, v_m.nome, v_a.nome, v_a.whatsapp, v_det);

  return query select v_uniao,
    jsonb_array_length(v_det -> 'agendamentos'), jsonb_array_length(v_det -> 'anamneses'),
    jsonb_array_length(v_det -> 'anotacoes'), jsonb_array_length(v_det -> 'resgates'),
    jsonb_array_length(v_det -> 'pendencias');
end;
$function$;


-- BANCO: STAGING e PRODUÇÃO | Passo 8 | função clientes_desfazer_mover (auxiliar)
create or replace function public.clientes_desfazer_mover(p_uniao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_u clientes_uniao%rowtype;
  v_m clientes%rowtype;
  v_a clientes%rowtype;
  d jsonb;
  n1 integer; n2 integer; n3 integer; n4 integer; n5 integer;
begin
  v_u := (select u from clientes_uniao u where u.id = p_uniao_id);
  v_m := (select c from clientes c where c.id = v_u.mantido_id);
  v_a := (select c from clientes c where c.id = v_u.absorvido_id);
  d := v_u.detalhes;

  update agendamentos a set telefone = v_a.whatsapp_original, nome_cliente = x.nome
    from jsonb_to_recordset(coalesce(d -> 'agendamentos', '[]'::jsonb)) as x(id text, nome text)
   where a.id::text = x.id and a.estabelecimento_id = v_u.estabelecimento_id and a.telefone = v_m.whatsapp;
  get diagnostics n1 = row_count;

  update anamnese_respostas t set cliente_id = v_a.id where t.cliente_id = v_m.id
     and t.id::text in (select jsonb_array_elements_text(coalesce(d -> 'anamneses', '[]'::jsonb)));
  get diagnostics n2 = row_count;

  update anotacoes_clientes t set cliente_id = v_a.id where t.cliente_id = v_m.id
     and t.id::text in (select jsonb_array_elements_text(coalesce(d -> 'anotacoes', '[]'::jsonb)));
  get diagnostics n3 = row_count;

  update fidelidade_resgates t set cliente_id = v_a.id where t.cliente_id = v_m.id
     and t.id::text in (select jsonb_array_elements_text(coalesce(d -> 'resgates', '[]'::jsonb)));
  get diagnostics n4 = row_count;

  update pendencias_admin t set cliente_id = v_a.id where t.cliente_id = v_m.id
     and t.id::text in (select jsonb_array_elements_text(coalesce(d -> 'pendencias', '[]'::jsonb)));
  get diagnostics n5 = row_count;

  return jsonb_build_object('agendamentos', n1, 'anamneses', n2, 'anotacoes', n3, 'resgates', n4, 'pendencias', n5);
end;
$function$;


-- BANCO: STAGING e PRODUÇÃO | Passo 9 | função clientes_desfazer_uniao (principal)
create or replace function public.clientes_desfazer_uniao(p_uniao_id uuid)
returns table(agendamentos_devolvidos integer, anamneses_devolvidas integer, anotacoes_devolvidas integer, resgates_devolvidos integer, pendencias_devolvidas integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_u clientes_uniao%rowtype;
  v_m clientes%rowtype;
  v_a clientes%rowtype;
  r jsonb;
begin
  v_u := (select u from clientes_uniao u where u.id = p_uniao_id for update);
  if v_u.id is null then
    raise exception 'União não encontrada' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from perfis p
    where p.user_id = auth.uid()
      and (p.papel = 'global' or p.estabelecimento_id = v_u.estabelecimento_id)
  ) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if v_u.desfeito_em is not null or v_u.absorvido_id is null then
    raise exception 'Esta união não pode ser desfeita' using errcode = 'P0001';
  end if;
  perform 1 from clientes where id in (v_u.mantido_id, v_u.absorvido_id) order by id for update;
  v_m := (select c from clientes c where c.id = v_u.mantido_id);
  v_a := (select c from clientes c where c.id = v_u.absorvido_id);
  if v_a.id is null or v_a.excluido_em is null or v_a.unido_a_cliente_id is distinct from v_m.id or v_a.whatsapp_original is null then
    raise exception 'O cadastro da lixeira mudou e a união não pode ser desfeita' using errcode = 'P0001';
  end if;
  if exists (select 1 from clientes c where c.estabelecimento_id = v_a.estabelecimento_id and c.whatsapp = v_a.whatsapp_original) then
    raise exception 'O número % já está em outro cadastro', v_a.whatsapp_original using errcode = '23505';
  end if;

  r := public.clientes_desfazer_mover(p_uniao_id);

  update clientes set whatsapp = v_a.whatsapp_original, whatsapp_original = null,
         excluido_em = null, unido_a_cliente_id = null
   where id = v_a.id;
  if v_m.etiqueta_id is not distinct from (v_u.detalhes ->> 'etiqueta_final')::uuid then
    update clientes set etiqueta_id = (v_u.detalhes ->> 'etiqueta_mantido_antes')::uuid where id = v_m.id;
  end if;
  delete from clientes_whatsapp_historico
   where cliente_id = v_m.id and motivo = 'uniao' and whatsapp = v_a.whatsapp_original;
  update clientes_uniao set desfeito_em = now(), desfeito_por = auth.uid() where id = v_u.id;

  return query select (r ->> 'agendamentos')::integer, (r ->> 'anamneses')::integer,
    (r ->> 'anotacoes')::integer, (r ->> 'resgates')::integer, (r ->> 'pendencias')::integer;
end;
$function$;


-- BANCO: STAGING e PRODUÇÃO | Passo 10 | função clientes_manter_dois
create or replace function public.clientes_manter_dois(p_cliente_a_id uuid, p_cliente_b_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_a clientes%rowtype;
  v_b clientes%rowtype;
begin
  if p_cliente_a_id is null or p_cliente_b_id is null or p_cliente_a_id = p_cliente_b_id then
    raise exception 'Cadastros inválidos' using errcode = 'P0001';
  end if;
  v_a := (select c from clientes c where c.id = p_cliente_a_id);
  v_b := (select c from clientes c where c.id = p_cliente_b_id);
  if v_a.id is null or v_b.id is null or v_a.estabelecimento_id <> v_b.estabelecimento_id then
    raise exception 'Cadastros inválidos' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from perfis p
    where p.user_id = auth.uid()
      and (p.papel = 'global' or p.estabelecimento_id = v_a.estabelecimento_id)
  ) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  insert into clientes_dispensadas (estabelecimento_id, cliente_a_id, cliente_b_id)
  values (v_a.estabelecimento_id, least(p_cliente_a_id, p_cliente_b_id), greatest(p_cliente_a_id, p_cliente_b_id))
  on conflict (cliente_a_id, cliente_b_id) do nothing;
end;
$function$;


-- BANCO: STAGING e PRODUÇÃO | Passo 11 | função clientes_desfazer_manter_dois (sem chamador no front hoje)
create or replace function public.clientes_desfazer_manter_dois(p_cliente_a_id uuid, p_cliente_b_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_estab bigint;
begin
  v_estab := (select d.estabelecimento_id from clientes_dispensadas d
               where d.cliente_a_id = least(p_cliente_a_id, p_cliente_b_id)
                 and d.cliente_b_id = greatest(p_cliente_a_id, p_cliente_b_id));
  if v_estab is null then
    return;
  end if;
  if not exists (
    select 1 from perfis p
    where p.user_id = auth.uid()
      and (p.papel = 'global' or p.estabelecimento_id = v_estab)
  ) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  delete from clientes_dispensadas
   where cliente_a_id = least(p_cliente_a_id, p_cliente_b_id)
     and cliente_b_id = greatest(p_cliente_a_id, p_cliente_b_id);
end;
$function$;


-- BANCO: STAGING e PRODUÇÃO | Passo 12 | permissões: auxiliares fechadas, principais só para logados
revoke all on function public.clientes_unir_conferir(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.clientes_unir_mover(uuid, uuid) from public, anon, authenticated;
revoke all on function public.clientes_desfazer_mover(uuid) from public, anon, authenticated;

revoke all on function public.clientes_unir(uuid, uuid, uuid) from public, anon;
revoke all on function public.clientes_desfazer_uniao(uuid) from public, anon;
revoke all on function public.clientes_manter_dois(uuid, uuid) from public, anon;
revoke all on function public.clientes_desfazer_manter_dois(uuid, uuid) from public, anon;

grant execute on function public.clientes_unir(uuid, uuid, uuid) to authenticated;
grant execute on function public.clientes_desfazer_uniao(uuid) to authenticated;
grant execute on function public.clientes_manter_dois(uuid, uuid) to authenticated;
grant execute on function public.clientes_desfazer_manter_dois(uuid, uuid) to authenticated;


-- BANCO: STAGING e PRODUÇÃO | Passo 13 | atualizar_whatsapp_cliente (agora grava o número antigo no histórico)
-- Antes: sem search_path fixo e sem o insert em clientes_whatsapp_historico.
create or replace function public.atualizar_whatsapp_cliente(p_cliente_id uuid, p_novo_whatsapp text, p_estabelecimento_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_whatsapp_antigo text;
begin
  v_whatsapp_antigo := (select c.whatsapp from clientes c
                         where c.id = p_cliente_id and c.estabelecimento_id = p_estabelecimento_id);
  if v_whatsapp_antigo is null then
    raise exception 'cliente não encontrado para este estabelecimento';
  end if;
  update clientes set whatsapp = p_novo_whatsapp where id = p_cliente_id;
  update agendamentos set telefone = p_novo_whatsapp
   where telefone = v_whatsapp_antigo and estabelecimento_id = p_estabelecimento_id;
  if v_whatsapp_antigo is distinct from p_novo_whatsapp then
    insert into clientes_whatsapp_historico (estabelecimento_id, cliente_id, whatsapp, motivo)
    values (p_estabelecimento_id, p_cliente_id, v_whatsapp_antigo, 'troca');
  end if;
end;
$function$;


-- Conferência (somente leitura): permissões esperadas
--   auxiliares (conferir, mover, desfazer_mover): anon = false, authenticated = false
--   principais (unir, desfazer_uniao, manter_dois, desfazer_manter_dois): anon = false, authenticated = true
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute') as anon_executa,
--        has_function_privilege('authenticated', p.oid, 'execute') as logado_executa
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('clientes_unir_conferir','clientes_unir_mover','clientes_desfazer_mover',
--                     'clientes_unir','clientes_desfazer_uniao','clientes_manter_dois',
--                     'clientes_desfazer_manter_dois','atualizar_whatsapp_cliente')
-- order by p.proname;