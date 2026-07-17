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
   externo de cada árvore), um `style` inline sobrescreve as 8 variáveis acima. O gatilho
   dessa sobrescrita é o campo **`tema.personalizado: true`** — não a presença de um campo
   de imagem específico (isso já causou um bug real: o tema da Flávia não usa o campo
   `marca`, e checar `tema.marca` deixou o override de cor silenciosamente desligado pra
   ela, mesmo com o header certo). Toda entrada de `TEMAS_POR_SLUG` com identidade própria
   deve ter `personalizado: true` explícito.

   ```js
   const tema = buscarTema(slug);
   const overrideEstilo = tema.personalizado ? {
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

## Logo / marca no header

`Hero.js` decide o layout do header pelo campo `tema.layoutMarca`. Três valores hoje:

- **`'esquerda'`** (Laysla) — uma imagem só em `tema.marca`, alinhada à esquerda do header;
  nome + subtítulo do estabelecimento em texto (fonte `tema.fonteDisplay`), centralizados no
  espaço restante à direita.
- **`'centralizado'`** — mesma ideia de `marca` + nome em texto, mas o símbolo fica
  centralizado no header em vez de à esquerda (útil quando o cliente não pediu um layout
  assimétrico).
- **`'pilha-completa'`** (Flávia/Ahazou) — usado quando o próprio material de marca já tem
  uma composição vertical (símbolo + wordmark) que não faz sentido decompor em "imagem +
  texto ao lado". Dois campos de imagem, `tema.marcaSimbolo` (topo) e `tema.marcaTexto`
  (embaixo), empilhados e centralizados. **Não renderiza `estabelecimento.nome` nem
  nenhum texto adicional** — as imagens já contêm a marca completa.
- Ausência de `layoutMarca` (tenants sem tema próprio) — comportamento original, nome em
  texto simples centralizado, sem nenhuma imagem.

### Padrão: logo em múltiplas peças

Quando o material de marca do cliente combina um símbolo com um wordmark numa tipografia
que não existe como fonte web (brush script, caligrafia, letterings customizados) — **não**
tentar recriar a tipografia em CSS. Já aconteceu duas vezes e o caminho certo nas duas foi:

1. Processar a imagem/PDF original (nunca estimar cor ou recorte visualmente — ler pixel
   real com PIL/script, ver seção seguinte).
2. Recortar as peças em imagens separadas e transparentes: o símbolo isolado do texto
   (Laysla: monograma sem o wordmark; Flávia: as pétalas sem "ahazou"), e — se a tipografia
   do wordmark for irreproduzível — o próprio wordmark cortado como imagem também (Flávia:
   "ahazou" + "spa das unhas" viraram uma imagem só, `marcaTexto`, em vez de tentar achar
   uma fonte parecida).
3. Empilhar/posicionar via `layoutMarca` (ver acima), sem depender de nenhum texto ao vivo
   pra essa parte da marca.

Isso mantém o header pixel-fiel ao material do cliente, sem gambiarra de "fonte parecida".

## Extração de paleta — sempre por pixel, nunca por estimativa

```python
from PIL import Image
from collections import Counter

im = Image.open("logo.png").convert("RGBA")
pixels = list(im.getdata())
opaco = [p[:3] for p in pixels if p[3] > 220]  # ignora fundo transparente
c = Counter(opaco)
for cor, contagem in c.most_common(15):
    print(cor, '#%02x%02x%02x' % cor, contagem)
```

Usar as cores mais frequentes como base real da paleta (cor de ação = a mais dominante que
tiver contraste suficiente pra botão; contraste/heading = uma variante mais escura real do
arquivo, não inventada). Fundo de header/body geralmente precisa ser **derivado** (clareado
a partir de uma cor extraída), não puro — documentar sempre quando um valor foi extraído
puro vs. derivado, pra não confundir "dado real" com "escolha de design" numa consulta
futura.

## Tipografia

Fonte de destaque (nome/subtítulo, quando não fizer parte de uma imagem de logo) é importada
globalmente em `app/layout.js` via `next/font/google` e exposta como variável CSS (ex.:
`--font-cormorant`). O tema referencia essa variável em `tema.fonteDisplay`. Adicionar uma
fonte nova = 1 import em `layout.js` + 1 referência no tema do tenant.

## Espaçamento do header

Cada `layoutMarca` pode pedir padding vertical diferente dependendo do tamanho natural das
imagens (uma pilha de 2 imagens ocupa mais altura que um símbolo único ao lado de texto) —
ajustar padding-top/padding-bottom por caso, não assumir que o valor que funcionou pro
primeiro tenant serve pra todos.

## Passo a passo pra um tenant novo com identidade própria

1. Extrair a paleta real do material de marca do cliente (nunca estimar — processar a
   imagem/PDF e ler os valores de pixel, ver script acima).
2. Avaliar o logo: cabe como uma imagem só (`marca` + `layoutMarca: 'esquerda'` ou
   `'centralizado'`), ou precisa virar múltiplas peças (`marcaSimbolo`/`marcaTexto` +
   `layoutMarca: 'pilha-completa'`)? Ver seção "logo em múltiplas peças" acima.
3. Definir os valores de `TEMAS_POR_SLUG[slug]`: bgHeader, bgBody, bordaHeader,
   textoPrincipal, textoSecundario, botao, botaoHover, campos de imagem conforme o item 2,
   layoutMarca, fonteDisplay, e **`personalizado: true`** (sem isso, o override de cor no
   resto do app não é aplicado, mesmo com o header certo).
4. Se a paleta pedir fonte diferente da já carregada, importar em `layout.js`.
5. Testar em staging comparando visualmente com o tenant padrão (nada deve vazar pra ele) —
   incluir explicitamente botões, calendário e bordas na checagem, não só o header (é onde
   o bug do `personalizado` passou despercebido na primeira rodada).
6. Documentar aqui os hex usados e a decisão de layout, pra não precisar re-extrair nem
   redescobrir o padrão da próxima vez que o cliente pedir ajuste.
