"use client";

import { useEffect, useState } from "react";
import { formatarPreco } from "@/lib/preco";
import { valorTotalAgendamento } from "@/lib/acrescimoDomingo";
import { somarAjustesPreco } from "@/lib/agendamentoRespostas";

// Total de um agendamento com acréscimo de domingo gravado: o cron soma os
// ajustes de preço das perguntas ANTES do acréscimo, então o valor só é exibido
// depois de buscá-los. Sem número enquanto carrega ou se a busca falhar.
// Usar apenas quando agendamentoTemAcrescimo(linha).
export default function ValorComAcrescimo({ linha }) {
  const id = linha?.id;
  const [estado, setEstado] = useState({ id: null, status: "carregando", centavos: 0 });

  useEffect(() => {
    if (id == null) return undefined;
    let ativo = true;
    somarAjustesPreco(id)
      .then((r) => {
        if (!ativo) return;
        setEstado({ id, status: r.ok ? "ok" : "erro", centavos: r.centavos });
      })
      .catch(() => {
        if (ativo) setEstado({ id, status: "erro", centavos: 0 });
      });
    return () => {
      ativo = false;
    };
  }, [id]);

  const aviso = (
    <span className="text-xs">
      Não foi possível conferir o valor; confira os ajustes de preço das perguntas.
    </span>
  );

  // Resultado de outro agendamento (troca de id) conta como carregando.
  if (id == null) return aviso;
  if (estado.id !== id || estado.status === "carregando") return <>…</>;
  if (estado.status === "erro") return aviso;
  const total = valorTotalAgendamento(linha, estado.centavos);
  return <>{total == null ? "—" : formatarPreco(total)}</>;
}
