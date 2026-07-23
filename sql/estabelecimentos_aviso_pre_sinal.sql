-- Aviso configurável exibido num popup para a cliente, no fluxo público,
-- antes dela ver o bloco de pagamento do sinal (ver aviso_pre_sinal em
-- ConfiguracoesSalao e PopupAvisoSinal/FormularioAgendamento). Texto livre;
-- null/vazio = nenhum popup aparece.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists aviso_pre_sinal text;
