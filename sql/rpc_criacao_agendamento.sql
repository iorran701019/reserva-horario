-- RPC de CRIAÇÃO da reserva pública (papel anon), Etapa 6 do plano de
-- fechamento da RLS de `agendamentos`.
--
-- Fecha o último buraco de ESCRITA do fluxo público: a policy de INSERT anon
-- ("insercao publica de agendamentos"), que hoje deixa qualquer requisição
-- anônima inserir QUALQUER linha em `agendamentos` — inclusive já
-- 'confirmado', ou na agenda de um salão que nem existe mais. Depois que o app
-- passar a chamar esta função (Etapa 7), a policy cai (Etapa 8, junto com a de
-- SELECT anon).
--
-- Mesmas convenções do arquivo da Etapa 3 (sql/rpcs_agendamento_publico.sql):
-- SECURITY DEFINER, `set search_path = public, pg_temp` (pg_temp SEMPRE no
-- fim), delimitador $fn$, revoke de PUBLIC antes do grant, rollback comentado
-- no fim.
--
-- E a regra mais importante daquele arquivo vale aqui igual: NENHUM bloco
-- EXCEPTION. A exclusion constraint `agendamentos_sem_sobreposicao` (23P01) é
-- a proteção real contra duas clientes pegando o mesmo horário, e o fluxo
-- público detecta `error.code === '23P01'` pra dizer "esse horário acabou de
-- ser reservado" (ver components/FormularioAgendamento.js). Engolir o erro
-- aqui quebraria essa mensagem em silêncio.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de STAGING primeiro).
--
-- ---------------------------------------------------------------------------
-- ONDE ESTA FUNÇÃO PARA (o critério que define o arquivo inteiro)
-- ---------------------------------------------------------------------------
-- O banco valida PERTENCIMENTO e LIMITES. Regra de negócio que já vive no app
-- NÃO é reimplementada aqui.
--
-- Por quê: duas versões da mesma regra divergem com o tempo, e a divergência
-- não recusa o ataque — recusa a reserva legítima, que é perda de dinheiro
-- garantida. Já o risco evitado é pequeno, porque toda reserva pendente passa
-- pela revisão manual da dona antes de valer (decisão de produto de hoje):
-- uma reserva forjada vira só um pedido que ela recusa.
--
-- Por isso NÃO estão aqui, e continuam sendo do app: a regra de sinal
-- (precisaSinal + a cascata de lib/sinalPix.js + Lista de Bloqueio), o cálculo
-- da duração efetiva a partir das opções escolhidas (calcularAjusteDuracao),
-- e as regras de disponibilidade — janela de agendamento, antecedência mínima,
-- prazo mínimo entre agendamentos, restrição por etiqueta, exceções de
-- horário (lib/disponibilidade.js, lib/janelaAgendamento.js e a rota de
-- antecedência, todas chamadas ANTES daqui).
--
-- A consequência a registrar, sem eufemismo: um anônimo que chame a RPC direto
-- ainda consegue reservar fora da janela, com a duração que quiser dentro de
-- 5..720, e escolher entre os dois status de reserva provisória (inclusive
-- 'pendente' num salão que cobra sinal). O que ele NÃO consegue mais:
-- se auto-confirmar, escrever na agenda de outro salão, usar serviço ou
-- profissional que não são daquele salão, parear serviço com profissional que
-- não o atende, carimbar `pendente_desde` pelo relógio do próprio celular, ou
-- pendurar respostas de perguntas alheias no agendamento.
--
-- ---------------------------------------------------------------------------
-- O QUE A FUNÇÃO NÃO ACEITA MAIS DO NAVEGADOR
-- ---------------------------------------------------------------------------
--   pendente_desde        – now() do SERVIDOR quando a linha nasce
--                           'pendente', NULL quando nasce 'aguardando_sinal'.
--                           Hoje vem de `new Date().toISOString()`, ou seja,
--                           do relógio do celular da cliente: um relógio
--                           adiantado esticava de graça a janela de protocolo
--                           de 24h (ver a régua de telas em
--                           app/[salon]/page.js). Mesmo cuidado do commit que
--                           passou a calcular antecedência sempre em
--                           America/Sao_Paulo.
--   sinal_declarado_pago  – sempre false: nenhuma reserva NASCE com o sinal
--                           declarado. Quem grava isso é
--                           agendamento_declarar_sinal (Etapa 3).
--   sinal_valor_centavos  – nunca gravado aqui, pelo mesmo motivo.
--   finalizado            – sempre true, como no payload de hoje.
--   telefone              – normalizado aqui dentro (mesma conta de
--                           normalizarWhatsapp), pra não depender do formato
--                           que o navegador mandou.
--
-- `status` e `duracao_min` CONTINUAM vindo do app — validados só por
-- pertencimento ao conjunto permitido e por limite numérico, nunca
-- recalculados (ver a seção acima).
--
-- ---------------------------------------------------------------------------
-- AS RESPOSTAS DAS PERGUNTAS VÊM JUNTO (p_respostas)
-- ---------------------------------------------------------------------------
-- Hoje `agendamento_respostas` é gravada numa SEGUNDA chamada anônima
-- (salvarRespostasPerguntas), e a policy `agendamento_respostas_public_insert`
-- autoriza esse insert com um EXISTS em `agendamentos`. Esse EXISTS roda com a
-- permissão do anon e, portanto, PASSA PELA RLS de `agendamentos`: derrubada a
-- policy de SELECT anon na Etapa 8, ele deixa de enxergar a linha recém-criada
-- e o insert das respostas passa a falhar com 42501 — em silêncio, porque o
-- código trata a gravação como "melhor esforço". Por isso as respostas mudam
-- de casa: gravadas aqui dentro, no mesmo SECURITY DEFINER, não dependem de
-- policy nenhuma — e a `agendamento_respostas_public_insert` pode cair junto
-- na Etapa 8.
--
-- Ganho de brinde: hoje a reserva pode ficar de pé com as respostas perdidas
-- (e portanto com o ajuste de preço/duração não registrado). Aqui é tudo uma
-- transação só — ou nasce completa, ou não nasce.
--
-- MUDANÇA DE COMPORTAMENTO a tratar na Etapa 7: resposta inválida agora
-- DERRUBA a criação, em vez de virar aviso. Como a validação só recusa o que o
-- wizard nunca monta (pergunta de outro serviço, opção de outra pergunta,
-- resposta duplicada), o caminho normal não muda.
--
-- Formato de p_respostas — o mesmo shape de linhasRespostasPerguntas, sem o
-- agendamento_id:
--   [{"pergunta_id": "8f3c…", "opcao_id": "b21a…", "texto_livre": null}, ...]
-- (pergunta_id e opcao_id são uuid, portanto sempre entre aspas no jsonb)
--
-- ---------------------------------------------------------------------------
-- CÓDIGOS DE ERRO (pra Etapa 7 mapear em mensagem de tela)
-- ---------------------------------------------------------------------------
--   AG001  salão inexistente ou inativo
--   AG002  serviço não é deste salão (ou está inativo)
--   AG003  profissional não é deste salão (ou está inativo)
--   AG004  profissional não atende este serviço (sem vínculo)
--   AG005  status inicial fora dos dois de reserva provisória
--   AG006  duração fora do intervalo permitido
--   AG007  resposta de pergunta inválida pro serviço escolhido
--   AG008  nome ou WhatsApp ausente/malformado
--   AG009  data ou horário ausente/fora de qualquer faixa plausível
--
-- Nenhum deles é 23P01: o erro de horário ocupado continua subindo cru, com o
-- SQLSTATE do Postgres, exatamente como o app já espera.
--
-- ---------------------------------------------------------------------------
-- `periodo` (tsrange)
-- ---------------------------------------------------------------------------
-- Confirmado no banco: é COLUNA GERADA (tsrange montado de `data` + `horario`
-- + `duracao_min`). Por isso esta função não o monta nem o lista no insert —
-- igual a todos os caminhos de insert do app. A exclusion constraint
-- `agendamentos_sem_sobreposicao` continua valendo pra linha criada aqui sem
-- nada a mais ser feito.
--
-- ---------------------------------------------------------------------------
-- AGENDAMENTO EM GRUPO (Sessão 69) — como esta função se estende
-- ---------------------------------------------------------------------------
-- NÃO implementado aqui. O que foi feito é deixar o caminho pronto:
--
--   * A função é a unidade "uma pessoa, uma linha". Ela não abre transação,
--     não faz nada uma-vez-por-chamada e não guarda estado entre chamadas —
--     então um futuro `agendamento_criar_grupo(...)` pode chamá-la N vezes
--     dentro do próprio corpo plpgsql e as N linhas nascem na MESMA transação
--     (uma chamada de função é uma transação): se a pessoa 3 bater na exclusion
--     constraint, as duas primeiras somem junto. É exatamente o que o grupo
--     precisa e o que o cancela-e-recria de hoje não consegue dar.
--   * Como não há bloco EXCEPTION, o 23P01 da pessoa 3 sobe intacto pela
--     função de grupo até o app, sem tratamento novo.
--   * O que a função de grupo vai acrescentar POR CIMA, sem tocar nesta: ler
--     `permite_agendamento_grupo`/`max_pessoas_grupo` do estabelecimento,
--     conferir a quantidade de pessoas, e passar adiante o identificador do
--     grupo. Esse último é a ÚNICA mudança de assinatura prevista aqui — um
--     `p_grupo_id` opcional, quando a coluna existir. Até lá, nada a fazer.
--   * Duas funções (uma interna + um wrapper granted) foram consideradas e
--     descartadas: hoje o wrapper seria repasse puro. A função de grupo chama
--     esta direto — dentro de um SECURITY DEFINER o papel corrente é o dono,
--     que tem EXECUTE de qualquer jeito, então o grant pro anon não atrapalha.

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
    finalizado
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
    true
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

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
-- REVOKE de PUBLIC antes do GRANT: toda função nasce com EXECUTE pra PUBLIC, e
-- sem isto o grant abaixo seria decorativo. `authenticated` entra junto porque
-- o mesmo componente público roda logado quando a dona abre o próprio link com
-- a sessão do /admin aberta — o /admin em si NÃO usa esta função (o insert do
-- modo livre é outro caminho, com regras próprias: serviço livre, status
-- 'confirmado', fora da janela por decisão consciente).
revoke execute on function public.agendamento_criar(
  bigint, bigint, bigint, date, time, integer, text, text, text, jsonb
) from public;

grant execute on function public.agendamento_criar(
  bigint, bigint, bigint, date, time, integer, text, text, text, jsonb
) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Seguro de rodar ENQUANTO as policies de INSERT anon ("insercao publica de
-- agendamentos") e `agendamento_respostas_public_insert` ainda existirem — ou
-- seja: antes da Etapa 8, e depois dela só recriando as duas junto. Com o app
-- já migrado (Etapa 7) e as policies derrubadas, dropar esta função deixa o
-- fluxo público sem NENHUM caminho de criação de reserva.
--
-- drop function if exists public.agendamento_criar(
--   bigint, bigint, bigint, date, time, integer, text, text, text, jsonb
-- );
