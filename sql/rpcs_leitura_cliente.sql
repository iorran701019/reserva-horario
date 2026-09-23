-- RPCs de LEITURA do fluxo público (papel anon), Etapa 7 do plano de
-- fechamento da RLS de `agendamentos`.
--
-- Fecham o último buraco de LEITURA do fluxo da cliente. Hoje o painel
-- público lê `agendamentos` direto, amparado pela policy "leitura de slots
-- para anonimos" (SELECT, anon, using = true), que devolve QUALQUER coluna de
-- QUALQUER linha de QUALQUER salão — nome, telefone, valores, caminho do
-- comprovante do Pix. Basta trocar o filtro do PostgREST. O mesmo vale pro
-- contador de fidelidade, hoje amparado por `fidelidade_resgates_public_select`.
--
-- Depois que o app passar a chamar estas funções, as DUAS policies caem
-- (Etapa 8). A disponibilidade pública NÃO depende delas: ela lê a view
-- `slots_ocupados`, que roda como dono e já expõe só o mínimo — não mexer.
--
-- Mesmas convenções dos dois arquivos anteriores
-- (sql/rpcs_agendamento_publico.sql e sql/rpc_criacao_agendamento.sql):
-- SECURITY DEFINER, `set search_path = public, pg_temp` (pg_temp SEMPRE no
-- fim), delimitador $fn$, salão ativo como pré-requisito, revoke de PUBLIC
-- antes do grant, rollback comentado no fim.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de STAGING primeiro).
--
-- ---------------------------------------------------------------------------
-- O CRITÉRIO QUE DEFINE O ARQUIVO INTEIRO
-- ---------------------------------------------------------------------------
-- Cada função devolve EXATAMENTE as colunas que a tela já usa hoje, nem uma a
-- mais. O que some do alcance do anônimo, e some de propósito:
--
--   nome_cliente, telefone          – a cliente já sabe os próprios; ver os de
--                                     outra pessoa é justamente o vazamento.
--   sinal_valor_centavos,
--   sinal_declarado_pago,
--   comprovante_pix_url,
--   abacatepay_*                    – dinheiro e comprovante. O caminho do
--                                     comprovante é ponteiro pra um arquivo em
--                                     bucket privado; não circula por aqui.
--   observacoes, servico_livre,
--   cancelado_pelo_salao,
--   etiqueta / anotações            – cozinha do /admin, não do painel.
--
-- Todas são STABLE: só leem. E todas filtram por
-- (estabelecimento_id, telefone normalizado), que é o recorte do painel — a
-- cliente identificada vê o que é dela naquele salão, e nada além.
--
-- O QUE ISTO NÃO RESOLVE, dito sem eufemismo: o telefone continua sendo o
-- único fator. Quem souber o número de outra pessoa vê os agendamentos dela
-- neste salão — igual a hoje, porque é assim que o fluxo público identifica a
-- cliente (ver IdentificacaoCliente). O ganho aqui é que o alcance deixa de
-- ser "a tabela inteira de todos os salões" e passa a ser "as colunas de tela
-- de um telefone num salão". Um segundo fator é decisão de produto, fora da
-- Etapa 7.
--
-- NADA de regra de negócio aqui dentro. Quem classifica um agendamento
-- (`classificarAgendamento`, lib/particao.js — "o confirmado que já passou do
-- horário conta como histórico") continua sendo o app, exatamente como hoje.
-- Reimplementar essa régua em SQL criaria duas versões da mesma regra, e elas
-- divergem com o tempo. Por isso várias funções devolvem LINHAS e não
-- respostas: o corte fino continua no JS, sobre os mesmos campos de sempre.
--
-- ---------------------------------------------------------------------------
-- TIPOS A CONFIRMAR NO BANCO ANTES DE RODAR
-- ---------------------------------------------------------------------------
-- Um RETURNS TABLE com tipo diferente do da coluna faz a função falhar em
-- tempo de EXECUÇÃO ("structure of query does not match function result
-- type"), não na criação. Estes não estavam na lista confirmada e foram
-- assumidos pelo uso — confira antes de aplicar:
--
--   agendamentos.pendente_desde            -> assumido timestamptz
--   agendamentos.expirado_automaticamente  -> assumido boolean
--   agendamentos.finalizado                -> assumido boolean
--   agendamentos.origem                    -> assumido text
--   servicos.eh_manutencao                 -> assumido boolean
--   servicos.nome                          -> assumido text
--   clientes.whatsapp                      -> assumido text
--   fidelidade_resgates.estabelecimento_id -> assumido bigint (FK pra
--                                             estabelecimentos.id, que é bigint)
--   fidelidade_resgates.resgatado_em       -> assumido timestamptz
--
-- Conferência rápida:
--   select table_name, column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('agendamentos', 'servicos', 'clientes', 'fidelidade_resgates')
--      and column_name in ('pendente_desde','expirado_automaticamente','finalizado',
--                          'origem','eh_manutencao','nome','whatsapp',
--                          'estabelecimento_id','resgatado_em')
--    order by table_name, column_name;

-- ---------------------------------------------------------------------------
-- 0. Normalização do telefone (helper interno)
-- ---------------------------------------------------------------------------
-- A MESMA conta de normalizarWhatsapp (lib/whatsappValidacao.js) e do bloco 1
-- de agendamento_criar: só dígitos, e o 55 colado na frente de um número já
-- internacional sai. Extraída porque agora são SEIS funções aplicando a mesma
-- regra — repetir o regexp em cada uma é exatamente como as duas grafias do
-- mesmo número nascem.
--
-- Diferente de agendamento_criar, aqui NÃO há checagem de comprimento: estas
-- são leituras. Telefone vazio ou malformado vira string vazia, que não casa
-- com nenhuma linha, e a função retorna conjunto vazio — o mesmo desfecho do
-- `.eq("telefone", "")` de hoje.
--
-- IMMUTABLE porque a saída depende só da entrada — assim o planner pode
-- avaliá-la uma vez e usar o índice de (estabelecimento_id, telefone).
--
-- Não recebe grant: só é chamada de dentro de funções SECURITY DEFINER, que
-- rodam como dono.
create or replace function public.normalizar_telefone(p_telefone text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
           when length(t.d) = 13 and left(t.d, 2) = '55' then substr(t.d, 3)
           else t.d
         end
    from (select regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') as d) t;
$fn$;

-- ---------------------------------------------------------------------------
-- 1. Agendamentos ATIVOS da cliente
-- ---------------------------------------------------------------------------
-- Substitui a query de buscarAgendamentosAtivos (lib/agendamentosCliente.js).
-- É ela que alimenta a lista do PainelCliente, e é a lista NÃO VAZIA que faz
-- app/[salon]/page.js abrir o painel em vez do wizard.
--
-- Filtros idênticos aos de hoje: os quatro status de "ainda em jogo"
-- (pendente + confirmado + concluido + aguardando_sinal — 'concluido' entra
-- junto de propósito, ver o comentário da função JS) e finalizado = true, que
-- exclui a reserva provisória abandonada no meio do wizard. Ordem por
-- data/horário crescente, como hoje.
--
-- `servico_nome` vem do LEFT JOIN, ocupando o lugar do `servicos(nome)` do
-- PostgREST — o app remonta o objeto aninhado `servicos: { nome }` pra que
-- nenhum componente precise mudar. LEFT e não INNER: agendamento importado do
-- Google Calendar tem servico_id nulo, e um INNER o sumiria da lista.
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
  servico_nome    text
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
         s.nome
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
-- 2. Histórico recente da cliente
-- ---------------------------------------------------------------------------
-- Substitui buscarHistoricoRecente (lib/agendamentosCliente.js): só o que já
-- foi RESOLVIDO no banco (concluido/cancelado) nos últimos p_dias.
--
-- `expirado_automaticamente` continua saindo do resultado por FILTRO, não por
-- omissão de coluna: é o cron cancelando um pendente vencido, e "Expirado" é
-- linguagem interna do salão — a cliente não deve ver isso no próprio painel.
-- A coluna vai no retorno porque a tela ainda a lê; é um boolean derivado,
-- não vaza nada.
--
-- A DATA LIMITE MUDA DE RELÓGIO, e é a única mudança de comportamento do
-- arquivo: hoje "hoje menos p_dias" é montado com o relógio do NAVEGADOR;
-- aqui sai de America/Sao_Paulo. Pra uma cliente no Brasil é o mesmo dia; num
-- celular com fuso errado, o corte passa a ser o certo em vez do dele.
-- `current_date` daria o dia em UTC (o fuso do processo do Postgres), o que
-- deslocaria o corte pra quem abre o painel de noite — mesmo cuidado do
-- cálculo de antecedência mínima e do bloco 7 de agendamento_criar.
--
-- p_dias é limitado a 1..3650: a chamada real manda 30, e um número absurdo
-- (ou negativo) vindo do navegador não deve virar varredura da tabela inteira
-- nem janela invertida.
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
  servico_nome             text
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
         s.nome
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
-- 3. Janela do prazo mínimo entre agendamentos
-- ---------------------------------------------------------------------------
-- Substitui a query de buscarConflitoPrazoMinimo (lib/agendamentosCliente.js).
-- Devolve a JANELA CRUA — os agendamentos da cliente entre (alvo - prazo) e
-- (alvo + prazo) — e para aí. O corte fino (distância ESTRITAMENTE menor que
-- o prazo, `idsIgnorados`, e qual é o mais próximo) continua no JS, onde já
-- estava.
--
-- Motivo de não terminar a conta aqui: `idsIgnorados` são as linhas que são a
-- PRÓPRIA tentativa em curso (a reserva antecipada desta sessão, o
-- agendamento em edição, os já decididos num popup anterior). Mandar esse
-- conjunto pro banco só pra ele filtrar não compra nada, e duplicaria em SQL
-- a régua de "7 dias de prazo aceita dois agendamentos a exatos 7 dias".
--
-- Filtros idênticos aos de hoje, incluindo o `finalizado OR origem =
-- 'importado'`: evento importado do Google Calendar nasce finalizado=false,
-- mas um evento já vinculado a uma cliente é atendimento real e precisa
-- conflitar.
--
-- p_prazo_dias limitado a 1..3650 pelo mesmo motivo do item 2. O JS já recusa
-- prazo não-inteiro ou <= 0 antes de chamar; aqui é o cinto.
--
-- Esta é a única função do arquivo usada por um gesto do /admin (o gate de
-- prazo ao confirmar um pendente, em app/[salon]/admin/page.js) além do
-- fluxo público — daí `authenticated` no grant valer pra ela de verdade, e
-- não só pela dona abrindo o próprio link logada.
create or replace function public.agendamentos_cliente_janela_prazo(
  p_estabelecimento_id bigint,
  p_telefone           text,
  p_data               date,
  p_prazo_dias         integer
)
returns table (
  id           uuid,
  data         date,
  horario      time,
  status       text,
  servico_id   bigint,
  servico_nome text
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
         a.servico_id,
         s.nome
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
    left join public.servicos s on s.id = a.servico_id
   where a.estabelecimento_id = p_estabelecimento_id
     and e.ativo = true
     and a.telefone = public.normalizar_telefone(p_telefone)
     and a.status in ('pendente', 'confirmado', 'concluido', 'aguardando_sinal')
     and (a.finalizado = true or a.origem = 'importado')
     and p_data is not null
     and a.data >= p_data - least(greatest(coalesce(p_prazo_dias, 1), 1), 3650)
     and a.data <= p_data + least(greatest(coalesce(p_prazo_dias, 1), 1), 3650)
   order by a.data, a.horario;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Agendamentos da cliente PARA UM SERVIÇO (não cancelados)
-- ---------------------------------------------------------------------------
-- Substitui existeManutencaoAtiva (lib/manutencaoSugerida.js): serve pra não
-- sugerir de novo uma manutenção que a cliente já tem marcada.
--
-- Devolve linhas, não um boolean, porque quem decide "ainda está ativo" é
-- classificarAgendamento no JS — 'concluido' vem junto no `<> 'cancelado'` e é
-- o próprio classificador que o manda pro histórico. Um boolean aqui exigiria
-- repetir essa régua em SQL (ver o critério no topo).
create or replace function public.agendamentos_cliente_por_servico(
  p_estabelecimento_id bigint,
  p_telefone           text,
  p_servico_id         bigint
)
returns table (
  id          uuid,
  data        date,
  horario     time,
  duracao_min integer,
  status      text
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
         a.status
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
   where a.estabelecimento_id = p_estabelecimento_id
     and e.ativo = true
     and a.telefone = public.normalizar_telefone(p_telefone)
     and a.servico_id = p_servico_id
     and a.status <> 'cancelado';
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Últimos atendimentos de SUCESSO da cliente
-- ---------------------------------------------------------------------------
-- UMA função no lugar de DUAS queries JS que só diferiam por um filtro: a
-- varredura ampla de buscarManutencaoSugerida (todos os serviços) e a busca
-- mirada de buscarUltimoConcluidoDoServico (um servico_id já conhecido, usada
-- por calcularPrecoManutencao e buscarVencimentoManutencao). `p_servico_id`
-- nulo = sem filtro de serviço; preenchido = só aquele.
--
-- Mesmos status (confirmado + concluido), mesma ordem (mais recente primeiro)
-- e o MESMO `limit 5` de hoje. O 5 não é arbitrário e não pode virar 1: quem
-- procura o "concluído mais recente" é `primeiroConcluido` no JS, que percorre
-- a lista aplicando classificarAgendamento — um 'confirmado' ainda no futuro
-- encabeça a lista sem ser concluído, e sem a folga de 5 a busca voltaria
-- vazia.
create or replace function public.agendamentos_cliente_ultimos_sucesso(
  p_estabelecimento_id bigint,
  p_telefone           text,
  p_servico_id         bigint default null
)
returns table (
  id          uuid,
  data        date,
  horario     time,
  duracao_min integer,
  status      text,
  servico_id  bigint
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
         a.servico_id
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
   where a.estabelecimento_id = p_estabelecimento_id
     and e.ativo = true
     and a.telefone = public.normalizar_telefone(p_telefone)
     and a.status in ('confirmado', 'concluido')
     and (p_servico_id is null or a.servico_id = p_servico_id)
   order by a.data desc, a.horario desc
   limit 5;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Base do contador de fidelidade
-- ---------------------------------------------------------------------------
-- Substitui, SÓ NO RAMO PÚBLICO, as duas leituras de contarServicosFidelidade
-- (lib/fidelidade.js) que a Etapa 8 deixaria sem policy: a de `agendamentos` e
-- a do último `fidelidade_resgates`. O /admin continua lendo as duas direto,
-- como `authenticated`, pela policy fidelidade_resgates_admin_all — nada muda
-- lá.
--
-- Devolve as LINHAS que o contador filtra, não o número: quem decide se um
-- atendimento conta é classificarAgendamento no JS (ver o critério no topo).
--
-- `resgatado_em` é um escalar por cliente e se repete em toda linha. É
-- deliberado: evita uma segunda RPC só pra ele, e o caso "nenhum agendamento"
-- não perde nada — sem linhas a contagem é 0, com ou sem resgate conhecido.
--
-- `fidelidade_conta_manutencao` NÃO vem daqui: continua saindo do select de
-- `estabelecimentos` que o JS já faz (tabela de leitura pública legítima, fora
-- do escopo da Etapa 8). O que vem é `eh_manutencao` por linha, que é o dado
-- que o filtro precisa.
--
-- COMO O CLIENTE É RESOLVIDO, e a única diferença de comportamento: hoje o JS
-- parte de um `clienteId` e vai buscar o whatsapp dele; aqui parte do telefone
-- e acha o(s) cliente(s). Se o salão tiver DUAS linhas em `clientes` com o
-- mesmo número em grafias diferentes (base legada com máscara — ver
-- normalizar_telefone acima), os resgates das duas entram e vale o mais
-- recente. É o desfecho correto: quem resgatou foi a pessoa, não a linha. A
-- comparação normalizada dos dois lados é o que faz isso funcionar — um
-- `whatsapp` mascarado nunca casaria com o telefone só-dígitos de
-- `agendamentos`.
--
-- Sem filtro de `finalizado` aqui, de propósito: a query que esta função
-- substitui também não tem. Mudar isso agora alteraria a contagem de
-- fidelidade de clientes reais, o que é assunto de outra sessão.
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
     and a.status in ('confirmado', 'concluido');
$fn$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
-- REVOKE de PUBLIC antes do GRANT: toda função nasce com EXECUTE pra PUBLIC, e
-- sem isto os grants abaixo seriam decorativos.
--
-- `normalizar_telefone` fica SEM grant de propósito: é helper interno, e as
-- seis funções a chamam de dentro de um SECURITY DEFINER (papel corrente =
-- dono, que tem EXECUTE de qualquer jeito). O revoke dela cita `anon` e
-- `authenticated` explicitamente porque no Supabase toda função nova já nasce
-- com EXECUTE concedido a esses dois papéis — revogar só de PUBLIC deixaria o
-- helper aberto.
--
-- `authenticated` entra junto porque o mesmo componente público roda logado
-- quando a dona abre o próprio link com a sessão do /admin aberta — e porque
-- duas delas são de fato usadas pelo /admin:
-- agendamentos_cliente_janela_prazo (gate de prazo ao confirmar um pendente) e
-- agendamentos_cliente_ativos ("Próximos agendamentos" da ficha do cliente,
-- via lib/clientesAdmin.js, que reaproveita o mesmo helper do público).
revoke execute on function public.normalizar_telefone(text) from public, anon, authenticated;
revoke execute on function public.agendamentos_cliente_ativos(bigint, text) from public;
revoke execute on function public.agendamentos_cliente_historico(bigint, text, integer) from public;
revoke execute on function public.agendamentos_cliente_janela_prazo(bigint, text, date, integer) from public;
revoke execute on function public.agendamentos_cliente_por_servico(bigint, text, bigint) from public;
revoke execute on function public.agendamentos_cliente_ultimos_sucesso(bigint, text, bigint) from public;
revoke execute on function public.fidelidade_base_cliente(bigint, text) from public;

grant execute on function public.agendamentos_cliente_ativos(bigint, text) to anon, authenticated;
grant execute on function public.agendamentos_cliente_historico(bigint, text, integer) to anon, authenticated;
grant execute on function public.agendamentos_cliente_janela_prazo(bigint, text, date, integer) to anon, authenticated;
grant execute on function public.agendamentos_cliente_por_servico(bigint, text, bigint) to anon, authenticated;
grant execute on function public.agendamentos_cliente_ultimos_sucesso(bigint, text, bigint) to anon, authenticated;
grant execute on function public.fidelidade_base_cliente(bigint, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ÍNDICE
-- ---------------------------------------------------------------------------
-- Todas as seis filtram pelo mesmo par. Sem índice nele, as funções ficam mais
-- lentas que as queries de hoje sem ganho nenhum.
--
-- Sem CONCURRENTLY de propósito: o SQL Editor do Supabase roda o script inteiro
-- dentro de uma transação, e CREATE INDEX CONCURRENTLY não pode rodar em
-- transação. O lock de escrita que a forma normal toma é irrelevante no
-- tamanho atual das tabelas — se `agendamentos` crescer muito, o índice já
-- existe e isto não precisa rodar de novo.
create index if not exists agendamentos_estab_telefone_idx
  on public.agendamentos (estabelecimento_id, telefone);

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Seguro de rodar ENQUANTO as policies "leitura de slots para anonimos" e
-- `fidelidade_resgates_public_select` ainda existirem — ou seja: antes da
-- Etapa 8, e depois dela só recriando as duas junto. Com o app já migrado e as
-- policies derrubadas, dropar estas funções deixa o painel público sem NENHUM
-- caminho de leitura (lista vazia em tudo, sem erro de tela, porque todas as
-- funções JS tratam falha devolvendo vazio).
--
-- drop function if exists public.fidelidade_base_cliente(bigint, text);
-- drop function if exists public.agendamentos_cliente_ultimos_sucesso(bigint, text, bigint);
-- drop function if exists public.agendamentos_cliente_por_servico(bigint, text, bigint);
-- drop function if exists public.agendamentos_cliente_janela_prazo(bigint, text, date, integer);
-- drop function if exists public.agendamentos_cliente_historico(bigint, text, integer);
-- drop function if exists public.agendamentos_cliente_ativos(bigint, text);
-- drop function if exists public.normalizar_telefone(text);
