-- Serviço com SEGUNDA DATA (Etapa 6) — fidelidade do painel PÚBLICO.
--
-- A contagem de visitas da fidelidade (lib/fidelidade.js ->
-- contarServicosFidelidadePublico) parte das linhas devolvidas por
-- `fidelidade_base_cliente`. Num par (duas linhas com o mesmo
-- `reserva_grupo_id`), a etapa 'anterior' também é 'confirmado'/'concluido' e
-- inflava a contagem: o par tem que valer UMA visita. Esta versão deixa a
-- anterior de fora, no próprio `where`.
--
-- ÚNICA mudança em relação à função de sql/rpcs_leitura_cliente.sql (seção 6):
-- uma linha a mais no `where`,
--
--     and a.papel_reserva is distinct from 'anterior'
--
-- (`is distinct from` e não `<>`: `papel_reserva` é NULL na esmagadora maioria
-- das linhas, e `<>` com NULL descartaria todas.) Mesma assinatura, mesmo
-- retorno, mesmos grants. A função foi extraída do arquivo original por
-- script, não digitada de novo.
--
-- O lado do /admin (contarServicosFidelidade) filtra a anterior no JS e não
-- passa por aqui.
--
-- Rode no SQL Editor do Supabase: STAGING primeiro, PRODUÇÃO depois. Inteiro,
-- de uma vez. Idempotente (`create or replace`).
--
-- PRÉ-REQUISITO: sql/segunda_data_reserva_grupo.sql já aplicado neste banco.
-- Sem a coluna `papel_reserva` o `create` falha na hora com 42703 (função
-- `language sql` valida o corpo na criação) — o que é o desfecho certo: a
-- função atual continua intacta.
--
-- Como `create or replace` não muda o tipo de retorno, esta função pode ir pro
-- banco antes OU depois do JS; nada no JS depende dela.
--
-- ROLLBACK: rodar de novo a seção 6 de sql/rpcs_leitura_cliente.sql.

create or replace function public.fidelidade_base_cliente(
  p_estabelecimento_id bigint,
  p_telefone           text
)
returns table (
  data          date,
  horario       time,
  duracao_min   integer,
  status        text,
  eh_manutencao boolean,
  resgatado_em  timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select a.data,
         a.horario,
         a.duracao_min,
         a.status,
         s.eh_manutencao,
         (select max(r.resgatado_em)
            from public.fidelidade_resgates r
            join public.clientes c on c.id = r.cliente_id
           where r.estabelecimento_id = p_estabelecimento_id
             and public.normalizar_telefone(c.whatsapp)
                 = public.normalizar_telefone(p_telefone))
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
    left join public.servicos s on s.id = a.servico_id
   where a.estabelecimento_id = p_estabelecimento_id
     and e.ativo = true
     and a.telefone = public.normalizar_telefone(p_telefone)
     and a.status in ('confirmado', 'concluido')
     and a.papel_reserva is distinct from 'anterior';
$fn$;

-- ---------------------------------------------------------------------------
-- Permissões (idênticas às do arquivo original; repetir é inofensivo)
-- ---------------------------------------------------------------------------
revoke execute on function public.fidelidade_base_cliente(bigint, text) from public;
grant execute on function public.fidelidade_base_cliente(bigint, text) to anon, authenticated;
