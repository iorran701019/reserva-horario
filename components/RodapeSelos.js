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
    // flex-nowrap + overflow-x-auto só no mobile (abaixo de sm): os textos
    // (inclusive os mais longos configurados por tenant, ex.: Laysla)
    // precisam caber numa linha só, sem empurrar conteúdo abaixo. gap/fonte
    // reduzidos no mobile já resolvem a maioria das larguras; overflow-x-auto
    // é só a rede de segurança pra telas muito estreitas (~320px) onde nem
    // isso basta — rolagem horizontal em vez de quebrar linha. A partir de
    // sm, volta ao comportamento original (flex-wrap, sem scroll).
    <div className="mx-auto flex w-full max-w-md flex-nowrap items-center justify-center gap-x-0.5 gap-y-2 overflow-x-auto px-1 pb-6 text-[10px] text-muted sm:flex-wrap sm:gap-x-6 sm:overflow-visible sm:px-4 sm:text-xs">
      {ICONES.map((Icone, i) => (
        <span key={i} className="flex shrink-0 items-center gap-0.5 whitespace-nowrap sm:gap-1.5">
          <Icone className="h-2.5 w-2.5 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" />
          {textos[i] || SELOS_PADRAO[i]}
        </span>
      ))}
    </div>
  );
}
