-- Textos de WhatsApp personalizáveis por tenant (ver MENSAGENS_WHATSAPP_CONFIG
-- em lib/whatsapp.js e a seção "Mensagens de WhatsApp" de ConfiguracoesSalao).
-- Cada coluna é o texto vigente daquela mensagem: null = nunca editado (usa o
-- padrão do código); string (mesmo vazia) = personalizado pelo estabelecimento.
--
-- Já rodado no projeto de staging.

alter table public.estabelecimentos
  add column if not exists msg_confirmacao text,
  add column if not exists msg_lembrete text,
  add column if not exists msg_cancelamento text,
  add column if not exists msg_reativacao text,
  add column if not exists msg_solicitacao_enviada text,
  add column if not exists msg_duvida_generica text,
  add column if not exists msg_cancelamento_cliente text,
  add column if not exists msg_ajuda_prazo_expirado text,
  add column if not exists msg_falha_cadastro text,
  add column if not exists msg_contato_admin text;
