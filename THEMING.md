# Personalização visual por tenant (THEMING.md)

## Onde a paleta entra

Tudo controlado por 3 pontos isolados — nunca hardcodear cor em componente.

1. **`lib/temas.js`** — o dado. Um objeto por slug em `TEMAS_POR_SLUG`, mais um
   `TEMA_PADRAO` (paleta "Salão Aconchego") usado por qualquer tenant sem entrada própria.
   `buscarTema(slug)` retorna `TEMAS_POR_SLUG[slug] ?? TEMA_PADRAO`.

2. **Tokens CSS (`app/globals.css`)** — os nomes que os componentes já usam via classes
   Tailwind (`bg-primary`, `text-heading`, `ring-border` etc.). Nunca criar um novo token
   sem necessidade real; hoje existem:

   | Token              | Papel                                      |
   |--------------------|---------------------------------------------|
   | `--color-primary`  | botões de ação, seleção, foco                |
   | `--color-primary-hover` | hover da ação                          |
   | `--color-heading`  | títulos                                      |
   | `--color-border`   | bordas/divisores                             |
   | `--color-body`     | texto de corpo/labels                        |
   | `--color-muted`    | texto secundário/terciário                   |
   | `--color-surface`  | fundo do body/página                         |
   | `--color-card`     | fundo de cards, menu lateral do admin        |

3. **Override no runtime** — em `app/[salon]/page.js` e `app/[salon]/admin` (wrapper mais
   externo de cada árvore), um `style` inline sobrescreve as 8 variáveis acima quando
   `tema.marca` existe (ou seja, quando o tenant tem tema próprio, não o padrão):

   ```js
   const tema = buscarTema(slug);
   const overrideEstilo = tema.marca ? {
     '--color-primary': tema.botao,
     '--color-primary-hover': tema.botaoHover,
     '--color-heading': tema.textoPrincipal,
     '--color-border': tema.bordaHeader,
     '--color-body': tema.textoPrincipal,
     '--color-muted': tema.textoSecundario,
     '--color-surface': tema.bgBody,
     '--color-card': tema.bgHeader,
   } : {};
   ```

   Com isso, qualquer componente que já usa os tokens herda a cor certa automaticamente —
   **não** criar `if (slug === 'x')` espalhado nos componentes. Se um componente ainda usa
   hex direto em vez do token, o bug está nele, não no motor de tema.

## Fora do escopo do tema (cores funcionais)

Verde de status confirmado, âmbar de aviso/pendente, vermelho de cancelar — **nunca** entram
no override. São sinalização, não identidade visual, e valem igual em qualquer tenant.

## Logo / marca

Campo `tema.marca` (path da imagem, ex.: `/images/laysla/laysla-marca-cinza.png`) — quando
presente, `Hero.js` troca o nome em texto solto pela imagem + nome/subtítulo ao lado. Quando
`null` (tema padrão), mantém o comportamento atual (nome centralizado em texto).

Se o cliente mandar um logo em PDF/imagem com fundo branco: recortar e converter o preto pra
transparência + tingir na cor de marca antes de salvar como asset (evita depender de fundo
branco combinando com o `bgHeader` escolhido).

## Tipografia

Fonte de destaque (nome/logo) é importada globalmente em `app/layout.js` via `next/font/google`
e exposta como variável CSS (ex.: `--font-cormorant`). O tema referencia essa variável em
`tema.fonteDisplay`. Adicionar uma fonte nova = 1 import em `layout.js` + 1 referência no tema
do tenant; a fonte só "pesa" pra quem realmente usa.

## Passo a passo pra um tenant novo com identidade própria

1. Extrair a paleta real do material de marca do cliente (nunca estimar visualmente —
   processar a imagem/PDF e ler os valores de pixel).
2. Definir os 8 valores de `TEMAS_POR_SLUG[slug]` (bgHeader, bgBody, textoPrincipal,
   textoSecundario, botao, botaoHover, marca, fonteDisplay).
3. Se a paleta pedir fonte diferente da já carregada, importar em `layout.js`.
4. Testar em staging comparando visualmente com o tenant padrão (nada deve vazar pra ele).
5. Documentar aqui os hex usados, pra não precisar re-extrair da próxima vez que o cliente
   pedir ajuste.
