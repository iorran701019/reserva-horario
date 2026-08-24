# Pendências

## Resolvido
- [x] Bug em `salvarOpcoesPergunta` (apaga-e-recria opções a cada edição, quebrando `opcao_gatilho_id` via `ON DELETE SET NULL`) — corrigido com upsert seletivo (update/insert/delete por id).

## Em aberto
- [ ] UX da configuração de pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, mas complexa pra configurar; considerar assistente passo-a-passo ou fluxo guiado no futuro.
