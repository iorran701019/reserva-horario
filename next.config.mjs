// remotePatterns libera o next/image pra otimizar as fotos de perfil dos
// estabelecimentos, hospedadas no Supabase Storage (bucket 'fotos-perfil' —
// ver ConfiguracoesSalao.js/FotoPerfilCircular.js). Sem isso, <Image
// src={estabelecimento.foto_perfil_url}> quebra com hostname não configurado.
// `search` fica de fora de propósito: a URL salva sempre carrega
// ?v=<timestamp> pra invalidar o cache do otimizador após cada troca de foto.

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "yebwkchcrvebvvjvvvyu.supabase.co",
        pathname: "/storage/v1/object/public/fotos-perfil/**",
      },
    ],
  },
};

export default nextConfig;
