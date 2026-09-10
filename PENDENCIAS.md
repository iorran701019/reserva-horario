# Pendências — reserva-horario

## Em aberto

### AbacatePay — itens residuais (baixo risco, não bloqueiam ativação)
- Remarcação (`app/api/agendamentos/remarcar/route.js`): restauração best-effort do status da linha antiga quando o insert da nova falha, sem transação atômica — pode devolver `codigo: "restauracao_falhou"` em caso raro de conflito de horário. Mitigação barata: checar disponibilidade do horário novo antes de cancelar o antigo (não fecha a janela por completo, mas elimina a causa dominante). Fechar de vez exige RPC/transação no Postgres.
- Fail-open silencioso em `lib/estabelecimento.js` (`abacatepay_conectado: true` em erro de leitura): roda no browser da cliente, então um `console.warn` ali não ajuda a dona a perceber. Se quiser alertar a dona de fato, o lugar certo é instrumentar a rota `/api/abacatepay/conectado`.
- Rebaixamento silencioso da cascata de sinal Pix pra "desligado" (quando falta chave manual e credencial AbacatePay ao mesmo tempo): hoje o único aviso é o badge visual em Configurações e Pendentes — não há notificação ativa. Escolha de design consciente, mas vale reavaliar se algum tenant real cair nesse estado.

### Bug: navegação por voltar físico a partir do Pix (baixa prioridade)
- **Modo edição, não investigado ao vivo ainda.** Cliente chega no Pix, usa "editar" (entra em modo edição), volta várias vezes com o botão físico do navegador até a etapa "1-serviços" e continua voltando. Esperado: `sairDaEdicao` deveria levar de volta ao protocolo/Pix. Observado: cai no Painel do cliente (se já cadastrado) ou na tela inicial pedindo WhatsApp (se cliente novo) — contraria o que o código deveria fazer. Não perde dado nem trava o fluxo (cliente só precisa recomeçar a edição), mas o destino errado é uma falha real, ainda sem diagnóstico.
- **Fluxo de agendamento novo (sem edição), mecanismo já mapeado.** O primeiro toque em voltar a partir do Pix sempre leva à Identificação — isso é esperado, não é bug. Os toques seguintes ficam "mortos" (não mudam a tela) antes de sair do site: 2 toques mortos no caminho direto, 4 no caminho com F5 (o F5 piora, não corrige). Causa: entradas de histórico do wizard ("servico"/"dados") empilhadas a mais durante a restauração pós-F5, por um furo de um commit no gate de "servico" (`FormularioAgendamento.js:2508-2527`). Sem perda de dado. Consertar exige mexer no mesmo mecanismo delicado que sustenta toda a navegação por voltar físico — risco desproporcional ao incômodo.

### Marca Acolhe — resíduos
- `components/LogoAcolheRodape.js` é código morto: nenhum arquivo importa desde que o texto "Desenvolvido por Acolhe" substituiu a logo com tagline. Candidato a remoção numa limpeza futura, ou reaproveitamento se a logo voltar um dia.
- A string de fallback `"a equipe"` (quando não há profissional ativo) está duplicada em três lugares: `app/[salon]/page.js`, `components/BlocoConfirmacaoPix.js` e `components/BlocoQrCodeAbacatePay.js`. Se o texto do fallback mudar, precisa mudar nos três.
- Fase futura, ainda não desenhada: logo do `/admin` (Hero, cabeçalho) virar link pro Instagram do Acolhe.
- Clientes de teste no Salão de Teste (sandbox, sem dado real): `Teste Logo Rodape` (24) 98877-6655 e `Teste Anamnese Rodape` (24) 98877-6600 — remover quando quiser limpar.
- Config residual em staging (Salão de Teste, id 1): `sinal_valor_centavos` e `sinal_chave_pix` ainda preenchidos (1000 / `teste-historico@exemplo.com`), com `sinal_regra` já revertido para `desligado` — inofensivo (o sistema ignora os dois com a regra desligada), mas sujo. Reverter com `UPDATE estabelecimentos SET sinal_valor_centavos = NULL, sinal_chave_pix = NULL WHERE id = 1;`.

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
- Bug `jaPendente` não passado ao `BlocoConfirmacaoPix` do wizard — editar um agendamento já `pendente` reabre o bloco cru e reinicia a janela do protocolo (48h) sem necessidade. A variante observada com o Júnior (polling confirmava no banco, tela não reagia) foi resolvida como efeito colateral do fix da Sessão 52 — sobra só uma variante benigna no restore de sessão, sem corrupção de dado.
- `calendar_import_ignorados` ausente em produção — importação do Google Calendar possivelmente afetada, não confirmado na prática.
- Dívida técnica de tipos em `ConfiguracoesSalao.js` (`servicoManutencaoExternaId`) e `ModalVincularCliente.js` (`patch.servico_id`).

## Backlog
- Callback de patch para `sinal_regra` em `ConfiguracoesSalao.js` → `AdminPage`, evitando staleness do aviso de Pendentes até reload da página.
- Confirmar no código real como `clienteEhNovo` é calculado em `precisaSinal` (ramo `'novos'`) — discutido em profundidade numa sessão anterior, não investigado ainda.