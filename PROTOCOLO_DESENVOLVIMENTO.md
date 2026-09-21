# Protocolo de Desenvolvimento — reserva-horario

Documento vivo. Atualizar conforme o protocolo evoluir (não é regra fixa e imutável — revisar quando algo deixar de fazer sentido na prática).

---

## 1. Fluxo por demanda

1. `git checkout -b <branch>` antes de qualquer alteração.
2. Prompt de implementação é escrito no chat de projeto (raio-x) e levado ao Claude Code.
3. Revisão do diff/relatório retornado pelo Claude Code.
4. Iorran testa localmente (e em staging, com push, se a mudança exigir).
5. Merge imediato após validação — branch validada não fica esperando. Acúmulo de branches pendentes é anti-padrão.
6. Iorran faz add/commit/push manualmente no VSCode. Claude sempre entrega o texto da mensagem de commit pronto.
7. Só depois do merge da demanda atual (item 5) Claude parte pra próxima — mesmo que várias tenham sido citadas no início da sessão. Ver regra "uma demanda por vez" abaixo.

**Antes de reescrever um arquivo grande:** olhar `git diff` ou trechos específicos primeiro, avaliar o impacto isolado, e alterar estritamente o necessário.

**Confirmação de execução:** Iorran sempre traz de volta o output real do que rodou no VSCode (git status, git log, resultado de commit/merge/push etc.) antes de Claude assumir que um passo deu certo. Claude nunca presume sucesso sem ver o output colado.

**Ida pra `main`/produção:** por padrão, o fluxo termina em `staging`. Subir pra `main` exige decisão explícita do Iorran na própria sessão, mesmo quando o trabalho já está validado em staging há várias sessões — não é assumido automaticamente.

---

## 2. Regras de commit message

- Aspas simples em vez de aspas duplas (aspas duplas em linha fazem o VSCode interpretar como código).
- Evitar aspas duplas mesmo dentro do texto da mensagem (ex: citando um nome) — no PowerShell isso quebra a string mesmo com aspas simples por fora.
- PowerShell exige `-LiteralPath` para caminhos com colchetes literais (ex: `app\[salon]\...`).

---

## 3. SQL

- Sempre autorado neste chat — nunca delegado ao Claude Code, que não tem autorização de tocar no banco.
- Todo bloco de SQL começa com comentário de ambiente em destaque: `-- STAGING` ou `-- PRODUÇÃO` (sempre maiúsculo).
- Migrações vão primeiro para staging, confirmadas com `SELECT`, depois replicadas para produção com confirmação explícita entre ambientes.
- Nunca aplicar SQL destrutivo sem um `SELECT` de confirmação prévio.
- **IDs de `estabelecimento_id` não são iguais entre staging e produção** — sempre resolver por slug/nome antes de qualquer SQL que dependa do ID.
- RLS: nunca confiar em handoff sobre policy aplicada — sempre reconferir via `SELECT` em `pg_policies` antes de assumir que está em vigor.

---

## 4. Formato de resposta

- Prosa corrida, sem cabeçalhos fixos repetitivos.
- No máximo 3 parágrafos curtos explicando o porquê da mudança e o impacto prático (linguagem de negócio, sem jargão de programação sênior).
- Código/comando limpo, direto, sem floreio depois.

---

## 5. Fechamento de sessão

Depois de merges e SQLs do dia, Claude gera:
- O handoff da sessão.
- O diff exato para o `PENDENCIAS.md` (o que entra em Resolvido, o que sai de Em aberto, cada item com a sessão de referência entre parênteses).
- **Conferência de SQL staging → produção** — o resultado dessa conferência entra no handoff, mesmo quando não há pendência (registrar "nenhum SQL de schema pendente de replicar" é tão válido quanto listar um item em aberto).

Iorran só cola o bloco pronto — nunca marca `[x]` manualmente. Itens marcados `[x]` sem handoff correspondente precisam ser reconfirmados antes de serem tratados como fechados.

---

## 6. Regras de schema e ambiente (aprendidas com incidentes)

- Novas colunas em `estabelecimentos` precisam aparecer em `lib/estabelecimento.js` **e** `lib/perfil.js`, ou ficam invisíveis para contas `'dono'` (regra permanente, documentada no `QA_CHECKLIST.md`).
- Datas: sempre `new Date(ano, mes-1, dia)`, nunca `new Date("YYYY-MM-DD")` (problema de fuso UTC/GMT-3).
- Campos `time` do Postgres: normalizar com `.slice(0,5)` antes de comparar.
- Constraint de exclusão em `agendamentos` só dispara se `periodo` (tsrange) estiver populado — todo novo caminho de insert precisa incluir esse campo.
- RLS para fluxos públicos sem `auth.uid()` real: usar RPC `SECURITY DEFINER`, não policy anon aberta.
- Funções `SECURITY DEFINER` usadas em triggers precisam estar explicitamente marcadas assim — trigger rodando como anon falha silenciosamente (42501).
- Extensão `btree_gist` é necessária para constraints de exclusão por tenant em `agendamentos`.
- No embed do Supabase, quando FK e relação são usadas juntas (`profissional_id` + `profissionais(nome)`), ambas precisam estar explícitas no select.

---

## 7. Princípios de arquitetura

- Configuração manual sobrepõe automação quando representa decisão consciente sobre um caso específico — mas automação que protege contra um risco que a config manual nunca pretendeu dispensar continua valendo.
- Conflito físico de horário (dois agendamentos confirmados sobrepondo o mesmo profissional) nunca é contornável, em nenhum contexto.
- Disponibilidade é sempre calculada, nunca armazenada.
- `status='cancelado'` + `expirado_automaticamente=true` é a representação canônica de reserva provisória expirada.
- Textos de WhatsApp vivem só em `lib/whatsapp.js`, como funções nomeadas.
- Reaproveitar hooks, máquinas de estado e componentes visuais existentes antes de criar novos — sinalizar soluções complicadas demais e sugerir caminho mais simples.
- Sempre investigar (raio-x / prompt somente leitura) antes de implementar.
- **Nome do profissional só aparece em telas de agendamento com 2+ profissionais ativos** (`qtdProfissionaisAtivos > 1`; `null`/contagem carregando também esconde, nunca mostra por padrão). Regra permanente desde a Sessão 59 — qualquer novo ponto que exiba `profissional_nome` deve seguir essa condição.
- Toda alteração de status feita por decisão da própria dona dentro do `/admin` (cancelar, resolver conflito de prazo, marcar exceção de conclusão) é tratada como "ação do salão" pra fins de estatística — independente do gatilho que levou a essa decisão (ex: conflito de prazo detectado pelo sistema ainda conta como cancelamento do salão, porque foi ela quem clicou).
- **Tema do `/admin` pode divergir do público, campo a campo, sempre com fallback pro valor público correspondente:** `bgCardAdmin` (→ `--color-card`, fallback `bgHeader`), `botaoAdmin`/`botaoAdminHover` (→ `--color-primary`/hover, fallback `botao`/`botaoHover`), `bordaAdmin` (→ `--color-border`, fallback `bordaHeader`). Existe porque o admin ignora `textoCard` de propósito (sempre usa `textoPrincipal` como texto) — então um `bgHeader` ou `botao` escolhido pro público escuro/claro pode deixar o admin com texto ilegível, mesmo quando o público está perfeito. Regra prática: **todo tenant com `bgHeader` escuro precisa dos três campos** (ver `NOVO_TENANT_CHECKLIST.md`).
- **Decisão de negócio que foge do escopo original do app (ex.: maquiadora em vez de manicure) prefere um flag/config por tenant a uma categoria geral de "tipo de salão"** — até que 2 ou mais features realmente exijam essa distinção. Criar a taxonomia geral antes disso é escopo maior que o necessário (ver "sem catedral"). Caso de origem: agendamento em grupo da Laryssa, resolvido com dois campos novos em `estabelecimentos` (`permite_agendamento_grupo`, `max_pessoas_grupo`) editáveis só no `/painel-global`, em vez de um sistema de segmentos.

---

## 8. Ferramentas e arquivos-chave

- **Stack:** Next.js (App Router, JS), Supabase (Postgres + Storage + Auth + pg_cron + pg_net), Tailwind v4, Vercel (Hobby — atenção ao timeout de 60s), Recharts (gráficos, desde a Sessão 59).
- **Ambientes Supabase:** staging (`reserva-staging` / `yebwkchcrvebvvjvvvyu`) e produção (`pwlvjaenryzdkatmrhul`) — projetos separados, sequências de ID independentes.
- **Arquivos de controle:** `PENDENCIAS.md`, `QA_CHECKLIST.md`, `DEPLOY_CHECKLIST.md`, `NOVO_TENANT_CHECKLIST.md`, `THEMING.md`.
- **Libs-chave:** `lib/disponibilidade.js`, `lib/whatsapp.js`, `lib/particao.js`, `lib/cliqueFora.js`, `lib/checagemWhatsapp.js`, `lib/comprimirImagem.js`, `lib/temas.js`, `lib/conclusao.js`, `lib/mes.js` (navegação mensal, `mesDeHoje`/`rotuloMes`).

---

## 9. Uso eficiente de tokens

- Sessões de discussão/pesquisa (como esta) separadas de sessões de implementação, para não reprocessar histórico completo a cada resposta.
- Fragmentar sessões por demanda, com handoff e fechamento frequentes, em vez de uma sessão única acumulando contexto.
- Raio-x enxuto: focar no que muda a decisão de implementação, não numa auditoria completa do arquivo — auditorias amplas ficam para sessões dedicadas.

---

## 10. BrowserMCP

- Desconectado por padrão — a definição da ferramenta consome ~38% do context window do Claude Code mesmo sem uso.
- Reconectar apenas nas sessões em que for necessário teste ao vivo no navegador (Claude Code validando fluxo/staging por conta própria, como feito na Sessão 30).
- Claude (chat) deve sinalizar quando uma demanda pedir esse tipo de validação, sugerindo reconectar antes do prompt pro Claude Code.
- **O painel do navegador do Claude Code é um navegador separado do navegador pessoal do Iorran (Chrome/Edge).** Um login feito no Chrome do Iorran não vale nessa aba — qualquer tela protegida por senha (login do `/admin`, por exemplo) precisa ser preenchida por ele diretamente dentro do painel que aparece do lado da conversa. Fricção real, repetida mais de uma vez na sessão de 21/09 — sempre confirmar em qual navegador a ação precisa acontecer antes de pedir "faça login".

---

## Regra: checagem de base antes de nova branch

Antes de todo `git checkout -b`, rodar `git branch` (sem argumento) **e `git status`** pra confirmar em qual branch você está e se não sobrou nada não commitado. Só criar a nova branch se estiver em `main` limpa — se estiver em outra branch de trabalho, ou se `git status` mostrar mudanças não commitadas (mesmo em `main`), decidir explicitamente: commitar/mergear primeiro, ou nomear a nova como dependente da atual (ramificação consciente, não acidental). Incidente real (Sessão 21/09): uma branch nova foi criada a partir de outra que tinha trabalho não commitado da Laysla, e esse trabalho quase entrou junto no commit da Laryssa — só não aconteceu porque o `git status` foi conferido antes do commit, não antes da criação da branch. A checagem de `git status` devia ter vindo primeiro.

## Regra: branches concorrentes no mesmo arquivo/bloco

Ao abrir uma demanda nova, checar se alguma branch ainda não mergeada em `main` toca o mesmo arquivo. Se tocar, preferir sequenciar (mergear a primeira até `main` + `staging` antes de começar a segunda) em vez de paralelizar — evita conflito de merge por divergência estrutural no mesmo bloco. Só paralelizar quando as branches tocam arquivos ou blocos claramente distintos.

## Regra: comandos de merge/push rodados fora da visão do Claude Code

Sempre que um merge, checkout ou push for rodado no terminal sem passar por um prompt do Claude Code (ex: comandos de fluxo Git que o Iorran roda direto após receber do chat), avisar explicitamente no próximo prompt pra ele — algo como "um merge de staging aconteceu entre sua última leitura e agora, rodado por mim via terminal, branch X em Y". Evita o agente interpretar estado de Git inesperado (MERGE_HEAD, conflitos) como anomalia ou ação própria não lembrada.

## Regra: uma demanda por vez

Mesmo quando Iorran lança várias demandas de uma vez no início da sessão, Claude não deve organizá-las e emendar a fila sozinho. O fluxo correto é: declarar uma demanda, completar o ciclo inteiro (branch → raio-x → diff → teste → merge), e só então perguntar explicitamente se segue pra próxima da lista ou se a sessão fecha ali. Isso existe porque triagem de várias demandas de uma vez já causou perda de pendência sem ficar claro pra Iorran — algo parecia resolvido "no papel" sem nunca ter virado branch de verdade. Vale mesmo que pareça repetitivo perguntar a cada fechamento.

## Regra: teste rápido via celular

O localhost (`npm run staging`) está salvo como ícone na tela do celular de Iorran — dá pra testar mudanças visuais direto ali, sem precisar de push pra staging. Vale como primeira opção de teste pra ajustes de UI antes de subir pra staging de verdade.

## Regra: limpeza de branch ao fechar sessão

Toda branch de feature mergeada em `main` durante a sessão atual é apagada (local +
remoto) como parte do fechamento — não fica acumulando pra uma faxina futura. Por
branch, junto com os comandos de merge já entregues:

```bash
git branch -d nome-da-branch
git push origin --delete nome-da-branch
```

Nunca apagar `main` nem `staging` (branch permanente — alias estável usado pelos
triggers de webhook, nunca deletar). Essa rotina cobre só as branches nascidas na
própria sessão; o acúmulo histórico de branches antigas já mergeadas (a maior parte da
saída de `git branch --merged main` hoje) segue como item de backlog à parte, tratado
numa sessão dedicada de limpeza — não misturar os dois.

## Regra: conferência de SQL staging → produção antes de fechar sessão

No fechamento de toda sessão que rodou algum SQL de schema (ALTER/CREATE, não limpeza de dados de teste), Claude lista de volta cada bloco de SQL rodado durante a sessão e confirma, um por um, se já foi replicado em produção — não basta ter sido "planejado" ou "confirmado em staging". Se algum ficou só em staging (esquecido, ou porque o merge foi adiado), isso é reportado explicitamente como pendência de schema em aberto no handoff, nunca deixado implícito. Motivo: coluna nova sem réplica em produção passa despercebida até alguém mexer justamente naquele campo — vira bug fantasma, difícil de diagnosticar, porque o código já assume que a coluna existe nos dois ambientes.

## Regra: decisões de negócio ambíguas exigem exemplo concreto, não princípio abstrato

Quando uma regra de negócio nova tem zona cinzenta (ex: "isso conta como cancelamento do salão ou não?"), pedir ao Iorran um exemplo real do dia a dia em vez de insistir numa pergunta abstrata — a resposta concreta costuma resolver a ambiguidade de forma mais rápida e precisa que alternativas de múltipla escolha genéricas.

## Regra: tenant-modelo de tema em staging (slug `css`)

Antes de moldar a identidade visual (tema/CSS) de qualquer tenant novo, usar primeiro o
tenant fixo `css` (id 8 em staging, ex-`padrao-novo`) — nunca editar tema direto num tenant
que só existe em produção. Ele tem cadastro básico igual ao de um tenant novo (profissional,
5 etiquetas padrão, janela até 2027), sem catálogo nem serviços.

Fluxo: criar/editar temporariamente `TEMAS_POR_SLUG.css` em `lib/temas.js` com as
cores/logo em teste → validar via localhost apontado pro staging → aprovado, copiar a
configuração final pra entrada do tenant real → apagar a entrada `css` (ela cai sozinha de
volta no `TEMA_PADRAO` — comportamento padrão de `buscarTema()`, sem precisar de código
novo).

**Atenção:** o tenant-modelo `css` só existe em staging. Tenants criados direto em produção
sem espelho em staging (caso da Laryssa, Sessão 67) não têm como usar o `/laryssa/admin`
real durante o desenvolvimento do tema — nesses casos, moldar em `css` mesmo (aceitando que
o resultado visual ali usa a estrutura de outro tenant) e confirmar o resultado final em
produção depois do merge, já que não há alternativa.

## Regra: logo a partir de foto/JPEG com composição alta demais pro header

Quando a logo do cliente vem de uma foto ou arte com fundo (não um PDF/SVG vetorial) e a
composição inteira (ícone + nome + tagline, empilhados) é alta demais pro formato de header
do app, **não distorcer via `scale()`/`achatarLogo`** — o resultado ovaliza pétalas, círculos
e qualquer elemento redondo. Preferir separar o ícone do texto (dois recortes, cada um com
fundo removido) e usar `layoutMarca: 'esquerda'`: o header só precisa caber a altura do
ícone sozinho, não da pilha inteira. Caso de origem: logo da Laryssa (monograma + flores
empilhado sobre o nome, proporção quase quadrada) — recorte em `laryssa-marca.png` (ícone) e
`laryssa-marcaTexto.png` (nome+tagline), mesmo padrão que a Laysla já usava antes de virar
lockup único.

*Última atualização: 21/09 (tema do `/admin` divergente do público — `bgCardAdmin`/`botaoAdmin`/`bordaAdmin`; princípio de flag por tenant em vez de "tipo de salão"; regra de `git status` antes de nova branch; navegador separado do Claude Code; limite do tenant-modelo `css` pra tenants só de produção; técnica de recorte de logo alta a partir de foto).*