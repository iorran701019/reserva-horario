-- Bucket de Storage pra foto de perfil dos estabelecimentos (recurso GENÉRICO
-- do motor — ver estabelecimentos.foto_perfil_url/foto_perfil_posicao em
-- sql/estabelecimentos_foto_perfil.sql e a seção "Foto de perfil" em
-- ConfiguracoesSalao.js).
--
-- Caminho de cada arquivo: `${estabelecimento_id}/perfil.<extensao>` —
-- sempre sobrescrito (upsert), nunca acumula lixo. Bucket público (leitura
-- livre, é a foto pública do salão); escrita só pra dono autenticado do
-- próprio admin (mesmo padrão de "só dono/global edita o próprio salão" das
-- policies de estabelecimentos).
--
-- Rode este arquivo no SQL Editor do Supabase (projeto de staging).

insert into storage.buckets (id, name, public)
values ('fotos-perfil', 'fotos-perfil', true)
on conflict (id) do nothing;

create policy "Leitura pública de fotos-perfil"
  on storage.objects for select
  using (bucket_id = 'fotos-perfil');

create policy "Upload autenticado em fotos-perfil"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'fotos-perfil');

create policy "Update autenticado em fotos-perfil"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'fotos-perfil');
