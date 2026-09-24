-- Serviço com SEGUNDA DATA (Etapa 2 de 6) — a RPC do par.
--
-- Cria os DOIS agendamentos de um serviço com `exige_segunda_data`
-- (ver sql/segunda_data_reserva_grupo.sql) numa transação só: o EVENTO
-- (papel 'principal', onde o sinal fica preso) e a ETAPA ANTERIOR
-- (papel 'anterior' — o "teste" da noiva), amarrados pelo mesmo
-- `reserva_grupo_id`.
--
-- Este arquivo tem TRÊS funções e é idempotente (pode rodar de novo):
--   1. agendamento_criar_interno – o motor. Os 10 parâmetros de sempre MAIS
--                                  grupo/papel. SEM grant nenhum.
--   2. agendamento_criar         – a assinatura pública de 10 parâmetros,
--                                  INALTERADA. Vira um wrapper da interna.
--   3. agendamento_criar_par     – nova, chama a INTERNA duas vezes.
--
-- Rode no SQL Editor do Supabase (STAGING primeiro), inteiro, de uma vez.
--
-- ---------------------------------------------------------------------------
-- POR QUE TRÊS FUNÇÕES, E NÃO DUAS
-- ---------------------------------------------------------------------------
-- A versão anterior deste arquivo acrescentava os dois parâmetros à PRÓPRIA
-- `agendamento_criar`. Duas coisas erradas nisso, as duas evitadas aqui:
--
-- 1. SEGURANÇA. `agendamento_criar` tem grant pra `anon` — é ela que o
--    /agendar chama sem sessão. Com grupo e papel na assinatura pública,
--    qualquer anônimo passaria a poder mandá-los: criar uma linha SOLTA com
--    `papel_reserva = 'anterior'` e nenhuma irmã, ou pendurar a reserva dele
--    no `reserva_grupo_id` do par de outra cliente (o uuid vaza pra quem
--    souber ler a própria linha). Nenhuma tela do /admin espera um papel sem
--    par, e o estrago é silencioso — o card aparece azul, "vinculado" a nada.
--    Agora esses dois parâmetros só existem na INTERNA, que não tem grant: só
--    alcançável de dentro de outra função SECURITY DEFINER deste mesmo
--    arquivo. O que chega da rua continua sendo exatamente o de antes.
--
-- 2. FRAGILIDADE. Trocar a assinatura exigia `drop function` da versão antiga
--    EXATA antes do create — e isso só funciona se o banco estiver idêntico ao
--    que o arquivo presume. Divergiu (uma assinatura a mais de um teste
--    antigo, um parâmetro com outro tipo), o drop não pega, o create cria um
--    overload, e a chamada do app — que manda por NOME — fica ambígua entre os
--    candidatos: 42725 (`function ... is not unique`), com o fluxo público
--    inteiro parando de criar reserva. Sem drop nenhum, esse risco some.
--
-- ---------------------------------------------------------------------------
-- NADA MUDA PRO APP — E AGORA POR CONSTRUÇÃO, NÃO POR SORTE
-- ---------------------------------------------------------------------------
-- components/FormularioAgendamento.js (~:3201) chama assim:
--
--   supabase.rpc("agendamento_criar", {
--     p_estabelecimento_id, p_servico_id, p_profissional_id, p_data,
--     p_horario, p_duracao_min, p_nome, p_telefone, p_status, p_respostas
--   })
--
-- `agendamento_criar` continua com os MESMOS 10 parâmetros, os mesmos tipos,
-- na mesma ordem, com o mesmo `returns uuid` e os mesmos grants. Ela é
-- recriada com `create or replace` puro (sem drop), então nem a assinatura nem
-- as permissões chegam a ser tocadas. A única diferença é que o corpo virou
-- uma linha: repassa os 10 e manda grupo/papel nulos.
--
-- Etapa 2 NÃO mexe no app: nada em /agendar, no /admin ou em lib/ chama
-- agendamento_criar_par ainda. Este arquivo só deixa o banco pronto.
--
-- ---------------------------------------------------------------------------
-- O QUE agendamento_criar_par ACRESCENTA — E O QUE ELA NÃO FAZ
-- ---------------------------------------------------------------------------
-- Ela é o `agendamento_criar_grupo` que o cabeçalho de
-- sql/rpc_criacao_agendamento.sql já previa, no caso particular N=2 com papéis
-- assimétricos. Vale a regra de lá, palavra por palavra, agora valendo pra
-- `agendamento_criar_interno`: ela é a unidade "uma pessoa, uma linha", não
-- abre transação e não guarda estado entre chamadas — então chamá-la duas
-- vezes daqui de dentro faz as duas linhas nascerem na MESMA transação (uma
-- chamada de função É uma transação).
--
-- O par chama a INTERNA, não o wrapper público: é a interna que aceita grupo e
-- papel. Passar pelo wrapper obrigaria a devolver esses dois parâmetros à
-- assinatura pública, que é justamente o que este arquivo evita.
--
-- NENHUM BLOCO EXCEPTION, aqui nem lá. Essa é a propriedade inteira do
-- arquivo: se a etapa anterior bater na exclusion constraint
-- `agendamentos_sem_sobreposicao`, o 23P01 sobe cru, o evento que já tinha
-- sido inserido SOME junto, e o app recebe o mesmo código de erro que já sabe
-- tratar ("esse horário acabou de ser reservado"). Meio par nunca fica de pé.
-- É exatamente o que o cancela-e-recria de hoje não consegue dar.
--
-- O que ela NÃO revalida, de propósito, pelo mesmo critério do arquivo
-- original ("o banco valida PERTENCIMENTO e LIMITES; regra de negócio que já
-- vive no app não é reimplementada aqui"): janela de agendamento, antecedência
-- mínima, prazo mínimo entre agendamentos, restrição por etiqueta, exceções de
-- horário e a regra de sinal. Tudo isso roda no app ANTES, para as DUAS datas.
--
-- O sinal é UM só e fica preso ao EVENTO: esta função não toca em
-- sinal_declarado_pago nem em sinal_valor_centavos (nenhuma reserva nasce com
-- sinal declarado — quem grava isso é agendamento_declarar_sinal), e a etapa
-- anterior nasce em 'pendente' justamente pra nunca entrar na fila de Pix.
--
-- ---------------------------------------------------------------------------
-- CÓDIGOS DE ERRO NOVOS (continuam a sequência AG0xx do arquivo original)
-- ---------------------------------------------------------------------------
--   AG010  serviço não está marcado como "precisa de uma segunda data"
--   AG011  data da etapa anterior não é ANTERIOR à data do evento
--
-- AG001..AG009 continuam valendo: as duas chamadas internas passam pelas
-- mesmas validações de sempre, e o erro sobe com o código original. Nenhum dos
-- dois é 23P01 — horário ocupado continua subindo com o SQLSTATE do Postgres,
-- como o app já espera.

-- ---------------------------------------------------------------------------
-- 1. agendamento_criar_interno — o motor, sem grant nenhum
-- ---------------------------------------------------------------------------
-- Fora do NOME, da assinatura e das duas colunas a mais no insert, o corpo é
-- IDÊNTICO ao de `agendamento_criar` em sql/rpc_criacao_agendamento.sql.
-- Aquele arquivo continua sendo a explicação de tudo que acontece aqui dentro
-- (os 9 blocos, os limites de duração, a normalização do telefone, a validação
-- das respostas); este só o estende. Mexeu num, confira o outro.
--
-- O `_interno` do nome não é decoração nem convenção de estilo: esta função
-- NÃO recebe grant (ver o revoke logo depois do corpo). Ela é alcançável só de
-- dentro de outra função SECURITY DEFINER deste arquivo, onde o papel corrente
-- é o DONO — e o dono tem EXECUTE de qualquer jeito, independente de grant.
-- Nenhuma chamada de fora (PostgREST, `anon`, `authenticated`) enxerga esta
-- assinatura.

create or replace function public.agendamento_criar_interno(
  p_estabelecimento_id bigint,
  p_servico_id         bigint,
  p_profissional_id    bigint,
  p_data               date,
  p_horario            time,
  p_duracao_min        integer,
  p_nome               text,
  p_telefone           text,
  p_status             text,
  p_respostas          jsonb default '[]'::jsonb,
  -- ETAPA 2 (segunda data): os DOIS únicos parâmetros novos. No FIM e com
  -- default porque só agendamento_criar_par os preenche — o wrapper público
  -- logo abaixo chama esta função passando null nos dois, que é o
  -- comportamento de toda reserva solta.
  --
  -- Eles existem SÓ aqui, e é isso que os mantém fora do alcance de `anon`:
  -- ver a seção "POR QUE TRÊS FUNÇÕES" no topo.
  p_reserva_grupo_id   uuid default null,
  p_papel_reserva      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- Limites da duração. Piso 5: é o DURACAO_MINIMA_MIN de
  -- duracaoEfetivaServico — uma duração zerada ou negativa não pode virar
  -- agendamento sem intervalo (um range vazio não colide com nada, ou seja, a
  -- exclusion constraint deixaria de proteger aquele horário). Teto 720 (12h):
  -- mais longo que qualquer jornada de salão, com folga sobre os serviços mais
  -- demorados do app (extensão/mega hair giram em torno de 6–8h). Acima disso
  -- ou é dado errado, ou é uma reserva feita pra trancar a agenda inteira de um
  -- profissional. Os dois são LIMITE, não recálculo: quanto a reserva dura de
  -- fato continua sendo conta do app.
  c_duracao_min constant integer := 5;
  c_duracao_max constant integer := 720;
  -- Teto do texto livre: é digitado por anônimo e vai aparecer nos cards do
  -- /admin (ver lib/agendamentoRespostas.js). 500 cabe qualquer observação
  -- real e impede que a tela da dona vire um paredão.
  c_texto_max   constant integer := 500;

  v_nome             text;
  v_telefone         text;

  v_resposta         jsonb;
  v_pergunta_id      uuid;
  v_opcao_id         uuid;
  v_texto_livre      text;
  v_perguntas_vistas uuid[] := '{}';

  v_hoje             date;
  v_id               uuid;
begin
  -- -------------------------------------------------------------------------
  -- 1. Nome e WhatsApp
  -- -------------------------------------------------------------------------
  -- A normalização é a MESMA de normalizarWhatsapp (lib/whatsappValidacao.js):
  -- só dígitos, e o 55 colado na frente de um número já internacional sai.
  -- Feita aqui pra que a linha nasça sempre no formato canônico, que é o que
  -- casa com `clientes.whatsapp` em todas as telas do /admin.
  --
  -- Aceita 10 OU 11 dígitos: validarWhatsapp exige 11 (celular), mas base
  -- antiga tem número de 10, e este não é o lugar de recusar uma cliente por
  -- causa de um cadastro herdado.
  v_nome := nullif(btrim(coalesce(p_nome, '')), '');
  if v_nome is null then
    raise exception 'Nome do cliente ausente.' using errcode = 'AG008';
  end if;

  v_telefone := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  if length(v_telefone) = 13 and left(v_telefone, 2) = '55' then
    v_telefone := substr(v_telefone, 3);
  end if;
  if length(v_telefone) not in (10, 11) then
    raise exception 'WhatsApp do cliente ausente ou malformado.' using errcode = 'AG008';
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Salão ativo
  -- -------------------------------------------------------------------------
  -- Mesmo pré-requisito das cinco funções da Etapa 3 (e do `using` da policy
  -- que elas substituíram): salão inativo não recebe agendamento novo por
  -- nenhum caminho.
  if not exists (
    select 1
      from public.estabelecimentos e
     where e.id = p_estabelecimento_id
       and e.ativo = true
  ) then
    raise exception 'Salão não encontrado ou inativo.' using errcode = 'AG001';
  end if;

  -- -------------------------------------------------------------------------
  -- 3. Serviço DO salão
  -- -------------------------------------------------------------------------
  -- O `estabelecimento_id` no where é o ponto inteiro: sem ele, um anônimo
  -- podia montar uma linha com o id do salão A e o serviço do salão B. Filtra
  -- `ativo` igual à lista pública do wizard (`oculto` não precisa entrar: só
  -- existe sobre serviço já inativo).
  if not exists (
    select 1
      from public.servicos s
     where s.id = p_servico_id
       and s.estabelecimento_id = p_estabelecimento_id
       and s.ativo = true
  ) then
    raise exception 'Serviço não encontrado neste salão.' using errcode = 'AG002';
  end if;

  -- -------------------------------------------------------------------------
  -- 4. Profissional DO salão, ativo, e que atende ESTE serviço
  -- -------------------------------------------------------------------------
  -- As duas checagens são as mesmas que calcularVagasPorHorario faz pra montar
  -- a grade (`!inner` em profissionais com ativo + estabelecimento, sobre
  -- servico_profissional). Ou seja: a função só aceita um par que a grade
  -- também aceitaria — e o encaixe automático (escolherMenosOcupado) sai de
  -- lá, então o caminho normal nunca bate aqui.
  --
  -- `servico_profissional` não tem coluna própria de ativo: o vínculo existe
  -- ou não existe, e "ativo" é do profissional (ver
  -- sql/servico_profissional.sql).
  if not exists (
    select 1
      from public.profissionais pr
     where pr.id = p_profissional_id
       and pr.estabelecimento_id = p_estabelecimento_id
       and pr.ativo = true
  ) then
    raise exception 'Profissional não encontrado neste salão.' using errcode = 'AG003';
  end if;

  if not exists (
    select 1
      from public.servico_profissional sp
     where sp.servico_id = p_servico_id
       and sp.profissional_id = p_profissional_id
  ) then
    raise exception 'Este profissional não atende o serviço escolhido.' using errcode = 'AG004';
  end if;

  -- -------------------------------------------------------------------------
  -- 5. Status
  -- -------------------------------------------------------------------------
  -- Os dois estados de reserva provisória do fluxo, e só. 'confirmado' e
  -- 'concluido' são decisão do SALÃO, tomada no /admin: um anônimo que
  -- pudesse inserir 'confirmado' se auto-aprovava na agenda da dona, pulando
  -- justamente a revisão manual que torna aceitável tudo o mais que esta
  -- função deixa passar (ver "onde esta função para", no topo). Com
  -- 'concluido' ainda entraria no faturamento dos Relatórios.
  --
  -- QUAL dos dois é o certo pra este agendamento continua sendo conta do app
  -- (precisaSinal) — aqui só se confere que é um dos dois.
  if p_status is null or p_status not in ('pendente', 'aguardando_sinal') then
    raise exception 'Status inicial inválido para uma reserva.' using errcode = 'AG005';
  end if;

  -- -------------------------------------------------------------------------
  -- 6. Duração dentro dos limites
  -- -------------------------------------------------------------------------
  if p_duracao_min is null
     or p_duracao_min < c_duracao_min
     or p_duracao_min > c_duracao_max then
    raise exception 'Duração do agendamento fora do intervalo permitido (% a % minutos).',
      c_duracao_min, c_duracao_max using errcode = 'AG006';
  end if;

  -- -------------------------------------------------------------------------
  -- 7. Data plausível
  -- -------------------------------------------------------------------------
  -- Rede larga de propósito, NÃO é a janela de agendamento (ver o topo). Serve
  -- só pra barrar data absurda — reserva em 1970 ou em 2190 não é cliente, é
  -- lixo ou ataque. `current_date` sairia no fuso do processo do Postgres
  -- (UTC), o que daria um dia de diferença pra quem agenda de noite;
  -- America/Sao_Paulo aqui pelo mesmo motivo do cálculo de antecedência.
  v_hoje := (now() at time zone 'America/Sao_Paulo')::date;
  if p_data is null or p_data < v_hoje - 1 or p_data > v_hoje + 730 then
    raise exception 'Data fora de qualquer faixa plausível.' using errcode = 'AG009';
  end if;

  if p_horario is null then
    raise exception 'Horário ausente.' using errcode = 'AG009';
  end if;

  -- -------------------------------------------------------------------------
  -- 8. Respostas das perguntas do serviço
  -- -------------------------------------------------------------------------
  -- Validadas ANTES de inserir qualquer coisa. São validações de
  -- PERTENCIMENTO, não de regra: nada aqui decide preço nem duração, só
  -- confere que cada linha pendurada no agendamento é do serviço escolhido.
  --
  -- O que cada checagem impede:
  --   pergunta do serviço     – sem isso, dava pra pendurar num agendamento a
  --                             resposta de uma pergunta de OUTRO serviço (ou
  --                             de outro salão), e a ficha da cliente no
  --                             /admin passaria a mostrar texto que não tem
  --                             nada a ver com o atendimento.
  --   opção da pergunta       – uma opção de outra pergunta apareceria no card
  --                             como resposta de uma pergunta que ninguém fez.
  --   um dos dois, nunca os 2 – espelha linhasRespostasPerguntas: ou opção, ou
  --                             texto livre.
  --   sem pergunta repetida   – duas respostas pra mesma pergunta deixariam o
  --                             card com a pergunta duplicada.
  if p_respostas is not null and jsonb_typeof(p_respostas) <> 'array' then
    raise exception 'Formato inválido das respostas.' using errcode = 'AG007';
  end if;

  for v_resposta in
    select valor from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb)) as t(valor)
  loop
    v_pergunta_id := nullif(v_resposta ->> 'pergunta_id', '')::uuid;
    v_opcao_id    := nullif(v_resposta ->> 'opcao_id', '')::uuid;
    v_texto_livre := nullif(btrim(coalesce(v_resposta ->> 'texto_livre', '')), '');

    if v_pergunta_id is null then
      raise exception 'Resposta sem pergunta.' using errcode = 'AG007';
    end if;

    if v_pergunta_id = any (v_perguntas_vistas) then
      raise exception 'Pergunta respondida duas vezes.' using errcode = 'AG007';
    end if;
    v_perguntas_vistas := v_perguntas_vistas || v_pergunta_id;

    if not exists (
      select 1
        from public.servico_perguntas sp
       where sp.id = v_pergunta_id
         and sp.servico_id = p_servico_id
    ) then
      raise exception 'Pergunta não pertence ao serviço escolhido.' using errcode = 'AG007';
    end if;

    if (v_opcao_id is null) = (v_texto_livre is null) then
      raise exception 'Resposta precisa ter uma opção OU um texto, nunca os dois.'
        using errcode = 'AG007';
    end if;

    if v_texto_livre is not null and length(v_texto_livre) > c_texto_max then
      raise exception 'Texto da resposta longo demais.' using errcode = 'AG007';
    end if;

    if v_opcao_id is not null and not exists (
      select 1
        from public.servico_pergunta_opcoes o
       where o.id = v_opcao_id
         and o.pergunta_id = v_pergunta_id
    ) then
      raise exception 'Opção não pertence à pergunta respondida.' using errcode = 'AG007';
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 9. Grava
  -- -------------------------------------------------------------------------
  -- Qualquer erro daqui pra baixo (em especial o 23P01 da
  -- agendamentos_sem_sobreposicao) sobe cru. Ver o topo.
  insert into public.agendamentos (
    nome_cliente,
    telefone,
    data,
    horario,
    servico_id,
    duracao_min,
    estabelecimento_id,
    profissional_id,
    status,
    pendente_desde,
    sinal_declarado_pago,
    finalizado,
    reserva_grupo_id,
    papel_reserva
  )
  values (
    v_nome,
    v_telefone,
    p_data,
    p_horario,
    p_servico_id,
    p_duracao_min,
    p_estabelecimento_id,
    p_profissional_id,
    p_status,
    -- Entrada em 'pendente' carimbada pelo relógio do SERVIDOR. Nascendo em
    -- 'aguardando_sinal' a linha ainda não entrou em pendente: quem carimba
    -- depois é agendamento_declarar_sinal.
    case when p_status = 'pendente' then now() else null end,
    false,
    -- true como no payload de hoje: `finalizado` marca que a linha veio de um
    -- fluxo de agendamento, não de importação.
    true,
    -- Gravados crus, sem validação nova: quem recusa um papel fora de
    -- ('principal','anterior') é a check constraint
    -- agendamentos_papel_reserva_check (ver sql/segunda_data_reserva_grupo.sql),
    -- e NULL nos dois é o caso normal de toda reserva solta.
    p_reserva_grupo_id,
    p_papel_reserva
  )
  returning id into v_id;

  -- Mesma transação do insert acima: respostas perdidas deixam de ser
  -- possíveis (ver o topo).
  insert into public.agendamento_respostas (agendamento_id, pergunta_id, opcao_id, texto_livre)
  select v_id,
         (e.valor ->> 'pergunta_id')::uuid,
         nullif(e.valor ->> 'opcao_id', '')::uuid,
         nullif(btrim(coalesce(e.valor ->> 'texto_livre', '')), '')
    from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb)) as e(valor);

  return v_id;
end;
$fn$;

-- Permissões da INTERNA: nenhuma. Este bloco é a metade de segurança do
-- arquivo inteiro — sem ele, os dois parâmetros do vínculo ficariam expostos
-- pra `anon` e o ganho da separação seria zero.
--
-- `revoke ... from public` é o que de fato fecha a porta: toda função nasce
-- com EXECUTE pra PUBLIC, e `anon`/`authenticated` herdam de PUBLIC. Os dois
-- revokes nominais depois são redundantes por construção (nunca houve grant
-- explícito pra eles) e estão aqui de propósito: tornam a intenção legível no
-- `\df+` e limpam o estado caso alguém tenha concedido na mão em algum
-- momento. Revogar o que não foi concedido não é erro no Postgres.
--
-- NENHUM GRANT ABAIXO. É deliberado, não esquecimento — quem precisar desta
-- função chama de dentro de um SECURITY DEFINER deste arquivo.
revoke all on function public.agendamento_criar_interno(
  bigint, bigint, bigint, date, time, integer, text, text, text, jsonb, uuid, text
) from public;

revoke all on function public.agendamento_criar_interno(
  bigint, bigint, bigint, date, time, integer, text, text, text, jsonb, uuid, text
) from anon;

revoke all on function public.agendamento_criar_interno(
  bigint, bigint, bigint, date, time, integer, text, text, text, jsonb, uuid, text
) from authenticated;

-- ---------------------------------------------------------------------------
-- 2. agendamento_criar — a assinatura pública, INALTERADA
-- ---------------------------------------------------------------------------
-- Mesmos 10 parâmetros, mesmos tipos, mesma ordem, mesmo `returns uuid`, mesmo
-- security definer e mesmo search_path de sql/rpc_criacao_agendamento.sql. Só
-- o corpo mudou: era a implementação inteira, virou um repasse.
--
-- `create or replace` PURO, sem drop: a assinatura não mudou, então não há
-- overload a criar nem permissão a recriar. Os grants que a função já tem
-- sobrevivem intactos ao replace — o revoke/grant no fim deste bloco está aqui
-- só pra deixar o arquivo auto-suficiente (se por acaso a função não existisse
-- ainda, ou se alguém tivesse mexido nas permissões na mão), e é idêntico ao
-- do arquivo original.
--
-- Os dois nulos na chamada abaixo são o ponto inteiro do wrapper: toda reserva
-- que entra pela porta pública nasce SEM grupo e SEM papel, e não há como
-- pedir o contrário de fora.
create or replace function public.agendamento_criar(
  p_estabelecimento_id bigint,
  p_servico_id         bigint,
  p_profissional_id    bigint,
  p_data               date,
  p_horario            time,
  p_duracao_min        integer,
  p_nome               text,
  p_telefone           text,
  p_status             text,
  p_respostas          jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  return public.agendamento_criar_interno(
    p_estabelecimento_id => p_estabelecimento_id,
    p_servico_id         => p_servico_id,
    p_profissional_id    => p_profissional_id,
    p_data               => p_data,
    p_horario            => p_horario,
    p_duracao_min        => p_duracao_min,
    p_nome               => p_nome,
    p_telefone           => p_telefone,
    p_status             => p_status,
    p_respostas          => p_respostas,
    p_reserva_grupo_id   => null,
    p_papel_reserva      => null
  );
end;
$fn$;

-- Permissões de agendamento_criar: as MESMAS do arquivo original, repetidas
-- aqui palavra por palavra. Revoke de PUBLIC antes do grant porque toda função
-- nasce com EXECUTE pra PUBLIC e sem isso o grant seria decorativo.
-- `authenticated` entra junto porque o mesmo componente público roda logado
-- quando a dona abre o próprio link com a sessão do /admin aberta.
revoke execute on function public.agendamento_criar(
  bigint, bigint, bigint, date, time, integer, text, text, text, jsonb
) from public;

grant execute on function public.agendamento_criar(
  bigint, bigint, bigint, date, time, integer, text, text, text, jsonb
) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. agendamento_criar_par — o par inteiro, numa transação só
-- ---------------------------------------------------------------------------
-- Assinatura: os MESMOS parâmetros da criação do evento (na mesma ordem de
-- agendamento_criar, pra não obrigar ninguém a decorar duas ordens), mais as
-- duas coordenadas da etapa anterior.
--
-- `p_data`/`p_horario` são sempre os do EVENTO. Escolha deliberada: o evento é
-- o atendimento que a cliente veio marcar, é onde o sinal fica preso e é o que
-- aparece como "o agendamento" em toda tela; a etapa anterior é o acessório.
-- Ter o principal nos nomes de sempre também é o que mantém a ordem dos
-- parâmetros igual à da função de cima.
--
-- Retorna JSONB (e não `returns table`) porque é o formato mais direto de
-- consumir no supabase-js: `data` já vem como o objeto
-- `{ evento_id, anterior_id, reserva_grupo_id }`, sem o `data[0]` que um
-- `returns table` de uma linha obrigaria (compare com
-- `agendamento_status_reserva`, onde o app precisa escrever `linhas?.[0]`).
create or replace function public.agendamento_criar_par(
  p_estabelecimento_id bigint,
  p_servico_id         bigint,
  p_profissional_id    bigint,
  p_data               date,
  p_horario            time,
  p_duracao_min        integer,
  p_nome               text,
  p_telefone           text,
  p_status             text,
  p_data_anterior      date,
  p_horario_anterior   time,
  p_respostas          jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_exige_segunda_data boolean;
  v_grupo_id           uuid;
  v_evento_id          uuid;
  v_anterior_id        uuid;
begin
  -- -------------------------------------------------------------------------
  -- 1. O serviço aceita par?
  -- -------------------------------------------------------------------------
  -- Sem esta checagem, qualquer anônimo poderia dobrar a agenda de QUALQUER
  -- serviço mandando duas datas — inclusive num salão que nunca ligou a opção.
  -- É validação de PERTENCIMENTO (a coluna diz que este serviço é de duas
  -- datas), não regra de negócio recalculada: continua valendo o critério do
  -- arquivo original.
  --
  -- Os mesmos filtros da lista pública do wizard (do salão + ativo), pra que
  -- serviço de OUTRO salão não caia aqui como se fosse "não exige segunda
  -- data". Quando o select não acha nada, `found` é falso: nesse caso NÃO
  -- levantamos AG010 — deixamos seguir pra que agendamento_criar levante o
  -- AG002 ("serviço não encontrado neste salão"), que é a mensagem verdadeira.
  select s.exige_segunda_data
    into v_exige_segunda_data
    from public.servicos s
   where s.id = p_servico_id
     and s.estabelecimento_id = p_estabelecimento_id
     and s.ativo = true;

  if found and v_exige_segunda_data is not true then
    raise exception 'Este serviço não está configurado para uma segunda data.'
      using errcode = 'AG010';
  end if;

  -- -------------------------------------------------------------------------
  -- 2. A etapa anterior vem ANTES do evento
  -- -------------------------------------------------------------------------
  -- Estritamente antes, em DATAS diferentes: o teste da noiva não acontece no
  -- mesmo dia do casamento, e permitir a igualdade abriria a porta pro par
  -- "mesmo dia, dois horários", que é outra funcionalidade (agendamento em
  -- grupo) com outras regras. Comparar só as datas, e não data+horário,
  -- mantém a regra legível na tela: "escolha um dia antes do atendimento".
  --
  -- Esta é a ÚNICA regra que o banco impõe sobre o par e que o app também vai
  -- impor (o calendário da segunda passagem não deixa escolher dia >= evento).
  -- Duplicação consciente, mesmo critério da antecedência mínima: é a ordem
  -- das duas linhas que dá sentido ao papel de cada uma, e uma inversão
  -- gravada deixaria 'anterior' depois de 'principal' — indefensável em toda
  -- tela que ler o par.
  if p_data_anterior is null then
    raise exception 'Data da etapa anterior ausente.' using errcode = 'AG011';
  end if;

  if p_data is null or p_data_anterior >= p_data then
    raise exception 'A etapa anterior precisa ser em um dia ANTERIOR ao do atendimento principal.'
      using errcode = 'AG011';
  end if;

  -- -------------------------------------------------------------------------
  -- 3. O vínculo
  -- -------------------------------------------------------------------------
  -- Gerado AQUI, nunca recebido do navegador: um grupo mandado de fora
  -- deixaria um anônimo pendurar a reserva dele no par de outra cliente.
  -- gen_random_uuid() é nativo do Postgres desde a 13 (não precisa de
  -- pgcrypto).
  v_grupo_id := gen_random_uuid();

  -- -------------------------------------------------------------------------
  -- 4. O EVENTO primeiro
  -- -------------------------------------------------------------------------
  -- A ordem importa por dois motivos. O primeiro é de produto: se o par
  -- inteiro for impossível, o erro que a cliente vê deve ser sobre o horário
  -- que ela mais quer. O segundo é de implementação: é o id do evento que o
  -- app precisa ter em mãos pra prender o sinal, e tê-lo como a primeira
  -- variável preenchida mantém o fluxo legível.
  --
  -- `p_status` e `p_respostas` vão INTEIROS pra cá: quem decide entre
  -- 'pendente' e 'aguardando_sinal' continua sendo o app (precisaSinal), e as
  -- respostas do popup de perguntas pertencem ao atendimento principal.
  v_evento_id := public.agendamento_criar_interno(
    p_estabelecimento_id => p_estabelecimento_id,
    p_servico_id         => p_servico_id,
    p_profissional_id    => p_profissional_id,
    p_data               => p_data,
    p_horario            => p_horario,
    p_duracao_min        => p_duracao_min,
    p_nome               => p_nome,
    p_telefone           => p_telefone,
    p_status             => p_status,
    p_respostas          => p_respostas,
    p_reserva_grupo_id   => v_grupo_id,
    p_papel_reserva      => 'principal'
  );

  -- -------------------------------------------------------------------------
  -- 5. A ETAPA ANTERIOR
  -- -------------------------------------------------------------------------
  -- Mesmo cliente, mesmo serviço, mesmo profissional e mesma duração do
  -- evento. Duração própria pra etapa anterior ficou FORA da primeira versão
  -- de propósito (um "teste" costuma ser mais curto que o atendimento do dia,
  -- mas isso é um campo novo em `servicos`, não uma conta a inventar aqui).
  --
  -- Duas diferenças deliberadas em relação ao evento:
  --
  --   status 'pendente' FIXO – o sinal é UM só e está preso ao evento. Se esta
  --     linha nascesse em 'aguardando_sinal', ela entraria na fila de Pix por
  --     conta própria e a cliente veria dois QR Codes pra um pagamento só.
  --     'pendente' é o estado certo: o horário está segurado e a dona decide.
  --
  --   respostas '[]' – as respostas do popup já estão no evento. Duplicá-las
  --     mostraria a mesma pergunta duas vezes na ficha do /admin e contaria o
  --     ajuste de preço/duração em dobro (ver calcularAjusteDuracao e
  --     lib/agendamentoRespostas.js).
  v_anterior_id := public.agendamento_criar_interno(
    p_estabelecimento_id => p_estabelecimento_id,
    p_servico_id         => p_servico_id,
    p_profissional_id    => p_profissional_id,
    p_data               => p_data_anterior,
    p_horario            => p_horario_anterior,
    p_duracao_min        => p_duracao_min,
    p_nome               => p_nome,
    p_telefone           => p_telefone,
    p_status             => 'pendente',
    p_respostas          => '[]'::jsonb,
    p_reserva_grupo_id   => v_grupo_id,
    p_papel_reserva      => 'anterior'
  );

  return jsonb_build_object(
    'evento_id',        v_evento_id,
    'anterior_id',      v_anterior_id,
    'reserva_grupo_id', v_grupo_id
  );
end;
$fn$;

-- Permissões idênticas às de agendamento_criar, e pelo mesmo motivo: quem
-- chama é o /agendar, sem sessão (`anon`), e `authenticated` entra junto
-- porque o mesmo componente público roda logado quando a dona abre o próprio
-- link com a sessão do /admin aberta.
revoke execute on function public.agendamento_criar_par(
  bigint, bigint, bigint, date, time, integer, text, text, text, date, time, jsonb
) from public;

grant execute on function public.agendamento_criar_par(
  bigint, bigint, bigint, date, time, integer, text, text, text, date, time, jsonb
) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Desfazer é em TRÊS passos, e a ORDEM importa: as duas de cima dependem da
-- interna, então a interna sai por último. (Plpgsql resolve a chamada em tempo
-- de execução e o Postgres NÃO impede dropar a interna antes — mas aí
-- `agendamento_criar` fica de pé e quebrando com 42883 na primeira chamada, o
-- que é MUITO pior que não existir: o /agendar aceita o toque no horário e
-- falha na gravação.)
--
-- O passo 3 é o que mais importa e é fácil esquecer: depois de dropar a
-- interna, `agendamento_criar` vira uma casca que chama uma função inexistente.
-- Rodar sql/rpc_criacao_agendamento.sql devolve o CORPO de verdade pra ela.
-- Entre o passo 1 e o passo 3 o fluxo público fica quebrado — rode os três de
-- uma vez, não um por dia.
--
-- Só é seguro rodar enquanto NADA no app chamar agendamento_criar_par — ou
-- seja: até a Etapa 3. Depois dela, este rollback tira do ar a criação de par
-- do /agendar.
--
-- Pares JÁ GRAVADOS não são afetados: as linhas continuam lá, com
-- reserva_grupo_id e papel_reserva preenchidos. O rollback derruba só a
-- capacidade de criar novos. Pra desfazer as COLUNAS, ver
-- sql/segunda_data_reserva_grupo.sql.
--
-- -- 1. Some com a função de par.
-- drop function if exists public.agendamento_criar_par(
--   bigint, bigint, bigint, date, time, integer, text, text, text, date, time, jsonb
-- );
--
-- -- 2. Some com o motor. Ninguém mais o chama depois do passo 1, exceto o
-- --    wrapper — que o passo 3 substitui.
-- drop function if exists public.agendamento_criar_interno(
--   bigint, bigint, bigint, date, time, integer, text, text, text, jsonb, uuid, text
-- );
--
-- -- 3. OBRIGATÓRIO. Recrie agendamento_criar rodando
-- --    sql/rpc_criacao_agendamento.sql INTEIRO: ele tem o `create or replace`
-- --    da assinatura de 10 com o CORPO completo, mais o revoke/grant. É um
-- --    replace da casca deixada pelo passo 2 — a assinatura é a mesma, então
-- --    não há overload nem permissão a recuperar.
-- --
-- --    NÃO tente reconstruir a função a partir DESTE arquivo apagando
-- --    parâmetros: aqui ela é só um repasse. Aquele arquivo é a fonte.

-- ---------------------------------------------------------------------------
-- TESTE (rodar em STAGING, no SQL Editor) — tudo comentado de propósito
-- ---------------------------------------------------------------------------
-- Três cenários: par válido, ordem das datas inválida, e horário da etapa
-- anterior ocupado (o que prova a atomicidade). A limpeza está no fim e apaga
-- tudo pelo telefone de teste.
--
-- Nada aqui usa id fixo: o salão sai do SLUG e o serviço sai do NOME, os dois
-- resolvidos na hora. Troque as duas linhas de :slug/:servico e mais nada.
--
-- PRÉ-REQUISITO: o serviço escolhido precisa ter exige_segunda_data = true
-- (ligue pela tela de Serviços do /admin, ou pelo UPDATE comentado abaixo) e
-- precisa ter vínculo em servico_profissional — sem ele agendamento_criar
-- levanta AG004, que é outro erro e confundiria a leitura do teste.
--
-- -- Ligar a opção no serviço de teste, se ainda não estiver ligada:
-- -- update public.servicos s
-- --    set exige_segunda_data = true
-- --   from public.estabelecimentos e
-- --  where e.slug = 'teste'
-- --    and s.estabelecimento_id = e.id
-- --    and s.nome = 'NOME DO SERVICO AQUI';
--
--
-- -- =====================================================================
-- -- CENÁRIO 1 — par válido (deve DEVOLVER os três ids)
-- -- =====================================================================
-- with alvo as (
--   select e.id  as estabelecimento_id,
--          s.id  as servico_id,
--          sp.profissional_id,
--          s.duracao_min
--     from public.estabelecimentos e
--     join public.servicos s
--       on s.estabelecimento_id = e.id
--      and s.ativo = true
--     join public.servico_profissional sp
--       on sp.servico_id = s.id
--    where e.slug = 'teste'                      -- <<< SLUG do salão
--      and s.nome = 'NOME DO SERVICO AQUI'       -- <<< NOME do serviço
--    limit 1
-- )
-- select public.agendamento_criar_par(
--          p_estabelecimento_id => a.estabelecimento_id,
--          p_servico_id         => a.servico_id,
--          p_profissional_id    => a.profissional_id,
--          -- Datas bem à frente, pra não esbarrar em nada já agendado.
--          p_data               => (current_date + 60),
--          p_horario            => '10:00'::time,
--          p_duracao_min        => a.duracao_min,
--          p_nome               => 'TESTE Par Segunda Data',
--          p_telefone           => '11999990001',
--          p_status             => 'pendente',
--          p_data_anterior      => (current_date + 50),
--          p_horario_anterior   => '10:00'::time
--        ) as resultado
--   from alvo a;
--
-- -- Confere as duas linhas: MESMO reserva_grupo_id, papéis diferentes, e a
-- -- 'anterior' com data menor. Os dois em 'pendente' (a etapa anterior é
-- -- sempre 'pendente', mesmo que o evento fosse 'aguardando_sinal').
-- select a.data, a.horario, a.status, a.papel_reserva, a.reserva_grupo_id
--   from public.agendamentos a
--  where a.telefone = '11999990001'
--  order by a.data;
--
--
-- -- =====================================================================
-- -- CENÁRIO 2 — etapa anterior no MESMO dia / DEPOIS do evento
-- -- Esperado: ERRO AG011, e NENHUMA linha nova.
-- -- Rode as duas variantes; as duas têm que falhar.
-- -- =====================================================================
-- with alvo as (
--   select e.id as estabelecimento_id, s.id as servico_id,
--          sp.profissional_id, s.duracao_min
--     from public.estabelecimentos e
--     join public.servicos s on s.estabelecimento_id = e.id and s.ativo = true
--     join public.servico_profissional sp on sp.servico_id = s.id
--    where e.slug = 'teste' and s.nome = 'NOME DO SERVICO AQUI'
--    limit 1
-- )
-- select public.agendamento_criar_par(
--          p_estabelecimento_id => a.estabelecimento_id,
--          p_servico_id         => a.servico_id,
--          p_profissional_id    => a.profissional_id,
--          p_data               => (current_date + 61),
--          p_horario            => '14:00'::time,
--          p_duracao_min        => a.duracao_min,
--          p_nome               => 'TESTE Par Ordem',
--          p_telefone           => '11999990002',
--          p_status             => 'pendente',
--          -- IGUAL à do evento (troque por current_date + 62 pra testar
--          -- "depois"; as duas têm que dar AG011).
--          p_data_anterior      => (current_date + 61),
--          p_horario_anterior   => '09:00'::time
--        )
--   from alvo a;
--
-- -- Tem que voltar ZERO.
-- select count(*) as deve_ser_zero
--   from public.agendamentos where telefone = '11999990002';
--
--
-- -- =====================================================================
-- -- CENÁRIO 3 — horário da ETAPA ANTERIOR já ocupado
-- -- Esperado: ERRO 23P01, e — o ponto do teste — o EVENTO também NÃO fica
-- -- gravado. É isto que prova que as duas linhas nascem na mesma transação.
-- -- =====================================================================
-- -- 3a. Ocupa o horário da futura etapa anterior com uma reserva comum.
-- --     Usa agendamento_criar (a PÚBLICA, de 10 argumentos) de propósito:
-- --     além de montar o cenário, exercita o wrapper e prova que ele continua
-- --     criando reserva normalmente depois da reestruturação.
-- with alvo as (
--   select e.id as estabelecimento_id, s.id as servico_id,
--          sp.profissional_id, s.duracao_min
--     from public.estabelecimentos e
--     join public.servicos s on s.estabelecimento_id = e.id and s.ativo = true
--     join public.servico_profissional sp on sp.servico_id = s.id
--    where e.slug = 'teste' and s.nome = 'NOME DO SERVICO AQUI'
--    limit 1
-- )
-- select public.agendamento_criar(
--          p_estabelecimento_id => a.estabelecimento_id,
--          p_servico_id         => a.servico_id,
--          p_profissional_id    => a.profissional_id,
--          p_data               => (current_date + 70),
--          p_horario            => '11:00'::time,
--          p_duracao_min        => a.duracao_min,
--          p_nome               => 'TESTE Bloqueia Anterior',
--          p_telefone           => '11999990003',
--          p_status             => 'pendente'
--        )
--   from alvo a;
--
-- -- 3b. Tenta o par com a etapa anterior EXATAMENTE nesse horário ocupado.
-- --     O evento (dia +80) está livre e seria inserido primeiro.
-- with alvo as (
--   select e.id as estabelecimento_id, s.id as servico_id,
--          sp.profissional_id, s.duracao_min
--     from public.estabelecimentos e
--     join public.servicos s on s.estabelecimento_id = e.id and s.ativo = true
--     join public.servico_profissional sp on sp.servico_id = s.id
--    where e.slug = 'teste' and s.nome = 'NOME DO SERVICO AQUI'
--    limit 1
-- )
-- select public.agendamento_criar_par(
--          p_estabelecimento_id => a.estabelecimento_id,
--          p_servico_id         => a.servico_id,
--          p_profissional_id    => a.profissional_id,
--          p_data               => (current_date + 80),
--          p_horario            => '11:00'::time,
--          p_duracao_min        => a.duracao_min,
--          p_nome               => 'TESTE Par Atomico',
--          p_telefone           => '11999990004',
--          p_status             => 'pendente',
--          p_data_anterior      => (current_date + 70),
--          p_horario_anterior   => '11:00'::time
--        )
--   from alvo a;
--
-- -- O TESTE DE VERDADE: tem que voltar ZERO. Se voltar 1, o evento ficou
-- -- órfão e a atomicidade está quebrada.
-- select count(*) as deve_ser_zero
--   from public.agendamentos where telefone = '11999990004';
--
--
-- -- =====================================================================
-- -- LIMPEZA — rode sempre no fim, mesmo se algum cenário falhar no meio.
-- -- Pega os quatro telefones de teste; agendamento_respostas cai junto pelo
-- -- ON DELETE CASCADE do agendamento_id.
-- -- =====================================================================
-- delete from public.agendamentos
--  where telefone in ('11999990001', '11999990002', '11999990003', '11999990004');
--
-- -- Confirma que não sobrou nada.
-- select count(*) as deve_ser_zero
--   from public.agendamentos
--  where telefone in ('11999990001', '11999990002', '11999990003', '11999990004');
--
-- -- Se você ligou exige_segunda_data só pro teste, desligue de volta:
-- -- update public.servicos s
-- --    set exige_segunda_data = false
-- --   from public.estabelecimentos e
-- --  where e.slug = 'teste'
-- --    and s.estabelecimento_id = e.id
-- --    and s.nome = 'NOME DO SERVICO AQUI';
--
--
-- -- =====================================================================
-- -- CENÁRIO 4 — o INVENTÁRIO. Rode depois de aplicar o arquivo.
-- --
-- -- É a checagem que fecha o risco de overload: confirma que existe
-- -- EXATAMENTE UMA agendamento_criar, e que ela tem os 10 argumentos de
-- -- sempre. Se aparecer uma segunda linha com 12 argumentos, o banco tem um
-- -- overload e a chamada do app vai falhar com 42725 — nesse caso dropa a de
-- -- 12 (ela é resíduo de uma versão anterior deste arquivo, não é usada por
-- -- nada).
-- --
-- -- Esperado, exatamente 3 linhas:
-- --
-- --   agendamento_criar          | 10 | p_estabelecimento_id bigint, ... p_respostas jsonb
-- --                              |    | acl: anon, authenticated   <- tem grant
-- --   agendamento_criar_interno  | 12 | ... p_reserva_grupo_id uuid, p_papel_reserva text
-- --                              |    | acl: (vazio/só o dono)     <- SEM grant, o ponto
-- --   agendamento_criar_par      | 12 | ... p_data_anterior date, p_horario_anterior time
-- --                              |    | acl: anon, authenticated   <- tem grant
-- --
-- -- Confira as DUAS colunas do fim: `qtd_argumentos` da agendamento_criar tem
-- -- que ser 10, e `quem_pode_executar` da _interno tem que sair VAZIO. Um
-- -- 'anon' ali significa que o revoke não pegou e os parâmetros do vínculo
-- -- estão expostos.
-- -- =====================================================================
-- select p.proname                                     as funcao,
--        pg_get_function_identity_arguments(p.oid)      as argumentos,
--        p.pronargs                                     as qtd_argumentos,
--        p.prosecdef                                    as security_definer,
--        coalesce(
--          (select string_agg(a.grantee, ', ' order by a.grantee)
--             from aclexplode(p.proacl) ax
--             join lateral (
--               select case when ax.grantee = 0 then 'PUBLIC'
--                           else pg_get_userbyid(ax.grantee) end as grantee
--             ) a on true
--            where ax.privilege_type = 'EXECUTE'
--              and a.grantee <> pg_get_userbyid(p.proowner)
--          ), '(nenhum — só o dono)'
--        )                                              as quem_pode_executar
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname like 'agendamento_criar%'
--  order by p.proname, p.pronargs;
