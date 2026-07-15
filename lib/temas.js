// Tema visual por salão (slug), independente do `segmento` (sql/estabelecimentos_segmento.sql).
// É só apresentação do Hero: sem entrada aqui (ou tema.marca nulo), o Hero
// mantém 100% o visual padrão — nome em texto centralizado, cores da paleta
// global (ver components/Hero.js). Nada disso precisa de migration; é local
// ao front, então basta editar TEMAS_POR_SLUG pra dar identidade a um salão.
const TEMAS_POR_SLUG = {
  laysla: {
    bgHeader: "#FAF9F7",
    // Body mais escuro que o header e os cards (bg-card) — o contraste entre
    // as três camadas vem daqui, não de mudar a cor dos cards.
    bgBody: "#CDCDCD",
    // Cinza médio antigo do bgHeader agora é só a linha de separação do Hero.
    bordaHeader: "#CDCDCD",
    textoPrincipal: "#2f2b28",
    textoSecundario: "#6D6D6D",
    // Botões do wizard público (FormularioAgendamento/IdentificacaoCliente) —
    // MESMO cinza da marca/textoSecundario (#6D6D6D), não um tom à parte.
    botao: "#6D6D6D",
    botaoHover: "#575757",
    fonteDisplay: "font-cormorant",
    marca: "/images/laysla/laysla-marca-cinza.png",
    // Nome de exibição no Hero — sobrepõe estabelecimentos.nome ("Laysla
    // Nails") sem exigir migration; ver Hero.js (bloco `tema`).
    nomeExibido: "Laysla Vieira",
    tagline: "Nail designer",
  },
};

// Devolve o tema do slug (objeto) ou null — slug ausente/sem entrada cadastrada.
export function buscarTema(slug) {
  if (!slug) return null;
  return TEMAS_POR_SLUG[String(slug).toLowerCase()] ?? null;
}
