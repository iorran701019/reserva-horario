# Pendências

## Resolvido
- [x] Bug em `salvarOpcoesPergunta` (apaga-e-recria opções a cada edição, quebrando `opcao_gatilho_id` via `ON DELETE SET NULL`) — corrigido com upsert seletivo (update/insert/delete por id).
- [x] "Não" nas perguntas Sim/Não mostrando campos de ajuste (preço/duração) desnecessariamente — resolvido junto com a feature de duração: campos ficam escondidos atrás de um link "+ adicionar ajuste também pro Não", só expandindo se a pergunta já tinha algum valor salvo ali.## Resolvido
- [x] Expiração automática de pré-agendamentos vencidos (job pg_cron a cada 15min, cancela e marca `expirado_automaticamente=true`) — libera o horário na agenda e some sozinho de Pendentes.
- [x] Popup de confirmação "fora da janela de agendamento" (admin/modo livre e confirmação de pendente) — decisão consciente da dona em vez de aceitar em silêncio.
- [x] Botão "Alterar data" ganhou opção de notificar ou não o cliente via WhatsApp (novo template `msg_alteracao_data`, editável em Configurações).
- [x] Botões Confirmar/Cancelar padronizados (dividido, com opção "sem notificar") em todos os pontos do sistema: Pendentes inbox, seção "Fora da janela", e modal de Detalhes do Painel.

## Em aberto
- [ ] UX da configuração de pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, mas complexa pra configurar; considerar assistente passo-a-passo ou fluxo guiado no futuro.

