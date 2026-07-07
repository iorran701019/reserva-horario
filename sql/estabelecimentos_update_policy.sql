-- Policy de UPDATE em `estabelecimentos`: permite ao dono/global editar o
-- PRÓPRIO salão (ex.: a preferência `escolha_profissional` alternada no admin).
--
-- Rode este arquivo no SQL Editor do Supabase SÓ SE o update do toggle estiver
-- sendo bloqueado por RLS (a leitura pública do slug tem a própria policy de
-- SELECT e NÃO é tocada aqui — por isso não mexemos no enable de RLS).
--
-- Espelha a lógica das policies de `servicos`/`profissionais`: perfil do usuário
-- (perfis.user_id = auth.uid()) manda; 'global' edita qualquer salão, os demais
-- ficam presos ao próprio estabelecimento (perfis.estabelecimento_id).

drop policy if exists "estabelecimentos_admin_update" on public.estabelecimentos;
create policy "estabelecimentos_admin_update"
  on public.estabelecimentos
  for update
  to authenticated
  using (
    exists (
      select 1 from public.perfis pf
      where pf.user_id = auth.uid()
        and (pf.papel = 'global' or pf.estabelecimento_id = estabelecimentos.id)
    )
  )
  with check (
    exists (
      select 1 from public.perfis pf
      where pf.user_id = auth.uid()
        and (pf.papel = 'global' or pf.estabelecimento_id = estabelecimentos.id)
    )
  );
