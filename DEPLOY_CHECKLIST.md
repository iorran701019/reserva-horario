# Deploy Checklist — reserva-horario

## Antes do merge
- [ ] `git branch backup-main-antes-do-merge`
- [ ] Resolver conflitos com atenção a nomes de função duplicados (main x feature)
- [ ] `npm run build` local — deve passar limpo antes de qualquer push pra main

## SQL em produção
- [ ] Rodar SELECT de conferência e ALTER/CREATE em ações separadas no SQL Editor
- [ ] Testar em staging antes de replicar em produção

## Vercel
- [ ] Variáveis de ambiente conferidas separadamente por ambiente (Production x Preview)
- [ ] Reativar "Vercel Authentication" (Deployment Protection) após demo/preview compartilhado

## Pós-deploy
- [ ] Smoke test na URL real (não só local)
- [ ] Confirmar RLS ativo nas tabelas novas (anon + authenticated)