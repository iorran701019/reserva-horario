-- ESPELHO do banco — documentação, NÃO precisa ser executado.
--
-- Corpo de `public.expirar_pendentes_vencidos()` idêntico em STAGING e em
-- PRODUÇÃO em 24/09/2026 (função chamada pelo pg_cron). Este arquivo existe só
-- pra o repositório registrar o que roda no banco; qualquer mudança de
-- verdade na função é feita e testada no Supabase, e este espelho é atualizado
-- depois.
--
-- Dois blocos:
--   (a) rascunho abandonado: linhas `finalizado = false` em
--       pendente/aguardando_sinal, canceladas depois de
--       `estabelecimentos.reserva_provisoria_expira_horas` desde `created_at`.
--   (b) pendente vencido pelo HORÁRIO: linhas `finalizado = true` em
--       pendente/aguardando_sinal cujo `upper(periodo)` já passou (fuso
--       America/Sao_Paulo), a partir de 2026-09-11, marcadas
--       `expirado_automaticamente = true`.
--
-- Nota pro par de duas datas: as duas linhas nascem `finalizado = true`
-- (sql/rpc_criacao_par.sql), então só o bloco (b) as alcança, cada uma pelo
-- SEU horário — a anterior, sendo mais cedo, expira primeiro.

CREATE OR REPLACE FUNCTION public.expirar_pendentes_vencidos()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update agendamentos a
     set status = 'cancelado'
    from estabelecimentos e
   where e.id = a.estabelecimento_id
     and a.finalizado = false
     and a.status in ('pendente', 'aguardando_sinal')
     and e.reserva_provisoria_expira_horas is not null
     and a.created_at + (e.reserva_provisoria_expira_horas || ' hours')::interval < now();

  update agendamentos a
     set status = 'cancelado',
         expirado_automaticamente = true
   where a.finalizado = true
     and a.status in ('pendente', 'aguardando_sinal')
     and a.periodo is not null
     and a.data >= '2026-09-11'
     and upper(a.periodo) < (now() at time zone 'America/Sao_Paulo');
end;
$function$;
