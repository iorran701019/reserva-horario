# Pendências — reserva-horario

## Em aberto

### Confirmado vira concluído (Sessão 58 — ainda não commitada, só em staging)
- **Nada commitado ainda.** Toda a branch `feat/confirmado-vira-concluido` segue só no working directory, com várias rodadas de fix acumuladas. Próxima sessão: revisar o `git diff` completo antes do primeiro commit.
- **Decisão desta sessão: manter só em staging por enquanto.** Não replicar pra produção até decisão explícita numa próxima sessão — mesmo as 4 colunas novas e os 2 crons já existindo nos dois ambientes desde antes do código deste fix.
- **Teste manual completo ainda não feito.** A aba "Aguardando Conclusão" (sub-navegação dentro de "Pendentes", em formato de duas abas de pasta sempre visíveis) foi vista só vazia numa janela anônima. Clicar em Sim/Corrigir/Não compareceu e no botão "Editar" do Histórico (incluindo os 3 estados do sinal) ainda não foi exercitado de verdade.
- **Achado de segurança sério, sem relação direta com esta feature:** a policy `"Público pode cancelar próprio agendamento"` (UPDATE, staging e produção) tem `qual = true` — sem checagem de dono. Qualquer requisição anônima pode alterar qualquer linha de `agendamentos`, de qualquer salão, não só cancelar o próprio. Anterior a esta sessão, descoberto durante a conferência de RLS pro `concluido`. Prioridade alta pra próxima rodada de segurança.
- **Trigger de sync do Google Calendar confirmado (`trg_sincronizar_google_calendar`, staging e produção):** dispara em todo `UPDATE` de `agendamentos` via `net.http_post` pra `/api/google-calendar/sync`. Como o código do fix (que passa a tratar `concluido` como status que mantém o evento) ainda não foi mergeado, qualquer `UPDATE` que o cron novo já fizer em produção — incluindo a conclusão automática — roda contra o código ANTIGO, que apaga o evento do Google pra qualquer status diferente de `confirmado`. Verificado hoje: o único agendamento já concluído pelo cron em produção não tinha `google_event_id` vinculado (sem evento a perder). Mas o cron roda a cada 15 minutos e vai concluir outros — checar de novo antes do merge, e mergear o quanto antes pra fechar essa janela.
- **Dados de teste acumulados em staging (Laysla, `estabelecimento_id=3`), a limpar antes de considerar a feature pronta:**
  - `Teste Aguardando Confirmação` (já virou `concluido` pelo cron)
  - `Teste Editar no Histórico`, `Teste Sinal - Aguardando Conclusão`, `Teste Sinal - Editar Histórico`, `Teste Sinal - Sem Valor Registrado`
  - Os dois "Molde F1" da cliente `xuxa` (confirmados futuros) NÃO são deste teste — são dado pré-existente que revelou o bug do Histórico; não apagar sem confirmar com o Iorran.
- **Incidente registrado:** um lote de INSERT de teste foi rodado por engano em PRODUÇÃO (`estabelecimento_id=3`, que em produção é o Júnior, não a Laysla). As 3 linhas foram identificadas e apagadas por `id` na mesma sessão; confirmado limpo, sem dado real afetado. Lição de processo: sempre conferir o nome do projeto ativo no SQL Editor antes de qualquer INSERT/UPDATE/DELETE, especialmente depois de alternar entre staging e produção repetidas vezes na mesma sessão.
- **Confirmado nesta sessão, sem pendência:** as 4 colunas novas existem nos dois ambientes; não há CHECK travando `status='concluido'`; nenhuma policy de leitura anônima filtra por status (concluídos aparecem normalmente pra fidelidade/manutenção/painel da cliente); os 8 pontos de leitura que reconheciam só `confirmado` foram migrados pra `STATUS_SUCESSO`; o vazamento de "confirmado" aparecendo como "Concluído" no Histórico (geral e ficha do cliente) foi corrigido em duas rodadas, e o branch morto em `rotuloHistorico` foi removido.
- **UI aprovada nesta sessão:** aba "Aguardando Conclusão" renomeada (não colide mais com "confirmado"), virou sub-navegação dentro de "Pendentes" em formato de duas abas de pasta sempre visíveis, com reset automático pro inbox ao sair e voltar da aba pai. Card de conclusão ganhou exibição do sinal em 3 estados (sem sinal / sinal com valor gravado mostrando Sinal+Restante+Total / sinal pago sem valor registrado).
- Aba não mostra "conclui automaticamente em Xh" pra dona: `confirmado_expira_horas` não está em `lib/estabelecimento.js` nem em `lib/perfil.js`.
- Falta (`cancelado` + `nao_compareceu=true`) aparece como "Cancelado" no Histórico, sem rótulo nem filtro próprio de "Não compareceu". Decidir se vale.
- Badge de fidelidade, depois de "Editar" um concluído na ficha do cliente, só recalcula ao reabrir a ficha.
- Cobranças AbacatePay criadas antes deste deploy (QR ainda válido, reaproveitado) não passam pelo novo UPDATE e ficam sem `sinal_valor_centavos` — caem no estado "sinal pago, valor não registrado".
- Segundo comprovante Pix enviado com a linha já em `pendente` não faz UPDATE (comportamento pré-existente) — também não grava o valor do sinal nesse caso.
- Remarcação no fluxo manual (não-AbacatePay) cancela e recria a linha; a nova linha volta pra `aguardando_sinal` e só recebe `sinal_valor_centavos` quando a cliente declarar o pagamento de novo.

### AbacatePay — itens residuais (baixo risco, não bloqueiam ativação)
- Remarcação (`app/api/agendamentos/remarcar/route.js`): restauração best-effort do status da linha antiga quando o insert da nova falha, sem transação atômica — pode devolver `codigo: "restauracao_falhou"` em caso raro de conflito de horário. Mitigação barata: checar disponibilidade do horário novo antes de cancelar o antigo (não fecha a janela por completo, mas elimina a causa dominante). Fechar de vez exige RPC/transação no Postgres.
- Fail-open silencioso em `lib/estabelecimento.js` (`abacatepay_conectado: true` em erro de leitura): roda no browser da cliente, então um `console.warn` ali não ajuda a dona a perceber. Se quiser alertar a dona de fato, o lugar certo é instrumentar a rota `/api/abacatepay/conectado`.
- Rebaixamento silencioso da cascata de sinal Pix pra "desligado" (quando falta chave manual e credencial AbacatePay ao mesmo tempo): hoje o único aviso é o badge visual em Configurações e Pendentes — não há notificação ativa. Escolha de design consciente, mas vale reavaliar se algum tenant real cair nesse estado.

### Sinal obrigatório para etiqueta "Lista de Bloqueio" (Sessão 56)
- **Valéria (produção)** não tem nenhuma etiqueta cadastrada (nem as 5 padrão do checklist de novo tenant) — o checkbox "Cobrar sinal de clientes na Lista de Bloqueio" fica desabilitado pra esse tenant até alguém criar as etiquetas retroativamente.
- **Staging** está incompleto: só a Laysla tem etiquetas, e "Lista de Bloqueio" precisou ser criada manualmente pra viabilizar o teste da Sessão 56. Flávia, Junior e Valéria não têm etiqueta nenhuma em staging — dificulta testes futuros de qualquer feature baseada em etiqueta nesse ambiente.
- Cards antigos duplicados de cancelamento em produção (anteriores a 27/08, já registrados abaixo em "Limpar lixo de teste") agora ficam **visualmente idênticos** depois da troca de título ("{nome} cancelou o agendamento" nos dois) — antes dava pra diferenciar pelo texto. Não é bug novo, só ficou mais difícil de notar a olho; arquivar quando conveniente.

### Ocultar preço/duração globais (nova, Sessão 57)
- **Junior (produção) não foi ajustada.** Só Laysla (`ocultar_duracao_servicos=true`) e Flávia (default) foram configuradas nesta sessão, refletindo o estado real que cada uma tinha por serviço. A Junior tem o mesmo padrão de uso real da Laysla (duração oculta em 16 de 29 serviços/manutenções ativos e inativos) e ficou com os dois toggles no default (`false`/`false`) — decidir com o Iorran e rodar o UPDATE equivalente, senão a Junior passa a mostrar duração que hoje escondia.
- Colunas antigas `servicos.ocultar_preco` e `servicos.ocultar_duracao` continuam no banco sem uso (a UI não lê nem grava mais nelas) — candidatas a remoção futura numa limpeza de schema.
- Com preço oculto, o bloco "Sua última manutenção já passou do prazo…" continua aparecendo, só sem o valor numérico. Se preferir sumir com o bloco inteiro nesse caso, é um ajuste de uma linha.

### Popup de virada de mês — 2 meses (nova, Sessão 57)
- Aviso de React pré-existente: "Cannot update AdminPage while rendering ConfiguracoesSalao", em `salvarMes` (`ConfiguracoesSalao.js:1591`) — não afeta funcionamento, mas vale corrigir numa sessão futura.
- Seletor "Meses editáveis" mostra "3 meses" mesmo quando o alcance real do salão é 4 (o default) — o dropdown só oferece 3/6/12, sem opção pra 4. Ajustar pra refletir o valor real ou incluir a opção.
- Salão de Teste (staging) ficou com setembro e outubro/2026 gravados como "Fechado" depois do teste manual desta sessão. Pra repetir o teste do zero (voltar ao estado "sem registro"), é preciso apagar essas duas linhas de `janela_agendamento_meses` no banco.

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
- Divergência de `roles` na policy "Público pode cancelar próprio agendamento" entre staging (`{anon,authenticated}`) e produção (`{anon}`) — ver item de segurança acima (Sessão 58): essa policy tem um problema maior que a divergência de roles.
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
- Erro HTTP 400 recorrente no console, sem URL identificada — apareceu em pelo menos três sessões diferentes (respiro do botão de contato, Sessão 55/56; teste da Lista de Bloqueio, Sessão 56; teste do popup de virada de mês no `/admin`, Sessão 57). Não é exclusivo do `/agendar`. Não bloqueou nenhum fluxo testado, mas a origem não foi rastreada ainda.

## Backlog
- Troca estética "Confirmado" → "Agendado" (nova, Sessão 58): manter o valor de banco `confirmado` como está, trocar só o RÓTULO exibido pra "Agendado" em todo lugar visível à dona/cliente. Ainda não iniciado: precisa de um raio-x dedicado pra mapear com precisão onde é texto exibido (vira "Agendado") vs. onde é o valor cru de status usado em lógica (`status === "confirmado"`, continua igual). Ponto de nomeação a revisitar: a aba "Aguardando Conclusão" fica ao lado de "Pendentes" — se o rótulo virar "Agendado", vale considerar se algum nome de aba entra em tensão semântica de novo.
- Callback de patch para `sinal_regra` em `ConfiguracoesSalao.js` → `AdminPage`, evitando staleness do aviso de Pendentes até reload da página.
- Confirmar no código real como `clienteEhNovo` é calculado em `precisaSinal` (ramo `'novos'`) — discutido em profundidade numa sessão anterior, não investigado ainda.
- Criar as 5 etiquetas padrão retroativamente para a Valéria (produção) e para Flávia/Junior/Valéria em staging, alinhando com o `NOVO_TENANT_CHECKLIST.md`.

### Ocultar preço/duração globais (nova, Sessão 57)
- Colunas antigas `servicos.ocultar_preco` e `servicos.ocultar_duracao` continuam no banco sem uso (a UI não lê nem grava mais nelas) — candidatas a remoção futura numa limpeza de schema.
- Com preço oculto, o bloco "Sua última manutenção já passou do prazo…" continua aparecendo, só sem o valor numérico. Se preferir sumir com o bloco inteiro nesse caso, é um ajuste de uma linha.

### Em aberto
- [ ] Serviços — "Manutenção vinda de outro salão": revisar como esse checkbox se comporta.
  Hoje é independente e pode ser marcado em quantos serviços a dona quiser, mas na prática
  deveria ser único por estabelecimento (é uma categoria conceitual só, não vários serviços
  externos). Também precisa ficar mutuamente exclusivo com "Este item é uma manutenção" —
  regra de negócio: manutenção vinda de fora não tem prazo de manutenção próprio (não existe
  "manutenção da manutenção externa"), então marcar um devia esconder/desmarcar o outro.
  Vale desenhar a UI com calma antes de implementar (sessão XX).