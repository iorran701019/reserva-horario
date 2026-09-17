# Pendências — reserva-horario

## Em aberto

### Segurança (prioridade alta)
- **RLS de leitura anônima em `agendamentos` — vazamento confirmado, não hipotético.** A policy `leitura de slots para anonimos` (SELECT, role `anon`, `qual = true`) devolve todas as colunas de todos os salões pra qualquer requisição sem autenticação, incluindo `nome_cliente` e `telefone`. Confirmado com teste real via `curl` usando a chave pública, em staging e em produção (retornou dados de 3+ salões, incluindo clientes reais). Mapeamento completo dos pontos de leitura anon feito na Sessão 64: grupo A/B/C (cálculo de vagas/disponibilidade) já migrado pra ler a view `slots_ocupados` (ampliada com `id` e `profissional_id`, sem nome/telefone) — mergeado na `main`. Falta: RPC por telefone pros pontos D-J (histórico/painel da cliente), RPC por `id` pros pontos K/L/M (status de sinal/cancelamento), e resolver os INSERT/UPDATE com `.select("id")` que hoje dependem do SELECT anon aberto pra não quebrar (isso bloqueia o fechamento definitivo da policy). Entra na auditoria RLS da semana que vem, com prioridade alta.
- Policy `"Público pode cancelar próprio agendamento"` (UPDATE, `agendamentos`) tem `qual = true` nos dois ambientes, sem checagem de dono — qualquer requisição anônima pode alterar qualquer linha, de qualquer salão. Ainda sem correção.
- Bug intermitente, alta prioridade: pergunta condicional (filha) às vezes salva com `pergunta_pai_id`/`opcao_gatilho_id` NULL mesmo com o checkbox marcado — reproduzido em produção, causa raiz não encontrada. Ver `Handoff_Bug_Pergunta_Condicional_Nao_Salva.md`.

### Julia — onboarding (Sessão 62)
- Decidir `modo_horario` do profissional (`'janela'` vs `'fixo'`) na conversa presencial e atualizar a linha em `profissionais` — hoje está em `'janela'` só como placeholder.
- Confirmar com a Laysla o valor real do serviço "APLICAÇÃO COM DECORAÇÃO - SEMI ELABORADA" (id 82, hoje R$1,00 em produção). Atualização Sessão 64: a Laysla indicou que é um acréscimo de R$10 sobre outro serviço, não um serviço à parte — investigar se ele deveria ser uma opção do sistema de "perguntas de adicional" em vez de um item separado do catálogo. Decidir também sobre as 2 linhas "Manutenção vinda de outra profissional" sem categoria — só então replicar (ou não) pra Julia.
- Testar ao vivo, com a conta Google da Julia, a lista de eventos ignorados na importação do Calendar (Sessão 62) e garimpar manualmente os que forem atendimento real.
- Limpar os 3 clientes fictícios (Maria Julia, Joana da Silva, Francine Souza) e os 12 agendamentos de demonstração em **produção**, assim que a apresentação for aprovada.
- Confirmar merge de `fix/lista-ignorados-import-calendar` e `fix/equipe-acordeao` pra `main`, se ainda não tiver sido feito.
- Opcional: apagar o tenant `padrao-novo` de staging ou mantê-lo como referência permanente do tema padrão.

### Laysla — financeiro (Sessão 64)
- **Decisão de negócio:** relatório financeiro de agosto e setembro/2026 tratado como não confiável (histórico contaminado por 64 agendamentos importados do Google Calendar sem vínculo — `finalizado=false`, nunca entram no relatório — mais edições manuais de valor não investigadas a fundo, mais receita de curso dado a outras manicures, que o sistema não rastreia). Decidido não corrigir retroativamente. Medição "oficial" recomeça em outubro/2026, com todos os agendamentos feitos integralmente pelo app e conclusão em tempo real. Comparação entre a percepção da Laysla e o relatório do app prevista pra meados de outubro.
- Os 64 agendamentos importados de ago/set ficam como estão (sem vínculo, sem `finalizado=true`) — ela pode vincular manualmente pelo modal se quiser, mas isso não é mais prioridade do produto.
- **Atenção pra outubro:** orientar a Laysla a não editar/vincular nada de agosto ou setembro depois que outubro começar — isso não entra no relatório de outubro (a data do agendamento continua sendo a original), mas pode confundir a comparação prevista pro meio do mês.
- Pendente: conversa presencial pra reconciliar o valor de setembro que ela tinha em mente (R$800 numa conversa, R$1.600 em outra, referente a curso dado a outras manicures) — número ainda inconsistente, não fechado.
- Se ela quiser rastrear receita fora de agendamentos (cursos, etc.) no relatório no futuro, é pedido de funcionalidade nova, não correção — avaliar depois se ela confirmar interesse.

### CRM Comercial — fase 1 (Sessão 63)
- Testar ao vivo em staging (nada foi testado no browser): arraste entre colunas, select de status no celular, cadastro rápido com tag nova, detalhe + interações, popup de perda e reabertura.
- Testar o gatilho de demonstração: sucesso (agendamento termina `confirmado` no Painel do `acolhe-comercial`), horário ocupado (23P01), e os dois rollbacks (update do lead falhando → agendamento apagado; promoção a `confirmado` falhando → agendamento apagado + lead revertido).
- Decidir se o push "Pendente: {nome}" disparado pelo insert transitório da demonstração incomoda (só chega a quem ativou notificação no tenant `acolhe-comercial`).
- Schema do CRM (`leads`, `tags`, `lead_tags`, `interacoes` + RLS), tenant `acolhe-comercial` e profissional existem **só em staging** — replicar antes de qualquer ida pra produção.
- Conferir as decisões de implementação listadas no handoff da Sessão 63 (trecho do card, `ultimo_contato_em` automático, `data_conversao`, Convertidos no Follow-up).

### Dados de teste a limpar
- Staging, Laysla (`estabelecimento_id=3`): vários lotes nunca limpos — `Teste Aguardando Confirmação`, `Teste Editar no Histórico`, `Teste Sinal - Aguardando Conclusão`, `Teste Sinal - Editar Histórico`, `Teste Sinal - Sem Valor Registrado`, `TESTE QA - Sinal Pago`, `TESTE QA - Sem Sinal`, `TESTE QA - Marca Editado`. Os dois "Molde F1" da cliente `xuxa` são dado pré-existente — não apagar.
- Salão de Teste (staging): setembro e outubro/2026 gravados como `'fechado'` em `janela_agendamento_meses` (efeito colateral de teste da Sessão 57).
- Salão de Teste (staging, id 1): `sinal_valor_centavos`/`sinal_chave_pix` preenchidos com `sinal_regra` desligado — residual da marca Acolhe.
- Salão de Teste: clientes `Teste Logo Rodape` e `Teste Anamnese Rodape`.
- Lixo de teste (`Cancelamento: {nome}`) em `pendencias_admin` de staging.

### Configuração retroativa pendente
- Etiquetas padrão (5) nunca criadas para: Valéria (produção), e Flávia/Junior/Valéria (staging) — só a Laysla tem em staging. Valéria (produção) fica com o checkbox de sinal obrigatório pra "Lista de Bloqueio" desabilitado até isso ser feito.
- Ocultar preço/duração: configurado só pra Laysla e Flávia — Junior (produção) ainda não foi ajustada, decidir com o Iorran antes.

### Bugs conhecidos
- `buscarAgendamentos` (`page.js`) usa `duracao_min` do join com `servicos` em vez da coluna própria de `agendamentos` — mesma inversão já corrigida em `buscarFechados` (Sessão 12/09), precisa de raio-x e correção própria.
- `jaPendente` nunca é passado ao `BlocoConfirmacaoPix` pelo wizard de agendamento — edição de agendamento pendente reinicia a janela do protocolo sem necessidade.
- `calendar_import_ignorados` existe em staging mas não em produção — possível quebra da importação do Google Calendar lá, não confirmado na prática.
- Segundo comprovante Pix enviado com a linha já em `pendente` não faz `UPDATE` — não grava o valor do sinal nesse caso.
- Remarcação no fluxo manual (não-AbacatePay) cancela e recria a linha; a nova só recebe `sinal_valor_centavos` quando a cliente declarar o pagamento de novo.
- Badge de fidelidade só recalcula depois de reabrir a ficha do cliente, ao editar um concluído.
- Marcar "Não compareceu" sobre um item já concluído corrige o sinal, mas nenhuma tela mostra essa marca depois — o item vira cancelado e o botão "Editar" some desses cards.
- Sem backfill retroativo de `editado_manualmente_em`: concluídos manuais antes de 14/09 não aparecem marcados como "Editado" no Histórico.
- Aviso de React pré-existente: "Cannot update AdminPage while rendering ConfiguracoesSalao" em `salvarMes`.
- Seletor "Meses editáveis" mostra "3 meses" mesmo quando o alcance real é 4.
- Erro HTTP 400 recorrente no console, origem ainda não identificada.
- Dívida técnica de tipos: `ConfiguracoesSalao.js` (`servicoManutencaoExternaId` sem `String()`) e `ModalVincularCliente.js` (`patch.servico_id` grava string crua) — inofensivo hoje.
- Bug de navegação por voltar físico a partir do Pix: modo edição não investigado ao vivo (`sairDaEdicao` deveria levar de volta ao Pix); no fluxo novo sem edição há toques "mortos", mexer no mecanismo tem risco desproporcional ao ganho.
- Sincronização de colunas entre `lib/estabelecimento.js` e `lib/perfil.js` — as duas listas já divergem em vários campos.
- Divergência de `roles` na policy `"Público pode cancelar próprio agendamento"` entre staging e produção — confirmar se é intencional (relacionado ao item de segurança acima, mas registrado à parte por ser sobre `roles`, não sobre a condição `qual`).
- **Importação do Google Calendar sempre grava `finalizado=false`, inclusive quando o vínculo com cliente/serviço é feito depois** (manual pelo modal, ou automático quando o texto casa com uma cliente já cadastrada) — atendimentos importados e concluídos ficam permanentemente fora do relatório financeiro e de outras telas que exigem `finalizado=true` (contagem de "cliente nova", painel da cliente). Correção investigada e considerada segura (Sessão 64: incluir `finalizado: true` no UPDATE do `ModalVincularCliente.js` e na rota de importação automática), mas não aplicada — deprioritizado pra Laysla porque ela não vai mais importar do Calendar a partir de outubro, mas o bug se repete pra qualquer outro tenant que use essa importação (ex: Julia).

### Produto / UX
- "Manutenção vinda de outro salão" (`servicos.manutencao_externa`) precisa de redesenho: hoje pode ser marcado em vários serviços, mas deveria ser único por estabelecimento (categoria conceitual), e mutuamente exclusivo com "Este item é uma manutenção" (manutenção externa não tem prazo próprio).
- UX da pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, mas complexa de configurar; considerar assistente passo-a-passo.
- Polish visual dos botões de upload de comprovante (unificar "Enviar print/foto" e "Enviar PDF" num botão principal + link secundário) — desenhado, prompt pronto, adiado até confirmar se a fricção se repete no uso real.
- Popup de renovação de anamnese (12 meses vs. manter prazo já editado) — não implementado; precisa de duas colunas novas via SQL antes de qualquer código.
- Resumo (data/horário/cliente/serviço) na tela "dados" do wizard de agendamento pelo `/admin` — não iniciado.
- Aviso de Pix no cancelamento (valor não volta automaticamente) — cobrir tanto `/agendar` quanto `/admin`.
- Falta (`cancelado` + `nao_compareceu=true`) aparece só como "Cancelado" no Histórico, sem rótulo próprio — decidir se vale distinguir visualmente.
- Mensagem de WhatsApp "Fora da janela" (`MENSAGEM_FORA_DA_JANELA`) cita `{janela_fim}`, campo sem relação real com a disponibilidade — avaliar remover ou substituir o texto.
- Campo `janela_agendamento_fim` está escondido em Regras de negócio (`ConfiguracoesSalao.js`, `{false && (...)}`) sem UI de edição — decidir entre reexibir editável ou remover de vez (coluna, loaders, save).
- Bloqueio temporário de novembro (Laysla) — bloquear o mês inteiro com liberação automática numa data.
- Campo `emoji` em `etiquetas_cliente` sem consumidor.
- Default de "Cliente Fixo" em mês restrito não filtra por `ativa` em `etiquetasSelect`.
- Insert de sinal pelo `/admin` (agendamento novo com sinal declarado) não foi exercitado ao vivo com sessão autenticada — confirmar visualmente que grava o valor certo.
- Sinal retido histórico de cancelados ficou fora do backfill de sinal por incerteza de estorno não rastreável — se um dia quiser recuperar, precisa de critério próprio.

### AbacatePay — itens residuais (baixo risco)
- Remarcação (`app/api/agendamentos/remarcar/route.js`): restauração best-effort do status da linha antiga quando o insert da nova falha, sem transação atômica.
- Fail-open silencioso em `lib/estabelecimento.js` (`abacatepay_conectado: true` em erro de leitura).
- Rebaixamento silencioso da cascata de sinal Pix pra "desligado" quando falta chave manual e credencial AbacatePay ao mesmo tempo.

### Limpeza de código
- `components/LogoAcolheRodape.js` é código morto.
- String de fallback `"a equipe"` duplicada em três lugares.
- Colunas antigas `servicos.ocultar_preco` e `servicos.ocultar_duracao` sem uso.
- Coluna `estabelecimentos.reserva_provisoria_expira_horas` ainda no banco, usada só pelo bloco de rascunho abandonado de `expirar_pendentes_vencidos` — `DROP COLUMN` fica pra depois, manual.
- `buscarUltimasAnamnesesPorCliente` (`lib/anamnese.js`) sem consumidor no repo.

## Backlog
- Reforçar com Laysla (e futuras manicures) o uso da aba Ausências pra bloqueio de agenda pessoal, em vez de tentar automatizar leitura do Google Calendar pra bloqueio ao vivo (decisão de arquitetura da Sessão 62 — ver `Protocolo_Novo_Tenant.md`).
- Callback de patch para `sinal_regra` em `ConfiguracoesSalao.js` → `AdminPage`, evitando staleness do aviso de Pendentes até reload.
- Confirmar no código real como `clienteEhNovo` é calculado em `precisaSinal` (ramo `'novos'`).
- Sessão dedicada ao Programa de Fidelidade (botão "agendar brinde" sem handler, expiração de 12 meses, notificação).
- Auditoria não iniciada: alinhamento de colunas de `estabelecimentos` entre `lib/estabelecimento.js` e `lib/perfil.js` (mesmo item do bug acima, registrado aqui como auditoria formal a agendar).
- Auditoria não iniciada: varredura livre de padrões de risco não previstos, continuação do raio-x de risco silencioso.
- Fase futura: logo do `/admin` virar link pro Instagram do Acolhe.