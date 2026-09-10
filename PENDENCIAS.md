# Pendências — reserva-horario

## Em aberto

### AbacatePay — itens residuais (baixo risco, não bloqueiam ativação)
- Remarcação (`app/api/agendamentos/remarcar/route.js`): restauração best-effort do status da linha antiga quando o insert da nova falha, sem transação atômica — pode devolver `codigo: "restauracao_falhou"` em caso raro de conflito de horário. Mitigação barata: checar disponibilidade do horário novo antes de cancelar o antigo (não fecha a janela por completo, mas elimina a causa dominante). Fechar de vez exige RPC/transação no Postgres.
- Fail-open silencioso em `lib/estabelecimento.js` (`abacatepay_conectado: true` em erro de leitura): roda no browser da cliente, então um `console.warn` ali não ajuda a dona a perceber. Se quiser alertar a dona de fato, o lugar certo é instrumentar a rota `/api/abacatepay/conectado`.
- Rebaixamento silencioso da cascata de sinal Pix pra "desligado" (quando falta chave manual e credencial AbacatePay ao mesmo tempo): hoje o único aviso é o badge visual em Configurações e Pendentes — não há notificação ativa. Escolha de design consciente, mas vale reavaliar se algum tenant real cair nesse estado.

### Marca Acolhe (logo, tagline, link de suporte)
- Responsividade do menu-drawer do `/admin` em telas baixas/paisagem: com o ícone da logo em `h-16`, o rodapé do drawer passa a ocupar ~279px fixos — em paisagem no celular (~360px de altura) sobra só ~24px pro `<nav>` das 8 abas rolarem. Nada quebra, mas fica apertado. Sugestão registrada: `h-10 sm:h-16` (compacto só no breakpoint pequeno).
- Confirmar visualmente o Ponto 2 da logo com tagline no `/agendar` (tela de protocolo pós-submit, `app/[salon]/page.js`) — verificado só por código e build; o Salão de Teste não tem nenhum mês aberto na agenda, então não foi possível fechar um agendamento de teste pra ver a tela ao vivo.
- Fase futura, ainda não desenhada: logo do `/admin` (Hero, cabeçalho) virar link pro Instagram do Acolhe — item distinto do link de Suporte já entregue no menu-drawer.
- Dois clientes de teste ficaram cadastrados no Salão de Teste (sandbox, sem dado real): `Teste Logo Rodape` (24) 98877-6655 e `Teste Anamnese Rodape` (24) 98877-6600 — remover quando quiser limpar.

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