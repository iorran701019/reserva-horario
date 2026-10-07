# Acolhe (reserva-horario)
Agendamento online multi-tenant para salões e profissionais de beleza: cada salão tem seu `/<slug>` público e seu `/<slug>/admin`. Next.js (App Router) + Supabase + Vercel.

**Rodar localmente:** `npm install`, criar `.env.local` com as chaves do Supabase (nunca commitar) e `npm run dev` (`npm run build`, `npm start` e `npm run lint` também existem).

**Documentação**
- `AGENTS.md` / `CLAUDE.md`: instruções carregadas pelo Claude Code em toda sessão.
- `PROTOCOLO_DESENVOLVIMENTO.md`: fluxo de trabalho, Git, SQL, segurança e regras de arquitetura.
- `NOVO_TENANT.md`: conversa presencial com a dona (Parte A) e passo a passo técnico para um novo salão (Parte B).
- `THEMING.md`: tema, cores e logo por tenant. `PENDENCIAS.md`: fila de trabalho, bugs e backlog.
- `CHECKLIST_RELEASE.md`: antes do merge, SQL e schema, deploy na Vercel e testes pós-merge por área.
- `docs/`: handoffs de sessões passadas e `identidade-visual/` (assets de marca, não usados no build).
