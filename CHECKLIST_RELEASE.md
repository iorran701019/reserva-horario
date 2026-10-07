# Checklist de release — reserva-horario

Vale para todo merge em `main`. Roda antes do merge (staging) e de novo depois do deploy (produção). "SQL e schema" e "Deploy" são obrigatórios sempre; o teste por área é completo em merges que tocam schema ou vários arquivos, e só a área tocada em mudanças pontuais.

Regra de ambiente: o build (`npm run build`) é rodado pelo Iorran, nunca pelo Claude Code.

## 1. Antes do merge
- [ ] `git branch backup-main-antes-do-merge`
- [ ] Resolver conflitos com atenção a nomes de função duplicados (main x feature)
- [ ] `npm run build` local, rodado pelo Iorran — deve passar limpo antes de qualquer push pra main
- [ ] `git log main..staging --oneline` (depois de sincronizar a `staging`): só os commits da demanda atual. Commit de outra demanda: parar e decidir antes de publicar (Protocolo, "merge em `main` confere a `staging`")
- [ ] Toda coluna nova em `estabelecimentos` entrou nos DOIS selects (ver "Lição dos dois selects" abaixo)

## 2. SQL e schema
- [ ] **Passo 0 (obrigatório sempre): conferir as colunas.** Toda coluna nova da sessão existe no ambiente antes de testar a tela:
  ```sql
  select column_name, data_type from information_schema.columns
  where table_name = '<tabela>';
  ```
- [ ] Rodar SELECT de conferência e ALTER/CREATE em ações separadas no SQL Editor
- [ ] SQL sempre em staging primeiro, confirmado com SELECT; só depois replicar em produção
- [ ] **O merge nunca vem na mesma resposta do SQL de produção quando o código depende de schema novo** (Protocolo §3): primeiro o SQL de produção com o SELECT de conferência; o merge para `main` só na resposta seguinte, depois do resultado colado. Vale para a `staging` se o banco de staging ainda não tiver o SQL. Sem isso o push publica código que pede coluna inexistente e derruba o `/admin` (e o `/agendar`, quando a coluna está em `lib/estabelecimento.js`) com 42703
- [ ] **Coluna aditiva entra antes do código:** coluna nova nullable ou com default, que nada ainda lê, vai aos dois bancos no início da demanda — assim o merge nunca corre esse risco
- [ ] Confirmar RLS ativo nas tabelas novas (anon + authenticated), reconferindo `pg_policies`; não confiar em handoff
- [ ] `estabelecimento_id` difere entre staging e produção: resolver por slug/nome antes de SQL direcionado

## 3. Deploy na Vercel
- [ ] Variáveis de ambiente conferidas separadamente por ambiente (Production x Preview)
- [ ] Depois do push, o commit novo aparece como **Production** na Vercel (depois de qualquer Instant Rollback a promoção automática da `main` pode ter sido desligada; conferir que o push virou Production)
- [ ] Reativar "Vercel Authentication" (Deployment Protection) após demo/preview compartilhado
- [ ] Smoke test na URL real (não só local)

## 4. Teste pós-merge por área

### /admin
- [ ] Pendentes/Confirmados/Cancelados — criar, confirmar, cancelar 1 agendamento de teste; sub-toggle "Aguardando Conclusão" abre sem erro
- [ ] Painel: abas Dia, Lista e Mês abrem sem erro; clique no evento abre modal
- [ ] Histórico e Agendar abrem sem erro
- [ ] Clientes — busca, detalhe, histórico, anamnese (se aplicável), anotação livre
- [ ] Serviços — abre sem erro de coluna; criar/reordenar/apagar categoria
- [ ] Profissionais — horários e exceções (se mais de 1 profissional ativo)
- [ ] Regras de negócio — sinal/Pix, manutenção, fidelidade, Mensagens de WhatsApp
- [ ] Relatórios — sub-abas **Atividades** (pizzas de desfecho e de tipo de serviço, gráfico por dia/mês) e **Financeiro** (cards: Atendimentos concluídos, Cancelamentos, Receita do mês, Sinais recebidos, Sinais retidos (cancelados), Ticket médio); trocar de mês navega sem erro; números batem com um mês conhecido
- [ ] Assinatura (aba só aparece para salão com linha em `assinaturas`) — próximas faturas e histórico carregam; informar pagamento de uma fatura aberta (Pix) e conferir que o aviso/alerta da aba some ou muda; salão sem assinatura não vê a aba
- [ ] Login — logout + login de novo
- [ ] **Se o tenant tiver `bgHeader`/`botao` escuro:** conferir `bgCardAdmin` (cards e drawer mobile legíveis), `botaoAdmin` (botões cheios com texto legível) e `bordaAdmin` (toggle ligado/desligado distinguível) — regressão real encontrada na Laysla e na Laryssa (Sessão 21/09): texto escuro sobre escuro ou claro sobre claro sem esses três campos

### /agendar
- [ ] Identificação por WhatsApp (número novo e já cadastrado)
- [ ] Cadastro completo ou simplificado, conforme o tenant
- [ ] Wizard serviço → data/hora → confirmação, sinal via Pix
- [ ] Painel do cliente — cancelar, confirmar pagamento, novo agendamento, histórico

### /painel-global (login com papel `global`; navegação por menus suspensos)
- [ ] Abre a aba padrão (CRM) sem erro; `?aba=` troca para Agenda, Auditoria e Financeiro
- [ ] **Agenda** (calendário do tenant `acolhe-comercial`): carrega; clique em um evento abre o detalhe; "Entrar em contato" abre o WhatsApp; cancelar um agendamento de teste reflete no status
- [ ] **Financeiro:** lista de salões ativos abre; abrir um salão mostra assinatura e faturas; "Ativar assinatura" (salão sem assinatura) cria assinatura e gera faturas; "Gerar faturas até" um mês; "Confirmar pagamento" e recusa (com motivo) numa fatura informada; "Nota fiscal marcada como emitida" em fatura paga manual
- [ ] **Auditoria:** sub-abas Cadastro, Anamnese, Horários e Alertas abrem; alternar uma flag e conferir que o `/admin` do salão reflete
- [ ] **CRM:** quadro abre; mudar status de um lead; criar lead

## Lição dos dois selects de `estabelecimentos`
Toda coluna nova em `estabelecimentos` precisa entrar em DOIS selects, não um: `lib/estabelecimento.js` (`buscarEstabelecimento`, usado por /agendar e por contas 'global') E `lib/perfil.js` (`buscarPerfil`, usado por contas 'dono' no /admin). Esquecer o segundo foi a causa raiz de um bug real (fidelidade não aparecia pra conta dono).

Exceção (Protocolo §6): coluna que só rotas de servidor leem por embed próprio (ex.: `google_calendar_cor_id`, lida só pelo sync do Calendar) não precisa entrar nos dois selects.
