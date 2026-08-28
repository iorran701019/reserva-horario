# Pendências

## Resolvido
- [x] Bug em `salvarOpcoesPergunta` (apaga-e-recria opções a cada edição, quebrando `opcao_gatilho_id` via `ON DELETE SET NULL`) — corrigido com upsert seletivo (update/insert/delete por id).
- [x] "Não" nas perguntas Sim/Não mostrando campos de ajuste (preço/duração) desnecessariamente — resolvido junto com a feature de duração: campos ficam escondidos atrás de um link "+ adicionar ajuste também pro Não", só expandindo se a pergunta já tinha algum valor salvo ali.
- [x] Expiração automática de pré-agendamentos vencidos (job pg_cron a cada 15min, cancela e marca `expirado_automaticamente=true`) — libera o horário na agenda e some sozinho de Pendentes.
- [x] Popup de confirmação "fora da janela de agendamento" (admin/modo livre e confirmação de pendente) — decisão consciente da dona em vez de aceitar em silêncio.
- [x] Botão "Alterar data" ganhou opção de notificar ou não o cliente via WhatsApp (novo template `msg_alteracao_data`, editável em Configurações).
- [x] Botões Confirmar/Cancelar padronizados (dividido, com opção "sem notificar") em todos os pontos do sistema: Pendentes inbox, seção "Fora da janela", e modal de Detalhes do Painel.
- [x] Tag "Comprovante declarado pelo WhatsApp" no card de Pendentes, quando a cliente confirma o sinal sem anexar arquivo (sessão 27/08).
- [x] Contraste baixo nos botões neutros da tela de protocolo (Ver localização, Ver agendamentos, Editar) na Laysla, corrigido com `bg-surface` + `text-heading` (sessão 27/08).
- [x] Editar e cancelar agendamento na tela de confirmação de sinal, tanto pelo link do salão quanto pelo botão "Confirmar pagamento" do PainelCliente (sessão 27/08).
- [x] Voltar e escolher outro horário, ou cancelar, direto na tela de Pix dentro do wizard — sem deixar reserva órfã presa no sistema (sessão 27/08).
- [x] Cancelamento de agendamento ainda não confirmado (`aguardando_sinal`/`pendente`) não notifica mais a dona via WhatsApp; só agendamentos já `confirmado` continuam avisando (sessão 27/08).
- [x] Resumo de nome, serviço, data e horário no topo da tela de Pix, nos 3 pontos onde ela aparece, substituindo a linha duplicada "Agendando para" (sessão 27/08).
27/08/2026
+ - [x] Pendentes: botão "Ver" nos agendamentos confirmados, abrindo painel/dia com o modal do agendamento já aberto (sessão 33)
+ - [x] Pendentes: truncar lista de agendamentos confirmados em 2 itens com toggle "+N outros"/"Mostrar menos", e inverter ênfase visual (dados do agendamento em destaque, confirmados rebaixados) (sessão 33)
- [x] Upload de comprovante Pix no Android não oferecia opção de Galeria — corrigido separando em dois inputs de accept único (imagem/PDF) (Sessão 32)
- [x] Compactação dos handoffs das Sessões 1–20 num único arquivo de arquivo morto, originais removidos do projeto (Sessão 32)
- [x]Ordem dos controles de crop da foto de perfil (Zoom → Vertical → Horizontal) (sessão 34)
- [x]Foto por categoria de serviço em /agendar, com crop e zoom em tela cheia (sessão 34)
- [x]Botão "Remover foto" no perfil e nas categorias de serviço (sessão 34)
- [x]Pendência de cancelamento duplicada em Pendentes (dois sinks gravando a mesma pendência) (sessão 34)
- [x] Botão "Ver meus agendamentos" removido da entrada direta na tela de confirmação de sinal Pix — evita que a cliente saia do fluxo de resolver aquele agendamento específico (Sessão 35).
- [x] Consumo de cota "Claude Browser MCP" (38%) investigado e corrigido — causa era o toggle "Claude in Chrome" nas Configurações do claude.ai, não MCP do Claude Code. Desativado por Iorran (Sessão 35).

## Em aberto
- [ ] UX da configuração de pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, mas complexa pra configurar; considerar assistente passo-a-passo ou fluxo guiado no futuro.
27/08/2026
- [ ] Polish visual dos botões de upload de comprovante (unificar "Enviar print/foto" e "Enviar PDF" num botão principal + link secundário) — desenhado, prompt pronto, adiado por decisão consciente até confirmar se a fricção reportada se repete no uso real das clientes (Sessão 32)
- [ ]Testar ao vivo a correção da pendência de cancelamento duplicada — cancelar agendamento de teste no sandbox e confirmar que só uma pendência aparece (sessão 34)
- [ ]Confirmar que a remoção de foto de perfil está funcionando após o fix do NOT NULL em foto_perfil_zoom (sessão 34)
- [ ]Investigar updates sem .select() em ConfiguracoesSalao.js — risco de "Salvo ✓" falso mascarando bloqueios de RLS (sessão 34)

## Segurança — auditoria RLS/Storage (retomar semana que vem)
- [ ] Upload de comprovante Pix quebrado em staging: bucket `comprovantes-pix` aceita INSERT anônimo, mas falta policy de UPDATE que o `upsert:true` do app exige — hoje toda cliente que anexa arquivo real provavelmente cai silenciosamente no caminho do checkbox.
- [ ] DELETE via sessão autenticada do admin não funciona em `agendamentos`/Storage — sem policy de DELETE, o PostgREST retorna 204 "de sucesso" mesmo apagando 0 linhas; só `service_role` conseguiu apagar de fato.
- [ ] Confirmar se reservas em `aguardando_sinal` (cliente abandona antes de declarar/anexar o Pix) têm alguma expiração automática, ou se ficam presas indefinidamente ocupando o slot — checar se o job `expirar_reservas_pendentes` cobre esse status ou só `pendente`.
- [ ] `BlocoConfirmacaoPix` não recebe `jaPendente` do wizard — editar um agendamento já `pendente` (não mais `aguardando_sinal`) reabre o bloco cru e permite reescrever `pendente_desde`, reiniciando a janela do protocolo (48h) sem necessidade.

