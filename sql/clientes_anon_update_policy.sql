-- Policy de UPDATE em `clientes` para o público (papel anon): permite que o
-- fluxo de edição do /agendar (AtualizarDadosCliente, aberto pelo
-- "Atualizar meus dados" do PainelCliente) grave as alterações no próprio
-- registro. RLS bloqueia esse update hoje por padrão (confirmado em teste
-- manual: PATCH retorna PGRST116 "Cannot coerce the result to a single JSON
-- object" — 0 linhas afetadas) — sem esta policy a tela de edição não
-- persiste nada, mesmo sem erro visível de RLS explícito.
--
-- Espelha a mesma lógica de segurança já usada no insert público de
-- `clientes`: qualquer um pode atualizar, restrito a um estabelecimento
-- ativo existente — tanto na linha atual (using) quanto na linha resultante
-- (with check), pra impedir mover o registro pra outro estabelecimento_id.
-- Não há autenticação de cliente nesta fase: quem tem o id da linha (só
-- alcançado via o fluxo de identificação por WhatsApp) pode editá-la.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

drop policy if exists "clientes_public_update" on public.clientes;
create policy "clientes_public_update"
  on public.clientes
  for update
  to anon
  using (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = clientes.estabelecimento_id
        and e.ativo = true
    )
  )
  with check (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = clientes.estabelecimento_id
        and e.ativo = true
    )
  );
