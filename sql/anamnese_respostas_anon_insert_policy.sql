-- Policy de INSERT em `anamnese_respostas` para o público (papel anon): o
-- FormularioAnamnese do /agendar precisa gravar a resposta do cliente. RLS já
-- bloqueia esse insert hoje (confirmado: "new row violates row-level security
-- policy for table anamnese_respostas") — sem esta policy o formulário mostra
-- o erro na tela mas não persiste nada.
--
-- Mesma lógica de segurança do insert público de `clientes`/`agendamentos`:
-- qualquer um pode criar, restrito a um estabelecimento ativo existente.
-- Leitura de `anamnese_modelos`/`anamnese_respostas` não é tocada aqui — já
-- funciona para anon.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

drop policy if exists "anamnese_respostas_public_insert" on public.anamnese_respostas;
create policy "anamnese_respostas_public_insert"
  on public.anamnese_respostas
  for insert
  to anon
  with check (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = anamnese_respostas.estabelecimento_id
        and e.ativo = true
    )
  );
