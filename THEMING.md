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
   | `--color-field`    | fundo de inputs e itens que precisam contrastar com `bg-card` (ex.: campo de telefone, chip de horário fixo, botão de ficha de cliente) — opcional por tenant via `tema.bgCampo`, cai em `--color-card` se ausente (sem regressão pra quem não define) |
   | `--color-on-card`  | texto que senta **direto** em cima de `bg-card` (classe `text-on-card`) — opcional por tenant via `tema.textoCard`, pra tenant com card escuro e texto claro (ex.: laysla). Cai em `tema.textoPrincipal` (= `--color-heading`) se ausente. **Não** usar em texto sobre `bg-field`/`bg-surface`, que continuam claros. O default em `globals.css` só vale fora do wrapper do tema: `var()` resolve no `:root`, então o override precisa estar nos dois wrappers (`page.js` e `admin/page.js`) |

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

   O **admin pode ter cor de botão própria**, separada do público: `tema.botaoAdmin` /
   `tema.botaoAdminHover`, com fallback pra `tema.botao` / `tema.botaoHover` quando
   ausentes. Útil quando o botão público é claro (dourado) e precisaria de troca de cor de
   texto pra funcionar no admin também.

   Do mesmo jeito, o **admin pode ter fundo de card próprio**: `tema.bgCardAdmin`, com
   fallback pra `tema.bgHeader` quando ausente. Vira o `--color-card` só no admin (cards,
   acordeões, menu lateral). Útil quando o card público é escuro: o admin ignora
   `tema.textoCard` e usa sempre `textoPrincipal` como texto, então um `bgHeader` escuro
   dá texto escuro sobre fundo escuro lá (ex.: laryssa).

   E também **borda própria**: `tema.bordaAdmin`, com fallback pra `tema.bordaHeader`
   quando ausente. Vira o `--color-border` só no admin (bordas de card e campo, trilho do
   toggle desligado). Útil quando a borda pública é escura: o toggle desligado usa
   `bg-border` e o ligado `bg-primary`, então uma `bordaHeader` escura perto do botão do
   admin deixa ligado e desligado quase da mesma cor (ex.: laysla).

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
- **`'direita'`** (Julia) — mesmo bloco de `'esquerda'` espelhado (`flex-row-reverse`):
  nome/tagline à esquerda, `tema.marca` colada na borda direita.
- **`'centro'`** — mesma ideia de `marca` + nome em texto, mas o símbolo fica
  centralizado no header em vez de à esquerda (útil quando o cliente não pediu um layout
  assimétrico).
- **`'pilha-completa'`** (Flávia/Ahazou) — usado quando o próprio material de marca já tem
  uma composição vertical (símbolo + wordmark) que não faz sentido decompor em "imagem +
  texto ao lado". Dois campos de imagem, `tema.marcaSimbolo` (topo) e `tema.marcaTexto`
  (embaixo), empilhados e centralizados. **Não renderiza `estabelecimento.nome` nem
  nenhum texto adicional** — as imagens já contêm a marca completa.
- Ausência de `layoutMarca` (tenants sem tema próprio) — comportamento original, nome em
  texto simples centralizado, sem nenhuma imagem.

Campo booleano **`ocultarNome`**: some com o `<h1>` do nome ao lado da logo quando a
`marca` já traz o nome escrito por extenso — usar junto com `layoutMarca: 'centro'` quando
o SVG/PNG já é um lockup completo (ver `acolhe`, `julia`, `layra`).

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

### Armadilha: cache do otimizador de imagens ao trocar arquivo pelo mesmo nome

Ao substituir um arquivo de imagem em `public/` mantendo o **mesmo nome** (ex.: gerar uma
nova versão de `marcaTexto` e sobrescrever `laysla-logo-header.png`), o cache em disco do
otimizador de imagens do Next (`.next/dev/cache/images` em dev) pode continuar servindo a
versão antiga já transcodificada — mesmo depois de um hard-reload no navegador, porque o
cache não é invalidado automaticamente pela sobrescrita do arquivo. Isso já causou um falso
positivo real: uma versão nova parecia ter um "ghost box" atrás do texto, quando na verdade
era a versão *anterior* (dimensões diferentes) ainda sendo servida do cache.

Se uma mudança de imagem não aparecer (ou aparecer com o conteúdo errado) mesmo após
hard-reload, apagar `.next/dev/cache/images` (ou reiniciar o dev server) antes de concluir
qualquer coisa sobre o arquivo em si.

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

0. **Moldar a identidade visual primeiro no tenant-modelo de staging** (slug `css`,
   `TEMAS_POR_SLUG.css`) — nunca editar tema direto num tenant que só existe em produção.
   Testar via localhost, aprovar, copiar a configuração final pro tenant real, e então
   apagar a entrada `css` de `lib/temas.js` (ela volta sozinha pro `TEMA_PADRAO` — ver
   `buscarTema()`).
1. Extrair a paleta real do material de marca do cliente (nunca estimar — processar a
   imagem/PDF e ler os valores de pixel, ver script acima).
2. Avaliar o logo: cabe como uma imagem só (`marca` + `layoutMarca: 'esquerda'` ou
   `'centro'`), ou precisa virar múltiplas peças (`marcaSimbolo`/`marcaTexto` +
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
