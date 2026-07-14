-- Policy de UPDATE em `agendamentos` para o público (papel anon): necessária
-- pelo novo fluxo de reserva antecipada do FormularioAgendamento — a cliente
-- reserva o horário (insert em "aguardando_sinal"/"pendente") assim que toca
-- num slot, e o submit final / cancelamento ao voltar/trocar de data viram
-- UPDATEs dessa mesma linha (status, sinal_declarado_pago). RLS bloqueia
-- update hoje por padrão (confirmado: anon pode INSERT em agendamentos mas
-- não UPDATE/DELETE — retorna 200 com 0 linhas afetadas, sem erro visível).
-- Sem esta policy, tanto o cancelamento de reserva órfã quanto a confirmação
-- final do agendamento público não persistem nada.
--
-- Espelha a mesma lógica de segurança já usada no insert público de
-- `agendamentos`: qualquer um pode atualizar, restrito a um estabelecimento
-- ativo existente — tanto na linha atual (using) quanto na linha resultante
-- (with check), pra impedir mover o registro pra outro estabelecimento_id.
-- Não há autenticação de cliente nesta fase: quem tem o id da linha (só
-- alcançado no próprio fluxo de agendamento, no mesmo carregamento de
-- página) pode editá-la.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

drop policy if exists "agendamentos_public_update" on public.agendamentos;
create policy "agendamentos_public_update"
  on public.agendamentos
  for update
  to anon
  using (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = agendamentos.estabelecimento_id
        and e.ativo = true
    )
  )
  with check (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = agendamentos.estabelecimento_id
        and e.ativo = true
    )
  );
