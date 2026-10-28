# Protocolo de Desenvolvimento — reserva-horario

Documento vivo. Atualizar conforme o protocolo evoluir (não é regra fixa e imutável — revisar quando algo deixar de fazer sentido na prática).

---

## 1. Fluxo por demanda

1. **Antes de qualquer prompt de implementação, Claude entrega o bloco de comandos de branch para o Iorran rodar no terminal do VSCode:** `git branch --show-current`, `git status`, `git checkout main` (ou a branch-base decidida, quando a demanda é empilhada) e `git checkout -b <nome>`. O Iorran cola a saída no chat. Só depois sai o prompt para o Code, que apenas confirma a branch com `git branch --show-current` e `git status` e **não cria nem troca de branch por conta própria** (pedido de 15/10, Sessão 90). O bloco de branch roda **uma vez**; se a branch já existe, o caminho é `git checkout <nome>`, não `git checkout -b`. Exceção prática (Sessão 96): o bloco de branch e o prompt do Code podem ir na mesma mensagem quando o prompt manda o Code **parar** se a branch não for a esperada ou se houver mudança não commitada.
2. Prompt de implementação é escrito no chat de projeto (raio-x) e levado ao Claude Code. Fatia pequena e localizada pode ter leitura e implementação num prompt só, com **condição de parada** explícita ("se encontrar X, não implemente; descreva e pare") (Sessão 96).
3. Revisão do diff/relatório retornado pelo Claude Code. **O relatório do Code é resumo: nenhum commit sai sem Claude ler o diff** (em código de login, linha a linha). Se o Code disser que o diff está "acima" ou entregar só o resumo, Claude pede o diff por arquivo na Área de Trabalho antes de seguir (Sessão 93). O relatório pode omitir uma correção pedida (Sessão 95: card sem `.catch`); cada correção se confere por diff ou por busca de texto.
4. Iorran testa localmente (e em staging, com push, se a mudança exigir).
5. Merge imediato após validação — branch validada não fica esperando. Acúmulo de branches pendentes é anti-padrão (exceção consciente: feature em fatias empilhadas, ver abaixo).
6. Iorran faz add/commit/push manualmente no VSCode. Claude sempre entrega a sequência completa de comandos (status, add arquivo por arquivo, commit com a mensagem pronta, log de conferência, merge, push, sincronização da `staging`, exclusão da branch).
7. Só depois do merge da demanda atual (item 5) Claude parte pra próxima — mesmo que várias tenham sido citadas no início da sessão. Ver regra "uma demanda por vez" abaixo.

Quando o Claude Code trabalha direto no repositório, ele devolve o diff sem commitar; o commit, o push e o merge continuam sendo do Iorran.

**Antes de reescrever um arquivo grande:** olhar `git diff` ou trechos específicos primeiro, avaliar o impacto isolado, e alterar estritamente o necessário.

**Confirmação de execução:** Iorran sempre traz de volta o output real do que rodou no VSCode (git status, git log, resultado de commit/merge/push etc.) antes de Claude assumir que um passo deu certo. Claude nunca presume sucesso sem ver o output colado. Se a saída colada parar no meio (ex.: termina no merge e não mostra o push nem a exclusão da branch), Claude pede uma conferência curta (`git fetch origin`, `git log origin/main -1 --oneline`, `git status`) antes de considerar publicado. "Already up to date" num merge que deveria trazer mudança é alarme, não sucesso. Quando o Iorran cola só o texto do comando, sem saída, ou só um dos resultados pedidos, Claude pede o que falta antes de seguir (Sessão 96).

**Ida pra `main`/produção:** por padrão, o fluxo termina em `staging`. Subir pra `main` exige decisão explícita do Iorran na própria sessão, mesmo quando o trabalho já está validado em staging há várias sessões — não é assumido automaticamente. Antes de perguntar, Claude lista o que fica pendente e separa "o que impede o merge" do "que fica para depois" (Sessão 96).

**Um passo por vez (regra de 14/10, Sessão 88):** cada mensagem do Claude traz só o que o Iorran precisa rodar antes de responder. Nada de prompt ou comando que dependa de aprovação ou resultado posterior (por exemplo, merge junto do teste). Cada bloco de código vem rotulado "para o Code" ou "para você (PowerShell/SQL)". Quando o Iorran se perde ("qual primeiro bloco?"), reenviar só o primeiro passo.

**Teste antes de commit/merge:** os comandos de commit e merge só saem depois de o Iorran relatar o teste da demanda; "sem merge" vale até o teste geral (Sessões 84 e 86 mergearam antes do teste e foi sorte). O que não foi testado no navegador fica declarado como "sem prova" no inventário, nunca como "testado". "Tudo testado" genérico é aceito quando a lista de passos foi dada antes; se faltar algum ponto da lista no relato, Claude pergunta.

**Branches empilhadas:** quando as demandas se dependem e ainda não foram mergeadas, a branch nova sai da anterior (não da `main`), para não dar conflito em arquivos comuns; no fim, um único merge da última carrega todas (Sessões 88, 89 e 90). Antes de criar a branch empilhada, a anterior precisa estar **commitada** (ver a regra de checagem de base abaixo).

**Feature em fatias (Sessões 93 a 96, adicional de domingo):** quando uma feature se divide em fatias dependentes (motor, tela, preço, visual), cada fatia é uma branch empilhada com raio-x, diff, teste e commit próprios, **sem merge intermediário**. Uma fatia que abre comportamento que só faz sentido com outra (domingo aberto sem cobrar o acréscimo, por exemplo) **nunca vai à `main` sozinha**: o merge só sai quando a fatia que fecha o risco estiver pronta e testada. Coluna aditiva que a feature precisa pode ir antes aos dois bancos (§3). Cada fatia vai ao GitHub com `git push -u origin <branch>` logo depois do commit. **Antes do merge da pilha, `git log --oneline HEAD..origin/main` precisa voltar vazio**; se a `main` andou (fechamentos de sessão no meio da pilha), primeiro `git show --stat` dos commits que faltam e `git merge origin/main` no topo (Sessão 96: os fechamentos 93 e 94 só tinham `.md`). A pilha do adicional chegou a 13 branches e um único merge, por avanço direto.

**Deploy:** depois do push na `main`, conferir na Vercel que o deploy do commit está como Production e Ready, e conferir antes o deploy da `staging` (build quebrado ali quebraria em produção). Depois, teste rápido no tenant `junior` de produção. Se o build quebrar, reverter só o commit suspeito.

**Sessão aberta por consentimento (Sessão 96):** quando o Iorran pede para não fechar a sessão no fim do dia, Claude entrega uma **nota de continuidade** curta para o projeto (estado do git, testes, decisões do dia, próxima demanda e próximos passos), porque as decisões só existem no chat. A nota não substitui o handoff; o handoff do fechamento a substitui.

---

## 2. Regras de commit message e terminal

- Aspas simples em vez de aspas duplas (aspas duplas em linha fazem o VSCode interpretar como código).
- Evitar aspas duplas mesmo dentro do texto da mensagem (ex: citando um nome) — no PowerShell isso quebra a string mesmo com aspas simples por fora.
- Mensagem de uma linha só. Quando o Claude Code sugerir mensagem longa com corpo, usar só a primeira linha.
- PowerShell exige `-LiteralPath` para caminhos com colchetes literais (ex: `app\[salon]\...`). `Select-String -Path` com `[salon]` não acha o arquivo e **não avisa**: usar `-LiteralPath` (Sessão 93: voltou a dar falso "não achei").
- No `git add`, caminho com `[salon]` vai com o prefixo literal: `git add ':(literal)app/[salon]/admin/page.js'` — sem ele o git trata os colchetes como curinga.
- Nunca `git add .`; sempre arquivo por arquivo, com `git status` antes do commit para conferir que só os arquivos esperados entraram.
- `curl` no PowerShell é alias de `Invoke-WebRequest`: usar `curl.exe`. Git com `core.pager cat` para não travar em `less`.
- Liberar a porta 3000 presa: `Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.
- **Servidor de dev em terminal separado do terminal do git** (padrão do Iorran, Sessão 90): a branch se confere no terminal do git, não no do servidor. Se aparecer "Port 3000 is in use" ou "Another next dev server is already running", há um `next dev` antigo: parar, apagar `.next\dev` e `.next\cache` e subir de novo. Antes de ler qualquer teste, confirmar a branch e a URL do Supabase no `.env.local` (`Get-Content .env.local | Select-String 'NEXT_PUBLIC_SUPABASE_URL'`; nunca imprimir chaves). Antes de trocar de branch, parar o servidor.
- **Diff por arquivo na Área de Trabalho (Sessões 87 e 90):** todo diff chega ao chat por arquivo, com **nome que diz demanda, arquivo e estado**: `git diff -- arquivos | Out-File -Encoding utf8 "$env:USERPROFILE\Desktop\diff-<demanda>-<ARQUIVO>-<estado>.txt"` (ex.: `diff-situacao-pix-PAGE-menu-alterar.txt`). O diff é cumulativo contra a base até o commit, então **antes de gerar um novo, apagar os `diff-*.txt` antigos** (`Remove-Item "$env:USERPROFILE\Desktop\diff-*.txt"`), para nunca haver dois da mesma demanda na Área de Trabalho. `Remove-Item diff-*.txt` apaga **qualquer** arquivo com esse prefixo: arquivos de controle gerados do repositório levam o prefixo `controle-` (Sessão 95). Arquivo novo ainda sem commit aparece com `git add -N arquivo` antes; `git diff --name-only` também não lista arquivo novo sem o `-N`. Acento quebrado no `.txt` é só da codificação (`Out-File -Encoding utf8` no PowerShell 5). No fechamento, depois do merge, apagar de novo.
- **Provar se um defeito é antigo (Sessão 96):** `git stash push -m '<nome>'`, recarregar a tela com Ctrl+Shift+R e olhar; depois `git stash pop` e `git diff --stat` para conferir que tudo voltou. Um passo por mensagem, e o Iorran olha a tela certa (o calendário do Alterar, não o do Agendar).
- Avisos de LF/CRLF do Git são inofensivos (`core.autocrlf=true` converte; o diff mostra só as linhas de conteúdo). `Get-Content | Measure-Object -Line` não conta linhas em branco: para contar linhas de verdade, usar `(Get-Content arquivo).Count`.
- Para trocar uma linha de arquivo de controle sem substituir o arquivo, usar `Get-Content -Encoding utf8`, trocar o índice e `Set-Content -Encoding utf8`; conferir com `git diff --stat` (esperado: só as linhas trocadas) e com `Select-String` que o texto antigo saiu.
- **Linha de base do eslint:** `app/[salon]/admin/page.js` tem **12 erros e 1 aviso** (`react-hooks/set-state-in-effect`, todos antigos, Sessão 90); `components/FormularioAgendamento.js` tem **2 erros** antigos (Sessão 95); `app/[salon]/admin/GerenciarProfissionais.js` tem **1 erro** (`setAbaEdicao` dentro de um efeito, Sessão 93); `GerenciarServicos.js`, `lib/gradeAdmin.js` e `components/ModalAlterarAgregado.js` têm 0. Todo relatório do Code diz se apareceu algo novo; só isso importa.

---

## 3. SQL

- **Autoria e aplicação passam sempre pelo chat.** O Claude Code nunca escreve SQL, nem em arquivo; todo SQL nasce no chat do projeto, que o revisa linha a linha antes de o Iorran colar no SQL Editor. O Claude Code descreve em prosa o que o banco precisa. Se um arquivo em `sql/` for versionado, quem o escreve ou atualiza é o Iorran, à mão, depois de aplicar o SQL; ele precisa refletir exatamente o que foi aplicado.
- Todo bloco de SQL começa com comentário de ambiente em destaque: `-- STAGING` ou `-- PRODUÇÃO` (sempre maiúsculo).
- Migrações vão primeiro para staging, confirmadas com `SELECT`, depois replicadas para produção com confirmação explícita entre ambientes.
- **Merge nunca na mesma resposta que o SQL de produção** (incidente da Sessão 73): quando o código novo depende de schema novo, Claude entrega primeiro o SQL de produção com o `SELECT` de conferência, e os comandos de merge para `main` só na resposta seguinte, depois que o Iorran colar o resultado. Vale também para a `staging` se o banco de staging ainda não tiver o SQL. Sem isso, o push publica código que pede coluna inexistente e derruba o `/admin` (e o `/agendar`, quando a coluna entra em `lib/estabelecimento.js`) com 42703.
- **Coluna aditiva pode ir aos dois bancos antes do código.** Coluna nova nullable ou com default, que nada no código ainda lê, pode ser criada em staging e produção logo no início da demanda — assim o merge nunca corre o risco acima. (Aplicado na Sessão 90 para `situacao_pix_dona`, `precisa_trocar_credenciais` e `troca_exigida_em`, e na Sessão 93 para `ausencias.acrescimo_domingo` e `estabelecimentos.acrescimo_domingo_percentual`.) Coluna que o código **seleciona** (como em `buscarAgendamentos`, `buscarPerfil` e no select de `ausencias` do motor) derruba a tela inteira se faltar num dos bancos: conferir nos dois com `information_schema.columns` antes do merge. Coluna que uma rota de servidor **sempre grava** (mesmo com `null`, como `acrescimo_percentual_aplicado` na remarcação) também quebra o caminho inteiro se faltar.
- Nunca aplicar SQL destrutivo sem um `SELECT` de confirmação prévio.
- **`count(*)` no mesmo comando de um `UPDATE` não enxerga a mudança** (Sessão 90): a conferência da marca tem de ser um SELECT separado, depois do UPDATE.
- **SELECT de conferência de dado de teste só depois de criar o dado** (Sessão 93): resultado vazio rodado antes de o Iorran criar o item não prova falha nem sucesso. O Claude avisa a ordem (criar, depois rodar) e, se o resultado vier vazio, pergunta se o dado já foi criado antes de suspeitar do código.
- **IDs de `estabelecimento_id` não são iguais entre staging e produção** — sempre resolver por slug/nome antes de qualquer SQL que dependa do ID.
- **UUID cortado em relatório visual (ex.: 8 caracteres) não serve para `WHERE id IN (...)`.** Para achar o registro, usar o UUID inteiro ou filtrar por texto (`id::text like 'prefixo%'`).
- RLS: nunca confiar em handoff sobre policy aplicada — sempre reconferir via `SELECT` em `pg_policies` antes de assumir que está em vigor (e confirmar `relrowsecurity` em `pg_class`; grant de escrita sem policy só é inofensivo com a RLS ligada). O mesmo vale para estado de dados registrado em handoff (ex.: flag "ligada em todos os tenants") — conferir no banco antes de decidir.
- **Os arquivos em `sql/` não são fonte de verdade.** Vários divergem do banco (tipos, nomes de coluna, policies que não existem mais; `ausencias` nem existe lá). Antes de escrever qualquer SQL que dependa de tipo ou coluna, conferir no banco via `information_schema.columns`, `pg_get_viewdef`, `pg_proc.prosrc` ou `pg_policies`. Caso real (Sessão 71): o repo dizia `bigint` para ids que no banco são `uuid`, e a função teria compilado e quebrado só na hora em que a cliente tentasse reservar. **Caso da Sessão 90:** `sinal_regras_especiais` não é coluna de `estabelecimentos` (é tabela própria); nunca chutar o nome. **Sessão 93:** o check de `ausencias.tipo_registro` aceita só `ausencia`, `liberacao` e `exclusividade_servico`; valor novo exigiria alterar a constraint (por isso a marca é coluna própria). Quando o Code diz que não achou uma função ou policy no repo, o chat a lê no banco (`pg_get_functiondef`, `pg_policies`) antes de desenhar algo que dependa dela (Sessão 96).
- **Aplicar primeiro, conferir depois.** A conferência só faz sentido depois de colar e rodar o conteúdo do arquivo. Se a conferência voltar sem as linhas esperadas (ou com "function does not exist"), a primeira hipótese é que o arquivo não foi rodado naquele projeto.
- **SQL Editor do Supabase:** mostra só o resultado do último comando e roda só o trecho selecionado — colar o arquivo inteiro (Ctrl+A no VS Code) num editor vazio, sem nada selecionado. `BEGIN` e `COMMIT` em execuções separadas não gravam nada. Para testar sem deixar rastro: bloco `do $$ ... $$` único terminando em `raise exception` com o resultado. A conferência pode vir no fim do mesmo bloco (é o último comando, então é o que aparece). Quando a mesma consulta roda nos dois bancos, o Iorran diz de qual banco é cada resultado.
- O SQL Editor roda o script inteiro numa transação: `create index concurrently` não funciona ali. Com as tabelas do tamanho atual, usar `create index if not exists` normal.
- Coluna nova: `notify pgrst, 'reload schema';` depois do `alter table`.
- Colunas do catálogo do Postgres com tipo `"char"` (ex.: `attgenerated`) precisam de `::text` antes de concatenar.
- Para provar o que um visitante anônimo enxerga, simular o papel direto no SQL Editor: `set role anon;` seguido da consulta. Tabela fechada devolve "permission denied".
- **Banco de destino na primeira linha de todo SQL (pedido de 14/10):** `-- BANCO: PRODUÇÃO | Passo N de M | ...` (ou `STAGING`, ou `STAGING e PRODUÇÃO`); leitura leva `SOMENTE LEITURA`. SQL vai no SQL Editor, nunca no PowerShell.
- **SQL Editor, armadilhas das Sessões 88 e 89:** interpreta `select ... into x` como criação de tabela (usar `v := (select ...)` e `get diagnostics n = row_count`); trunca colagem em torno de 4 mil caracteres (uma função por execução, texto compacto, delimitador `$fn$`); "Success. No rows returned" não prova o `alter` — conferir sempre com `information_schema`/`pg_proc`. Bloco de teste em produção começa com guarda de slug (`if (select slug from estabelecimentos where id = N) is distinct from 'x' then raise exception ...`).
- **Antes de sobrescrever função na produção:** ler o texto atual (`pg_get_functiondef`) e conferir tipos reais (`information_schema`) antes de escrever FKs; a definição lida vira o rollback (Sessão 96: o cron de conclusão lido em produção bateu palavra por palavra com o rollback guardado no Handoff 95). Nunca chutar coluna: usar `to_jsonb(linha)` ou `information_schema`. Filtro de nome com trecho curto e sem acento. Antes de apagar ou atualizar em produção, um select de conferência antes e outro depois; atualizar e apagar numa instrução com CTE.
- **Testar RPC direto no editor:** `select set_config('request.jwt.claims', '{"sub":"<user_id>","role":"authenticated"}', true);` e chamar a função no mesmo Run. Teste que não deve deixar rastro termina com `raise exception` intencional.
- **Gatilhos de `agendamentos`:** notificação e Google Calendar disparam em qualquer UPDATE (inclusive de uma coluna só, como `situacao_pix_dona`); lembrar disso antes de atualizar linha em produção. Mudança derivada (como o acréscimo) vai **no mesmo UPDATE** da data, nunca num segundo UPDATE.
- **Padrão do aviso sim ou não (Sessões 95 e 96):** para gravar um dado derivado na criação ou na alteração de reserva, o app diz só sim ou não (`set_config` local), um gatilho `BEFORE` lê o valor do salão e grava na própria linha, e uma RPC nova chama a função existente sem alterar a que está em produção (`agendamento_criar_com_acrescimo`, `agendamento_alterar_com_acrescimo`). Fora da RPC, o gatilho não mexe na coluna, então insert ou UPDATE direto (dona, service role) grava o valor mandado.
- **Regra do banco que protege o consumidor (Sessão 96):** além da regra de negócio no app, o banco pode carregar um **limite** que nunca deve ser furado, mesmo por chamada direta à API (acréscimo só em domingo, de 1 a 50%: `agendamentos_acrescimo_somente_domingo_check`). Antes de apertar um limite, medir as linhas que ele recusaria e as configurações que o alimentam (o percentual de cada salão), senão reservas legítimas passam a ser recusadas.
- **Arquivo em `sql/` é escrito pelo Iorran, à mão, depois de aplicar o SQL** (reforço de 15/10): o Claude nunca pede para o Iorran procurar arquivo gerado por ele. Se o consolidado do SQL da sessão for útil, ele vai como anexo do handoff.
- **UPDATE em `auth.users` (Sessão 90):** só com SELECT de conferência antes (uma linha, a conta certa) e depois; nunca em lote. Senha, hash e chave nunca passam pelo chat. UUID e e-mail podem.

---

## 4. Formato de resposta

- Prosa corrida, sem cabeçalhos fixos repetitivos (nada de "Contexto em 2 linhas", "O Código Prático").
- No máximo 3 parágrafos curtos explicando o porquê da mudança e o impacto prático (linguagem de negócio, sem jargão de programação sênior).
- Código/comando limpo, direto, sem floreio depois.
- **Arquivos de controle chegam completos, para colar.** Handoff, `PENDENCIAS.md`, `INVENTARIO_RECURSOS.md` e `PROTOCOLO_DESENVOLVIMENTO.md` vêm inteiros; o Iorran cola no arquivo do repositório ou no projeto. Quando o arquivo é grande demais para o chat (o protocolo passa de 40 mil caracteres), ele vem como arquivo enviado na conversa, completo. O Claude nunca pede para o Iorran procurar download na Área de Trabalho ou em Downloads, e os comandos só mexem em arquivo que já está no repositório. (Pedido de 19/10: mesmo quando só um trecho mudou, os arquivos vêm completos.)
- **Nunca afirmar comportamento do app sem ler o código ou ver o resultado.** Se a afirmação sair errada, retratar na hora (caso de 15/10: eu disse que as outras opções do Alterar confirmavam e tiram o card dos Pendentes sem ter lido `handleAlterar`; caso de 22/10: eu disse que o motor já cobria liberação recorrente, mas o calendário do `/agendar` não abre o dia).
- **Recomendação que contraria o desenho descrito pelo Iorran é declarada como tal e perguntada, não implementada por conta** (Sessão 93: ele pediu um tipo no menu com segundo menu e card separado; eu entreguei uma caixa de seleção por custo de código e a tela teve de ser refeita).
- **Decisão proposta pelo Claude que o teste do Iorran derruba é retratada na hora e registrada no handoff** (Sessão 96: propus a grade do Alterar "como a cliente veria"; o teste mostrou que a dona não conseguia mover a reserva para o horário combinado).
- **Quando o Iorran descreve uma ideia, repetir o entendimento antes de propor** (Sessão 96: entendi ao contrário o pedido sobre mês fechado; o print dele corrigiu).
- **Investigação de "bug" da dona:** primeiro dados (quem criou, quando, em qual horário, em que status), depois hipótese. Mensagem para a dona nunca afirma causa antes de os dados confirmarem.
- **Texto ou selo que o Iorran vê na tela pode vir de outra branch ou de outro ambiente** (Sessão 90: "Troca pendente" só existia no código publicado na `staging`, não no código da branch em teste). Confirmar branch, URL do Supabase e se o servidor foi reiniciado antes de diagnosticar. Opção que o Iorran não encontra na tela: antes de suspeitar do código, conferir se ele escolheu o modo que revela a opção (Sessão 93, "Tipo de liberação" sem seleção).
- **Cópia do projeto no claude.ai pode estar defasada em relação ao repositório** (19/10: o `INVENTARIO_RECURSOS.md` do projeto não tinha as linhas 26 a 28; 28/10: o protocolo do projeto era de 19/10 e o repositório já tinha as regras da Sessão 93). Antes de reescrever um arquivo de controle, pedir a versão do repositório.
- **Pergunta sobre lei ou direito do consumidor:** informar fatos e artigos, dizer que não é parecer jurídico e sugerir advogado ou Procon; a decisão de produto continua do Iorran (Sessão 93).
- **Pedido de produto vindo do Iorran durante o teste** (Sessão 96: âmbar no horário do `/agendar`, "Valor total" sempre visível): Claude diz o alcance (quem passa a ver a mudança) antes de implementar.

---

## 5. Fechamento de sessão

Depois de merges e SQLs do dia, Claude gera:
- O handoff da sessão, em arquivo `.md`.
- O conteúdo **completo e limpo** do `PENDENCIAS.md`, pronto para substituir o arquivo inteiro, nunca como diff com marcadores. O que foi resolvido na sessão sai do arquivo e fica registrado no handoff.
- **Conferência de SQL staging → produção** — o resultado dessa conferência entra no handoff, mesmo quando não há pendência (registrar "nenhum SQL de schema pendente de replicar" é tão válido quanto listar um item em aberto).
- O `PROTOCOLO_DESENVOLVIMENTO.md` completo, quando a sessão criou regra nova.
- A sequência completa de comandos para commitar os arquivos de controle numa branch de fechamento e levá-los a `staging` e `main`. A branch de fechamento sai da `main`, nunca de uma branch de feature não mergeada (Sessão 93), e os arquivos de controle só são colados depois de criada.
- Título do handoff no projeto sem barra (`/`), porque a interface trata a barra como pasta: `# reserva-horario — Handoff Sessão N (datas)`.
- `PENDENCIAS.md` e `INVENTARIO_RECURSOS.md` são commitados na branch da demanda **antes** do merge (prática das Sessões 88 e 89), para o merge já levar a documentação; quando a demanda já foi mergeada, vão numa branch de fechamento (`fechamento-sessao-N`), como nas Sessões 90 e 96. No fechamento, conferir `git log main..staging --oneline` e, depois do merge, sincronizar a `staging` e apagar a branch. Quando a demanda ainda não foi mergeada (feature em fatias), as linhas do inventário vão no handoff e entram na branch da feature antes do merge.
- Revisar o inventário junto do `PENDENCIAS.md`. Apagar os `diff-*.txt` da Área de Trabalho.
- Quando houver demanda declarada como inadiável para a próxima sessão, ela abre o `PENDENCIAS.md` numa seção própria acima de tudo.
- **Quando a sessão deixa suporte a donas para o fim de semana ou para um período**, o handoff traz um **protocolo de plantão** (o que fazer em cada problema provável, com SELECTs de acompanhamento prontos e o que nunca fazer). Modelo: Handoff Sessão 90, seção 8.
- **Dados de teste em staging não são limpos** (decisão de 26/10): staging é o ambiente de teste e o histórico ajuda em consultas futuras. Limpeza de dado de teste só em produção. O fechamento não lista limpezas de staging.

Iorran só cola o conteúdo pronto — nunca marca `[x]` manualmente. Itens marcados `[x]` sem handoff correspondente precisam ser reconfirmados antes de serem tratados como fechados.

Handoffs antigos são compactados periodicamente num arquivo único (o mais recente: "Arquivo compactado Sessões 1–73"), com backup externo antes de remover os originais do projeto — a compactação tem perda.

---

## 6. Regras de schema e ambiente (aprendidas com incidentes)

- Novas colunas em `estabelecimentos` precisam aparecer em `lib/estabelecimento.js` **e** `lib/perfil.js`, ou ficam invisíveis para contas `'dono'` (regra permanente, documentada no `CHECKLIST_RELEASE.md`). Exceção: coluna que só rotas de servidor leem por embed próprio (ex.: `google_calendar_cor_id`, lida só pelo sync do Calendar) não precisa entrar nos dois selects. (Colunas de `perfis`, como `precisa_trocar_credenciais` e `troca_exigida_em`, não seguem essa regra: entram só no select de `perfis` em `lib/perfil.js`.) `estabelecimentos.acrescimo_domingo_percentual` está nos dois selects desde `b58c624`.
- Datas no navegador: sempre `new Date(ano, mes-1, dia)`, nunca `new Date("YYYY-MM-DD")` (problema de fuso UTC/GMT-3). Datas de um mês montadas como texto `ano-mês-dia` com `padStart` também são seguras.
- **Datas e horas no servidor (rotas em `app/api/`, Vercel roda em UTC): nunca ler data/hora de parede pelo fuso do processo** (`getHours()`, `getDate()`, `new Date(ano, mes, dia, h, m)`). Converter sempre para `America/Sao_Paulo` com `Intl.DateTimeFormat` (padrão de `lib/googleCalendarImportacao.js` e `lib/disponibilidade.js` desde a Sessão 71), sem offset fixo `-03:00`. Comparar dois instantes absolutos (`Date.now()` contra um `timestamptz`) é seguro. No SQL, "hoje" é `(now() at time zone 'America/Sao_Paulo')::date`, nunca `current_date`. Caso de origem: a revalidação de antecedência recusava horários válidos com 3h de diferença e o corte das 19h disparava às 16h.
- Para testar fuso localmente, rodar com `TZ=UTC` e `TZ=America/Sao_Paulo` no PowerShell (`$env:TZ = "..."`). No Git Bash, `TZ` com barra não funciona (o MSYS converte em caminho do Windows) — usar PowerShell ou `MSYS_NO_PATHCONV=1`.
- Campos `time` do Postgres: normalizar com `.slice(0,5)` antes de comparar.
- **`agendamentos.periodo` é coluna gerada** (`tsrange(data + horario, data + horario + duracao_min, '[)')`). Nenhum insert precisa (nem pode) preenchê-lo; a constraint de exclusão `agendamentos_sem_sobreposicao` vale para todo caminho de insert desde que `data`, `horario` e `duracao_min` estejam corretos. Por isso `duracao_min` nunca pode ser zero ou negativo (range vazio não colide com nada).
- Funções `SECURITY DEFINER` usadas em triggers precisam estar explicitamente marcadas assim — trigger rodando como anon falha silenciosamente (42501).
- Extensão `btree_gist` é necessária para constraints de exclusão por tenant em `agendamentos`.
- No embed do Supabase, quando FK e relação são usadas juntas (`profissional_id` + `profissionais(nome)`), ambas precisam estar explícitas no select.
- `DROP FUNCTION` + `CREATE` derruba os grants — sempre re-conceder e testar o caminho real depois.
- Catálogo criado por SQL direto precisa do INSERT manual em `servico_profissional` (sem ele, o `/agendar` diz "nenhum profissional disponível" e a RPC `agendamento_criar` recusa com AG004).
- Vercel Instant Rollback pode desligar a promoção automática da `main` até um deploy ser promovido à mão — depois de qualquer rollback, conferir que o próximo push virou Production.
- **Upload de imagem no Storage (Sessão 90, corrigido na Sessão 91):** foto sobe **comprimida** (`lib/comprimirImagem.js`), com limite de tamanho e `cacheControl` explícito, e exibida com `loading="lazy"`; extensão diferente no `upsert` deixa arquivo órfão. As fotos existentes foram reprocessadas por script (57,19 MB para 2,60 MB em 20/10); o `--remover-antigos` ainda está pendente (ver `PENDENCIAS.md`).
- **Script de manutenção com service role (19/10):** roda localmente, com a chave lida do `.env.local` (nunca colada no chat nem impressa em log); **backup dos arquivos ou linhas afetados antes**; **ensaio em staging** antes de produção (IDs e pastas diferem entre os ambientes); modo de simulação (listar o que mudaria) antes do modo que grava; SELECT de conferência antes e depois quando tocar o banco.
- **Teste de tela que grava dado (Sessão 93):** antes de clicar em salvar, confirmar a URL do Supabase no `.env.local` (staging `yebwkchcrvebvvjvvvyu`) e usar o tenant de teste (`teste` em staging); o `/laysla` abre o tenant real no ambiente apontado pelo `.env.local`, então o slug sozinho não diz onde se está gravando. Em staging, o dado de teste pode ficar (decisão de 26/10).
- **Aviso de cota do Supabase (Sessão 93):** "exceeded its quota in the previous billing cycle" com data de restrição significa olhar o Usage do ciclo novo em até uma semana; se o ritmo passar do limite, assinar o Pro com spend cap antes da data (§17, cota).
- **Lista sem limite (Sessão 96):** `buscarAgendamentos` carrega o histórico inteiro do salão; o PostgREST corta respostas em 1000 linhas por padrão. Toda leitura de tabela que cresce precisa de limite, paginação ou recorte, e o crescimento se mede com `count` por salão (demanda aberta no `PENDENCIAS.md`).

---

## 7. Princípios de arquitetura

- Configuração manual sobrepõe automação quando representa decisão consciente sobre um caso específico — mas automação que protege contra um risco que a config manual nunca pretendeu dispensar continua valendo.
- Conflito físico de horário (dois agendamentos confirmados sobrepondo o mesmo profissional) nunca é contornável, em nenhum contexto.
- Disponibilidade é sempre calculada, nunca armazenada.
- `status='cancelado'` + `expirado_automaticamente=true` é a representação canônica de reserva provisória expirada.
- **Reserva `pendente`/`aguardando_sinal` fica segurando o horário até a dona agir nos Pendentes** (decisão unânime das donas, 22/09). Não criar expiração por prazo antes disso: parte das `aguardando_sinal` já pagou e só não teve o pagamento confirmado. A defesa contra horário preso é a visibilidade nos Pendentes, não um relógio. **A situação do Pix marcada pela dona (`situacao_pix_dona`, Sessão 90) nunca altera `status`**: só reordena a fila e muda a tag; o horário continua preso.
- **Uma regra de negócio mora num lugar só.** O banco valida pertencimento e limites (salão ativo, serviço/profissional do salão, status permitido, duração dentro de faixa, acréscimo só em domingo e até 50%); a regra de negócio (quando cobrar sinal, duração com adicionais, janela, antecedência, prazo mínimo, classificação de agendamento, quais horários levam acréscimo) mora no app. Duplicar a regra em SQL cria duas versões que divergem com o tempo, e a divergência recusa a reserva legítima — perda de dinheiro garantida — enquanto o risco evitado costuma ser pequeno, porque toda reserva passa pela revisão da dona. Dado calculado em vários lugares ganha uma função pura única (`valorTotalAgendamento`); a grade da dona tem uma só (`lib/gradeAdmin.js`).
- Textos de WhatsApp vivem só em `lib/whatsapp.js`, como funções nomeadas.
- Reaproveitar hooks, máquinas de estado e componentes visuais existentes antes de criar novos — sinalizar soluções complicadas demais e sugerir caminho mais simples.
- Sempre investigar (raio-x / prompt somente leitura) antes de implementar.
- **Tela da dona é modo da dona (Sessão 96):** toda tela do `/admin` que escolhe data ou horário mostra o que a dona pode fazer (dia inteiro, estados sinalizados, como o Agendar), nunca o que a cliente veria. A regra da cliente vira aviso ou confirmação, não esconde opção.
- **Nome do profissional só aparece em telas de agendamento com 2+ profissionais ativos** (`qtdProfissionaisAtivos > 1`; `null`/contagem carregando também esconde, nunca mostra por padrão). Regra permanente desde a Sessão 59 — qualquer novo ponto que exiba `profissional_nome` deve seguir essa condição.
- **Múltiplas profissionais em manutenção (decisão de 28/10):** nenhum salão real tem 2+ profissionais ativas; cada profissional tende a ter o próprio link. O recurso continua funcionando e nenhuma mudança nova pode estragar dados nesse caso, mas recursos novos não ganham interface própria para ele até existir uma dona real usando (medir com `count` de profissionais ativos por salão antes de reabrir).
- Toda alteração de status feita por decisão da própria dona dentro do `/admin` (cancelar, resolver conflito de prazo, marcar exceção de conclusão) é tratada como "ação do salão" pra fins de estatística — independente do gatilho que levou a essa decisão (ex: conflito de prazo detectado pelo sistema ainda conta como cancelamento do salão, porque foi ela quem clicou).
- **Tema do `/admin` pode divergir do público, campo a campo, sempre com fallback pro valor público correspondente:** `bgCardAdmin` (→ `--color-card`, fallback `bgHeader`), `botaoAdmin`/`botaoAdminHover` (→ `--color-primary`/hover, fallback `botao`/`botaoHover`), `bordaAdmin` (→ `--color-border`, fallback `bordaHeader`), `textoBotaoAdmin` (→ `--color-on-primary` quando há `botaoAdmin`, fallback `#fdfcfa`; sem `botaoAdmin`, o admin usa `textoBotao` como o público). Existe porque o admin ignora `textoCard` de propósito (sempre usa `textoPrincipal` como texto) — então um `bgHeader` ou `botao` escolhido pro público escuro/claro pode deixar o admin com texto ilegível, mesmo quando o público está perfeito. Regra prática: **todo tenant com `bgHeader` escuro precisa de `bgCardAdmin`/`botaoAdmin`/`bordaAdmin`**, e todo botão claro precisa de texto escuro (ver `NOVO_TENANT.md`). O mesmo vale para tenant **claro com `bgHeader` mais escuro que `bgBody`** (card mais escuro que a página, caso da Layra): o admin assume card claro sobre página, então precisa de `bgCardAdmin` mais claro que a página e de `bordaAdmin` com pelo menos 3:1 contra `bgBody`.
- **Decisão de negócio que foge do escopo original do app (ex.: maquiadora em vez de manicure) prefere um flag/config por tenant a uma categoria geral de "tipo de salão"** — até que 2 ou mais features realmente exijam essa distinção. Criar a taxonomia geral antes disso é escopo maior que o necessário (ver "sem catedral"). Caso de origem: agendamento em grupo da Laryssa, desenho congelado, não implementado (as colunas `permite_agendamento_grupo` e `max_pessoas_grupo` não existem; ver `PENDENCIAS.md`) — a ideia é um flag por tenant editável só no `/painel-global`, em vez de um sistema de segmentos. Pares de datas são ferramenta das maquiadoras e não levam acréscimo de domingo.
- **Etiqueta de cliente é dado passivo; o que gera fricção são os gates.** Desligar comportamento incômodo se faz pelo popup (bloco "Alertas e avisos"), nunca apagando a estrutura de etiquetas nem as regras que dependem dela (mês restrito, Lista de Bloqueio, filtros). Um interruptor de aviso não muda regra de agenda.
- **Conclusão automática x manual (`conclusao_manual_ativa`).** Salão automático: `confirmado` vira `concluido` na hora em que passa o horário do atendimento, sem espera. Salão manual: só vira `concluido` depois que o prazo de revisão (`confirmado_expira_horas`) vence sem ação da dona. Vale para a função de cron `concluir_agendamentos_confirmados_vencidos` e para a classificação do Financeiro/Relatórios.
- **Sinal de agendamento cancelado é crédito retido, não receita:** não entra no total de receita; aparece à parte, no card "Sinais retidos (cancelados)" do Financeiro.
- **Mudança que obriga a dona a fazer algo (Sessão 90):** primeiro um aviso fixo e destacado que não trava o trabalho dela (cenário: a dona com cliente esperando), e só depois de um prazo o bloqueio. Prazo de 30 dias em `DIAS_AVISO`, invisível na tela. Quando o risco é de segurança imediato (senha provisória que circulou por WhatsApp), o bloqueio é na hora.
- **Não impor fricção às donas para resolver problema de infraestrutura (decisão de 19/10):** se dá para resolver por código ou script (ex.: reprocessar fotos pesadas), não se pede à dona que reenvie arquivos.
- **Mês fechado não tem horário aberto, nem na visão da dona** (decidido em 28/10, a implementar): o calendário já mostra o dia tracejado, e a grade do Agendar e do Alterar deve dizer o mesmo. Ligado à ideia futura de a assinatura em atraso impedir a abertura de meses novos (ponto delicado, ver `PENDENCIAS.md`).
- **Adicional de domingo (Sessões 93 a 96, em produção desde 28/10):** domingo é folga, então todo horário de domingo nasce de uma exceção (Liberar horário); o acréscimo vale para os horários abertos por essa exceção. Marca em `ausencias.acrescimo_domingo`; percentual por salão em `estabelecimentos.acrescimo_domingo_percentual` (**padrão 40** desde 28/10, de 0 a 50, o Iorran altera). O motor confia na marca e não olha o dia da semana; a tela só cria a marca em domingo; **o banco recusa acréscimo gravado fora de domingo ou acima de 50%**. Liberação com e sem marca cobrindo o mesmo horário do mesmo profissional = sem acréscimo. O acréscimo é **por horário**: sem profissional escolhido, só vale se todos os livres naquele horário tiverem a marca. O motor informa os horários com acréscimo pela propriedade não enumerável `acrescimoPorHorario` do mapa (ler sempre o mapa cru; cópias e o filtro de antecedência a perdem); quem calcula o valor é o app.
- **Preço com acréscimo (Sessões 95 e 96, substitui a regra da Sessão 93):** a reserva grava o **percentual aplicado** (`agendamentos.acrescimo_percentual_aplicado`), nunca um valor em reais. Total = base + floor(base × percentual ÷ 100), com base = serviço + agregado + ajustes das perguntas; arredonda para baixo, uma vez, em `precoComAcrescimo` (o cron repete a mesma conta, e os dois lados se apontam). **Remarcação e alteração recalculam pelo horário novo**; mudar o percentual do salão nunca mexe em reserva existente. O sinal Pix é valor fixo e independente. A cliente nunca vê o percentual ("Acréscimo de Domingo no valor total do serviço"); a dona vê ("Agendamento com acréscimo de domingo (N%)").
- **Negociação do acréscimo pela dona (Sessão 96):** no Agendar e no Alterar do `/admin`, a caixa "Acréscimo de domingo (N%)" decide por reserva. Ela só aparece em domingo, fora de par, com percentual válido e quando aquele domingo tem liberação com acréscimo para o profissional **ou** a reserva já tem acréscimo gravado: se a dona não oferece acréscimo publicamente no `/agendar`, ela não ganha a opção só do lado dela. O valor inicial vem da marca do horário; mexer só na caixa é alteração; remover acréscimo sempre pede confirmação.
- **Mudança de preço ao consumidor só com aviso antes de confirmar** e nunca retroativa (CDC, art. 39 X, 31 e 39 VI; orientação, não parecer). O teto do percentual (50) é um limite do app e do banco. Antes de anunciar o adicional às donas: conversa com a dona sobre o percentual e consulta jurídica.

---

## 8. Ferramentas e arquivos-chave

- **Stack:** Next.js (App Router, JS), Supabase (Postgres + Storage + Auth + pg_cron + pg_net), Tailwind v4, Vercel (Hobby — atenção ao timeout de 60s), Recharts (gráficos, desde a Sessão 59).
- **Ambientes Supabase:** staging (`reserva-staging` / `yebwkchcrvebvvjvvvyu`) e produção (`pwlvjaenryzdkatmrhul`) — projetos separados, sequências de ID independentes. Plano gratuito (Sessão 90: cota de egress estourada; Sessão 93: novo aviso de cota, ver `PENDENCIAS.md`).
- **Arquivos de controle:** `CLAUDE.md`, `AGENTS.md`, `PENDENCIAS.md`, `INVENTARIO_RECURSOS.md`, `PROTOCOLO_DESENVOLVIMENTO.md`, `CHECKLIST_RELEASE.md`, `NOVO_TENANT.md`, `THEMING.md` e `docs/` (handoffs e identidade visual). Os arquivos de `sql/` **não** são fonte de verdade (ver §3): o banco manda.
- **Libs-chave:** `lib/disponibilidade.js`, `lib/whatsapp.js`, `lib/particao.js`, `lib/cliqueFora.js`, `lib/checagemWhatsapp.js`, `lib/comprimirImagem.js`, `lib/temas.js`, `lib/conclusao.js`, `lib/mes.js` (navegação mensal, `mesDeHoje`/`rotuloMes`), `lib/janelaAgendamento.js`, `lib/sinalRegra.js`, `lib/sinalPix.js`, `lib/googleCalendarSync.js`, `lib/servicoAgregado.js` (regras puras do serviço agregado, testadas em `lib/servicoAgregado.test.mjs`), `lib/agregadosServico.js` (leitura dos agregados no Supabase), `lib/situacaoPixDona.js` (elegibilidade, tag, menu e ordenação da situação do Pix, testada em `lib/situacaoPixDona.test.mjs`), `lib/credenciaisDona.js` (regras de senha e e-mail, máscara), `lib/senhaProvisoria.js` (gerador da senha provisória), `lib/avisoTrocaCredenciais.js` (modo `nenhum`/`aviso`/`bloqueio`), `lib/apiAuth.js` (`autorizarAdminEstabelecimento` e `autorizarGlobal`), `lib/acrescimoDomingo.js` (regras puras do adicional: marca, valor, caixa da dona, gravação na remarcação, bloco "Valor total"; testada em `lib/acrescimoDomingo.test.mjs`), `lib/gradeAdmin.js` (estados, legenda e montagem da grade do dia inteiro do Agendar e do Alterar; testada em `lib/gradeAdmin.test.mjs`), `lib/agendamentoRespostas.js` (`somarAjustesPreco` e `somarAjustesPrecoEmLote`, tudo-ou-nada) e `components/ValorComAcrescimo.js`.
- **Camada pública de dados (desde a Sessão 71):** `sql/rpcs_agendamento_publico.sql` (cancelar, liberar reserva, declarar sinal, anexar comprovante, status da reserva), `sql/rpc_criacao_agendamento.sql` (`agendamento_criar`, com as respostas das perguntas na mesma transação e erros AG001–AG009), `sql/rpcs_leitura_cliente.sql` (painel da cliente por telefone + helper interno `normalizar_telefone`), rota `app/api/agendamentos/comprovante-upload` (URL assinada do comprovante). Desde a Sessão 73: `agendamento_criar_interno` (sem grant), `agendamento_criar_par`, `agendamento_cancelar_cliente_par`. Desde a Sessão 96: `agendamento_criar_com_acrescimo` (pública) e `agendamento_alterar_com_acrescimo` (só `authenticated`), e a rota `app/api/agendamentos/remarcar` grava o acréscimo. Toda mudança no fluxo público de agendamento passa por um desses. A RPC `agendamento_alterar_agregado` existe no banco sem arquivo versionado.
- **Rotas de conta e segurança (Sessão 90):** `app/api/conta/trocar-credenciais` (a própria dona, token da sessão) e `app/api/painel-global/seguranca` (só papel `global`). Ver §11.

---

## 9. Uso eficiente de tokens

- Sessões de discussão/pesquisa separadas de sessões de implementação, para não reprocessar histórico completo a cada resposta.
- Fragmentar sessões por demanda, com handoff e fechamento frequentes, em vez de uma sessão única acumulando contexto. (Sessão 93: duas demandas e uma feature em quatro fatias numa conversa só deixaram o contexto enorme; fechar depois de uma fatia grande. Sessão 96: três dias abertos funcionaram com nota de continuidade no projeto.)
- Raio-x enxuto: focar no que muda a decisão de implementação, não numa auditoria completa do arquivo — auditorias amplas ficam para sessões dedicadas.
- Raio-x complexo pode ir para o Claude Code na nuvem (branch própria `claude/...`, container sem `node_modules` nem `.env.local`); implementação fica no local. Fluxo da nuvem: Code commita e dá push na branch dele → local `git fetch origin` + `git merge origin/claude/...` na branch de feature → teste → merge na `main` → `git push origin --delete claude/...`. **A nuvem só enxerga o que está em `origin`:** código em branch só local não existe para ela (Sessão 93: o raio-x disse que o motor não lia a coluna nova porque a branch não estava no remoto); no prompt, dizer qual branch está só local ou fazer o push antes.
- O conhecimento do projeto no claude.ai guarda só os `.md` de controle e os handoffs — código é lido pelo Claude Code direto do disco.

---

## 10. BrowserMCP e Claude Code

- Desconectado por padrão — a definição da ferramenta consome ~38% do context window do Claude Code mesmo sem uso.
- Reconectar apenas nas sessões em que for necessário teste ao vivo no navegador (Claude Code validando fluxo/staging por conta própria, como feito na Sessão 30).
- Claude (chat) deve sinalizar quando uma demanda pedir esse tipo de validação, sugerindo reconectar antes do prompt pro Claude Code.
- **O painel do navegador do Claude Code é um navegador separado do navegador pessoal do Iorran (Chrome/Edge).** Um login feito no Chrome do Iorran não vale nessa aba — qualquer tela protegida por senha (login do `/admin`, por exemplo) precisa ser preenchida por ele diretamente dentro do painel que aparece do lado da conversa. Sempre confirmar em qual navegador a ação precisa acontecer antes de pedir "faça login".
- **O Claude Code não roda `next build` nem `next dev` com o servidor do Iorran ligado, e não encerra processos dele** (incidente da Sessão 74: `.next` corrompido servindo CSS antigo). Verificação padrão nos prompts: `npx eslint` nos arquivos tocados. Se o cache corromper: parar o servidor, apagar `.next\dev` e `.next\cache`, subir de novo com `npm run dev` (não existe script `staging`; o banco lido depende do `.env.local`: staging `yebwkchcrvebvvjvvvyu`, produção `pwlvjaenryzdkatmrhul`).
- Todo prompt de implementação termina com "não commite; me devolva o diff" e a mensagem de commit sugerida. Se o Code falhar por erro da própria ferramenta (ex.: classificador de permissões sem veredito), nada foi alterado — basta pedir "tenta de novo" ou reabrir a sessão com o mesmo prompt.
- Worktree separado (ex.: `C:\Users\Iorran\BarberShop-laryssa`) aparece com `+` no `git branch`; fechar com `git worktree remove` antes de apagar a branch dele.
- **Edição de código só no Code local**, aberto em `C:\Users\Iorran\BarberShop`, confirmando `git rev-parse --show-toplevel`, branch e `git log -1`. O Code na nuvem trabalha em worktree atrasado (Sessão 84) e serve para raio-x de leitura, com `git fetch` e base `origin/main` explícita no prompt.
- **O Code não commita, não faz push, não escreve SQL, não cria nem troca de branch.** Os prompts são somente leitura até o OK; ele entrega o diff por arquivo e uma seção "o que não consegui cobrir". Não pedir `next build` sem necessidade (o `AGENTS.md` proíbe por padrão). **O Code nunca imprime chaves, `.env.local` nem senhas**, nem em log, teste ou comentário.
- **Efeito do React com dependência que recarrega sozinha (Sessão 96):** a lista de agendamentos do `/admin` é recarregada a cada 60 s; ela nunca entra nas dependências de um efeito que consulta o banco. Dado que só pinta (rótulo, cor) é montado no render ou em `useMemo` a partir do que já foi buscado; o efeito depende só do que muda a consulta.
- **Testes automatizados (Sessões 89 a 96):** `node --test lib/servicoAgregado.test.mjs`, `lib/situacaoPixDona.test.mjs`, `lib/credenciaisDona.test.mjs`, `lib/senhaProvisoria.test.mjs`, `lib/avisoTrocaCredenciais.test.mjs`, `lib/acrescimoDomingo.test.mjs` e `lib/gradeAdmin.test.mjs` (regras puras; em 28/10, acrescimo + gradeAdmin + servicoAgregado somam 112 passando) e `npm run test:componentes` (vitest + jsdom + testing-library; em 28/10, **90 passando e 1 `it.fails`** documentado em `tests/disponibilidadeAgenda.test.js`, em 9 arquivos, entre eles `tests/agendamentoRespostas.test.js`, `tests/CalendarioDiasModoLivre.test.jsx` e `tests/TelaSolicitacaoEnviada.test.jsx`). Mudança em agregado, preço, tempo, disponibilidade, grade do admin, Pix da dona ou credenciais roda os testes correspondentes antes do diff. `lib/whatsapp.js` usa o alias `@/` e não roda em `node --test`; lib nova que precisa rodar em `node --test` usa imports relativos. A Vercel instala as devDependencies: conferir o build depois do merge.
- **Teste de regressão de dados do motor (Sessão 93):** mudança em `lib/disponibilidade.js` que não deve alterar o resultado visível é provada pelo Code local com um script temporário **fora do versionado** (em `.next/regress`, apagado no fim): importa a `main` (`git show main:lib/disponibilidade.js`) e a versão da branch, lê o staging só com a chave anon em memória (nunca impressa) e compara `JSON.stringify` da saída enumerável, em vários salões, 3 meses e nos contextos público e admin (420 combinações, todas idênticas, na Sessão 93). Se o alias `@/` não rodar em `node` puro, usar o runner do vitest só para o script temporário; se exigir mexer em arquivo versionado, parar e avisar. O Code confirma no fim que o `git status` voltou só aos arquivos esperados.
- **Refatoração que move código de uma tela que funciona para uma lib comum (Sessão 96, `lib/gradeAdmin.js`):** o Code explica ponto a ponto por que a tela antiga continua igual, o eslint confirma que nenhum nome ficou para trás (o número de erros não muda) e o Iorran retesta a tela antiga no navegador antes do commit.

---

## 11. Segurança de dados (padrão desde a Sessão 71)

**O visitante anônimo não tem acesso direto a dado de cliente.** Desde 23/09, `anon` não tem nenhuma policy nem nenhum grant em `agendamentos`, `agendamento_respostas` e `fidelidade_resgates`, e o bucket `comprovantes-pix` não tem nenhuma policy anônima. O calendário público lê só a view `slots_ocupados` (roda como dono, expõe só data/horário/duração/profissional). Toda leitura ou escrita que o fluxo público precisar é feita por RPC `SECURITY DEFINER` ou por rota de servidor com service role. **Nunca reabrir policy anônima nessas tabelas para "destravar" uma feature** — necessidade nova do público vira RPC nova. (`ausencias` é diferente: leitura anônima `using true`, por design, e não guarda dado de cliente; escrita só da dona do salão ou `global`.)

**Convenções de toda RPC pública:**
- `security definer`, `set search_path = public, pg_temp` (`pg_temp` sempre no fim), delimitador `$fn$`.
- Salão ativo como pré-requisito.
- Valida pertencimento e limites, nunca regra de negócio (ver princípio no item 7).
- **Nenhum bloco `EXCEPTION`.** O erro 23P01 (horário ocupado) precisa chegar cru ao app, que mostra "Esse horário acabou de ser reservado". Erros próprios usam SQLSTATE de 5 caracteres (`AG001`...) documentados no cabeçalho do arquivo e traduzidos para mensagem amigável no app.
- Retorno sempre distingue "gravou" de "não gravou" (`boolean`, status anterior ou `null`) — nunca `void`, senão uma escrita bloqueada volta a parecer sucesso.
- Leitura devolve só as colunas que a tela usa — nunca `nome_cliente`, `telefone`, valores ou comprovante quando não forem da própria tela.
- O `id` uuid do agendamento funciona como fator de posse nas RPCs por id (não é enumerável). As leituras do painel usam `estabelecimento_id` + telefone normalizado — risco aceito, igual ao de `cliente_buscar_por_whatsapp`.
- Rollback comentado no fim do arquivo.

**Acréscimo de domingo e o navegador (Sessão 96):** o percentual **nunca vem do navegador**. O fluxo público manda só sim ou não (`agendamento_criar_com_acrescimo`, executável por `anon`; rota `app/api/agendamentos/remarcar`, que aceita só `true` estrito, lê o percentual do salão da própria reserva e confere domingo antes de gravar). As duas exceções gravam o percentual do salão lido pelo próprio app da dona: o insert direto do Agendar do `/admin` e a gravação só da caixa no Alterar (a policy da dona cobre, e o banco limita a domingo e 1 a 50). Risco aceito: a cliente pode mandar um "sim" forjado num domingo; a dona revisa toda reserva e o banco barra fora de domingo.

**Permissões no Supabase:** toda função nova já nasce com `EXECUTE` explícito para `anon` e `authenticated` (além de `public`). `revoke ... from public` sozinho não fecha nada. Helper interno ou função de cron: `revoke execute on function ... from public, anon, authenticated;`. Função pública: `revoke ... from public;` seguido de `grant execute ... to anon, authenticated;`. Função só da dona: `revoke ... from public, anon, authenticated;` seguido de `grant execute ... to authenticated;`. Conferir sempre com `has_function_privilege('anon', oid, 'execute')`.

**Policies se somam (são OR).** Uma policy restrita não adianta se outra da mesma tabela libera tudo — antes de dizer que algo está fechado, listar **todas** as policies da tabela, inclusive as de `authenticated` (caso real: `agendamento_respostas_authenticated_all` com `using = true` deixava uma dona ler e apagar respostas das clientes de outro salão). Policy de admin segue sempre o padrão "salão da dona em `perfis` **ou** papel `global`" — a cláusula `global` já foi esquecida mais de uma vez.

**Papel das policies igual nos dois bancos.** Policy de dona é `to authenticated`, nunca `{public}`. Uma policy pública em staging cobria em silêncio o insert do admin, e ao removê-la o admin de staging perdeu a permissão de criar agendamento — só apareceu porque a consulta de conferência listou as policies restantes. (Divergência ainda aberta em staging: UPDATE de `agendamentos` é `{public}` em staging e `{authenticated}` em produção, conferido em 27/10; `perfis`; ver `PENDENCIAS.md`.)

**Subquery dentro de policy roda com a RLS de quem chama.** Um `EXISTS (select ... from agendamentos ...)` numa policy de outra tabela deixa de enxergar a linha quando a leitura de `agendamentos` é fechada para aquele papel — e o insert que dependia disso passa a falhar em silêncio. Ao fechar uma tabela, procurar policies de outras tabelas que a consultam.

**Ordem de deploy com banco e código:**
- Função ou coluna nova: criar no banco (staging, depois produção) **antes** do merge do código que a usa.
- Policy ou grant antigo: remover só **depois** que o código novo estiver publicado em produção e testado.
- Storage: código novo primeiro (esperar o deploy da Vercel terminar), regras antigas do bucket depois.
- Invertida qualquer dessas ordens, as clientes reais ficam sem conseguir agendar, cancelar ou enviar comprovante até o passo seguinte.

**Storage:** upload feito por visitante anônimo só por URL assinada emitida em rota de servidor (`createSignedUploadUrl` com service role, depois `uploadToSignedUrl` no navegador), com validação do agendamento e lista fechada de extensões. Nunca policy anônima de INSERT/UPDATE/SELECT em bucket privado — o `upsert` exige SELECT, e SELECT anônimo no bucket deixa listar e baixar tudo.

**Tabela nova:** RLS ligado desde a criação; nenhuma policy para `anon` a menos que seja dado de catálogo que o `/agendar` precisa ler e que não identifica ninguém; policies de dona no padrão acima. Dado sensível (chave de API, token, credencial) nunca vira coluna de `estabelecimentos` — a leitura pública dessa tabela é por linha, não por coluna.

**Segredos:** nunca colar `.env.local`, chave de service role, secret de webhook, token de sessão **nem senha (inclusive a provisória)** no chat. Se acontecer, trocar a chave no painel de origem (Supabase, Google Cloud, AbacatePay), na Vercel (Preview e Production), no `.env.local` e em qualquer função do banco que carregue o valor (triggers com `pg_net`), no mesmo dia. UUID de usuário e e-mail podem ser colados.

**Credenciais das donas (Sessão 90):**
- A marca `perfis.precisa_trocar_credenciais` e a data `perfis.troca_exigida_em` **só são escritas por rota de servidor com service role** (ou por SQL do Iorran). `perfis` tem RLS ligada e só a policy SELECT do próprio perfil: nenhuma policy de INSERT/UPDATE. Nunca criar uma. Nunca guardar essa marca em `user_metadata` (a própria pessoa grava); vai em coluna de `perfis` e, para o que é do servidor, em `app_metadata`.
- Flags no Auth (`app_metadata`, só o servidor grava): `troca_credenciais_email` (rastro da retomada), `troca_so_senha` (modo só senha do reset) e `credenciais_proprias` (a dona já escolheu o próprio e-mail). Ver o Handoff Sessão 90.
- Toda rota que mexe em usuário do Auth: valida o token (`auth.getUser`), **nunca recebe `user_id` do corpo**, lê o perfil com o token do usuário (RLS), recusa conta `global`, loga só código e status do erro, nunca senha nem e-mail. Rota exclusiva do painel global usa `autorizarGlobal` (o helper `autorizarAdminEstabelecimento` deixa a dona passar).
- Ordem do reset: **liga a marca primeiro, troca a senha depois**, para a dona nunca ficar com senha provisória sem a troca obrigatória.
- Senha: 8+ caracteres, maiúscula, número, símbolo, nada óbvio, repetida duas vezes, validada na tela **e** repetida na rota. A senha provisória (12 caracteres, sem 0 O 1 l I) é devolvida uma única vez, com `no-store`, e fica só em estado React.
- **Modo `aviso` x `bloqueio`:** "Exigir troca" dá o aviso (30 dias); "Resetar acesso" bloqueia na hora. Migração das donas com e-mail fictício = "Exigir troca", nunca reset. O bloqueio é só de tela (a RLS não conhece a marca) e as sessões abertas da dona não são revogadas no reset (sem API por `user_id` no `auth-js` 2.108.2). Aceito.
- Ativar uma dona por vez, avisando antes por WhatsApp. Testes de login em tenant de teste (`junior` em produção, `teste` em staging).

**Checklist de conferência de uma mudança de segurança:**
1. Listar todas as policies das tabelas tocadas, nos dois bancos (e `relrowsecurity`).
2. `has_function_privilege` para cada função nova ou alterada.
3. `set role anon;` + consulta para provar o que o anônimo enxerga.
4. Teste manual do fluxo real da cliente no localhost contra staging e depois no tenant de teste em produção (`junior`/`acolhe`), incluindo pelo menos: agendar, trocar de horário pelo "Editar", cancelar, declarar sinal e anexar comprovante.

---

## 12. Tema e cores (regras da Sessão 74)

- Todo elemento com fundo `bg-primary` usa `text-on-primary` — nunca `text-white`. Vale também para filhos com classe própria de texto. Botões semânticos (`bg-green/red/blue/amber-600 text-white`) ficam com branco fixo de propósito.
- Texto sobre `bg-card` usa `text-on-card` (não `text-body`, pensado para o fundo `surface`).
- Overlay de modal usa `bg-overlay/NN`, nunca `bg-primary/NN`.
- Fundo derivado da cor de destaque por `color-mix` precisa de token com versão noturna (padrão `var(--destaque-suave, color-mix(...))`).
- Cor nova no `/admin` sempre por token do tema ou escala do Tailwind — nunca hex em `style` inline, senão escapa do modo noturno.
- Modo noturno existe só no `/admin`, nunca no fluxo público. Tenant novo é conferido também com o modo noturno ligado.
- Aviso de recusa de ação dentro de uma aba não usa o `setErro` global do admin (ele desmonta a aba aberta); usar aviso local.
- Tema novo é moldado primeiro no tenant `css` de staging (ver regra própria abaixo).
- **Cor funcional de status (verde, âmbar, vermelho e a do dia com acréscimo) fica fora do override de tema** (`THEMING.md`); qualquer cor nova no calendário precisa de entrada no bloco do modo noturno de `app/globals.css` e não pode colidir com o verde e o laranja do prazo de manutenção.
- **Âmbar do acréscimo (Sessões 95 e 96):** texto sobre fundo âmbar claro fixo usa `text-amber-900` (nunca `text-body`, que vira claro no noturno). Na grade do `/admin` o horário com acréscimo usa `CLASSE_GRADE_ACRESCIMO` (borda escura + `bg-amber-100`, a mesma do dia no calendário), distinta do âmbar de "Antecedência"; a classe mora em `lib/acrescimoDomingo.js` para o Agendar e o Alterar nunca divergirem.

---

## 13. Alertas e avisos (regra da Sessão 75)

Todo popup, aviso, confirmação ou lembrete novo (e mudança relevante num existente) passa por esta classificação **antes** de virar código, e o prompt do Claude Code já sai com a classificação decidida:

- **Preferência** — só informa ou lembra, e a dona pode dispensar sem risco. Nasce com interruptor no bloco "Alertas e avisos" de Regras de negócio (`ConfiguracoesSalao.js`), **ligado por padrão**, coluna própria em `estabelecimentos`, salvamento otimista com `.select("id")` e patch no pai via `onAvisoAtualizado(coluna, valor)`.
- **Proteção** — evita erro com dado real, conflito de agenda, perda de agendamento ou cobrança errada (colisão, fora da janela, prazo mínimo, confirmação de cancelamento, ação destrutiva), ou é de segurança da conta (cartão de troca de credenciais, aviso de limite de tentativas). Fica fixo, sem interruptor. São proteção: o aviso do adicional de domingo, a confirmação "Remover acréscimo de domingo?" e a confirmação "Fora da janela de agendamento" do Alterar (Sessão 96). Confirmações em sequência aparecem uma de cada vez (janela primeiro, depois remoção), e "Voltar" em qualquer uma cancela o salvamento.
- **Decisão da dona por reserva** (Sessão 96) — a caixa "Acréscimo de domingo (N%)" não é aviso nem preferência: é uma escolha sobre aquela reserva, sem interruptor.
- **Texto da dona para a cliente** (ex.: `alerta_mensagem` de serviço/categoria) — nunca aparece no `/admin`, sem precisar de interruptor.
- Na dúvida entre preferência e proteção, fica como proteção até decidir junto com o Iorran.
- O interruptor é escrito como "mostrar X" (ligado = aparece), mesmo quando a coluna antiga diz "pular" — a inversão fica só na tela e documentada em comentário.
- Todo popup novo entra classificado no inventário do painel global (`app/painel-global/AbaAuditoria.js`: `FLAGS_ALERTAS` se tiver coluna, `CATALOGO_SEM_CONTROLE` se for fixo), para o catálogo não ficar defasado.
- Coluna nova do bloco segue a regra de `estabelecimentos`: entra em `lib/estabelecimento.js` e `lib/perfil.js`.

---

## Regra: checagem de base antes de nova branch

Antes de todo `git checkout -b`, rodar `git branch` (sem argumento) **e `git status`** pra confirmar em qual branch você está e se não sobrou nada não commitado. Só criar a nova branch se estiver em `main` limpa — se estiver em outra branch de trabalho, ou se `git status` mostrar mudanças não commitadas (mesmo em `main`), decidir explicitamente: commitar/mergear primeiro, ou nomear a nova como dependente da atual (ramificação consciente, não acidental). Incidente real (Sessão 21/09): uma branch nova foi criada a partir de outra que tinha trabalho não commitado da Laysla, e esse trabalho quase entrou junto no commit da Laryssa — só não aconteceu porque o `git status` foi conferido antes do commit, não antes da criação da branch. A checagem de `git status` devia ter vindo primeiro.

**Incidente da Sessão 90:** `git checkout -b aviso-troca-30-dias` foi rodado com 14 arquivos do reset ainda **sem commit**; o Git levou as mudanças para a branch nova, e o commit do reset quase foi para a branch errada. Corrigido voltando à `reset-acesso-dona`, commitando lá e recriando a branch nova a partir do commit. **Regra:** Claude não manda `git checkout -b` enquanto o `git status` mostrar mudanças não commitadas da demanda anterior; antes, commit (e merge, se for o caso). (Exceção inofensiva: arquivos de controle `.md` colados antes da branch de fechamento.)

**Arquivo a mais no `git status` (Sessão 96):** quando aparece um arquivo que o handoff não lista, ver o diff dele antes de qualquer teste ou commit (era a troca de cor que faltava na lista, e entrou no commit).

## Regra: branches concorrentes no mesmo arquivo/bloco

Ao abrir uma demanda nova, checar se alguma branch ainda não mergeada em `main` toca o mesmo arquivo. Se tocar, preferir sequenciar (mergear a primeira até `main` + `staging` antes de começar a segunda) em vez de paralelizar — evita conflito de merge por divergência estrutural no mesmo bloco. Só paralelizar quando as branches tocam arquivos ou blocos claramente distintos. (Caso de 19/10: a demanda das categorias e a do egress mexem no upload de foto em `GerenciarServicos.js`; o egress vai primeiro. Sessão 93: `feature/ordem-foto-perfil` foi conferida por `git diff --stat` e não toca `GerenciarServicos.js`. Sessão 96: a lista de 1000+ ficou para depois do merge da pilha porque mexe no mesmo `page.js`.)

## Regra: comandos de merge/push rodados fora da visão do Claude Code

Sempre que um merge, checkout ou push for rodado no terminal sem passar por um prompt do Claude Code (ex: comandos de fluxo Git que o Iorran roda direto após receber do chat), avisar explicitamente no próximo prompt pra ele — algo como "um merge de staging aconteceu entre sua última leitura e agora, rodado por mim via terminal, branch X em Y". Evita o agente interpretar estado de Git inesperado (MERGE_HEAD, conflitos) como anomalia ou ação própria não lembrada.

## Regra: merge em `main` confere a `staging` antes

Antes de todo merge em `main`, rodar `git log main..staging --oneline`. A lista deve conter só os commits da demanda atual. Se aparecer commit de outra demanda, parar e decidir antes de publicar — a `staging` pode estar carregando trabalho ainda não validado. O inverso também acontece: `staging` atrasada em relação à `main` traz no merge da branch nova o trabalho antigo que faltava (inofensivo, mas precisa ser entendido antes de assustar). Antes do merge, conferir também que coluna ou função nova existe nos **dois** bancos, e que `git log HEAD..origin/main` volta vazio no topo da pilha.

## Regra: uma demanda por vez

Mesmo quando Iorran lança várias demandas de uma vez no início da sessão, Claude não deve organizá-las e emendar a fila sozinho. O fluxo correto é: declarar uma demanda, completar o ciclo inteiro (branch → raio-x → diff → teste → merge), e só então perguntar explicitamente se segue pra próxima da lista ou se a sessão fecha ali. Isso existe porque triagem de várias demandas de uma vez já causou perda de pendência sem ficar claro pra Iorran — algo parecia resolvido "no papel" sem nunca ter virado branch de verdade. Vale mesmo que pareça repetitivo perguntar a cada fechamento.

## Regra: teste rápido via celular

O localhost (`npm run staging`) está salvo como ícone na tela do celular de Iorran — dá pra testar mudanças visuais direto ali, sem precisar de push pra staging. Vale como primeira opção de teste pra ajustes de UI antes de subir pra staging de verdade. O endereço é `http://<IPv4 do computador>:3000/<slug>`, digitado com `http://` explícito (o navegador do celular às vezes troca sozinho para `https://`, que o servidor local não atende), com o celular no mesmo Wi-Fi do computador.

## Regra: teste que envolve disputa ou liberação de horário usa duas clientes

Mudanças que mexem em quando um horário é ocupado ou devolvido (troca de horário, cancelamento, expiração, criação de reserva) são testadas com **duas clientes diferentes**: uma libera ou disputa o horário, a outra confirma que ele aparece (ou não) para ela. Testar com a mesma cliente não prova a liberação, porque o app pode estar só escondendo o horário dela mesma.

## Regra: limpeza de branch ao fechar sessão

Toda branch de feature mergeada em `main` durante a sessão atual é apagada (local +
remoto) como parte do fechamento — não fica acumulando pra uma faxina futura. Por
branch, junto com os comandos de merge já entregues:

```bash
git branch -d nome-da-branch
git push origin --delete nome-da-branch
```

Branch que nunca teve push só precisa do `git branch -d` (o `push --delete` dá "remote ref does not exist", inofensivo). Branch de investigação sem
commits também é apagada no fechamento (Sessão 96: `adicional-domingo-troca-profissional`, apagada na hora). Nunca apagar `main` nem `staging` (branch
permanente — alias estável usado pelos triggers de webhook, nunca deletar). Essa rotina
cobre só as branches nascidas na própria sessão; o acúmulo histórico de branches antigas
já mergeadas (a maior parte da saída de `git branch --merged main` hoje) segue como item
de backlog à parte, tratado numa sessão dedicada de limpeza — não misturar os dois. Branches
de feature em fatias ainda não mergeadas **não** são apagadas no fechamento; quando a pilha é mergeada, todas saem juntas (Sessão 96: 13 branches do adicional).

## Regra: conferência de SQL staging → produção antes de fechar sessão

No fechamento de toda sessão que rodou algum SQL de schema (ALTER/CREATE, não limpeza de dados de teste), Claude lista de volta cada bloco de SQL rodado durante a sessão e confirma, um por um, se já foi replicado em produção — não basta ter sido "planejado" ou "confirmado em staging". Se algum ficou só em staging (esquecido, ou porque o merge foi adiado), isso é reportado explicitamente como pendência de schema em aberto no handoff, nunca deixado implícito. Motivo: coluna nova sem réplica em produção passa despercebida até alguém mexer justamente naquele campo — vira bug fantasma, difícil de diagnosticar, porque o código já assume que a coluna existe nos dois ambientes. Na Sessão 96, a mesma consulta de conferência rodou nos dois bancos e saiu idêntica, linha por linha.

## Regra: decisões de negócio ambíguas exigem exemplo concreto, não princípio abstrato

Quando uma regra de negócio nova tem zona cinzenta (ex: "isso conta como cancelamento do salão ou não?"), pedir ao Iorran um exemplo real do dia a dia em vez de insistir numa pergunta abstrata — a resposta concreta costuma resolver a ambiguidade de forma mais rápida e precisa que alternativas de múltipla escolha genéricas. Quando a decisão afeta a rotina das donas (ex.: expirar ou não uma reserva), vale ouvir as próprias donas antes de implementar — foi assim que a expiração automática de reservas foi descartada na Sessão 71. Antes de decidir sobre uma funcionalidade "que as donas usam ou não", medir o uso real em produção com um `SELECT` (caso da Sessão 75: todas as donas reais etiquetam, nenhuma usa mês restrito; caso da Sessão 90: nenhum salão tem regra geral de sinal desligada com regra especial cobrando; caso da Sessão 96: nenhum salão real tem 2+ profissionais ativas, e a troca de profissional saiu da pilha). Sessão 93: a conta do adicional foi fechada com o exemplo do Iorran (130 + 20 = 150; 30% = R$ 195). Sessão 96: a caixa de negociação nasceu do exemplo dele (as 09:00 marcadas já foram, a cliente aceita as 14:00 com o acréscimo).

## Regra: tenant-modelo de tema em staging (slug `css`)

Antes de moldar a identidade visual (tema/CSS) de qualquer tenant novo, usar primeiro o
tenant fixo `css` (id 8 em staging, ex-`padrao-novo`) — nunca editar tema direto num tenant
que só existe em produção. Ele tem cadastro básico igual ao de um tenant novo (profissional,
5 etiquetas padrão, janela até 2027), sem catálogo nem serviços — por isso não serve para
testes que precisem de serviço vinculado a profissional (para esses, usar outro tenant de
staging com catálogo).

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

## 14. Recursos órfãos e inventário (regra da Sessão 82)

- Todo recurso novo (coluna, flag, texto padrão, sintaxe dentro de campo, constante por salão) nasce com a resposta para quem edita e onde: dona (conteúdo do negócio), painel global (identidade, cobrança, infraestrutura), código fixo documentado ou remover.
- A resposta entra no `INVENTARIO_RECURSOS.md` no mesmo fechamento da demanda. Nada novo fica só em SQL ou só em código sem entrada no inventário. (Sessão 96: as linhas 29 a 33 do adicional entraram no fechamento, depois do merge.)
- Texto padrão visto pela cliente final é neutro. Papel no código é por id, nunca por nome. Sintaxe especial dentro de campo de texto (`---`, `{marcador}`) só nasce com dica na tela ou editor estruturado.
- Hotfix por SQL para um tenant é aceitável, mas abre linha no inventário com o destino definitivo.
- Confirmar o deploy em Production antes de rodar SQL de dado que depende do código novo.
- Fechamento de sessão: revisar o inventário junto do `PENDENCIAS.md`.

**Regras de diagnóstico (Sessões 80 a 82, 93 e 96):**
- Precedência de exceções de horário: bloqueio pontual vence liberação; bloqueio fixo cede a liberação de data específica; liberação recorrente perde para qualquer bloqueio. Toda tela que mostra bloqueio segue a regra do motor.
- **Janela mensal vence liberação no `/agendar`** (calendário e motor, Sessão 93): liberação num mês fechado não abre horário para a cliente; no Agendar e, desde a Sessão 96, no Alterar do `/admin` (`modoLivre`, contexto `admin`) a dona abre qualquer horário e recebe o aviso ou a confirmação de "fora da janela". O calendário do `/agendar` abre dia vindo da agenda normal, de liberação com data e, desde `e5b1868`, de liberação recorrente de domingo **com acréscimo**; liberação recorrente comum continua sem abrir o dia no calendário.
- **Calendário em `modoLivre` sem `mesesJanela`** marca todo dia como fora da janela (fail-closed de `mesAgendavel`). Todo calendário da dona recebe o mapa de meses (causa do "tudo fora do expediente" no Alterar, Sessão 96).
- Teste visual de calendário e grade só em aba anônima ou Ctrl+Shift+R.
- Confirmar o ambiente de cada teste (staging ou produção) antes de ler o resultado; conferir o id da Laysla (5 em produção, 3 em staging).
- Janela mensal e restrição por período são camadas separadas; consultar as duas ao diagnosticar tudo fora do expediente.
- Nunca chutar nome de coluna: consultar o schema antes de escrever SQL. SQL sempre rodável, com ids reais, sem placeholder (exceção declarada: SQL de plantão por slug, onde o slug é o único valor a trocar e vem comentado).

## 15. Lições de processo (Sessões 76 a 82)

- **SQL de conferência com mais de um `select`:** colar o resultado de cada um; e prefixar colunas com alias em `join` (`id` e `nome` existem nas duas tabelas e dão erro de coluna ambígua).
- **Diagnóstico de "tudo fora do expediente" no Agendar do admin:** conferir se a etiqueta da cliente bate **por id** com a liberada (etiquetas de nome parecido existem) e só então suspeitar do código (as duas camadas, janela mensal e `restricoes_agenda`, já estão em §14).
- **Antes de commitar um `.md` de controle**, conferir a contagem de linhas do arquivo (`(Get-Content PENDENCIAS.md).Count`) e o resumo do commit: `git commit` mostrando centenas de linhas removidas é alarme. Motivo: na Sessão 80 o diff colado no lugar do arquivo reduziu o `PENDENCIAS.md` de ~311 para 28 linhas.
- **Claude Code em modo automático pode travar todas as edições** (classificador de permissões sem veredito, nenhum arquivo alterado; trocar o modo na sessão já aberta não resolveu). Saída que funcionou: autorizar no prompt, de forma delimitada, a aplicação por script em Node (só os arquivos listados, abortar se o trecho não aparecer exatamente uma vez, sem `next build`/`next dev`, sem encerrar processos).
- **Claude Code na nuvem:** o worktree dele pode estar atrasado (na Sessão 79 a branch `claude/...` não tinha os commits da Sessão 77). Pedir no prompt que a análise use `origin/main`.
- **Coluna de telefone difere entre tabelas:** `clientes.whatsapp` × `agendamentos.telefone`. Motivo: subconsulta com o nome errado não dá erro, vira referência à coluna externa e traz todos os agendamentos do salão (Sessão 79).
- **Diagnóstico de "agenda sumiu":** perguntar primeiro se a dona mexeu em exceções ou na janela mensal pouco antes; pedir print com horário; **testar com a sessão de dona logada no navegador** (causa real da Sessão 80); conferir a janela mensal (mês sem registro = fechado); rodar a consulta de `ausencias_log` (Handoff 79). O registro não tem tela nem limpeza automática.
- **Localhost e branches (Sessão 80):** trocar de branch com o servidor ligado pode dar 404 em `/<slug>/admin` (parar o servidor, apagar `.next` e subir de novo); trocar de branch troca o visual servido (o roxo antigo volta na `main` se a branch visual não estiver mergeada). Baselines de eslint em §2.

## 16. Regras acumuladas das Sessões 83 a 89

- **Mutação sempre com `.select()` e checagem de 0 linhas**; datas com `new Date(ano, mes-1, dia)`, nunca de string (Sessão 86).
- **Edição de tabela sem policy de UPDATE** (ex.: `ausencias`): insert das novas, delete das antigas conferindo a contagem, compensação apagando as novas se falhar. Se um dia existir RPC atômica, trocar (Sessão 86).
- **Dado de etiqueta do cliente no wizard do admin: sempre por id**, nunca por nome (Sessão 81).
- **Texto padrão para cliente é neutro**, masculino como padrão para clientes de qualquer gênero; varredura geral de textos é demanda à parte (Sessão 88).
- **Todo recurso novo** (coluna, flag, texto, constante) segue o §13 (preferência com interruptor ou proteção fixa) e entra no `INVENTARIO_RECURSOS.md` (§14).
- **Cadastro duplicado de cliente:** a lixeira de clientes é invisível para telas e filtros (`excluido_em is null`); junção só pela dona, com Desfazer; ver `lib/duplicidadeCliente.js` (Sessão 88).
- **Alterar nos Pendentes e confirmação (lido na Sessão 96):** o Alterar **confirma** o pendente, mas num segundo UPDATE: `handleAlterar` grava data/horário/serviço pela RPC e, depois, se o status era `pendente` ou `aguardando_sinal`, chama `handleConfirmar` (janela, prazo mínimo, etiqueta) e `executarConfirmacao` faz o `update({status:"confirmado"})`. Notificação e Calendar disparam duas vezes, e se um gate parar a confirmação a data já mudou e o pendente continua pendente. A mensagem de alteração sai antes da confirmação. Juntar as duas operações é decisão aberta (`PENDENCIAS.md`).
- **Serviço agregado (casadinha), Sessão 89:**
  - Uma linha em `agendamentos` com quatro colunas de snapshot (`servico_agregado_id` guarda o id do serviço agregado, `agregado_nome`, `agregado_preco_centavos`, `agregado_duracao_min`); editar o combo depois não reescreve o histórico.
  - O tempo do agregado só entra na duração quando nenhum profissional ativo do serviço tem `modo_horario = 'fixo'` (agenda de janela soma; agenda fixa é informativa). Quem faz a conta é o gatilho `trg_set_duracao_min` (teto 720), nunca o front sozinho.
  - O sinal é valor fixo e não muda com o agregado; o preço total é o do serviço mais o do agregado.
  - Manutenção, segunda data e manutenção de outro salão não aceitam agregado nos dois sentidos, de propósito. A regra é uma só, `servicoAceitaAgregado`; manutenção + agregado é demanda futura em branch própria.
  - Criação pública passa por `agendamento_criar_com_agregado`; alteração isolada por `agendamento_alterar_agregado`; trocar o serviço limpa o agregado; remarcação com sinal pago valida o agregado antes de cancelar a linha antiga (409).
  - Teste de limite de agenda de janela: reserva que atravessa a meia-noite é recusada pelo banco e invisível para o motor; é uma divergência conhecida, documentada em `it.fails`.
  - Trocar o agregado de uma reserva com acréscimo de domingo preserva o percentual gravado (Sessão 96); o resumo do modal mostra o total da reserva como está gravada.

## 17. Regras da Sessão 90 (Pix da dona, segurança de login e egress)

- **Situação do Pix pela dona:** coluna própria `agendamentos.situacao_pix_dona` (`pendente_pagamento` ou `pago`), nunca `status`; só Pix manual efetivo, agendamento sem cobrança do AbacatePay e em estado cobrado ou já marcado; fila em três degraus em função pura testada (`lib/situacaoPixDona.js`). A tag da dona sobrepõe a derivada (comprovante, declaração, aguardando sinal), nunca o Pix confirmado pelo AbacatePay. Código e regra em `INVENTARIO_RECURSOS.md`, linha 26.
- **Quando a decisão da dona e o dado do gateway convivem, cada um mora na sua coluna** (a dona não reescreve o dado do gateway nem da cliente; o estado "original" volta com a opção de desfazer).
- **Edição só onde há cobrança:** o botão e o menu aparecem só nos estados cobrados ou já marcados; "nenhum sinal cobrado" e "sinal desligado" ficam fixos (a dona que mudar de ideia avisa a cliente por fora).
- **Segurança de login das donas:** ver §11 ("Credenciais das donas") e o Handoff Sessão 90 (protocolo de plantão). Inventário: linhas 27 e 28.
- **Quando o que o Iorran viu na tela não bate com o código lido, conferir branch, ambiente e servidor antes de diagnosticar** (§4).
- **Plantão de suporte:** quando um período de suporte a donas é combinado, o handoff traz o protocolo com SELECT de acompanhamento, casos de suporte e o que nunca fazer (§5).
- **Cota do Supabase:** conferir Usage antes de crescer o consumo (fotos, logs); foto de dona entra comprimida (§6). Decisão de 19/10: corrigir por código e script, sem pedir reenvio às donas (§7); regra para scripts com service role em §6.

## 18. Regras da Sessão 93 (categorias retráteis e adicional de domingo)

- **Linha retrátil por categoria (`GerenciarServicos.js`):** miniatura, placeholder e feedback de salvamento ficam sempre visíveis; ajustes de zoom e posição, upload e remover foto ficam dentro da linha, com uma categoria aberta por vez. Padrão de toggle dentro de bloco aberto: `mensagemExpandida` em `ConfiguracoesSalao.js`.
- **Exceções de Horário:** a aba "Horários" não existe no topo; "Horários" e "Exceções de Horário" são sub-abas da edição de cada profissional (`GerenciarProfissionais.js`). Exceções são **por profissional**. Liberar horário tem os modos "Um dia específico", "Vários dias num período" e "Domingo com acréscimo" com segundo menu (Um domingo, Vários domingos num período, Todos os domingos).
- **Liberação marcada com `acrescimo_domingo`** tem card próprio ("Domingos com acréscimo") e nunca aparece nas listas de Liberações nem de Recorrentes; editar um item do card mexe só nas linhas marcadas, e editar uma liberação comum mexe só nas sem marca. A marca nunca se perde na edição porque o select da tela a traz e vem sempre de `coletarLinhas`.
- **"Todos os domingos"** grava linha `recorrente` (`dia_semana` 0, `data_inicio` e `data_fim` nulos, sem `grupo_id`), uma por horário, e depende da janela mensal para saber em quais meses a cliente vê o domingo. Desde `e5b1868` (em produção desde 28/10), o calendário do `/agendar` abre esse domingo em âmbar, e os horários com acréscimo ficam âmbar na grade com a legenda "Horário com acréscimo".
- **Raio-x que diverge de outro raio-x ou do que o Iorran vê:** ler o código antes de afirmar (Sessão 93: um raio-x disse que o calendário tinha um selo de "liberado", outro disse que não; valeu o mais recente, lido em `origin/main`).
- **Feature em fatias e propostas pendentes:** as propostas de remarcação, pares e profissionais só viram código depois de o Iorran confirmar cada uma.

## 19. Princípios de trabalho e aprendizados (Sessões 93 a 95)

### Como este protocolo envelhece
- Cada regra daqui nasceu de um incidente ou de um acerto, e o protocolo não vale mais do que o caso que o originou. Quando um fato novo contraria uma regra, a regra muda, e o registro diz o que dizia, o que se descobriu, o que muda e a sessão. Exemplos: o arredondamento do acréscimo passou de `Math.round` para arredondar para baixo (decisão do Iorran, Sessão 95); "nunca recalcula agendamento existente" ganhou a exceção da remarcação e da alteração; o baseline do eslint de `FormularioAgendamento.js` era 1 erro e são 2; o percentual padrão passou de 50 para 40 (Sessão 96).
- A humildade técnica vale para os dois lados. O Iorran pode estar enganado sobre um dado do negócio, e o Claude pode estar enganado sobre o código, o banco ou a tela. Quem percebe o erro diz na hora, sem defender a versão anterior, e a correção vai para o handoff. Hipótese do Claude é chamada de hipótese, e o que se leu é distinguido do que se supôs.
- O app deixou de ser um protótipo e é ferramenta de trabalho das donas. Isso nasceu do jeito de trabalhar, e não de um recurso: raio-x antes de código, um passo por vez, diff lido, teste antes de commit, "sem prova" declarado, SQL em staging antes de produção, saída colada conferida. O que funciona se mantém; o que deixa de funcionar se reescreve.

### Dimensionar antes de começar
1. **Pedido que toca preço, duração ou disponibilidade nasce em fatias.** Antes do primeiro código, um raio-x lista todo ponto que calcula ou mostra aquele dado e propõe a divisão. O adicional de domingo entrou como "50% nos domingos" e virou 13 branches porque o app não tinha um conceito de preço: oito lugares o calculavam sozinhos. O tamanho aparece no raio-x e não no meio do caminho.
2. **Dado calculado em vários lugares ganha uma função pura única** (`valorTotalAgendamento`), e o arredondamento mora em um só ponto (`precoComAcrescimo`). Quem exibe o valor chama a função, nunca refaz a conta.
3. **Pilha de fatias não vai à `main` pela metade.** Se uma fatia abre comportamento que só se fecha em outra, o merge é um só, no fim, e o prazo da pilha é medido: enquanto ela existe, evitar outras demandas em `FormularioAgendamento.js` e `page.js`, e trazer a `main` para o topo antes do merge.
4. **Fórmula que mora no app e no SQL é dívida consciente.** O cron de conclusão repete a conta do app. Os dois lados levam comentário apontando para o outro, os testes usam os mesmos números (1005 com 50% dá 1507; 1605 dá 2407), e mudar o arredondamento exige mudar os dois no mesmo dia. Antes de substituir uma função de produção, ler `pg_get_functiondef` e guardar a definição antiga como rollback.

### Banco: padrão do aviso sim ou não
5. Para gravar um dado derivado na criação ou na alteração de reserva: o app diz só sim ou não (`set_config` local), um gatilho `BEFORE` lê o percentual do salão e grava na própria linha, e uma RPC nova chama a função existente, sem alterar a que está em produção. O percentual nunca vem do cliente. Não usar UPDATE depois da criação, porque notificação e Google Calendar disparam em todo UPDATE, e a mudança tem de caber no mesmo UPDATE da data.
6. **Teste de banco sem rastro:** bloco `do $$` que cria, altera, mede e termina em `raise exception 'RESULTADO ...'` intencional. Simular dona com `set_config('request.jwt.claims', ...)`. Escolher salão e serviço por slug ou condição, nunca por id (ids diferem entre staging e produção). O erro com a palavra RESULTADO é o sucesso do teste; qualquer outro erro se cola inteiro.
7. **Conferência única por bloco de SQL**, executada em staging e depois em produção, com o resultado esperado escrito antes. Todo SQL tem rollback comentado.

### Código e tela
8. **Select da lista do `/admin` é infraestrutura.** Um erro nele (coluna ausente num dos bancos) derruba a tela de todas as donas. Dado extra que só um card precisa vem por busca preguiçosa ou em lote, nunca por embed novo no select principal. O código que pede coluna nova só vai à `main` depois do SQL nos dois bancos.
9. **Número parcial nunca aparece na tela.** Enquanto a busca dos ajustes de preço carrega, ou se ela falha, o componente não mostra valor e mostra um aviso curto. Toda busca assíncrona que trava um botão tem tratamento de rejeição que o destrava. Busca em lote é tudo-ou-nada (`somarAjustesPrecoEmLote`): erro em um bloco devolve falha, nunca resultado parcial.
10. **Medir antes de decidir.** Um `SELECT` de uso real mudou decisões: três salões reais têm opções que ajustam o preço; a Laryssa tem agenda de domingo normal (o "dia misto" existe, como limitação conhecida); nenhum salão real tem 2+ profissionais ativas (Sessão 96); todos os salões estavam em 50% antes de apertar o teto do banco (Sessão 96).
11. **Teste de tela pelo caminho certo.** O Agendar do `/admin` e o `/agendar` são caminhos diferentes (um insere direto, o outro usa RPC). Antes de testar um recurso, confirmar qual caminho ele cobre, para um teste "sem efeito" não parecer defeito.
12. **Texto da cliente e texto da dona são diferentes.** A cliente nunca vê o percentual na tela; a dona vê. O percentual ainda viaja na resposta pública, o que é um vazamento pequeno, registrado, e não ocultável sem RPC nova.
13. **Cor funcional no `/admin` se confere nos dois modos** (claro e noturno), contra o token que o `globals.css` sobrescreve, e nunca por `text-body` sobre fundo de cor fixa.

### Trabalho com o Claude Code e com o chat
14. **O relatório do Code é resumo e pode omitir uma correção pedida.** Cada correção pedida se confere por diff ou por busca de texto, e o pedido inclui "mostre o trecho final".
15. **Raio-x que diz "não consegui cobrir" é o que decide a próxima etapa.** Funções de banco que o raio-x não leu são lidas no banco antes de qualquer desenho que dependa delas.
16. **O desenho descrito pelo Iorran é a especificação.** O Claude pode recomendar outro e declara que o está fazendo. Print com algo faltando vale como relatório de defeito, mesmo quando o código estava "como combinado".
17. **Sessão longa pede handoff com o SQL completo dentro**, para o trabalho não depender do histórico do chat. Fechar depois de uma fatia grande, ou deixar nota de continuidade.
18. **Comandos de apoio:** ver §2 (prefixo `controle-`, `git add -N`, acentos do `Out-File`).
19. **Atalho de escopo.** Reduzir o escopo para fechar mais cedo só vale quando o que fica de fora não toca em dinheiro nem em dado de cliente. O resto se entrega em fatias, nunca cortado. Cortar o que **ninguém usa** (múltiplas profissionais, medido) é diferente de cortar por pressa.

## 20. Aprendizados da Sessão 96 (fim do adicional de domingo)

1. **A tela real do Iorran é a prova.** Três correções de rota vieram dos testes dele: a grade do Alterar precisava do dia inteiro, a caixa de negociação devia existir só em domingo oferecido publicamente, e a grade em mês fechado não podia dizer "Disponível". Nenhuma apareceria em teste automático.
2. **Defeito antigo ou novo se prova com `git stash`, não com suposição.** O calendário do Alterar todo "Fora do expediente" parecia culpa da fatia nova; com as mudanças guardadas, continuava igual. A causa era um dado que nunca chegava ao calendário (`mesesJanela`).
3. **Antes de apertar uma regra do banco, medir o que ela recusaria** (linhas existentes e configurações que a alimentam). A constraint só de domingo entrou sem nenhuma reserva recusada porque as duas consultas vieram antes.
4. **Dependência de efeito que recarrega sozinha faz a tela piscar.** O Code pôs a lista de agendamentos nas dependências de uma consulta; com o refresh de 60 s, a grade do Alterar piscaria e refaria consultas. Pegue no diff, antes do commit: o que só pinta vai para o render.
5. **Refatorar uma tela que funciona exige prova de equivalência**: explicação ponto a ponto, eslint igual e reteste da tela antiga no navegador (Agendar, ao mover a grade para `lib/gradeAdmin.js`).
6. **Cabeçalho descreve o que está gravado; a escolha em curso aparece em outro lugar.** O resumo do agregado seguia o agregado escolhido na tela enquanto o resto do cabeçalho descrevia a reserva gravada.
7. **Subir para a produção não é lançar.** Recurso que só age quando a dona configura (marca de domingo) pode ir à `main` adormecido; o anúncio espera a conversa com a dona e a consulta jurídica. O que todas veem de imediato é listado antes do merge.
8. **Caminho difícil de testar vira "sem prova" com o roteiro para provar** (remarcação paga: marcar `abacatepay_pago_em` por SQL numa reserva de staging), nunca "testado" por dedução.
9. **A `main` anda durante uma pilha longa** (fechamentos de sessão). O topo recebe a `main` antes do merge, e `HEAD..origin/main` vazio é a prova.

*Última atualização: 28/10 (Sessão 96 — adicional de domingo em produção; §1 condição de parada no prompt do Code, nota de continuidade, `HEAD..origin/main` antes do merge da pilha, deploy da `staging` antes da `main` e teste no `junior`; §2 provar defeito antigo com `git stash`, baseline do eslint de `FormularioAgendamento.js` (2) e prefixo `controle-`; §3 padrão do aviso sim ou não, regra do banco que protege o consumidor, rollback lido em produção, coluna que a rota sempre grava; §4 decisão do Claude derrubada pelo teste, repetir o entendimento, alcance de pedido de produto, arquivos grandes como arquivo; §5 staging guarda dados de teste; §6 lista sem limite; §7 tela da dona é modo da dona, múltiplas profissionais em manutenção, mês fechado sem horário aberto, regras do adicional reescritas (padrão 40, percentual gravado, arredonda para baixo, recalcula na remarcação e na alteração, caixa de negociação, limite no banco); §8 libs e RPCs novas; §10 efeito com dependência que recarrega, testes (112 e 90 + 1 `it.fails`), refatoração com prova de equivalência; §11 acréscimo e o navegador; §12 âmbar do acréscimo; §13 confirmações de remoção e de janela como proteção e caixa como decisão da dona; §14 contexto admin no Alterar e calendário sem `mesesJanela`; §16 Alterar confirma num segundo UPDATE; §19 incorporado do Handoff 95; §20 aprendizados da sessão). Antes: 22/10 (Sessão 93 — categorias retráteis e adicional de domingo em fatias; §1 feature em fatias; §2 baselines e `Select-String -LiteralPath`; §3 coluna aditiva do adicional e check de `tipo_registro`; §4 recomendação que contraria o desenho e pergunta sobre lei; §5 branch de fechamento sai da `main`; §6 teste que grava dado e aviso de cota; §7 princípios do adicional; §8 `lib/acrescimoDomingo.js`; §9 a nuvem só enxerga `origin`; §10 teste de regressão de dados do motor; §11 `ausencias` com leitura anônima; §12 cor funcional; §13 popup do adicional é proteção; §14 janela mensal vence liberação; §18 regras da sessão). 19/10 (Sessão 90, continuação — egress por compressão e script, regra para scripts com service role, não impor fricção às donas, cópia do projeto defasada, sequenciar upload antes das categorias). 16/10 (Sessão 90 — Pix da dona, segurança de login, branch entregue pelo Claude, diff nomeado, servidor em terminal separado, armadilha do `count`, UPDATE em `auth.users`, protocolo de plantão, aviso antes do bloqueio, credenciais). 15/10 (Sessão 89 — seção 16, um passo por vez, diff por arquivo, arquivos de controle completos, rótulo de banco, armadilhas do SQL Editor, Code local, deploy na Vercel, serviço agregado). 07/10 (Sessão 82 — seções 14 e 15, AGENTS.md, Code nunca escreve SQL; Sessão 75 — seção 13; Sessão 74 — seção 12; merge nunca junto do SQL de produção, coluna aditiva antes do código, Code sem `next build`/`next dev` com o servidor ligado, `git add ':(literal)...'`, rotação de segredo inclui triggers, medir uso real antes de decidir).*