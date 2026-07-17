// Tema visual por salão (slug), independente do `segmento` (sql/estabelecimentos_segmento.sql).
// É só apresentação do Hero: sem entrada aqui (ou tema.marca nulo), o Hero
// mantém 100% o visual padrão — nome em texto centralizado, cores da paleta
// global (ver components/Hero.js). Nada disso precisa de migration; é local
// ao front, então basta editar TEMAS_POR_SLUG pra dar identidade a um salão.
const TEMAS_POR_SLUG = {
  laysla: {
    // Gatilho explícito do override de cor (--color-primary/--color-heading/
    // etc., ver app/[salon]/page.js, app/[salon]/admin/page.js, Hero.js,
    // FormularioAgendamento.js) — independente de qual campo de imagem a
    // marca usa (marca vs marcaSimbolo/marcaTexto).
    personalizado: true,
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
    // Layout do bloco de marca no Hero — monograma à esquerda + nome/tagline
    // empilhados à direita (ver Hero.js).
    layoutMarca: "esquerda",
    // Nome de exibição no Hero — sobrepõe estabelecimentos.nome ("Laysla
    // Nails") sem exigir migration; ver Hero.js (bloco `tema`).
    nomeExibido: "Laysla Vieira",
    tagline: "Nail designer",
  },
  flavia: {
    personalizado: true,
    bgHeader: "#FBF6F5",
    bgBody: "#F1E7E4",
    bordaHeader: "#E6D5D1",
    textoPrincipal: "#4A1420",
    textoSecundario: "#7A2A32",
    botao: "#A3182D",
    botaoHover: "#7A0F21",
    // Logo completo da Ahazou: símbolo (pétalas) + wordmark ("ahazou spa das
    // unhas"), empilhados no Hero — ver layoutMarca abaixo. Sem nome do
    // estabelecimento em texto solto; a imagem já contém a marca por extenso.
    marcaSimbolo: "/images/flavia/ahazou-simbolo.png",
    marcaTexto: "/images/flavia/ahazou-wordmark-completo.png",
    layoutMarca: "pilha-completa",
  },
};

// Devolve o tema do slug (objeto) ou null — slug ausente/sem entrada cadastrada.
export function buscarTema(slug) {
  if (!slug) return null;
  return TEMAS_POR_SLUG[String(slug).toLowerCase()] ?? null;
}
