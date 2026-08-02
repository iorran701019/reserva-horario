-- Flag por tenant: quando false, CadastroCliente/AtualizarDadosCliente
-- ocultam todo o bloco de endereço (CEP/número/complemento/bairro/cidade/
-- estado) e mostram no lugar um campo opcional "Contato de emergência
-- (WhatsApp)" (ver clientes.contato_emergencia). Default true preserva o
-- comportamento atual pra todo tenant existente.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists exigir_endereco boolean not null default true;
