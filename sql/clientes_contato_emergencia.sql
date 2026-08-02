-- Contato de emergência (WhatsApp) opcional, coletado por
-- CadastroCliente/AtualizarDadosCliente no lugar do bloco de endereço quando
-- estabelecimentos.exigir_endereco é false. Dígitos apenas, mesma convenção
-- da coluna `whatsapp`. Exibido em GerenciarClientes ao lado do WhatsApp
-- principal quando preenchido.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.clientes
  add column if not exists contato_emergencia text;
