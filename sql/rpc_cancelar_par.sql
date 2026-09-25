-- Serviço com SEGUNDA DATA (Etapa 5) — cancelamento do PAR pela cliente.
--
-- `agendamento_cancelar_cliente(uuid)` (sql/rpcs_agendamento_publico.sql) age
-- numa linha só. Num par (duas linhas com o mesmo `reserva_grupo_id`, papéis
-- 'principal' e 'anterior') isso deixava a outra linha de pé. Esta função
-- cancela a linha pedida E a irmã, numa única transação. A função antiga NÃO
-- é alterada: quem cancela linha sem par continua chamando ela, e o contrato
-- dos demais chamadores fica intacto.
--
-- Rode no SQL Editor do Supabase: STAGING primeiro, PRODUÇÃO depois. Inteiro,
-- de uma vez. Idempotente (`create or replace` + revoke/grant repetíveis).
--
-- PRÉ-REQUISITO: sql/segunda_data_reserva_grupo.sql já aplicado neste banco.
-- Sem a coluna `reserva_grupo_id` o `create` PASSA (o plpgsql só valida os
-- nomes de coluna na primeira execução) e toda chamada falha com 42703 —
-- então confirme o pré-requisito ANTES de rodar este arquivo.
--
-- ORDEM DE DEPLOY: esta função tem que existir no banco ANTES do merge do JS
-- que a chama (lib/agendamentosCliente.js, parâmetro `comPar`). Invertida, o
-- cancelamento de um par pelo painel da cliente falha até o SQL rodar.
--
-- ---------------------------------------------------------------------------
-- Contrato
-- ---------------------------------------------------------------------------
--   agendamento_cancelar_cliente_par(p_id uuid) returns text
--
--   Devolve o STATUS ANTERIOR da linha p_id ('pendente' | 'aguardando_sinal' |
--   'confirmado'), igual à função antiga — é ele que decide se a dona é
--   avisada no WhatsApp. NULL = nada foi gravado (linha inexistente, salão
--   inativo, ou p_id num status que este fluxo não cancela). Nesse caso a
--   irmã também NÃO é tocada: o gesto é sobre a p_id.
--
--   Sem `reserva_grupo_id` na p_id, age só nela (mesmo efeito da função
--   antiga).
--
-- ---------------------------------------------------------------------------
-- O que é escrito
-- ---------------------------------------------------------------------------
--   p_id      -> status = 'cancelado', cancelado_por_cliente = true
--   irmãs     -> status = 'cancelado' (SÓ o status)
--
-- `cancelado_por_cliente = true` só na p_id de propósito: é essa flag que
-- faz o trigger trg_criar_pendencia_cancelamento criar o card "Cancelado pelo
-- cliente" e a rota /api/notificacoes mandar a push. Com a flag nas duas
-- linhas a dona receberia dois cards e duas pushes pelo mesmo gesto.
--
-- Irmã = mesmo reserva_grupo_id, MESMO estabelecimento e MESMO telefone da
-- p_id. As duas últimas condições são cinto: o grupo nasce junto, na mesma
-- chamada de agendamento_criar_par, então numa linha legítima elas sempre
-- batem; se algum dia não baterem, a irmã fica de fora em vez de ser
-- cancelada por um uuid de outra cliente.
-- Só as irmãs em pendente/aguardando_sinal/confirmado são canceladas; uma já
-- cancelada ou concluída fica como está.
--
-- ---------------------------------------------------------------------------
-- Concorrência
-- ---------------------------------------------------------------------------
-- Todas as linhas do conjunto (p_id + irmãs) são travadas de uma vez, num
-- único `select ... order by id for update`. A ordem fixa por id evita
-- deadlock quando duas chamadas chegam ao mesmo tempo por pontas diferentes
-- do mesmo par (uma pela principal, outra pela anterior): as duas pedem os
-- locks na mesma sequência. O status da p_id é lido DEPOIS do lock.
--
-- Sem bloco EXCEPTION, como nas demais RPCs públicas: qualquer erro sobe com
-- o SQLSTATE intacto e a transação inteira desfaz, então as duas linhas
-- cancelam juntas ou nenhuma cancela.

create or replace function public.agendamento_cancelar_cliente_par(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_grupo  uuid;
  v_est    bigint;
  v_tel    text;
  v_status text;
begin
  -- 1) Identifica o grupo da linha pedida (sem lock ainda). Salão ativo é
  --    pré-requisito, igual à função antiga.
  select a.reserva_grupo_id, a.estabelecimento_id, a.telefone
    into v_grupo, v_est, v_tel
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
   where a.id = p_id
     and e.ativo = true;

  if not found then
    return null;
  end if;

  -- 2) Trava a p_id e as irmãs, em ordem fixa de id.
  perform 1
     from public.agendamentos a
    where a.id = p_id
       or (
            v_grupo is not null
        and a.reserva_grupo_id = v_grupo
        and a.estabelecimento_id = v_est
        and a.telefone = v_tel
          )
    order by a.id
      for update of a;

  -- 3) Status da p_id sob o lock (pode ter mudado entre o passo 1 e o 2).
  select a.status
    into v_status
    from public.agendamentos a
   where a.id = p_id;

  if v_status is null
     or v_status not in ('pendente', 'aguardando_sinal', 'confirmado') then
    return null;
  end if;

  -- 4) A linha pedida: a única que carrega a flag do trigger.
  update public.agendamentos
     set status = 'cancelado',
         cancelado_por_cliente = true
   where id = p_id;

  -- 5) As irmãs: só o status.
  if v_grupo is not null then
    update public.agendamentos
       set status = 'cancelado'
     where reserva_grupo_id = v_grupo
       and estabelecimento_id = v_est
       and telefone = v_tel
       and id <> p_id
       and status in ('pendente', 'aguardando_sinal', 'confirmado');
  end if;

  return v_status;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
-- Mesmo desenho das outras RPCs do fluxo público: REVOKE de PUBLIC antes do
-- GRANT (toda função nasce com EXECUTE pra PUBLIC). `authenticated` entra
-- porque o painel da cliente também roda logado quando a dona abre o próprio
-- link com a sessão do /admin aberta.
revoke execute on function public.agendamento_cancelar_cliente_par(uuid) from public;
grant execute on function public.agendamento_cancelar_cliente_par(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferência (rode DEPOIS, à mão, só em STAGING, com um par de teste)
-- ---------------------------------------------------------------------------
-- 1) Permissões: anon e authenticated devem dar true; public deve dar false.
--    select has_function_privilege('anon',
--             'public.agendamento_cancelar_cliente_par(uuid)', 'execute');
--    select has_function_privilege('authenticated',
--             'public.agendamento_cancelar_cliente_par(uuid)', 'execute');
--
-- 2) Comportamento, com o id da PRINCIPAL de um par de teste:
--    select public.agendamento_cancelar_cliente_par('<id-da-principal>');
--    -- devolve o status anterior ('pendente', 'aguardando_sinal' ou
--    -- 'confirmado'); rodar de novo devolve NULL (já cancelada).
--    select id, papel_reserva, status, cancelado_por_cliente
--      from public.agendamentos
--     where reserva_grupo_id = '<reserva_grupo_id-do-par>';
--    -- as DUAS em 'cancelado'; cancelado_por_cliente = true só na principal.
--    select count(*) from public.pendencias_admin
--     where tipo = 'cancelamento_cliente'
--       and agendamento_id in (select id from public.agendamentos
--                               where reserva_grupo_id = '<reserva_grupo_id-do-par>');
--    -- exatamente 1.
--
-- 3) Linha SEM par: o mesmo select devolve o status anterior e cancela só ela.
--
-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- drop function if exists public.agendamento_cancelar_cliente_par(uuid);
