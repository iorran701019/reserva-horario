# Pendências — reserva-horario

## Em aberto

### AbacatePay — cobrança automática de sinal via Pix
Concluído até aqui: schema e rotas de credenciais, tela de conectar/desconectar no admin, chave Dev mode validada em sandbox, endpoint de geração/reaproveitamento de cobrança (`gerar-cobranca`), endpoint de status com polling (`status`) + componente de QR Code no `/agendar` (`BlocoQrCodeAbacatePay`), e webhook de confirmação de pagamento (`app/api/abacatepay/webhook/route.js`) — testado ponta a ponta em staging (Laysla): pagamento confirmado automaticamente pelo gateway, com o agendamento saindo de `aguardando_sinal` e virando `pendente` sem a cliente precisar reabrir a tela. Autenticação por assinatura HMAC (headers `webhook-id`/`webhook-timestamp`/`webhook-signature`, padrão Standard Webhooks), não por secret na URL como a documentação inicial sugeria — confirmado por teste real, incluindo rejeição de assinatura inválida e recuperação automática via reentrega da AbacatePay.

Em aberto, em ordem sugerida:
1. Ajustar card de Pendentes para diferenciar visualmente pagamento confirmado pelo gateway (`abacatepay_pago_em`) do fluxo manual — os dois jogos de badge (comprovante anexado/declarado por WhatsApp vs. confirmado automaticamente) precisam ser mutuamente exclusivos por salão, conforme `metodo_cobranca_pix`.
2. Validação de configuração incompleta — hoje nada impede a dona de ativar sinal com `sinal_chave_pix` vazia (manual) ou `metodo_cobranca_pix='abacatepay'` sem credencial conectada (Abacate); os dois quebram o fluxo silenciosamente na hora que a cliente chega no bloco de Pix. Precisa de alerta/trava no momento de salvar a configuração.
3. Remover o campo "Chave Pix" da tela de Configurações quando `metodo_cobranca_pix='abacatepay'` — sem função nesse modo, resíduo do fluxo manual.
4. Investigar divergência de valor no teste em sandbox: o Abacate registrou ticket médio de R$20,00 (2 transações, R$40,00 total), mas o sinal configurado no serviço testado na Laysla staging é R$30,00. Confirmar se é resíduo dos testes de curl feitos fora do app (que usaram valores variados nos testes) ou bug real puxando valor errado.
5. Cadastrar o webhook no painel da AbacatePay para cada nova conta conectada (staging/Laysla já cadastrado; qualquer conta de produção futura precisa do mesmo cadastro manual, apontando para `https://reserva-horario.vercel.app/api/abacatepay/webhook` com o Secret correspondente).

Decisão de negócio: sem taxa de conveniência/markup — 100% do sinal fica com a dona, sem split de pagamento.

### Outros
- UX da configuração de pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, mas complexa de configurar; considerar assistente passo-a-passo no futuro.
- Polish visual dos botões de upload de comprovante (unificar "Enviar print/foto" e "Enviar PDF" num botão principal + link secundário) — desenhado, prompt pronto, adiado até confirmar se a fricção se repete no uso real.
- Testar ao vivo em produção a correção da pendência de cancelamento duplicada (a de staging foi diagnosticada e corrigida; produção não foi reconfirmada).
- Confirmar que a remoção de foto de perfil está funcionando após o fix do NOT NULL em `foto_perfil_zoom`.
- Popup de renovação de anamnese (renovar por 12 meses vs. manter prazo editado pelo cliente) — não implementado; precisa de duas colunas novas via SQL antes de qualquer código (vencimento explícito em `anamnese_respostas`, prazo configurável em `estabelecimentos`).
- `buscarUltimasAnamnesesPorCliente` (`lib/anamnese.js`) sem nenhum consumidor no repo — candidata a limpeza futura, sem risco.
- Divergência de `roles` na policy "Público pode cancelar próprio agendamento" entre staging (`{anon,authenticated}`) e produção (`{anon}`) — confirmar se é intencional.
- Limpar lixo de teste (`Cancelamento: {nome}`) em `pendencias_admin` de staging.
- PENDENTE, alta prioridade: pergunta condicional (filha) às vezes salva com `pergunta_pai_id`/`opcao_gatilho_id` NULL mesmo com o checkbox marcado — bug intermitente, investigação sem causa raiz confirmada ainda. Handoff dedicado: `reserva-horario_Handoff_Bug_Pergunta_Condicional_Nao_Salva.md`.
- Bloqueio temporário de novembro (Laysla): bloquear o mês inteiro com liberação automática numa data.
- Campo `emoji` em `etiquetas_cliente` sem consumidor no state do admin após a troca por cor — candidata a limpeza futura, sem risco.
- Default de "Cliente Fixo" em mês restrito não filtra por `ativa` em `etiquetasSelect` — caso de borda raro, deixado como está por decisão consciente.
- Resumo (data/horário/cliente/serviço) na tela "dados" do wizard de agendamento pelo `/admin`, antes de confirmar e enviar WhatsApp — não iniciado.
- Aviso de Pix no cancelamento (valor não volta automaticamente) — cobrir tanto `/agendar` quanto `/admin` (incluindo cancelamento de confirmados); frente própria futura.
- Sincronização de colunas de `estabelecimentos` entre `lib/estabelecimento.js` e `lib/perfil.js` — nunca iniciada.
- Bug `jaPendente` não passado ao `BlocoConfirmacaoPix` do wizard — editar um agendamento já `pendente` reabre o bloco cru e reinicia a janela do protocolo (48h) sem necessidade.
- `calendar_import_ignorados` ausente em produção — importação do Google Calendar possivelmente afetada, não confirmado na prática.
- Dívida técnica de tipos em `ConfiguracoesSalao.js` (`servicoManutencaoExternaId`) e `ModalVincularCliente.js` (`patch.servico_id`).

## Backlog
- Callback de patch para `sinal_regra` em `ConfiguracoesSalao.js` → `AdminPage`, evitando staleness do aviso de Pendentes até reload da página.
- Confirmar no código real como `clienteEhNovo` é calculado em `precisaSinal` (ramo `'novos'`) — discutido em profundidade numa sessão anterior, não investigado ainda.