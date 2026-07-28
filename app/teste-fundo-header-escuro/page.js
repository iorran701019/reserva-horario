import Hero from "@/components/Hero";

// Página de teste TEMPORÁRIA — comparação visual de fundo do header MAIS
// ESCURO que o body da Laysla (tema.bgBody = #CDCDCD), sem mexer no tema
// real (lib/temas.js). Pode apagar depois da decisão; não tem link em
// nenhuma navegação.
//
// Reaproveita o Hero REAL (components/Hero.js) com slug="laysla" — já
// inclui a linha vertical (tema.dividorHeader) e todo o resto do tema
// (marca, achatarLogo, headerCompacto etc). O fundo de cada variação
// sobrescreve tema.bgHeader via CSS (!important), já que o Hero define o
// background inline (estiloFundo) — não dá pra passar prop sem mexer no
// Hero, e o pedido foi não tocar nele além da linha vertical.
const VARIACOES = [
  { label: "Sutil", cor: "#B5B5B5" },
  { label: "Médio", cor: "#9C9C9C" },
  { label: "Forte", cor: "#858585" },
];

export default function TesteFundoHeaderEscuroPage() {
  return (
    <main className="flex min-h-screen flex-col divide-y divide-neutral-400">
      {VARIACOES.map(({ label, cor }, i) => {
        const classe = `bg-teste-escuro-${i}`;
        return (
          <section key={classe} className="bg-neutral-300 px-4 py-10 sm:px-8">
            <div className="mx-auto max-w-2xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                {label}
                <span className="ml-2 font-normal normal-case text-neutral-500">
                  — {cor}
                </span>
              </p>
              <div className={`overflow-hidden rounded-md shadow-sm ${classe}`}>
                <style>{`.${classe} header { background: ${cor} !important; }`}</style>
                <Hero slug="laysla" />
              </div>
            </div>
          </section>
        );
      })}
    </main>
  );
}
