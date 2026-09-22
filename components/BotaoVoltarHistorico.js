"use client";

import { useRouter } from "next/navigation";

// "Voltar" das páginas estáticas (app/termos, app/privacidade). Um href fixo
// pra "/" tiraria a cliente do salão de onde ela veio (a raiz é a tela neutra
// de seleção), então volta no histórico. Sem histórico anterior (link aberto
// direto, favorito, aba nova) o back() não faria nada — cai em "/".
export default function BotaoVoltarHistorico({ className, children }) {
  const router = useRouter();

  function voltar() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <button type="button" onClick={voltar} className={`cursor-pointer ${className ?? ""}`}>
      {children}
    </button>
  );
}
