import { buscarTema } from "@/lib/temas";

// Faixa de aviso por tenant (tema.avisoTopo, ex.: acolhe = demo), logo abaixo
// do Hero nas duas telas do fluxo público (wizard e pós-envio — ver
// app/[salon]/page.js). Âmbar suave fixo em vez de cor do tema: precisa ler
// como aviso em qualquer paleta. Sem o campo, nada é renderizado.
export default function AvisoTopo({ slug }) {
  const tema = buscarTema(slug);
  if (!tema?.personalizado || !tema.avisoTopo) return null;

  return (
    <div
      role="note"
      className="w-full border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900 sm:text-sm"
    >
      {tema.avisoTopo}
    </div>
  );
}
