-- Policy de INSERT em `clientes` para o público (papel anon): permite que o
-- fluxo de cadastro do /agendar (CadastroCliente) crie o próprio registro
-- quando o WhatsApp não é encontrado. RLS já bloqueia esse insert hoje
-- (confirmado: "new row violates row-level security policy for table
-- clientes") — sem esta policy o cadastro completo não persiste.
--
-- Espelha a mesma lógica de segurança já usada no insert público de
-- `agendamentos`: qualquer um pode criar, restrito a um estabelecimento
-- ativo existente (não dá pra "inventar" um estabelecimento_id qualquer).
-- Leitura (SELECT) não é tocada aqui — já funciona para anon.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

drop policy if exists "clientes_public_insert" on public.clientes;
create policy "clientes_public_insert"
  on public.clientes
  for insert
  to anon
  with check (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = clientes.estabelecimento_id
        and e.ativo = true
    )
  );
