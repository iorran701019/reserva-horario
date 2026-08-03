-- Guarda o id do evento criado no Google Calendar por
-- app/api/google-calendar/sync/route.js, pra saber se cria (POST), atualiza
-- (PATCH) ou apaga (DELETE) o evento na próxima sincronização do mesmo
-- agendamento. Null enquanto não existe evento (agendamento pendente/
-- aguardando_sinal, ou salão sem google_calendar_ativo).
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.agendamentos
  add column if not exists google_event_id text;
