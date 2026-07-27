import FotoPerfilCircular from "@/components/FotoPerfilCircular";

// Página de teste TEMPORÁRIA — comparação visual de enquadramento (object-
// position) da foto de perfil da Laysla. Pode apagar depois da decisão; não
// tem link em nenhuma navegação.
//
// Reusa o MESMO componente de produção (FotoPerfilCircular — ver
// app/[salon]/page.js), só variando `posicao`. `DIAMETRO` é o valor medido
// em produção pra Laysla (altura da caixa de identificação em desktop).

const FOTO = "/images/laysla/laysla_perfil.jpeg";
const DIAMETRO = 174;

const VARIACOES = [
  { titulo: "Atual", posicao: "50% 20%" },
  { titulo: "Mais alto", posicao: "50% 10%" },
  { titulo: "Ainda mais alto", posicao: "50% 0%" },
  { titulo: "Intermediário", posicao: "50% 15%" },
];

export default function TestePosicaoFotoPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-neutral-200 px-4 py-12 sm:flex-row sm:flex-wrap sm:gap-8">
      {VARIACOES.map((variacao) => (
        <div key={variacao.titulo} className="flex flex-col items-center gap-3">
          <p className="text-center text-sm font-semibold text-neutral-700">
            {variacao.titulo}
            <br />
            <span className="font-normal text-neutral-500">
              object-position: {variacao.posicao}
            </span>
          </p>
          <FotoPerfilCircular
            src={FOTO}
            posicao={variacao.posicao}
            diametro={DIAMETRO}
            alt={`Enquadramento ${variacao.titulo}`}
          />
        </div>
      ))}
    </main>
  );
}
