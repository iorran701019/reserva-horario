# Acolhe (reserva-horario)
Agendamento online multi-tenant para salões e profissionais de beleza: cada salão tem seu `/<slug>` público e seu `/<slug>/admin`. Next.js (App Router) + Supabase + Vercel.

**Rodar localmente:** `npm install`, criar `.env.local` com as chaves do Supabase (nunca commitar) e `npm run dev` (`npm run build`, `npm start` e `npm run lint` também existem).

**Documentação**
- `AGENTS.md` / `CLAUDE.md`: instruções carregadas pelo Claude Code em toda sessão.
- `PROTOCOLO_DESENVOLVIMENTO.md`: fluxo de trabalho, Git, SQL, segurança e regras de arquitetura.
- `PROTOCOLO_NOVO_TENANT.md` e `NOVO_TENANT_CHECKLIST.md`: roteiro da conversa com a dona e passo a passo técnico para um novo salão.
- `THEMING.md`: tema, cores e logo por tenant. `PENDENCIAS.md`: fila de trabalho, bugs e backlog.
- `QA_CHECKLIST.md` e `DEPLOY_CHECKLIST.md`: testes pós-merge e cuidados de deploy.
- `docs/`: handoffs de sessões passadas e `identidade-visual/` (assets de marca, não usados no build).
