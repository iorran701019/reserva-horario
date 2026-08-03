-- Zoom da foto de perfil circular, complementar a foto_perfil_posicao (ver
-- sql/estabelecimentos_foto_perfil.sql e FotoPerfilCircular.js).
--
-- foto_perfil_zoom – multiplicador (numeric) sobre a escala mínima que cobre
--                     o círculo (equivalente ao object-fit: cover de antes).
--                     null/1 = sem zoom extra, comportamento antigo.
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists foto_perfil_zoom numeric;
