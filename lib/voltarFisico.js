"use client";

import { useEffect, useRef } from "react";

// Intercepta o botão físico "voltar" (Android/iOS) enquanto `ativo` for
// true: ao ativar, empurra UMA entrada de histórico (sem mudar a URL) e
// passa a escutar `popstate`; recebendo o evento, chama `onVoltar` em vez de
// deixar o navegador sair da página. Ao desativar (etapa mudou de novo, ou o
// componente desmontou), só remove o listener — nunca deixa mais de um
// listener vivo por ativação.
//
// Uso por componente/etapa (não é um gerenciador central de pilha único pro
// fluxo inteiro): cada componente com etapas chama este hook com o PRÓPRIO
// callback de "voltar" — o mesmo que já alimenta o botão "Voltar" em tela,
// onde existir —, a condição que só é true quando aquela etapa está visível,
// e uma `chave` estável (string) que identifica ESTA etapa entre as demais
// que também chamam o hook no mesmo componente (ex.: "data"/"dados"). A
// primeira etapa de cada componente nunca deve chamar isto com ativo=true: é
// ali que o voltar físico deve continuar saindo da página normalmente.
//
// `onVoltar` pode ser uma função nova a cada render (comum, já que fecha
// sobre o estado da etapa atual) — guardamos a mais recente numa ref pra não
// precisar recriar o listener a cada render, só quando `ativo` muda de
// verdade.
//
// Por que checar `history.state` antes de empurrar: numa etapa com irmãs no
// mesmo componente (ex. "data" e "dados" do wizard, cada uma com sua própria
// chamada deste hook), reativar uma irmã depois que a outra desativou sem
// passar por um popstate real (ex.: reentrar em "data" vindo de um "Voltar"
// em tela, ou reativar "data" logo após o popstate de "dados" já ter movido
// o navegador pra cá) pousa em cima de uma entrada que já existe e já é
// nossa — empurrar de novo ali empilharia uma segunda entrada por cima,
// nunca mais alcançada por um voltar físico seguinte (ela fica presa,
// engolindo um toque em silêncio, sem nenhuma mudança visível na tela). Só
// empurra quando a entrada atual não é (ainda) desta chave.
export function useVoltarFisico(onVoltar, ativo, chave) {
  const onVoltarRef = useRef(onVoltar);
  useEffect(() => {
    onVoltarRef.current = onVoltar;
  }, [onVoltar]);

  useEffect(() => {
    if (!ativo) return;

    // Preserva o resto do state atual (o Next.js guarda ali o próprio estado
    // interno de navegação do App Router) — só acrescenta/atualiza a chave.
    if (window.history.state?.voltarFisico !== chave) {
      window.history.pushState(
        { ...window.history.state, voltarFisico: chave },
        ""
      );
    }

    function handlePopState() {
      onVoltarRef.current?.();
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [ativo, chave]);
}
