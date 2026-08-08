"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { buscarPerfil } from "@/lib/perfil";

// URL do login do salão, carregando o destino pretendido em ?next= pra reentrar
// no MESMO salão após autenticar. Extraída de app/[salon]/admin/page.js junto
// com o resto da checagem de sessão — é o destino usado nos dois redirects
// abaixo (sem sessão inicial e perda de sessão em outra aba).
function urlLogin(salon) {
  const destino = `/${salon}/admin`;
  return `/${salon}/admin/login?next=${encodeURIComponent(destino)}`;
}

// Extraído de app/[salon]/admin/page.js: encapsula a checagem de sessão do
// Supabase Auth + a resolução do PERFIL (lib/perfil.js) do usuário
// autenticado. NÃO resolve o estabelecimento — isso fica por conta de quem
// consome o hook, porque a regra difere por contexto ('dono' trava no
// estabelecimento do perfil; 'global' hoje resolve pelo slug do path em
// /[salon]/admin, e vai resolver por um seletor no /painel-global).
//
// `salon` é OPCIONAL: com slug (uso em /[salon]/admin), sem sessão redireciona
// pro login DESSE salão — comportamento idêntico ao de sempre. Sem slug (uso
// em /painel-global, que não tem um salão fixo na URL), sem sessão só marca
// autenticado=false e NÃO redireciona — quem consome decide o que renderizar
// (ex.: um formulário de login inline na própria página).
//
// Retorna:
//   - autenticado: null (verificando) | false (sem sessão) | true (logado)
//   - perfil: undefined (sem sessão / ainda não buscado) | null (autenticado,
//     mas sem linha em `perfis` — conta órfã) | { papel, estabelecimento }
//   - semPerfil: true quando o perfil já foi buscado e veio vazio (conta órfã)
export function useSessaoAdmin(salon) {
  const router = useRouter();

  // Estado da sessão: null = ainda verificando; false = sem login; true = logado.
  const [autenticado, setAutenticado] = useState(null);

  // Perfil resolvido (papel + estabelecimento-casa). undefined = sem sessão ou
  // ainda não buscado; null = conta órfã; objeto = ok.
  const [perfil, setPerfil] = useState(undefined);

  // Autenticado, mas sem linha em perfis (conta órfã).
  const [semPerfil, setSemPerfil] = useState(false);

  // Verifica a sessão ao montar e fica ouvindo mudanças (login/logout em
  // outra aba também caem aqui). Sem sessão E com salon → manda pro login
  // DESSE salão (slug no path, via urlLogin(salon)). Sem salon, só atualiza o
  // estado (ver comentário da função acima).
  useEffect(() => {
    let ativo = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!ativo) return;
      if (!session) {
        setAutenticado(false);
        if (salon) router.replace(urlLogin(salon));
        return;
      }
      setAutenticado(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (!ativo) return;
      if (!session) {
        setAutenticado(false);
        if (salon) router.replace(urlLogin(salon));
        return;
      }
      setAutenticado(true);
    });

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, [router, salon]);

  // Busca o perfil assim que a sessão for confirmada — a query de `perfis`
  // filtra por auth.uid(). Sem linha em perfis → conta órfã, marca semPerfil.
  useEffect(() => {
    if (autenticado !== true) return;
    let ativo = true;

    (async () => {
      const perfilResolvido = await buscarPerfil();
      if (!ativo) return;

      setPerfil(perfilResolvido);
      setSemPerfil(!perfilResolvido);
    })();

    return () => {
      ativo = false;
    };
  }, [autenticado]);

  return { autenticado, perfil, semPerfil };
}
