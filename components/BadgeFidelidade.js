// Selo de progresso do programa de fidelidade (ver buscarProgressoFidelidade
// em lib/fidelidade.js). Paleta roxa: mesma do card de pendência
// "fidelidade_disponivel" em app/[salon]/admin/page.js (TIPOS_PENDENCIA).
//
// variante 'banner': bloco completo, usado no topo do PainelCliente e na
// ficha detalhada de GerenciarClientes.
// variante 'chip': só "{atual}/{meta}", compacto — mesmo estilo visual do
// selo de aniversariante já existente em GerenciarClientes.js.
export default function BadgeFidelidade({ atual, meta, descricaoBrinde, variante }) {
  if (variante === "chip") {
    return (
      <span className="shrink-0 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-purple-100">
        {atual}/{meta}
      </span>
    );
  }

  const brindeLiberado = atual >= meta;

  return (
    <div className="rounded-xl bg-purple-50 p-3 ring-1 ring-purple-100">
      <p className="text-sm font-medium text-purple-700">
        {brindeLiberado
          ? "🎉 Brinde liberado!"
          : `Fidelidade: ${atual}/${meta} — faltam ${meta - atual} pra ${descricaoBrinde}!`}
      </p>
    </div>
  );
}
