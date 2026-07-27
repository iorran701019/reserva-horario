import Image from "next/image";
import { buscarTema } from "@/lib/temas";

// Página de teste TEMPORÁRIA — comparação visual de fundo do header da
// Laysla, sem mexer no tema real (lib/temas.js) nem no Hero.js. Pode apagar
// depois da decisão; não tem link em nenhuma navegação.
//
// Reproduz o mesmo markup do bloco `tema` (layoutMarca 'esquerda') do
// Hero.js — monograma (`tema.marca`) + wordmark (`tema.marcaTexto`) —, só
// trocando o fundo do header (`background`) e, na Variação C, aplicando um
// filter de contorno nas duas imagens.

const tema = buscarTema("laysla");

// Variação B: mesmo cinza do body (tema.bgBody = #CDCDCD / rgb(205,205,205)),
// ~9% mais claro por canal (205 * 1.09 ≈ 223 → #DFDFDF). Fica dentro da
// faixa pedida (8-10%) sem abrir muito espaço em relação ao body.
const BG_LEVEMENTE_CLARO = "#DFDFDF";

// Contorno da Variação C: mais escuro que o cinza da marca (--color-heading
// do tema da Laysla, tema.textoPrincipal). 4 drop-shadows (cima/baixo/
// esquerda/direita) de 1px simulam um stroke fino ao redor do PNG
// transparente, sem precisar gerar uma imagem nova.
const CONTORNO_COR = tema.textoPrincipal;
const FILTER_CONTORNO = [
  `drop-shadow(1px 0 0 ${CONTORNO_COR})`,
  `drop-shadow(-1px 0 0 ${CONTORNO_COR})`,
  `drop-shadow(0 1px 0 ${CONTORNO_COR})`,
  `drop-shadow(0 -1px 0 ${CONTORNO_COR})`,
].join(" ");

// Bloco do header — mesmo markup/tamanhos do ramo `layoutMarca: 'esquerda'`
// em Hero.js, com `bgHeader` e `logoFilter` parametrizáveis por variação.
function HeaderPreview({ bgHeader, logoFilter }) {
  return (
    <header
      className="relative flex min-h-[180px] flex-col items-center justify-center border-b px-4 py-12 text-center sm:min-h-[220px]"
      style={{ background: bgHeader, borderColor: tema.bordaHeader }}
    >
      <div className="relative mx-auto flex w-full max-w-md items-center gap-4">
        <Image
          src={tema.marca}
          alt=""
          width={266}
          height={338}
          style={{ filter: logoFilter }}
          className="h-24 w-auto sm:h-28"
        />
        <div className="flex flex-1 flex-col items-center text-center">
          <Image
            src={tema.marcaTexto}
            alt={tema.nomeExibido}
            width={1600}
            height={292}
            style={{ width: "auto", filter: logoFilter }}
            className="h-16 sm:h-20"
          />
        </div>
      </div>
    </header>
  );
}

function Variacao({ titulo, descricao, children }) {
  return (
    <section className="bg-neutral-300 px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-600">
          {titulo}
          {descricao && (
            <span className="ml-2 font-normal normal-case text-neutral-500">
              — {descricao}
            </span>
          )}
        </p>
        <div className="overflow-hidden rounded-md shadow-sm">{children}</div>
      </div>
    </section>
  );
}

export default function TesteFundoHeaderPage() {
  return (
    <main className="flex min-h-screen flex-col divide-y divide-neutral-400">
      <Variacao
        titulo="Variação A"
        descricao="Fundo igual ao body (zero contraste)"
      >
        <HeaderPreview bgHeader={tema.bgBody} />
      </Variacao>

      <Variacao
        titulo="Variação B"
        descricao="Fundo ~9% mais claro que o body"
      >
        <HeaderPreview bgHeader={BG_LEVEMENTE_CLARO} />
      </Variacao>

      <Variacao
        titulo="Variação C"
        descricao="Fundo igual ao body + contorno escuro na logo"
      >
        <HeaderPreview bgHeader={tema.bgBody} logoFilter={FILTER_CONTORNO} />
      </Variacao>
    </main>
  );
}
