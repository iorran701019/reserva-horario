-- Link de compartilhamento do Google Maps do estabelecimento, usado pelo
-- card "Ver localização" na tela de confirmação do agendamento (ver
-- link_localizacao em ConfiguracoesSalao e app/[salon]/page.js). Texto livre;
-- null/vazio = card não aparece.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists link_localizacao text;
