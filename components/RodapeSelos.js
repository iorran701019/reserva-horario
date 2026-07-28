import { Shield, Sparkles, Heart } from "lucide-react";

// Rodapé público com os 3 selos de confiança, configuráveis por tenant via
// estabelecimento.rodape_selo1/2/3 (ver lib/estabelecimento.js). null/vazio
// mantém o texto padrão abaixo; string preenchida substitui só aquele selo
// específico — os ícones (escudo, brilho, coração) são fixos, não mudam por
// tenant.
const SELOS_PADRAO = [
  "Atendimento personalizado",
  "Qualidade premium",
  "Feito com amor",
];

const ICONES = [Shield, Sparkles, Heart];

export default function RodapeSelos({ estabelecimento }) {
  const textos = [
    estabelecimento.rodape_selo1,
    estabelecimento.rodape_selo2,
    estabelecimento.rodape_selo3,
  ];

  return (
    <div className="mx-auto flex w-full max-w-md flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 pb-6 text-xs text-muted">
      {ICONES.map((Icone, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
          {textos[i] || SELOS_PADRAO[i]}
        </span>
      ))}
    </div>
  );
}
