-- Serviço com SEGUNDA DATA (Etapa 3b) — o VÍNCULO do par nas leituras da
-- cliente.
--
-- Duas funções de sql/rpcs_leitura_cliente.sql passam a devolver mais TRÊS
-- colunas (ver sql/segunda_data_reserva_grupo.sql):
--
--   reserva_grupo_id     – o uuid que amarra as duas linhas do par. NULL na
--                          esmagadora maioria das linhas: par é a exceção.
--   papel_reserva        – 'principal' (o atendimento que importa, onde o
--                          sinal fica preso) ou 'anterior' (o "teste"). NULL
--                          numa linha solta.
--   nome_etapa_anterior  – como o SALÃO chama a etapa anterior ("Teste",
--                          "Prova", "Ensaio"), vindo de `servicos` pelo LEFT
--                          JOIN que já existia. NULL = o salão não deu nome, e
--                          aí vale o padrão da UI ("Teste"), que vive lá e não
--                          aqui, de propósito — ver o comentário da coluna no
--                          arquivo de schema.
--
-- As duas funções:
--
--   agendamentos_cliente_ativos      – a lista do PainelCliente. É dela que
--                                      saem TAMBÉM a tela de sinal
--                                      (reservaAguardandoSinal) e o protocolo
--                                      reaberto (reservaEmProtocolo): as duas
--                                      são recortes EM MEMÓRIA da mesma
--                                      lista, em app/[salon]/page.js, não
--                                      funções à parte. Uma função só cobre
--                                      os três lugares que oferecem "Editar
--                                      agendamento" no fluxo público.
--   agendamentos_cliente_historico   – o histórico do mesmo painel. Não
--                                      oferece remarcação (as linhas já estão
--                                      concluídas/canceladas), mas vai junto
--                                      pra que "este agendamento tinha duas
--                                      datas" seja dizível em qualquer lista
--                                      da cliente sem uma segunda rodada de
--                                      migration depois.
--
-- Rode no SQL Editor do Supabase (STAGING primeiro), inteiro, de uma vez.
-- Idempotente: `drop ... if exists` da assinatura exata + `create or replace`
-- deixa rodar de novo sem erro, quantas vezes for.
--
-- PRÉ-REQUISITO: sql/segunda_data_reserva_grupo.sql já aplicado neste banco.
-- Sem as colunas, o `create` falha na hora com 42703 — o que é o desfecho
-- certo: a função velha já foi dropada, e o arquivo para antes de deixar
-- qualquer coisa meio feita.
--
-- ---------------------------------------------------------------------------
-- POR QUE DROP, E NÃO SÓ `create or replace`
-- ---------------------------------------------------------------------------
-- `create or replace function` recusa qualquer mudança no TIPO DE RETORNO com
-- 42P13 ("cannot change return type of existing function"), e acrescentar
-- coluna a um RETURNS TABLE é exatamente isso. O drop é da assinatura EXATA
-- (os tipos dos PARÂMETROS, que não mudam) — e SEM `cascade`, de propósito:
-- se alguma coisa depender destas funções, o drop falha e o arquivo inteiro
-- para, em vez de arrastar a dependência junto em silêncio.
--
-- DEPENDÊNCIAS CONFERIDAS antes de escrever isto: nenhuma outra função, view
-- ou trigger do repositório chama as duas (grep em sql/ e no app). Quem chama
-- é só o JS, por PostgREST:
--   agendamentos_cliente_ativos     -> buscarAgendamentosAtivos
--                                      (lib/agendamentosCliente.js), usada
--                                      pelo painel público E pela ficha do
--                                      cliente no /admin (lib/clientesAdmin.js).
--   agendamentos_cliente_historico  -> buscarHistoricoRecente (mesmo arquivo).
-- Se quiser a certeza do lado de lá antes de rodar, a consulta de inventário
-- do fim deste arquivo lista as duas com assinatura, retorno e grants.
--
-- ---------------------------------------------------------------------------
-- O QUE MUDA NO CORPO: NADA ALÉM DAS TRÊS COLUNAS
-- ---------------------------------------------------------------------------
-- Os corpos abaixo foram EXTRAÍDOS do arquivo original e conferidos por diff:
-- as únicas diferenças são as três colunas no fim do RETURNS TABLE e as três
-- expressões no fim do SELECT. Filtros, joins, ordenação, `language sql`,
-- `stable`, `security definer` e o `set search_path` continuam palavra por
-- palavra os de lá. Mexeu num, confira o outro.
--
-- NENHUM JOIN NOVO: `nome_etapa_anterior` sai do MESMO `left join servicos`
-- que já alimentava `servico_nome`. LEFT, e é isso que a mantém correta no
-- caso do agendamento importado do Google Calendar (servico_id nulo): a
-- coluna volta NULL em vez de a linha sumir da lista.
--
-- As colunas entram no FIM das duas listas, nunca no meio: a ordem do RETURNS
-- TABLE e a do SELECT precisam casar posição a posição (divergir aí é o
-- clássico "structure of query does not match function result type", e só em
-- tempo de EXECUÇÃO). Pro app dá na mesma — o PostgREST devolve objetos JSON,
-- lidos por NOME.
--
-- Por que as TRÊS, e não só `reserva_grupo_id`: o grupo diz "esta linha tem
-- irmã", o papel diz qual das duas ela é, e o nome é a palavra que a tela
-- escreve ao lado da data ("Teste: 13/11 às 10:00"). Sem o papel, um par
-- apareceria como duas linhas simétricas e nenhuma saberia qual manda; sem o
-- nome, a tela teria a segunda data e nenhum rótulo verdadeiro pra ela — só o
-- padrão, que estaria errado justamente nos salões que se deram ao trabalho
-- de configurar o próprio.
--
-- As três são inócuas na mão do anônimo: um uuid opaco, um rótulo de duas
-- opções e um nome de etapa que o salão já publica no próprio /agendar — os
-- três sobre uma linha que já é dela (o filtro por (estabelecimento_id,
-- telefone) continua igual). Nenhuma coluna de dinheiro, nome ou telefone de
-- terceiro entra aqui — o critério do arquivo original ("exatamente as
-- colunas que a tela usa, nem uma a mais") vale inteiro.
--
-- ---------------------------------------------------------------------------
-- ORDEM: DROP, CREATE, GRANT
-- ---------------------------------------------------------------------------
-- O drop leva os grants junto (eles pertencem à FUNÇÃO, não ao nome), então
-- os revoke/grant do fim deste arquivo não são zelo: sem eles as funções
-- renascem sem permissão nenhuma pra `anon`, e o painel público inteiro volta
-- vazio — sem erro de tela, porque as funções JS tratam falha devolvendo
-- lista vazia. São os MESMOS do arquivo original, copiados palavra por
-- palavra.

-- ---------------------------------------------------------------------------
-- 1. agendamentos_cliente_ativos — a lista do painel (e o protocolo, e o sinal)
-- ---------------------------------------------------------------------------
-- As colunas a mais desta função ligam, de uma vez, coisas que já estão
-- escritas no app e hoje são inertes por falta do campo:
--   * o "Editar agendamento" some da tela de sinal, do protocolo reaberto e
--     da sub-tela de sinal do PainelCliente quando a linha tem irmã —
--     remarcar meio par deixaria a etapa anterior apontando pra um evento que
--     já não existe;
--   * o wizard, se for aberto em modo edição com um par, cai no aviso "fale
--     com o salão" em vez de oferecer o fluxo.
--
-- E `nome_etapa_anterior` é o que falta pras telas que MOSTRAM o par (painel,
-- protocolo reaberto) escreverem o rótulo do salão em vez do padrão. Essa
-- parte ainda depende de mudança no JS — as duas linhas do par chegam como
-- dois registros soltos, e agrupá-las é trabalho de lá.
drop function if exists public.agendamentos_cliente_ativos(bigint, text);

create or replace function public.agendamentos_cliente_ativos(
  p_estabelecimento_id bigint,
  p_telefone           text
)
returns table (
  id              uuid,
  data            date,
  horario         time,
  duracao_min     integer,
  status          text,
  servico_id      bigint,
  profissional_id bigint,
  pendente_desde  timestamptz,
  servico_nome    text,
  reserva_grupo_id uuid,
  papel_reserva    text,
  nome_etapa_anterior text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select a.id,
         a.data,
         a.horario,
         a.duracao_min,
         a.status,
         a.servico_id,
         a.profissional_id,
         a.pendente_desde,
         s.nome,
         a.reserva_grupo_id,
         a.papel_reserva,
         s.nome_etapa_anterior
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
    left join public.servicos s on s.id = a.servico_id
   where a.estabelecimento_id = p_estabelecimento_id
     and e.ativo = true
     and a.telefone = public.normalizar_telefone(p_telefone)
     and a.status in ('pendente', 'confirmado', 'concluido', 'aguardando_sinal')
     and a.finalizado = true
   order by a.data, a.horario;
$fn$;


-- ---------------------------------------------------------------------------
-- 2. agendamentos_cliente_historico — o histórico do mesmo painel
-- ---------------------------------------------------------------------------
-- Aqui as três colunas ainda não têm consumidor: nenhuma tela de histórico
-- fala do par hoje. Vão junto porque a alternativa é uma segunda migration
-- (outro drop, outro create, outra janela em que a assinatura muda) no dia em
-- que a primeira lista de histórico quiser dizer "este era o teste do
-- casamento" — e porque deixar as duas funções do mesmo painel com formatos
-- diferentes é o tipo de assimetria de que ninguém lembra depois.
drop function if exists public.agendamentos_cliente_historico(bigint, text, integer);

create or replace function public.agendamentos_cliente_historico(
  p_estabelecimento_id bigint,
  p_telefone           text,
  p_dias               integer default 30
)
returns table (
  id                       uuid,
  data                     date,
  horario                  time,
  status                   text,
  expirado_automaticamente boolean,
  servico_nome             text,
  reserva_grupo_id         uuid,
  papel_reserva            text,
  nome_etapa_anterior      text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select a.id,
         a.data,
         a.horario,
         a.status,
         a.expirado_automaticamente,
         s.nome,
         a.reserva_grupo_id,
         a.papel_reserva,
         s.nome_etapa_anterior
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
    left join public.servicos s on s.id = a.servico_id
   where a.estabelecimento_id = p_estabelecimento_id
     and e.ativo = true
     and a.telefone = public.normalizar_telefone(p_telefone)
     and a.status in ('concluido', 'cancelado')
     and a.expirado_automaticamente is not true
     and a.data >= ((now() at time zone 'America/Sao_Paulo')::date
                    - least(greatest(coalesce(p_dias, 30), 1), 3650))
   order by a.data desc, a.horario desc;
$fn$;

-- ---------------------------------------------------------------------------
-- PERMISSÕES — idênticas às de sql/rpcs_leitura_cliente.sql
-- ---------------------------------------------------------------------------
-- `revoke ... from public` antes do grant porque toda função nasce com
-- EXECUTE pra PUBLIC; sem o revoke, o grant seria decorativo. `authenticated`
-- entra junto porque o mesmo componente público roda logado quando a dona
-- abre o próprio link com a sessão do /admin aberta — e porque
-- agendamentos_cliente_ativos é de fato usada pelo /admin, nos "Próximos
-- agendamentos" da ficha do cliente (lib/clientesAdmin.js).
revoke execute on function public.agendamentos_cliente_ativos(bigint, text) from public;
revoke execute on function public.agendamentos_cliente_historico(bigint, text, integer) from public;

grant execute on function public.agendamentos_cliente_ativos(bigint, text) to anon, authenticated;
grant execute on function public.agendamentos_cliente_historico(bigint, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- INVENTÁRIO — rode DEPOIS, pra conferir assinatura, retorno e grants
-- ---------------------------------------------------------------------------
-- As duas linhas devem sair com `reserva_grupo_id uuid`, `papel_reserva text`
-- e `nome_etapa_anterior text` — nessa ordem, no FIM de `retorno` —, com
-- `security_definer = t`, `volatilidade = s` e, em `permissoes`, as entradas
-- `anon=X/...` e `authenticated=X/...`. Uma entrada `=X/...` sem nada antes
-- do `=` seria o PUBLIC que o revoke tirou: se ela aparecer, o revoke não
-- rodou.
--
-- select p.proname                                 as funcao,
--        pg_get_function_identity_arguments(p.oid) as parametros,
--        pg_get_function_result(p.oid)             as retorno,
--        p.prosecdef                               as security_definer,
--        p.provolatile                             as volatilidade,  -- 's' = stable
--        coalesce(array_to_string(p.proacl, ' | '), '(sem acl: EXECUTE pra PUBLIC)')
--                                                  as permissoes
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('agendamentos_cliente_ativos', 'agendamentos_cliente_historico')
--  order by p.proname;
--
-- Um teste de fumaça, com um salão e um telefone reais (substitua os dois).
-- Num par, as DUAS linhas saem aqui — mesma `reserva_grupo_id`, papéis
-- diferentes, e o `nome_etapa_anterior` repetido nas duas (é do serviço, não
-- da linha):
--
-- select id, data, horario, status,
--        reserva_grupo_id, papel_reserva, nome_etapa_anterior
--   from public.agendamentos_cliente_ativos(1, '24999999999')
--  order by data, horario;

-- ---------------------------------------------------------------------------
-- ROLLBACK — volta as duas ao formato de sql/rpcs_leitura_cliente.sql
-- ---------------------------------------------------------------------------
-- NÃO basta dropar: dropar sozinho deixa o painel da cliente sem caminho de
-- leitura nenhum (lista vazia em tudo, sem erro de tela). Desfazer é dropar E
-- rodar de novo o sql/rpcs_leitura_cliente.sql, que recria as duas no formato
-- antigo com os mesmos grants:
--
-- drop function if exists public.agendamentos_cliente_historico(bigint, text, integer);
-- drop function if exists public.agendamentos_cliente_ativos(bigint, text);
-- -- e então rode sql/rpcs_leitura_cliente.sql inteiro.
--
-- O JS não precisa de rollback junto: ele lê os campos com `!= null` /
-- `?? null`, e coluna ausente volta a ser `undefined` — que é exatamente o
-- estado de hoje (o botão "Editar" aparecendo como sempre).
