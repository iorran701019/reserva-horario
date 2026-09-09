# Pendências — reserva-horario

## Em aberto

### AbacatePay — cobrança automática de sinal via Pix
Concluído até aqui: schema e rotas de credenciais, tela de conectar/desconectar no admin, geração/reaproveitamento de cobrança (`gerar-cobranca`), status com polling (`status`) + `BlocoQrCodeAbacatePay`, e webhook de confirmação (`app/api/abacatepay/webhook/route.js`) — **provado de ponta a ponta em produção** (Júnior, 09/09): chave conecta, webhook cadastra e remove de verdade na conta da AbacatePay, evento chega, passa pela validação HMAC por tenant e confirma o pagamento sozinho, sem depender do polling.

Nesta sessão, o onboarding do webhook deixou de ser manual: ao colar a chave, o próprio app cadastra o webhook na conta do salão via API (`lib/abacatepay/configurarWebhook.js`), gera um `webhook_secret` por tenant (colunas `webhook_id`/`webhook_secret` em `abacatepay_credenciais`, staging e produção), e a validação HMAC do webhook passou a resolver o secret pelo salão dono do evento em vez de uma env global única. A tela em Configurações ganhou um terceiro estado (chave conectada mas webhook pendente, com botão "Configurar agora") e o campo "Chave Pix" some no modo AbacatePay.

Dois bugs reais da integração com a AbacatePay foram encontrados e corrigidos, ambos por a documentação oficial deles divergir do comportamento real:
- `POST /webhooks/delete` — a doc descreve `id` no corpo JSON; o comportamento real exige `id` na query string com corpo vazio (confirmado sondando as variantes contra a API).
- Nome do campo do evento no payload — a doc/dashboard mostra `event` na raiz do corpo; o payload real que trafega usa `type`. Essa troca errada (`event`) chegou a ir pra produção por um ciclo inteiro antes de ser revertida com prova de corpo bruto capturado ao vivo. **Registrado na memória técnica do projeto para não se repetir.**

Também corrigido: chaves de API da AbacatePay sem a permissão `WEBHOOK:DELETE` fazem a remoção de webhook falhar silenciosamente (401) — toda chave nova (dev ou produção) deve ser gerada com escopo **Completo**.

Em aberto, em ordem sugerida:
1. Ajustar card de Pendentes para diferenciar visualmente pagamento confirmado pelo gateway (`abacatepay_pago_em`) do fluxo manual — os dois jogos de badge precisam ser mutuamente exclusivos por salão, conforme `metodo_cobranca_pix`.
2. Validação de configuração incompleta — hoje nada impede a dona de ativar sinal com `sinal_chave_pix` vazia (manual) ou `metodo_cobranca_pix='abacatepay'` sem credencial conectada; os dois quebram o fluxo silenciosamente na hora que a cliente chega no bloco de Pix.
3. **Novo (09/09):** botão "Confirmar agendamento" aparecendo na mesma tela do QR Code Pix, junto com "Cancelar agendamento" — parece permitir confirmar o horário sem o pagamento ter sido validado, o que não deveria ser possível no modo automático. Não investigado ainda; pode ser comportamento do modo manual vazando pra tela do modo automático, ou intencional por motivo ainda não identificado.
4. **Novo (09/09):** dois webhooks órfãos que sobraram na conta AbacatePay da Laysla (staging), de quando a chave usada ainda não tinha permissão de delete — já descartados manualmente pelo Iorran no dashboard deles.
5. Tutorial de onboarding pras pilotos escrito e revisado (`tutorial-abacatepay.pdf`) — cobre CNPJ obrigatório (achado desta sessão: a AbacatePay não libera produção pra conta só com CPF, MEI serve), cadastro de chave Pix/conta bancária pra saque (o dinheiro cai num saldo dentro da AbacatePay, não direto — precisa sacar), geração de chave (escopo Completo) e conexão no app.
6. Investigar divergência de valor no teste em sandbox (herdado — ainda não confirmado se é resíduo dos testes de curl ou bug real): Abacate registrou ticket médio de R$20 num teste onde o serviço configurado era R$30.
7. Confirmar que o `ALTER TABLE` de `webhook_id`/`webhook_secret` em `abacatepay_credenciais` está aplicado tanto em staging quanto produção (ambos confirmados nesta sessão) antes de conectar qualquer conta nova.

Decisão de negócio: sem taxa de conveniência/markup — 100% do sinal fica com a dona, sem split de pagamento (a própria AbacatePay também não tem split pronto pra marketplace ainda — está em desenvolvimento do lado deles).

Iorran tem 3 pendências adicionais em mente sobre o Pix/AbacatePay que não chegaram a ser discutidas nesta sessão — trazer na próxima.

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
- Bug `jaPendente` não passado ao `BlocoConfirmacaoPix` do wizard — editar um agendamento já `pendente` reabre o bloco cru e reinicia a janela do protocolo (48h) sem necessidade. **Possível variante nova (09/09):** num teste com o Júnior, o polling confirmou o pagamento no banco mas a tela do QR Code continuou parada sem reagir — pode ser a mesma causa raiz ou uma variante distinta; não investigado.
- `calendar_import_ignorados` ausente em produção — importação do Google Calendar possivelmente afetada, não confirmado na prática.
- Dívida técnica de tipos em `ConfiguracoesSalao.js` (`servicoManutencaoExternaId`) e `ModalVincularCliente.js` (`patch.servico_id`).

## Backlog
- Callback de patch para `sinal_regra` em `ConfiguracoesSalao.js` → `AdminPage`, evitando staleness do aviso de Pendentes até reload da página.
- Confirmar no código real como `clienteEhNovo` é calculado em `precisaSinal` (ramo `'novos'`) — discutido em profundidade numa sessão anterior, não investigado ainda.