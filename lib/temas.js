// Tema visual por salão (slug), independente do `segmento` (sql/estabelecimentos_segmento.sql).
// É só apresentação do Hero: sem entrada aqui, o salão recebe TEMA_PADRAO
// (paleta rosa + logo genérica); com entrada sem tema.marca, o Hero mostra o
// nome em texto centralizado nas cores do tema (ver components/Hero.js).
// Nada disso precisa de migration; é local ao front, então basta editar
// TEMAS_POR_SLUG pra dar identidade a um salão.
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
    achatarWordmark: 0.68,
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
    // Reduz o bloco de marca inteiro (monograma + wordmark + linha
    // divisória) mantendo as proporções entre eles — aplicado via scale()
    // no wrapper que os agrupa (ver Hero.js). Campo genérico: qualquer
    // tenant que precise de um logo mais compacto no header reaproveita;
    // 1 (ou ausente) = tamanho atual, sem mudança.
    escalaLogo: 0.8,
    // Reduz SÓ o monograma (símbolo "LV"), independente do wordmark e da
    // linha divisória — separado de escalaLogo (que escala o bloco inteiro
    // junto). Aplicado via scale() direto na <Image> do monograma (ver
    // Hero.js); a linha de base entre os três elementos continua alinhada
    // porque o scale não altera a caixa de layout (h-16/h-24 etc.), só o
    // desenho — o flex items-center segue centralizando pela caixa original.
    // Campo genérico: qualquer tenant no layout 'esquerda' reaproveita.
    escalaMonograma: 0.65,
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
  // lib/temas.js — dentro de TEMAS_POR_SLUG, ao lado de julia/flavia
acolhe: {
  personalizado: true,
  bgHeader: "#FBF3EF",
  bgBody: "#F3E4DC",
  bordaHeader: "#E3C3B3",
  textoPrincipal: "#6B4030",
  textoSecundario: "#A9704F",
  botao: "#D98B6E",
  botaoHover: "#B56A4E",
  fonteDisplay: "font-cormorant",
  marca: "/images/acolhe/acolhe-logo.svg",
  layoutMarca: "centro",
  headerCompacto: true,
  alturaMonograma: "h-28 w-auto sm:h-32",
  // Some com o <h1> do nome ao lado da logo (ver Hero.js) — o SVG já traz a
  // marca por extenso. Ausente nos outros temas = nome continua aparecendo.
  ocultarNome: true,
  // Faixa de aviso entre o Hero e "Agende seu horário" (ver app/[salon]/page.js).
  avisoTopo: "Demonstração do app. Sem atendimento real.",
},
  julia: {
    personalizado: true,
    // bgHeader vira tamb\u00E9m --color-card (superf\u00EDcie/card).
    bgHeader: "#F7F2E7",
    bgBody: "#EFE6D3",
    bordaHeader: "#DDD0B0",
    textoPrincipal: "#4A3D22",
    textoSecundario: "#6B5B3A",
    botao: "#A08344",
    botaoHover: "#8A6F38",
    fonteDisplay: "font-cormorant",
    // Lockup dourado completo (JK + nome + "Nail Designer"), recortado e
    // recomposto sem margens, fundo transparente (904x342, ~2.64:1). A faixa
    // "NAIL DESIGNER" está em 2x e centralizada sob o nome. O nome já vem na
    // imagem, então ocultarNome evita duplicar.
    marca: "/images/julia/julia-lockup-v2.png",
    layoutMarca: "centro",
    headerCompacto: true,
    nomeExibido: "Julia Koenigkam Nails",
    ocultarNome: true,
    // Altura recalibrada pro novo formato (mais alto): 87px => ~230px de
    // largura no mobile e 104px => ~275px no sm, mantendo o bloco do nome
    // ("Júlia Koenigkam") do mesmo tamanho de antes do "NAIL DESIGNER" dobrar.
    alturaMonograma: "h-[87px] w-auto sm:h-[104px]",
  },
  layra: {
    personalizado: true,
    // Paleta palha/bege tirada da própria arte da marca; textoPrincipal
    // (#302E30) é o mesmo preto-esverdeado do fill dos paths do SVG.
    bgHeader: "#EDE1CB",
    bgBody: "#F8F2E5",
    bordaHeader: "#DCCBA6",
    textoPrincipal: "#302E30",
    textoSecundario: "#5C554C",
    botao: "#D4AF37",
    botaoHover: "#B8952E",
    // Dourado claro demais pro branco-osso padrão — textoBotao sobrescreve
    // --color-on-primary só neste tenant (ver app/[salon]/page.js).
    textoBotao: "#302E30",
    // O dourado acima é de vitrine: funciona na landing, mas numa tela de
    // trabalho cheia de botões cansa. O admin fica no bronze original (que
    // era o botao/botaoHover da layra antes do dourado), com o branco-osso
    // padrão por cima. Ver app/[salon]/admin/page.js.
    botaoAdmin: "#8A6A3C",
    botaoAdminHover: "#6F5530",
    // Fundo próprio do campo de formulário: mesmo tom do bgBody, o que
    // "afunda" o input dentro do card bege (bgHeader) usando a borda já
    // existente como contorno. Sem este campo o input herda o card, que era
    // o comportamento de todo mundo antes do token --color-field.
    bgCampo: "#F8F2E5",
    fonteDisplay: "font-cormorant",
    // Lockup completo ("Layra Bonfim" + "Nail Studio") num SVG só, fundo
    // transparente, viewBox 1506x297 (~5.07:1 — bem mais largo que o da
    // Julia). O nome já vem na arte, então ocultarNome evita duplicar.
    marca: "/images/layra/layra-bonfim-logo.svg",
    layoutMarca: "centro",
    headerCompacto: true,
    ocultarNome: true,
    // Altura menor que a de acolhe/julia justamente por causa da proporção
    // larga: h-16 => ~325px de largura no mobile, h-20 => ~406px no sm.
    alturaMonograma: "h-16 w-auto sm:h-20",
    // Header afinado: o min-h padrão do ramo headerCompacto (136px) era muito
    // maior que a logo + padding, então sobrava folga e o py nem chegava a
    // mandar na altura. Com 88px o piso encosta no conteúdo (64 + 2x12 = 88)
    // e a logo fica perto do topo e do corpo. Ver Hero.js.
    headerMinH: "min-h-[88px] sm:min-h-[104px]",
    headerPy: "py-3",
  },
  // Snapshot exato da paleta antiga de app/globals.css, SEM marca — o Hero
  // renderiza o título em texto simples centralizado (layout antigo), só que
  // via tema em vez de ausência de tema.
  teste: {
    personalizado: true,
    // bgHeader também vira --color-card (bg-card → background-color), então
    // precisa ser cor sólida; o degradê original do header vai em fundoHero,
    // que só o Hero lê.
    bgHeader: "#fdfcfa",
    fundoHero: "linear-gradient(180deg, #fdfcfa, #d7c9b8)",
    bgBody: "#f5f1ea",
    bordaHeader: "#d7c9b8",
    // heading e body do padrão antigo divergiam (#4a342a/#5a4636); o motor de
    // tema só suporta um valor pros dois, fica o do heading.
    textoPrincipal: "#4a342a",
    textoSecundario: "#b2967d",
    botao: "#7d5a44",
    botaoHover: "#4a342a",
  },
};

// Identidade padrão de todo tenant sem entrada própria em TEMAS_POR_SLUG:
// paleta e layout da Julia, menos os campos específicos dela (nomeExibido,
// tamanhoNome) — o nome vem dinâmico de estabelecimentos.nome. Objeto próprio
// (julia NÃO é alias dele), pra ajustes aqui não reskinnarem a Julia.
export const TEMA_PADRAO = {
  personalizado: true,
  bgHeader: "#FBF3F0",
  bgBody: "#FFDADA",
  bordaHeader: "#D8A5A5",
  textoPrincipal: "#4B0B0B",
  textoSecundario: "#A66666",
  botao: "#924A4A",
  botaoHover: "#762727",
  fonteDisplay: "font-cormorant",
  marca: "/images/generico/logo-generico.png",
  layoutMarca: "esquerda",
  headerCompacto: true,
  alturaMonograma: "h-28 w-auto sm:h-32",
};

// junior/valeria espelham o mesmo objeto de tema de laysla/flavia (referência,
// não cópia) — qualquer ajuste futuro no tema da Laysla/Flávia reflete
// automaticamente no Júnior/Valéria.
TEMAS_POR_SLUG.junior = TEMAS_POR_SLUG.laysla;
TEMAS_POR_SLUG.valeria = TEMAS_POR_SLUG.flavia;
TEMAS_POR_SLUG.barbearia = TEMAS_POR_SLUG.teste;

// Devolve o tema do slug; slug sem entrada cadastrada → TEMA_PADRAO.
// Slug ausente (null/vazio) continua devolvendo null.
export function buscarTema(slug) {
  if (!slug) return null;
  return TEMAS_POR_SLUG[String(slug).toLowerCase()] ?? TEMA_PADRAO;
}
