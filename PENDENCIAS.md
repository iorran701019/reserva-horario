# Pendências — reserva-horario

## Em aberto

### Confirmado vira concluído + Conclusão manual + Relatórios (Sessões 58–59 — mergeado em staging E produção)
- **Feature completa em produção.** Status `confirmado` e `concluido` tratados como irmãos (STATUS_SUCESSO), cron duplo (expira reserva provisória / conclui confirmado vencido) rodando a cada 15 min nos dois ambientes, aba "Conclusão" (renomeada de "Aguardando Conclusão" — truncava no mobile) como sub-navegação de Pendentes, card de exceção (Sim / Cancelado / Substituir valor) testado e aprovado.
- **Toggle "Conclusão manual ativa"** em Regras de negócio → bloco próprio "Conclusão manual", com select de prazo (48h/72h/4 dias) ligado a `confirmado_expira_horas`. Default `false` em todos os tenants dos dois ambientes — **Flávia e Laysla, que já testavam o fluxo manualmente, precisam ativar o toggle na própria tela pra continuar vendo a aba** (decisão consciente: ativar via UI, não via SQL).
- **Card de Conclusão enxuto:** "Não compareceu" renomeado pra "Cancelado" (grava igual, via `marcarNaoCompareceu`); bug do "Corrigir" travando corrigido (virou "Substituir valor" com Salvar/Cancelar reais, nada vai pro banco até o Sim); bloco de valor some se `status='cancelado'`; textos do sinal simplificados; layout com data/horário em destaque (bloco índigo), chip azul "Aguardando Conclusão", etiqueta do cliente, profissional só com 2+ ativos.
- **Base de dados de Relatórios:** coluna `agendamentos.cancelado_pelo_salao` (gravada nos 3 pontos reais de cancelamento pelo admin: `handleCancelar`, troca por conflito de prazo em page.js e em FormularioAgendamento.js — remarcação e rascunho de wizard ficam de fora de propósito) e `servicos.manutencao_externa` (checkbox independente de `eh_manutencao`, ver pendência dedicada abaixo).
- **Aba "Relatórios"** (entre Clientes e Regras, ícone PieChart): dois gráficos de pizza por mês navegável — tipo de serviço dos concluídos (comum/manutenção interna/manutenção externa) e desfecho dos agendamentos (concluído/cancelado pelo cliente/cancelado pelo salão/expirado automaticamente). Cancelamentos antigos sem nenhuma flag de autor contam como estimativa em "cancelado pelo salão", com legenda avisando quando isso ocorre no mês. Recharts instalado como dependência nova do projeto.
- **Regra geral aplicada:** nome do profissional só aparece em telas de agendamento com 2+ profissionais ativos (`qtdProfissionaisAtivos > 1`; `null`/carregando também esconde) — 5 pontos corrigidos em `page.js` (Pendentes, Fora da janela, Histórico, modal de detalhe, Alterar data), virou regra permanente do protocolo.
- **Achado de segurança sério, ainda sem correção — prioridade alta:** a policy `"Público pode cancelar próprio agendamento"` (UPDATE, staging e produção) tem `qual = true`, sem checagem de dono. Qualquer requisição anônima pode alterar qualquer linha de `agendamentos`, de qualquer salão. Não relacionado à feature de Conclusão, descoberto durante a auditoria de RLS dela.
- **Dados de teste em staging** (Laysla, `estabelecimento_id=3`) ainda não limpos: `Teste Aguardando Confirmação`, `Teste Editar no Histórico`, `Teste Sinal - Aguardando Conclusão`, `Teste Sinal - Editar Histórico`, `Teste Sinal - Sem Valor Registrado`. Os dois "Molde F1" da cliente `xuxa` são dado pré-existente — não apagar sem confirmar.
- Aba não mostra "conclui automaticamente em Xh" pra dona fora da tela de Regras de negócio (só aparece lá agora, dentro do bloco Conclusão manual — resolvido pela feature desta sessão).
- Falta (`cancelado` + `nao_compareceu=true`) aparece como "Cancelado" no Histórico, sem rótulo próprio de "Não compareceu"/"Cancelado pelo card de Conclusão". Decidir se vale distinguir visualmente.
- Badge de fidelidade, depois de "Editar" um concluído na ficha do cliente, só recalcula ao reabrir a ficha.
- Cobranças AbacatePay criadas antes do deploy original desta feature (QR ainda válido, reaproveitado) ficam sem `sinal_valor_centavos` — caem no estado "sinal pago, valor não registrado".
- Segundo comprovante Pix enviado com a linha já em `pendente` não faz UPDATE (comportamento pré-existente) — também não grava o valor do sinal nesse caso.
- Remarcação no fluxo manual (não-AbacatePay) cancela e recria a linha; a nova linha volta pra `aguardando_sinal` e só recebe `sinal_valor_centavos` quando a cliente declarar o pagamento de novo.

### Manutenção vinda de outro salão — UI precisa de redesenho (nova, Sessão 59)
- Checkbox "Manutenção vinda de outro salão" (`servicos.manutencao_externa`) hoje é independente e pode ser marcado em quantos serviços a dona quiser, mas na prática deveria ser único por estabelecimento — é uma categoria conceitual só (o destino de "Sim, fiz em outro salão" no wizard), não vários serviços externos.
- Também precisa ficar mutuamente exclusivo com "Este item é uma manutenção": regra de negócio real, manutenção vinda de fora não tem prazo de manutenção próprio (não existe "manutenção da manutenção externa"). Hoje as duas coisas coexistem sem restrição.
- Vale desenhar a UI com calma (talvez um seletor único "qual serviço representa manutenção externa" em vez de checkbox por serviço) antes de implementar.

### AbacatePay — itens residuais (baixo risco, não bloqueiam ativação)
- Remarcação (`app/api/agendamentos/remarcar/route.js`): restauração best-effort do status da linha antiga quando o insert da nova falha, sem transação atômica — pode devolver `codigo: "restauracao_falhou"` em caso raro de conflito de horário. Mitigação barata: checar disponibilidade do horário novo antes de cancelar o antigo. Fechar de vez exige RPC/transação no Postgres.
- Fail-open silencioso em `lib/estabelecimento.js` (`abacatepay_conectado: true` em erro de leitura): roda no browser da cliente, um `console.warn` ali não ajuda a dona a perceber. Se quiser alertar a dona de fato, instrumentar a rota `/api/abacatepay/conectado`.
- Rebaixamento silencioso da cascata de sinal Pix pra "desligado" (quando falta chave manual e credencial AbacatePay ao mesmo tempo): hoje o único aviso é o badge visual em Configurações e Pendentes. Escolha de design consciente, mas vale reavaliar se algum tenant real cair nesse estado.

### Sinal obrigatório para etiqueta "Lista de Bloqueio" (Sessão 56)
- **Valéria (produção)** não tem nenhuma etiqueta cadastrada — o checkbox "Cobrar sinal de clientes na Lista de Bloqueio" fica desabilitado pra esse tenant até alguém criar as etiquetas retroativamente.
- **Staging** incompleto: só a Laysla tem etiquetas. Flávia, Junior e Valéria não têm etiqueta nenhuma em staging.
- Cards antigos duplicados de cancelamento em produção (anteriores a 27/08) ficam visualmente idênticos depois da troca de título — não é bug novo, arquivar quando conveniente.

### Ocultar preço/duração globais (Sessão 57)
- **Junior (produção) não foi ajustada.** Só Laysla e Flávia foram configuradas, refletindo o estado real que cada uma tinha por serviço. Decidir com o Iorran e rodar o UPDATE equivalente.
- Colunas antigas `servicos.ocultar_preco` e `servicos.ocultar_duracao` sem uso — candidatas a remoção futura.
- Com preço oculto, o bloco "Sua última manutenção já passou do prazo…" continua aparecendo, só sem o valor numérico. Ajuste de uma linha se quiser sumir com o bloco inteiro.

### Popup de virada de mês — 2 meses (Sessão 57)
- Aviso de React pré-existente: "Cannot update AdminPage while rendering ConfiguracoesSalao" em `salvarMes` — não afeta funcionamento, vale corrigir numa sessão futura.
- Seletor "Meses editáveis" mostra "3 meses" mesmo quando o alcance real é 4 (o default) — dropdown só oferece 3/6/12.
- Salão de Teste (staging) ficou com setembro e outubro/2026 gravados como "Fechado". Pra repetir o teste do zero, apagar essas duas linhas de `janela_agendamento_meses`.

### Bug: navegação por voltar físico a partir do Pix (baixa prioridade)
- **Modo edição, não investigado ao vivo ainda.** `sairDaEdicao` deveria levar de volta ao Pix; observado caindo no Painel do cliente ou tela inicial. Sem perda de dado, mas destino errado é falha real.
- **Fluxo novo (sem edição), mecanismo já mapeado.** Toques "mortos" antes de sair do site (2 no caminho direto, 4 com F5) — causa: entradas de histórico empilhadas por um furo de commit no gate de "servico". Consertar exige mexer no mecanismo delicado de navegação por voltar físico — risco desproporcional.

### Marca Acolhe — resíduos
- `components/LogoAcolheRodape.js` é código morto — candidato a remoção ou reaproveitamento futuro.
- String de fallback `"a equipe"` duplicada em três lugares (`app/[salon]/page.js`, `BlocoConfirmacaoPix.js`, `BlocoQrCodeAbacatePay.js`).
- Fase futura: logo do `/admin` virar link pro Instagram do Acolhe.
- Clientes de teste no Salão de Teste: `Teste Logo Rodape` e `Teste Anamnese Rodape` — remover quando quiser limpar.
- Config residual em staging (Salão de Teste, id 1): `sinal_valor_centavos`/`sinal_chave_pix` ainda preenchidos com `sinal_regra` desligado — inofensivo, mas sujo. `UPDATE estabelecimentos SET sinal_valor_centavos = NULL, sinal_chave_pix = NULL WHERE id = 1;`.

### Outros
- UX da pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, complexa de configurar; considerar assistente passo-a-passo.
- Polish visual dos botões de upload de comprovante — desenhado, prompt pronto, adiado.
- Testar ao vivo em produção a correção da pendência de cancelamento duplicada (staging já diagnosticado e corrigido).
- Confirmar remoção de foto de perfil após o fix do NOT NULL em `foto_perfil_zoom`.
- Popup de renovação de anamnese — não implementado; precisa de duas colunas novas via SQL antes de qualquer código.
- `buscarUltimasAnamnesesPorCliente` sem consumidor no repo — candidata a limpeza.
- Divergência de `roles` na policy de cancelamento entre staging/produção — ver item de segurança acima, que é o problema maior.
- Limpar lixo de teste (`Cancelamento: {nome}`) em `pendencias_admin` de staging.
- PENDENTE, alta prioridade: pergunta condicional (filha) às vezes salva com `pergunta_pai_id`/`opcao_gatilho_id` NULL — bug intermitente. Handoff dedicado: `reserva-horario_Handoff_Bug_Pergunta_Condicional_Nao_Salva.md`.
- Bloqueio temporário de novembro (Laysla): bloquear o mês inteiro com liberação automática numa data.
- Campo `emoji` em `etiquetas_cliente` sem consumidor — candidata a limpeza.
- Default de "Cliente Fixo" em mês restrito não filtra por `ativa` em `etiquetasSelect` — caso de borda raro, deixado como está.
- Resumo (data/horário/cliente/serviço) na tela "dados" do wizard de agendamento pelo `/admin` — não iniciado.
- Aviso de Pix no cancelamento (valor não volta automaticamente) — cobrir `/agendar` e `/admin`; frente própria futura.
- Sincronização de colunas entre `lib/estabelecimento.js` e `lib/perfil.js` — nunca iniciada (as duas listas já divergem em vários campos, confirmado na Sessão 59).
- Bug `jaPendente` não passado ao `BlocoConfirmacaoPix` do wizard — variante benigna restante, sem corrupção de dado.
- `calendar_import_ignorados` ausente em produção — não confirmado na prática.
- Dívida técnica de tipos em `ConfiguracoesSalao.js` (`servicoManutencaoExternaId`) e `ModalVincularCliente.js` (`patch.servico_id`).
- Erro HTTP 400 recorrente no console, sem URL identificada — apareceu em pelo menos três sessões diferentes. Origem não rastreada.

## Backlog
- Troca estética "Confirmado" → "Agendado": manter valor de banco `confirmado`, trocar só o rótulo exibido. Ainda não iniciado — precisa de raio-x dedicado. A tensão semântica com a aba "Aguardando Conclusão" já não existe mais (renomeada pra "Conclusão" na Sessão 59).
- Callback de patch para `sinal_regra` em `ConfiguracoesSalao.js` → `AdminPage`, evitando staleness do aviso de Pendentes até reload.
- Confirmar no código real como `clienteEhNovo` é calculado em `precisaSinal` (ramo `'novos'`) — não investigado ainda.
- Criar as 5 etiquetas padrão retroativamente para a Valéria (produção) e para Flávia/Junior/Valéria em staging.