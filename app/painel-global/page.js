import HubPainelGlobal from "./HubPainelGlobal";

// Server Component fino: só lê o ?aba= e entrega pro shell (client). Ler o
// search param AQUI, pela prop da page, em vez de useSearchParams lá dentro,
// evita ter que envolver o hub num <Suspense> (ver docs do Next: useSearchParams
// force o client render até o boundary mais próximo). `searchParams` é uma
// Promise desde o Next 15 — precisa de await.
export default async function PainelGlobalPage({ searchParams }) {
  const { aba } = await searchParams;

  return <HubPainelGlobal abaInicial={typeof aba === "string" ? aba : undefined} />;
}
