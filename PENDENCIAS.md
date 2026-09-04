## Resolvido
- [x] Bug em `salvarOpcoesPergunta` (apaga-e-recria opções a cada edição, quebrando `opcao_gatilho_id` via `ON DELETE SET NULL`) — corrigido com upsert seletivo (update/insert/delete por id).
- [x] "Não" nas perguntas Sim/Não mostrando campos de ajuste (preço/duração) desnecessariamente — resolvido junto com a feature de duração: campos ficam escondidos atrás de um link "+ adicionar ajuste também pro Não", só expandindo se a pergunta já tinha algum valor salvo ali.
- [x] Expiração automática de pré-agendamentos vencidos (job pg_cron a cada 15min, cancela e marca `expirado_automaticamente=true`) — libera o horário na agenda e some sozinho de Pendentes.
- [x] Popup de confirmação "fora da janela de agendamento" (admin/modo livre e confirmação de pendente) — decisão consciente da dona em vez de aceitar em silêncio.
- [x] Botão "Alterar data" ganhou opção de notificar ou não o cliente via WhatsApp (novo template `msg_alteracao_data`, editável em Configurações).
- [x] Botões Confirmar/Cancelar padronizados (dividido, com opção "sem notificar") em todos os pontos do sistema: Pendentes inbox, seção "Fora da janela", e modal de Detalhes do Painel.
- [x] Tag "Comprovante declarado pelo WhatsApp" no card de Pendentes, quando a cliente confirma o sinal sem anexar arquivo (sessão 27).
- [x] Contraste baixo nos botões neutros da tela de protocolo (Ver localização, Ver agendamentos, Editar) na Laysla, corrigido com `bg-surface` + `text-heading` (sessão 27).
- [x] Editar e cancelar agendamento na tela de confirmação de sinal, tanto pelo link do salão quanto pelo botão "Confirmar pagamento" do PainelCliente (sessão 27).
- [x] Voltar e escolher outro horário, ou cancelar, direto na tela de Pix dentro do wizard — sem deixar reserva órfã presa no sistema (sessão 27).
- [x] Cancelamento de agendamento ainda não confirmado (`aguardando_sinal`/`pendente`) não notifica mais a dona via WhatsApp; só agendamentos já `confirmado` continuam avisando (sessão 27).
- [x] Resumo de nome, serviço, data e horário no topo da tela de Pix, nos 3 pontos onde ela aparece, substituindo a linha duplicada "Agendando para" (sessão 27).
- [x] Pendentes: botão "Ver" nos agendamentos confirmados, abrindo painel/dia com o modal do agendamento já aberto (sessão 33).
- [x] Pendentes: truncar lista de agendamentos confirmados em 2 itens com toggle "+N outros"/"Mostrar menos", e inverter ênfase visual (dados do agendamento em destaque, confirmados rebaixados) (sessão 33).
- [x] Upload de comprovante Pix no Android não oferecia opção de Galeria — corrigido separando em dois inputs de accept único (imagem/PDF) (sessão 32).
- [x] Compactação dos handoffs das Sessões 1–20 num único arquivo de arquivo morto, originais removidos do projeto (sessão 32).
- [x] Ordem dos controles de crop da foto de perfil (Zoom → Vertical → Horizontal) (sessão 34).
- [x] Foto por categoria de serviço em /agendar, com crop e zoom em tela cheia (sessão 34).
- [x] Botão "Remover foto" no perfil e nas categorias de serviço (sessão 34).
- [x] Pendência de cancelamento duplicada em Pendentes (dois sinks gravando a mesma pendência) — corrigido no código em produção (sessão 34).
- [x] Botão "Ver meus agendamentos" removido da entrada direta na tela de confirmação de sinal Pix — evita que a cliente saia do fluxo de resolver aquele agendamento específico (sessão 35).
- [x] Consumo de cota "Claude Browser MCP" (38%) investigado e corrigido — causa era o toggle "Claude in Chrome" nas Configurações do claude.ai, não MCP do Claude Code. Desativado por Iorran (sessão 35).
- [x] Serviços da Valéria sincronizados com os da Flávia em produção — categorias e serviços idênticos (sessão 36).
- [x] Campo de opção de múltipla escolha (Serviços → pergunta) pequeno e com zoom automático no celular real (sessão 36).
- [x] Overflow do cabeçalho na ficha do cliente em Clientes (botões vazando a borda em telas estreitas) — cabeçalho reestruturado em três blocos empilhados: nome, telefone, botões (sessão 37).
- [x] Botão "Entrar em contato" (WhatsApp sem mensagem pronta) na ficha do cliente, ao lado de Agendar/Alterar WhatsApp/Editar (sessão 37).
- [x] Cancelar agendamento (com/sem notificar) direto na ficha do cliente, reaproveitando o modal e handler globais de Pendentes; corrigida a demora do card em refletir o cancelamento (sessão 37).
- [x] "Próximo agendamento" na ficha do cliente virou carrossel navegável de todos os agendamentos confirmados futuros, não só o mais próximo (componente reutilizável `CarrosselAgendamentos.js`) (sessão 37).
- [x] Botão "Voltar" da ficha do cliente redesenhado (de link de texto pra botão real, com ícone) (sessão 37).
- [x] Anamnese preenchida pelo admin não exige mais aceite de termos (era exigido do cliente, sem sentido pra dona); aceite histórico do cliente é preservado no registro novo (sessão 37).
- [x] Duplicidade de pendência de cancelamento em staging (Laysla) diagnosticada — causa raiz não era código (a correção da sessão 34 já estava certa em produção), e sim deploy de staging desatualizado; linha órfã removida manualmente via SQL (sessão 37).
- [x] Filtro por nome no topo do Histórico geral (sessão 37).
- [x] Filtro por cliente específico no Histórico, com autocomplete e paginação trimestral independente do filtro de categoria/mês (reaproveitando hooks de trimestre que estavam órfãos no repo desde a migração pra navegação mensal) (sessão 37).
- [x] Removido contador numérico (ex: "Expirado (12)") do select de categoria do Histórico — não refletia o mês selecionado, gerava confusão (sessão 37).
- [x] Nome do cliente no card do Histórico virou link que navega até o perfil dele em Clientes (sessão 37).
- [x] Rótulo visual "Confirmado" renomeado para "Agendado" em badges, mensagem padrão de WhatsApp, botão do wizard e relatório de pendentes — status interno do banco continua "confirmado", sem mudança de lógica (sessão 37).
- [x] No bloco de agendamentos já marcados em Pendentes, botão "Ver" (azul) virou badge "Agendado" (verde) (sessão 37).
- [x] Tag "Agendado"/"Sem agenda" na lista de Clientes, indicando se o cliente tem algum agendamento confirmado futuro (sessão 37).
- [x] Novo indicador de "Cadastro incompleto" na ficha do cliente, reagindo em tempo real após edição (sessão 37).
- [x] Simplificação da lista de Clientes: removidas as tags de Fidelidade e Anamnese (já cobertas na ficha); código morto removido (`ChipFidelidadeLista`, busca em lote de anamneses) — carregamento da aba caiu de 3 queries para 1 (sessão 37).
+ [x] Simplificação da lista de Clientes: removidas as tags de Fidelidade e Anamnese (já cobertas na ficha); código morto removido (`ChipFidelidadeLista`, busca em lote de anamneses) — carregamento da aba caiu de 3 queries para 1 (sessão 37).
+ [x] Histórico do painel cliente em /agendar limitado a altura de ~4 itens com scroll interno, evitando lista crescendo indefinidamente e empurrando o rodapé (sessão 38).
+ [x] Nome da cliente no modal de detalhes do Painel Dia (admin) virou link sublinhado para a ficha em Clientes, reaproveitando a mesma lógica/navegação já usada no Histórico geral; modal fecha automaticamente ao navegar (sessão 38).
+ [x] Card "Próximos agendamentos" na ficha do cliente ganhou fundo verde sutil quando o agendamento está confirmado, em harmonia com a tag "Agendado" (sessão 38).
+ [x] Checkbox "Manutenções contam pra meta" em Fidelidade agora fica desabilitado e visualmente esmaecido quando o programa está inativo, mesma regra já aplicada ao campo de meta (sessão 38).
+ [x] Calendário do /agendar pula automaticamente para o primeiro mês com disponibilidade ao entrar na etapa de escolha de data, mantendo navegação manual livre para ver meses sem vaga; nova função `calcularPrimeiroMesComVaga` em `lib/disponibilidade.js` reaproveita a base de disponibilidade entre meses varridos (sessão 38).
+ - [x] RLS: policy de DELETE em `agendamentos` criada (authenticated, isolado por tenant, só permite excluir agendamento não-confirmado) (sessão 39)
+ - [x] RLS/Storage: reconfirmado que Grupo 1+2 da auditoria seguem intactos em produção após as sessões 29-38 (sessão 39)
+ - [x] RLS/Storage: policy de UPDATE em `comprovantes-pix` confirmada correta em produção (o gap era só em staging) (sessão 39)
+ - [x] RLS/Storage: confirmado que `expirar_reservas_pendentes` já cobre `aguardando_sinal`, sem gap de expiração (sessão 39)
+ - [x] Raio-x de risco silencioso — Severidade 1 completa: 6 frentes de gravação de dado de cliente/agendamento corrigidas (`.select()` + checagem de 0-row + aviso visível) (sessão 39)
+ - [x] Raio-x de risco silencioso — Severidade 2 completa: 27 pontos de configuração/preferências corrigidos, novo helper `lib/erroSalvar.js` (sessão 39)
+ - [x] Raio-x de risco silencioso — Severidade 3 completa: 23 pontos em Serviços/Profissionais corrigidos, incluindo proteção contra grade duplicada em 4 pontos de delete+insert em cascata (sessão 39)
+ - [x] Bug de duplicidade de pendência de cancelamento (staging): causa raiz real encontrada (URL de webhook hardcoded pra deployment Preview congelado) e corrigida com branch `staging` permanente + triggers atualizados (sessão 39)
+ - [x] Sistema de etiquetas de cliente: CRUD, seletor rápido, badges em Pendentes/wizard admin/ficha de cliente (Sessão 40)
+ - [x] Gate obrigatório de etiqueta ao Confirmar/Cancelar em Pendentes (etiqueta ausente + "Cliente Nova" recorrente), cobrindo as 8 zonas de Pendentes (Sessão 40)
+ - [x] Regra de restrição de agenda por etiqueta ("Agenda de Dezembro"), incluindo propagação de etiqueta_id no fluxo público de identificação (Sessão 40)

## Em aberto
- [ ] UX da configuração de pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, mas complexa pra configurar; considerar assistente passo-a-passo ou fluxo guiado no futuro.
- [ ] Polish visual dos botões de upload de comprovante (unificar "Enviar print/foto" e "Enviar PDF" num botão principal + link secundário) — desenhado, prompt pronto, adiado até confirmar se a fricção reportada se repete no uso real (sessão 32).
- [ ] Testar ao vivo a correção da pendência de cancelamento duplicada em produção (sessão 34) — a de staging foi diagnosticada e limpa nesta sessão (37), mas produção não foi reconfirmada.
- [ ] Confirmar que a remoção de foto de perfil está funcionando após o fix do NOT NULL em `foto_perfil_zoom` (sessão 34).
- [ ] Investigar updates sem `.select()` em `ConfiguracoesSalao.js` — risco de "Salvo ✓" falso mascarando bloqueios de RLS (sessão 34).
- [ ] Verificar no dashboard da Vercel qual commit está publicado no ambiente de staging — suspeita de deploy preso numa branch antiga, causando bugs "fantasma" já corrigidos em `main` (sessão 37).
- [ ] Popup de renovação de anamnese (renovar por 12 meses vs. manter o prazo já editado pelo cliente) — não implementado; precisa de duas colunas novas via SQL antes de qualquer código: vencimento explícito em `anamnese_respostas` (hoje sempre derivado de `criado_em` + 12 meses) e prazo configurável em `estabelecimentos` (sessão 37).
- [ ] `buscarUltimasAnamnesesPorCliente` (`lib/anamnese.js`) ficou sem nenhum consumidor no repo após a simplificação da lista de Clientes — não é urgente, candidata a limpeza futura (sessão 37).
+ - [ ] Divergência de `roles` na policy "Público pode cancelar próprio agendamento" entre staging e produção — confirmar se é intencional (sessão 39)
+ - [ ] Limpar lixo de teste (`Cancelamento: {nome}`) em `pendencias_admin` de staging (sessão 39)
+ - [ ] Sincronizar branch `staging` com `main` após cada merge relevante, daqui pra frente (protocolo novo, sessão 39)
- PENDENTE, alta prioridade (achado 03/09): pergunta condicional (filha) é salva com pergunta_pai_id e opcao_gatilho_id NULL mesmo com checkbox "depende de outra" marcado e os dois selects preenchidos na tela — reproduzido em produção (tenant Júnior, serviços 148 e 150), em aba anônima (não é cache), com produção já rodando o fix bb37040 (não é deploy desatualizado). Investigação de código não encontrou caminho no state/payload capaz de gerar esse NULL com o checkbox marcado — contradição ainda não resolvida entre o código revisado e o comportamento real. Hipótese em aberto: dado do Network pode ter sido lido da Response em vez do Request Payload (precisa reconfirmar), ou corrida de timing entre o clique na opção-gatilho e o clique em salvar. Handoff detalhado com histórico completo da investigação e próximos passos: reserva-horario_Handoff_Bug_Pergunta_Condicional_Nao_Salva.md.
- [ ] Bloqueio temporário de novembro (Laysla): bloquear mês inteiro com liberação automática numa data (Sessão 40)
- [ ] Slots de dezembro da Flávia — 3 abordagens mapeadas (Sessão 38); **substituída pela regra de restrição por etiqueta, item resolvido acima**

## Segurança — auditoria RLS/Storage (retomar semana que vem)
- [ ] Upload de comprovante Pix quebrado em staging: bucket `comprovantes-pix` aceita INSERT anônimo, mas falta policy de UPDATE que o `upsert:true` do app exige — hoje toda cliente que anexa arquivo real provavelmente cai silenciosamente no caminho do checkbox.
- [ ] DELETE via sessão autenticada do admin não funciona em `agendamentos`/Storage — sem policy de DELETE, o PostgREST retorna 204 "de sucesso" mesmo apagando 0 linhas; só `service_role` conseguiu apagar de fato.
- [ ] Confirmar se reservas em `aguardando_sinal` (cliente abandona antes de declarar/anexar o Pix) têm alguma expiração automática, ou se ficam presas indefinidamente ocupando o slot — checar se o job `expirar_reservas_pendentes` cobre esse status ou só `pendente`.
- [ ] `BlocoConfirmacaoPix` não recebe `jaPendente` do wizard — editar um agendamento já `pendente` (não mais `aguardando_sinal`) reabre o bloco cru e permite reescrever `pendente_desde`, reiniciando a janela do protocolo (48h) sem necessidade.