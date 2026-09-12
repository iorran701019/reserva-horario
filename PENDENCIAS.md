# Pendências — reserva-horario

## Em aberto

### Expiração de pendentes por horário vencido + Aba Financeiro (Sessão de hoje — mergeado em staging e produção)
- **Incidente que motivou tudo:** mecanismo antigo de expiração (`processar_reservas_provisorias_vencidas`, baseado em horas desde a criação) cancelou silenciosamente agendamentos reais — Laysla quase perdeu vaga por prazo curto, Flávia teve 4 expirados sem saber (viagem a São Paulo). Dos 4, 1 (Aline) perdeu o horário de fato pra outra cliente que remarcou — **já resolvido manualmente com a Flávia**. Os outros 3 (Raiane restaurada pra Pendentes; Carolini e Jucelene já tinham sido repostas por fora) não precisaram de ação.
- **Job antigo desligado e removido** (jobid 4 em ambos os ambientes, nomes divergiam entre staging/produção — confirmado via `cron.job` antes de agir). Função `processar_reservas_provisorias_vencidas()` dropada.
- **Nova função `expirar_pendentes_vencidos()`**, mesmo intervalo de 15 min, dois blocos: (a) rascunho abandonado no wizard, igual comportamento antigo, sem rótulo; (b) pendente que chegou a aparecer em Pendentes agora expira pelo **vencimento do horário do serviço**, não mais por tempo desde a criação — com correção de fuso (`periodo` é hora local sem fuso, sessão do banco roda em UTC; comparação usa `now() at time zone 'America/Sao_Paulo'`). Data de corte `2026-09-11` no bloco (b) pra não reescrever retroativamente o desfecho de meses já fechados nos Relatórios.
- **Badge "Expira em Xh" removido** da aba Pendentes (contador, ordenação do inbox e comentários relacionados) — contava um prazo que deixou de existir.
- **Campo "Expiração de reserva provisória (horas)" removido** da tela de Configurações — só regia o rascunho abandonado, texto confundia a dona sobre o que controlava de verdade.
- **Pix ganhou constante própria** (`EXPIRACAO_PIX_HORAS = 24`) pro `expiresIn` do QR Code, desacoplado da coluna `reserva_provisoria_expira_horas` (nunca teve relação real, só coincidência de mesma coluna). Efeito colateral bom: salões com a coluna null, que antes geravam QR sem `expiresIn` (caindo no default da AbacatePay), agora têm 24h explícitas sempre.
- **`buscarHistoricoRecente` (painel público da cliente)** passa a excluir `expirado_automaticamente = true` — a cliente não vê "Expirado" no próprio painel; a ficha do cliente no admin (`buscarHistoricoCompleto`) continua mostrando tudo, de propósito, pra dona.
- **Cron de conclusão automática (jobid 5, `concluir_agendamentos_confirmados_vencidos`) agora grava `valor_cobrado_centavos`** — preço do serviço + soma dos ajustes de pergunta respondidos (join com `agendamento_respostas`/`servico_pergunta_opcoes`), com guarda `IS NULL` pra nunca sobrescrever valor já corrigido à mão. Sem `servico_id` (serviço avulso), fica `NULL` — sem inventar valor. Ajuste de manutenção vencida (`calcularPrecoManutencao`) fica de fora, não é reconstruível em SQL.
- **Bug de fuso encontrado no jobid 5, não corrigido nesta sessão:** a mesma comparação `periodo` (hora local sem fuso) contra `now()` numa sessão UTC também existe aqui — provável desvio de ~3h na hora exata da conclusão automática. Correção seria a mesma (`at time zone 'America/Sao_Paulo'`), mas é mudança de comportamento separada do escopo desta sessão.
- **Coluna `estabelecimentos.reserva_provisoria_expira_horas` continua no banco**, não foi dropada — usada só pelo bloco (a) da função nova. `DROP COLUMN` fica pra depois, manual.
- **Aba "Relatórios" dividida em duas sub-abas** (mesmo padrão visual de Pendentes/Concluídos): "Atividades" (conteúdo que já existia, sem mudança de lógica) e "Financeiro" (nova) — receita total do mês, total de sinais, ticket médio (só sobre concluídos com valor não-nulo), e um gráfico de linha/barra de receita por dia/mês reaproveitando o mesmo componente visual, com cor diferente (azul) e label no eixo X ("Dia do mês") pra diferenciar de Atividades.
- Financeiro conta só `status = 'concluido'` estrito (não o critério largo de desfecho) — um `confirmado` vencido ainda sem `valor_cobrado_centavos` gravado não entra até o cron rodar.
- `modoSerie` (Dia/Mês) é compartilhado entre Atividades e Financeiro — trocar num muda o outro também. Decisão consciente pra reaproveitar o effect do semestre.

### Confirmado vira concluído + Conclusão manual + Relatórios (Sessões 58–59 — mergeado em staging E produção)
- **Toggle "Conclusão manual ativa"** default `false` em todos os tenants — Flávia e Laysla precisam ativar na própria tela pra continuar vendo a aba de conclusão manual.
- **Achado de segurança sério, ainda sem correção — prioridade alta:** a policy `"Público pode cancelar próprio agendamento"` (UPDATE, staging e produção) tem `qual = true`, sem checagem de dono. Qualquer requisição anônima pode alterar qualquer linha de `agendamentos`, de qualquer salão.
- **Dados de teste em staging** (Laysla, `estabelecimento_id=3`) ainda não limpos: `Teste Aguardando Confirmação`, `Teste Editar no Histórico`, `Teste Sinal - Aguardando Conclusão`, `Teste Sinal - Editar Histórico`, `Teste Sinal - Sem Valor Registrado`. Os dois "Molde F1" da cliente `xuxa` são dado pré-existente — não apagar sem confirmar.
- Falta (`cancelado` + `nao_compareceu=true`) aparece como "Cancelado" no Histórico, sem rótulo próprio de "Não compareceu"/"Cancelado pelo card de Conclusão". Decidir se vale distinguir visualmente.
- Badge de fidelidade, depois de "Editar" um concluído na ficha do cliente, só recalcula ao reabrir a ficha.
- Cobranças AbacatePay criadas antes do deploy original desta feature (QR ainda válido, reaproveitado) ficam sem `sinal_valor_centavos` — caem no estado "sinal pago, valor não registrado".
- Segundo comprovante Pix enviado com a linha já em `pendente` não faz UPDATE (comportamento pré-existente) — também não grava o valor do sinal nesse caso.
- Remarcação no fluxo manual (não-AbacatePay) cancela e recria a linha; a nova linha volta pra `aguardando_sinal` e só recebe `sinal_valor_centavos` quando a cliente declarar o pagamento de novo.

### Manutenção vinda de outro salão — UI precisa de redesenho (Sessão 59)
- Checkbox "Manutenção vinda de outro salão" (`servicos.manutencao_externa`) hoje é independente e pode ser marcado em quantos serviços a dona quiser, mas na prática deveria ser único por estabelecimento — é uma categoria conceitual só, não vários serviços externos.
- Também precisa ficar mutuamente exclusivo com "Este item é uma manutenção": manutenção vinda de fora não tem prazo de manutenção próprio. Hoje as duas coisas coexistem sem restrição.
- Vale desenhar a UI com calma (talvez um seletor único "qual serviço representa manutenção externa" em vez de checkbox por serviço) antes de implementar.

### AbacatePay — itens residuais (baixo risco, não bloqueiam ativação)
- Remarcação (`app/api/agendamentos/remarcar/route.js`): restauração best-effort do status da linha antiga quando o insert da nova falha, sem transação atômica.
- Fail-open silencioso em `lib/estabelecimento.js` (`abacatepay_conectado: true` em erro de leitura).
- Rebaixamento silencioso da cascata de sinal Pix pra "desligado" (quando falta chave manual e credencial AbacatePay ao mesmo tempo).

### Sinal obrigatório para etiqueta "Lista de Bloqueio" (Sessão 56)
- **Valéria (produção)** não tem nenhuma etiqueta cadastrada — checkbox desabilitado pra esse tenant até alguém criar as etiquetas retroativamente.
- **Staging** incompleto: só a Laysla tem etiquetas. Flávia, Junior e Valéria não têm etiqueta nenhuma em staging.
- Cards antigos duplicados de cancelamento em produção (anteriores a 27/08) ficam visualmente idênticos depois da troca de título.

### Ocultar preço/duração globais (Sessão 57)
- **Junior (produção) não foi ajustada.** Só Laysla e Flávia foram configuradas. Decidir com o Iorran e rodar o UPDATE equivalente.
- Colunas antigas `servicos.ocultar_preco` e `servicos.ocultar_duracao` sem uso — candidatas a remoção futura.
- Com preço oculto, o bloco "Sua última manutenção já passou do prazo…" continua aparecendo, só sem o valor numérico.

### Popup de virada de mês — 2 meses (Sessão 57)
- Aviso de React pré-existente: "Cannot update AdminPage while rendering ConfiguracoesSalao" em `salvarMes`.
- Seletor "Meses editáveis" mostra "3 meses" mesmo quando o alcance real é 4.
- Salão de Teste (staging) ficou com setembro e outubro/2026 gravados como "Fechado".

### Bug: navegação por voltar físico a partir do Pix (baixa prioridade)
- **Modo edição, não investigado ao vivo ainda.** `sairDaEdicao` deveria levar de volta ao Pix.
- **Fluxo novo (sem edição), mecanismo já mapeado.** Toques "mortos" antes de sair do site — mexer no mecanismo de navegação por voltar físico, risco desproporcional.

### Marca Acolhe — resíduos
- `components/LogoAcolheRodape.js` é código morto.
- String de fallback `"a equipe"` duplicada em três lugares.
- Fase futura: logo do `/admin` virar link pro Instagram do Acolhe.
- Clientes de teste no Salão de Teste: `Teste Logo Rodape` e `Teste Anamnese Rodape`.
- Config residual em staging (Salão de Teste, id 1): `sinal_valor_centavos`/`sinal_chave_pix` ainda preenchidos com `sinal_regra` desligado.

### Outros
- UX da pergunta condicional (mãe/filha) em `GerenciarServicos.js` — considerar assistente passo-a-passo.
- Polish visual dos botões de upload de comprovante — desenhado, prompt pronto, adiado.
- Testar ao vivo em produção a correção da pendência de cancelamento duplicada.
- Confirmar remoção de foto de perfil após o fix do NOT NULL em `foto_perfil_zoom`.
- Popup de renovação de anamnese — não implementado; precisa de duas colunas novas via SQL antes de qualquer código.
- `buscarUltimasAnamnesesPorCliente` sem consumidor no repo.
- Divergência de `roles` na policy de cancelamento entre staging/produção.
- Limpar lixo de teste (`Cancelamento: {nome}`) em `pendencias_admin` de staging.
- PENDENTE, alta prioridade: pergunta condicional (filha) às vezes salva com `pergunta_pai_id`/`opcao_gatilho_id` NULL — bug intermitente.
- Bloqueio temporário de novembro (Laysla): bloquear o mês inteiro com liberação automática numa data.
- Campo `emoji` em `etiquetas_cliente` sem consumidor.
- Default de "Cliente Fixo" em mês restrito não filtra por `ativa` em `etiquetasSelect`.
- Resumo (data/horário/cliente/serviço) na tela "dados" do wizard de agendamento pelo `/admin` — não iniciado.
- Aviso de Pix no cancelamento (valor não volta automaticamente) — cobrir `/agendar` e `/admin`.
- Sincronização de colunas entre `lib/estabelecimento.js` e `lib/perfil.js` — as duas listas já divergem em vários campos.
- Bug `jaPendente` não passado ao `BlocoConfirmacaoPix` do wizard.
- `calendar_import_ignorados` ausente em produção — não confirmado na prática.
- Dívida técnica de tipos em `ConfiguracoesSalao.js` (`servicoManutencaoExternaId`) e `ModalVincularCliente.js` (`patch.servico_id`).
- Erro HTTP 400 recorrente no console, sem URL identificada.

## Backlog
- Troca estética "Confirmado" → "Agendado": manter valor de banco `confirmado`, trocar só o rótulo exibido.
- Callback de patch para `sinal_regra` em `ConfiguracoesSalao.js` → `AdminPage`, evitando staleness do aviso de Pendentes até reload.
- Confirmar no código real como `clienteEhNovo` é calculado em `precisaSinal` (ramo `'novos'`).
- Criar as 5 etiquetas padrão retroativamente para a Valéria (produção) e para Flávia/Junior/Valéria em staging.