-- `cliente_id` opcional em pendencias_admin: o tipo 'fidelidade_disponivel'
-- (ver TIPOS_PENDENCIA em app/[salon]/admin/page.js, lib/fidelidade.js) não
-- está preso a um agendamento específico como 'cancelamento_cliente' — precisa
-- apontar direto pra `clientes` pra resolver o WhatsApp (ação "Enviar
-- mensagem") e pra registrar o resgate. SET NULL preserva a pendência mesmo
-- se a cliente for apagada (mesma convenção de agendamento_id).
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.pendencias_admin
  add column if not exists cliente_id uuid references public.clientes (id) on delete set null;
