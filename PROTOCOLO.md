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

**Antes de reescrever um arquivo grande:** olhar `git diff` ou trechos específicos primeiro, avaliar o impacto isolado, e alterar estritamente o necessário.

**Confirmação de execução:** Iorran sempre traz de volta o output real do que rodou no VSCode (git status, git log, resultado de commit/merge/push etc.) antes de Claude assumir que um passo deu certo. Claude nunca presume sucesso sem ver o output colado.

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

---

## 8. Ferramentas e arquivos-chave

- **Stack:** Next.js (App Router, JS), Supabase (Postgres + Storage + Auth + pg_cron + pg_net), Tailwind v4, Vercel (Hobby — atenção ao timeout de 60s).
- **Ambientes Supabase:** staging (`reserva-staging`) e produção (`pwlvjaenryzdkatmrhul`) — projetos separados, sequências de ID independentes.
- **Arquivos de controle:** `PENDENCIAS.md`, `QA_CHECKLIST.md`, `DEPLOY_CHECKLIST.md`, `NOVO_TENANT_CHECKLIST.md`, `THEMING.md`.
- **Libs-chave:** `lib/disponibilidade.js`, `lib/whatsapp.js`, `lib/particao.js`, `lib/cliqueFora.js`, `lib/checagemWhatsapp.js`, `lib/comprimirImagem.js`, `lib/temas.js`.

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

*Última atualização: 27/08 (sessão paralela de protocolo).*