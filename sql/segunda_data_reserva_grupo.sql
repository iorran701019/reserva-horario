-- Serviço com SEGUNDA DATA (Etapa 1 de 6) — schema.
--
-- Caso real: maquiadora com "Noiva com teste", que são DOIS atendimentos —
-- um teste, dias antes, e o do dia do evento. A cliente escolhe as duas datas
-- numa passagem só pelo /agendar, paga UM sinal (preso ao evento) e sai com
-- dois agendamentos vinculados.
--
-- ---------------------------------------------------------------------------
-- AS 4 COLUNAS
-- ---------------------------------------------------------------------------
--   servicos.exige_segunda_data   – liga a opção NESTE serviço. Default false:
--                                   todo catálogo já existente continua com o
--                                   fluxo de uma data só, sem backfill.
--
--   servicos.nome_etapa_anterior  – como o salão chama a etapa que vem antes
--                                   ("Teste", "Prova", "Ensaio"). NULL = usa o
--                                   padrão, e o padrão vive na UI, não aqui:
--                                   assim o texto exibido muda sem migration
--                                   nem UPDATE em massa.
--
--   agendamentos.reserva_grupo_id – o vínculo. Mesmo uuid nas duas linhas do
--                                   par. NÃO é exclusivo deste caso: é a MESMA
--                                   coluna prevista para o agendamento em
--                                   grupo das maquiadoras (N pessoas, mesmo
--                                   serviço, horários consecutivos — ver o
--                                   desenho congelado em PENDENCIAS.md e o
--                                   bloco "AGENDAMENTO EM GRUPO" no topo de
--                                   sql/rpc_criacao_agendamento.sql). Uma
--                                   coluna serve aos dois porque os dois são a
--                                   mesma pergunta: "quais linhas nasceram
--                                   juntas e devem viver juntas".
--
--   agendamentos.papel_reserva    – o que ESTA linha é dentro do grupo.
--                                   'principal' = o evento (o atendimento que
--                                   importa, e a linha em que o sinal fica
--                                   preso); 'anterior' = a etapa anterior (o
--                                   teste). NULL para uma linha solta e também
--                                   para o agendamento em grupo, onde as N
--                                   linhas são simétricas e nenhuma é
--                                   principal — é justamente essa diferença
--                                   que a coluna registra, e é por isso que ela
--                                   é separada de reserva_grupo_id em vez de
--                                   ser inferida da ordem das datas.
--
-- ---------------------------------------------------------------------------
-- POR QUE UUID DE GRUPO, E NÃO UMA FK PRA LINHA IRMÃ
-- ---------------------------------------------------------------------------
-- Porque a remarcação pública NÃO faz UPDATE: ela CANCELA e RECRIA, e a linha
-- nova nasce com id NOVO. Valem os dois caminhos — a rota de remarcação com
-- sinal AbacatePay pago (app/api/agendamentos/remarcar/route.js) e o
-- cancela-e-recria do wizard (agendamento_liberar_reserva + agendamento_criar,
-- ver selecionarHorario em components/FormularioAgendamento.js).
--
-- Uma FK apontando pro id da irmã morreria silenciosamente na primeira
-- remarcação: ou vira NULL, ou passa a apontar pra uma linha cancelada. Com um
-- uuid de grupo, remarcar é só CARREGAR o mesmo valor pra linha nova — uma
-- coluna a mais no insert, ao lado de pendente_desde e dos abacatepay_*, que a
-- rota já copia pelo mesmo motivo.
--
-- Efeito colateral bom: nenhuma das duas linhas é "dona" da outra, então
-- cancelar uma não deixa referência pendurada na outra.
--
-- O índice é PARCIAL (where reserva_grupo_id is not null) porque a coluna é
-- NULL na esmagadora maioria das linhas — agendamento em par/grupo é a exceção,
-- não a regra. O índice parcial só indexa o que é buscado ("me dê as irmãs
-- deste grupo") e não paga por todo o resto da tabela.
--
-- ---------------------------------------------------------------------------
-- ESTADO: JÁ RODADO EM STAGING. Falta produção.
-- Sem estas colunas, a aba Serviços do /admin cai inteira com 42703 (o select
-- de GerenciarServicos.js já lê as duas colunas novas de `servicos`).
-- ---------------------------------------------------------------------------

alter table public.servicos
  add column if not exists exige_segunda_data boolean not null default false;
alter table public.servicos
  add column if not exists nome_etapa_anterior text;

alter table public.agendamentos
  add column if not exists reserva_grupo_id uuid;
alter table public.agendamentos
  add column if not exists papel_reserva text;

alter table public.agendamentos
  drop constraint if exists agendamentos_papel_reserva_check;
alter table public.agendamentos
  add constraint agendamentos_papel_reserva_check
  check (papel_reserva is null or papel_reserva in ('principal', 'anterior'));

create index if not exists agendamentos_reserva_grupo_idx
  on public.agendamentos (reserva_grupo_id)
  where reserva_grupo_id is not null;
