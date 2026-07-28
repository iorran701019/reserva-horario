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
    // Variação D aprovada: header mais claro que o bgBody (#CDCDCD, abaixo);
    // ver bordaHeader/bgBody logo abaixo.
    bgHeader: "#DFDFDF",
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
    // Recolorido de #6D6D6D pra #34363A (mesmo tom do wordmark) — RGB trocado
    // canal a canal, alpha original preservado 1:1 (já era uma máscara limpa,
    // sem halo/caixa fantasma), então proporção e suavidade das bordas não
    // mudam. Ver script usado: sharp lendo raw RGBA e substituindo só R/G/B.
    marca: "/images/laysla/laysla-marca-34363a.png",
    // Nome + tagline extraídos da fonte original da marca ("Laysla Vieira" /
    // "Nail Designer" numa imagem só) — substitui o texto ao vivo no Hero,
    // mantendo o monograma (`marca`) à esquerda; ver Hero.js (bloco `tema`).
    marcaTexto: "/images/laysla/laysla-logo-header.png",
    // Layout do bloco de marca no Hero — monograma à esquerda + nome/tagline
    // (texto ou, com marcaTexto definido, a imagem acima) empilhados à
    // direita (ver Hero.js).
    layoutMarca: "esquerda",
    // Aprovado após comparação visual (Variação D): o monograma (tema.marca)
    // veio mais "alongado" verticalmente do que o desejado na fonte
    // original — achatarLogo aplica scaleY(0.82) nele via CSS (sem
    // reamostrar o PNG). Campo genérico: qualquer tenant com o mesmo
    // problema de proporção pode reaproveitar (ver Hero.js). NÃO se aplica
    // ao wordmark (marcaTexto) — a fonte original já tem a proporção
    // correta, então Hero.js não repete o scaleY(0.82) nele (usa
    // achatarWordmark, abaixo, que é um achatamento estético à parte).
    achatarLogo: true,
    // Achatamento ESTÉTICO do wordmark (nome "Laysla Vieira"), pedido pela
    // cliente — diferente de achatarLogo (que corrige a proporção alongada
    // do monograma). Campo separado de propósito: achatarLogo é correção,
    // achatarWordmark é estilo. Valor ajustável; ver Hero.js.
    achatarWordmark: 0.85,
    // Nome de exibição no Hero — usado no alt da imagem/fallback sem
    // marcaTexto; sobrepõe estabelecimentos.nome ("Laysla Nails") sem exigir
    // migration; ver Hero.js (bloco `tema`).
    nomeExibido: "Laysla Vieira",
    tagline: "Nail designer",
    // Header mais baixo que o padrão do layout 'esquerda' — py/min-h já
    // passaram por dois cortes sucessivos (ver Hero.js). Campo genérico:
    // qualquer tenant com o mesmo pedido de header mais compacto pode
    // reaproveitar; só a Laysla usa até agora.
    headerCompacto: true,
    // Linha vertical fina entre o monograma e o nome/tagline (layoutMarca
    // 'esquerda') — cor sempre var(--color-heading) (já tematizado por
    // tenant via app/[salon]/page.js), então nenhum campo de cor extra é
    // necessário aqui. Campo genérico: qualquer tenant no mesmo layout pode
    // ativar; só a Laysla usa até agora. Ver Hero.js.
    dividorHeader: true,
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
