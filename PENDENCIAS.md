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

## Em aberto
- [ ] UX da configuração de pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, mas complexa pra configurar; considerar assistente passo-a-passo ou fluxo guiado no futuro.

## Segurança — auditoria RLS/Storage (retomar semana que vem)
- [ ] Upload de comprovante Pix quebrado em staging: bucket `comprovantes-pix` aceita INSERT anônimo, mas falta policy de UPDATE que o `upsert:true` do app exige — hoje toda cliente que anexa arquivo real provavelmente cai silenciosamente no caminho do checkbox.
- [ ] DELETE via sessão autenticada do admin não funciona em `agendamentos`/Storage — sem policy de DELETE, o PostgREST retorna 204 "de sucesso" mesmo apagando 0 linhas; só `service_role` conseguiu apagar de fato.
- [ ] Confirmar se reservas em `aguardando_sinal` (cliente abandona antes de declarar/anexar o Pix) têm alguma expiração automática, ou se ficam presas indefinidamente ocupando o slot — checar se o job `expirar_reservas_pendentes` cobre esse status ou só `pendente`.
- [ ] `BlocoConfirmacaoPix` não recebe `jaPendente` do wizard — editar um agendamento já `pendente` (não mais `aguardando_sinal`) reabre o bloco cru e permite reescrever `pendente_desde`, reiniciando a janela do protocolo (48h) sem necessidade.