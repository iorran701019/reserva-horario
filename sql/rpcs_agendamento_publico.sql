-- RPCs do fluxo PÚBLICO de agendamento (papel anon), Etapa 3 do plano de
-- fechamento da RLS de `agendamentos`.
--
-- Substituem a policy "Público pode cancelar próprio agendamento" (UPDATE,
-- anon, using = true), que hoje deixa qualquer requisição anônima alterar
-- QUALQUER linha de QUALQUER salão. Cada gesto do fluxo da cliente vira uma
-- função com escopo estreito, e a policy cai na Etapa 5 — depois que o app
-- estiver migrado (Etapa 4).
--
-- Por que só `p_id uuid`, sem telefone como segundo fator: `agendamentos.id`
-- é uuid com default gen_random_uuid(), não é enumerável. Quem tem o id já
-- esteve no fluxo daquele agendamento. Se algum dia o id voltar a ser
-- sequencial, TODAS as cinco precisam de `p_telefone` junto.
--
-- Convenções que valem pras cinco:
--   * SECURITY DEFINER + SET search_path — sem isso a função roda com o
--     search_path de quem chama e um schema plantado poderia sequestrar os
--     nomes. `pg_temp` vai no fim (nunca no começo) pelo mesmo motivo.
--   * Estabelecimento ATIVO é pré-requisito em todas, igual ao `using` da
--     policy que elas substituem (ver sql/agendamentos_anon_update_policy.sql).
--   * NENHUMA tem bloco EXCEPTION. A exclusion constraint
--     `agendamentos_sem_sobreposicao` (23P01) e qualquer outra violação
--     precisam subir com o SQLSTATE intacto: o fluxo público detecta
--     `error.code === '23P01'` pra dizer "esse horário acabou de ser
--     reservado" (ver components/FormularioAgendamento.js). Engolir erro aqui
--     quebraria essa mensagem em silêncio.
--   * Retorno SEMPRE distingue gravou de não gravou. O app inteiro depende
--     disso: hoje cada UPDATE anon usa `.select("id")` + checagem de zero
--     linhas justamente porque um update filtrado por RLS volta com
--     `error null` e nenhuma linha. Uma função `void` aqui reintroduziria o
--     bug que aqueles comentários existem pra evitar.
--   * `SELECT ... FOR UPDATE` antes do UPDATE em todas as que escrevem: além
--     de dar acesso ao status ANTERIOR (que o UPDATE ... RETURNING não
--     devolve), serializa dois gestos simultâneos da mesma cliente (marcar a
--     caixa e concluir o upload disparam os dois o mesmo write).
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging PRIMEIRO).

-- ---------------------------------------------------------------------------
-- 1. Cancelamento pela cliente
-- ---------------------------------------------------------------------------
-- Substitui o par SELECT-status + UPDATE de cancelarAgendamentoCliente
-- (lib/agendamentosCliente.js) — as duas idas viram uma, e some o TOCTOU entre
-- ler o status e gravar o cancelamento.
--
-- Devolve o STATUS ANTERIOR porque é ele que decide se a dona é avisada no
-- WhatsApp: desistir de algo em 'pendente'/'aguardando_sinal' cancela em
-- silêncio (ela talvez nem tenha visto o pedido); desfazer um 'confirmado'
-- notifica. NULL = nada foi alterado, e quem chama mostra o erro.
--
-- Status de origem aceitos: os três que o fluxo real cancela. 'concluido'
-- fica DE FORA de propósito, embora buscarConflitoPrazoMinimo possa devolver
-- um: cancelar um atendimento que já aconteceu reescreve histórico e ainda
-- dispara o trigger de pendência ("fulana cancelou o agendamento") pra algo
-- já prestado. O PainelCliente nunca oferece isso (a lista corta o que
-- classificarAgendamento considera histórico); só o botão "Cancelar <data
-- antiga> e confirmar <data nova>" do ModalPrazoMinimo alcançava esse caso.
-- 'cancelado' também sai: recancelar não é operação, e deixá-lo passar faria
-- a função devolver 'cancelado' como "status anterior" e o app abrir um aviso
-- de WhatsApp pra um cancelamento que não aconteceu agora.
--
-- `cancelado_por_cliente = true` é o que faz o trigger
-- trg_criar_pendencia_cancelamento criar o card da aba Pendentes. O trigger
-- dispara normalmente daqui: gatilho é da TABELA, não do papel, e a função de
-- trigger já é SECURITY DEFINER por conta própria (ver
-- sql/trigger_pendencia_cancelamento.sql). Depois da Etapa 5 este passa a ser
-- o ÚNICO caminho público que grava essa flag.
create or replace function public.agendamento_cancelar_cliente(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
begin
  select a.status
    into v_status
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
   where a.id = p_id
     and e.ativo = true
     for update of a;

  -- Linha inexistente, de salão inativo, ou em status que este fluxo não
  -- cancela: nada a fazer. NULL é o sinal de "não gravou".
  if v_status is null
     or v_status not in ('pendente', 'aguardando_sinal', 'confirmado') then
    return null;
  end if;

  update public.agendamentos
     set status = 'cancelado',
         cancelado_por_cliente = true
   where id = p_id;

  return v_status;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Liberar a reserva provisória do wizard
-- ---------------------------------------------------------------------------
-- Dois pontos do FormularioAgendamento: a reserva órfã descoberta na
-- restauração de sessão, e a reserva anterior cancelada antes de recriar
-- noutro horário. Nos dois casos é a PRÓPRIA cliente trocando de ideia dentro
-- do wizard, não um cancelamento no sentido do item 1.
--
-- Por isso NÃO grava `cancelado_por_cliente`: com a flag, o trigger criaria um
-- card "Cancelado pelo cliente" na aba Pendentes a cada troca de horário no
-- meio do fluxo — a dona veria ruído de uma decisão que a cliente tomou antes
-- de concluir qualquer coisa. É o comportamento de hoje (aqueles dois UPDATEs
-- gravam só `status`), preservado de propósito.
--
-- Status de origem: SÓ os dois de reserva provisória. 'confirmado' fica de
-- fora explicitamente — é a diferença que separa esta função da de cima, e a
-- razão de existirem duas. Um 'confirmado' chegando aqui só pode ser id
-- errado ou estado inesperado, e cancelar a agenda já firmada da cliente sem
-- ela escolher isso seria o pior desfecho possível. Nota: no modo edição a
-- linha é um agendamento de VERDADE (a cliente veio do "Editar" da tela de
-- protocolo ou do Pix), mas nesses dois caminhos ela está sempre em
-- 'pendente' ou 'aguardando_sinal' — o "Editar" não é oferecido pra
-- 'confirmado' em lugar nenhum do fluxo público.
create or replace function public.agendamento_liberar_reserva(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
begin
  select a.status
    into v_status
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
   where a.id = p_id
     and e.ativo = true
     for update of a;

  if v_status is null
     or v_status not in ('pendente', 'aguardando_sinal') then
    return false;
  end if;

  update public.agendamentos
     set status = 'cancelado'
   where id = p_id;

  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Declarar o pagamento do sinal
-- ---------------------------------------------------------------------------
-- O gesto "paguei e avisei": marcar a caixa ou concluir o upload do
-- comprovante (components/BlocoConfirmacaoPix.js), mais a rede de segurança do
-- submit final (finalizarAgendamento).
--
-- `sinal_valor_centavos` é LIDO DO ESTABELECIMENTO aqui dentro. Hoje o número
-- viaja do navegador (`estabelecimento.sinal_valor_centavos` na prop), ou
-- seja, um anônimo podia gravar o valor que quisesse num campo que alimenta o
-- card de Relatórios. COALESCE em vez de sobrescrita: linha que JÁ tem valor
-- (cobrança AbacatePay criada em gerar-cobranca, ou herança da remarcação)
-- mantém o que foi realmente cobrado — a config do salão pode ter mudado
-- desde então. Mesmo cuidado de confirmarPagamentoPix.
--
-- IDEMPOTÊNCIA NÃO É DEFENSIVA, É O CAMINHO NORMAL. No percurso comum a
-- cliente marca a caixa (grava) e depois submete o wizard (chama de novo):
-- `marcadoPendenteParaRef` mora dentro do BlocoConfirmacaoPix e não é
-- consultado pelo submit. Devolver false na segunda chamada faria a tela
-- mostrar "Não foi possível registrar o pagamento do sinal" e TRAVAR a
-- cliente na etapa "dados". Mesma situação de quem pagou via Pix
-- AbacatePay: confirmarPagamentoPix já deixou a linha em
-- pendente + sinal_declarado_pago antes de o submit chegar.
--
-- `pendente_desde` só é carimbado quando ainda está NULL. É dele que sai a
-- janela de protocolo de 24h (ver a régua de telas em app/[salon]/page.js):
-- reescrevê-lo a cada gesto empurraria a janela pra frente de graça. Hoje os
-- dois pontos gravam now() incondicionalmente — isto alinha o código com o
-- que o comentário de marcarPendente e a guarda de confirmarPagamentoPix já
-- dizem ser a intenção.
create or replace function public.agendamento_declarar_sinal(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status                text;
  v_sinal_declarado       boolean;
  v_sinal_estabelecimento integer;
begin
  select a.status, a.sinal_declarado_pago, e.sinal_valor_centavos
    into v_status, v_sinal_declarado, v_sinal_estabelecimento
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
   where a.id = p_id
     and e.ativo = true
     for update of a;

  if v_status is null then
    return false;
  end if;

  -- Já declarado: sucesso sem gravar nada (ver IDEMPOTÊNCIA acima).
  if v_status = 'pendente' and v_sinal_declarado is true then
    return true;
  end if;

  -- Fora isso, só sai de 'aguardando_sinal'. Um 'confirmado' não volta pra
  -- 'pendente' por gesto da cliente, e um 'cancelado' não ressuscita.
  if v_status <> 'aguardando_sinal' then
    return false;
  end if;

  update public.agendamentos
     set status               = 'pendente',
         sinal_declarado_pago = true,
         pendente_desde       = coalesce(pendente_desde, now()),
         sinal_valor_centavos = coalesce(sinal_valor_centavos, v_sinal_estabelecimento)
   where id = p_id;

  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Anexar o comprovante do Pix
-- ---------------------------------------------------------------------------
-- Grava o CAMINHO dentro do bucket privado 'comprovantes-pix', nunca uma URL
-- (signed url expira; uma url morta na linha seria pior que nada — ver
-- components/BlocoConfirmacaoPix.js e o createSignedUrl do /admin).
--
-- A validação do caminho é o que impede a função de virar um ponteiro
-- arbitrário: sem ela, um anônimo com o id poderia apontar a linha pro
-- comprovante de OUTRO agendamento e ler o arquivo alheio pela tela do
-- /admin. O padrão exigido é exatamente o que caminhoComprovante monta —
-- '<id do agendamento>/comprovante.<extensao>' — então o caminho gravado
-- SEMPRE cai no prefixo do próprio agendamento. A extensão vem de
-- arquivo.name.split('.').pop() no navegador, sem sanitização: o limite
-- alfanumérico aqui é a sanitização.
--
-- NÃO mexe em status: quem muda 'aguardando_sinal' -> 'pendente' é a função 3,
-- chamada logo depois pelo mesmo gesto. Status de origem aceitos são os dois
-- em que anexar faz sentido (a cliente pode mandar um segundo comprovante já
-- estando em 'pendente').
create or replace function public.agendamento_anexar_comprovante(
  p_id uuid,
  p_caminho text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
begin
  if p_caminho is null
     or p_caminho !~ ('^' || p_id::text || '/comprovante\.[A-Za-z0-9]{1,10}$') then
    return false;
  end if;

  select a.status
    into v_status
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
   where a.id = p_id
     and e.ativo = true
     for update of a;

  if v_status is null
     or v_status not in ('aguardando_sinal', 'pendente') then
    return false;
  end if;

  update public.agendamentos
     set comprovante_pix_url        = p_caminho,
         comprovante_pix_enviado_em = now()
   where id = p_id;

  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Status da reserva (leitura por id)
-- ---------------------------------------------------------------------------
-- Substitui os dois SELECT por id do wizard: o que resolve `statusPixReserva`
-- na restauração de sessão / modo edição, e o que decide entre o
-- cancela-e-recria local e a rota /api/agendamentos/remarcar.
--
-- Devolve SÓ status e abacatepay_pago_em — nada de nome, telefone, valores ou
-- comprovante. É o mínimo que as duas decisões precisam, e mantém a função
-- inofensiva mesmo que um id vaze.
--
-- Zero linhas = id inexistente ou salão inativo. Quem chama já trata isso
-- (`if (ignorar || error || !data) return` / `?.` com fallback), então o
-- caminho de erro continua o de hoje.
create or replace function public.agendamento_status_reserva(p_id uuid)
returns table (status text, abacatepay_pago_em timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select a.status, a.abacatepay_pago_em
    from public.agendamentos a
    join public.estabelecimentos e on e.id = a.estabelecimento_id
   where a.id = p_id
     and e.ativo = true;
$fn$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
-- REVOKE de PUBLIC antes do GRANT: toda função nasce com EXECUTE pra PUBLIC,
-- e sem isto os grants abaixo seriam decorativos. `authenticated` entra junto
-- porque o mesmo componente público roda logado quando a dona abre o próprio
-- link com a sessão do /admin aberta (o /admin em si não usa nenhuma destas).
revoke execute on function public.agendamento_cancelar_cliente(uuid) from public;
revoke execute on function public.agendamento_liberar_reserva(uuid) from public;
revoke execute on function public.agendamento_declarar_sinal(uuid) from public;
revoke execute on function public.agendamento_anexar_comprovante(uuid, text) from public;
revoke execute on function public.agendamento_status_reserva(uuid) from public;

grant execute on function public.agendamento_cancelar_cliente(uuid) to anon, authenticated;
grant execute on function public.agendamento_liberar_reserva(uuid) to anon, authenticated;
grant execute on function public.agendamento_declarar_sinal(uuid) to anon, authenticated;
grant execute on function public.agendamento_anexar_comprovante(uuid, text) to anon, authenticated;
grant execute on function public.agendamento_status_reserva(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Seguro de rodar ENQUANTO a policy "Público pode cancelar próprio
-- agendamento" ainda existir (ou seja: antes da Etapa 5, e depois dela só
-- recriando a policy junto — ver sql/agendamentos_anon_update_policy.sql).
-- Com o app já migrado (Etapa 4) e a policy derrubada, dropar estas funções
-- deixa o fluxo público sem NENHUM caminho de escrita.
--
-- drop function if exists public.agendamento_cancelar_cliente(uuid);
-- drop function if exists public.agendamento_liberar_reserva(uuid);
-- drop function if exists public.agendamento_declarar_sinal(uuid);
-- drop function if exists public.agendamento_anexar_comprovante(uuid, text);
-- drop function if exists public.agendamento_status_reserva(uuid);
