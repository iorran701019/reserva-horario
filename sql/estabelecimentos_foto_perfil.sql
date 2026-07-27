-- Foto de perfil circular do estabelecimento, mostrada no fluxo público
-- entre o subtítulo do Hero e a caixa de identificação/wizard (ver
-- FotoPerfilCircular e app/[salon]/page.js). Recurso genérico do motor —
-- qualquer tenant pode preencher, não só um salão específico.
--
-- foto_perfil_url      – caminho/URL da foto. null = nada aparece (sem
--                         buraco no layout).
-- foto_perfil_posicao  – object-position CSS (ex.: '50% 30%') pra enquadrar
--                         o rosto quando a foto não é quadrada. null cai no
--                         fallback '50% 50%' (centro).
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

alter table public.estabelecimentos
  add column if not exists foto_perfil_url text;

alter table public.estabelecimentos
  add column if not exists foto_perfil_posicao text;
