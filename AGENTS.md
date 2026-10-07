<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Regras do projeto
Resumo do PROTOCOLO_DESENVOLVIMENTO.md (leia o protocolo inteiro antes de demanda grande; consulte PENDENCIAS.md e INVENTARIO_RECURSOS.md quando a tarefa tocar neles).
- Crie a branch (git checkout -b, a partir da main atualizada) antes de editar. Nunca edite na main.
- Não faça commit, push nem merge. Devolva git status e git diff. Sugira a mensagem de commit em uma linha, com aspas simples e sem aspas duplas.
- Não rode next build nem next dev, não suba servidor e não encerre processos.
- Nunca escreva SQL, nem em arquivo de sql/. Descreva em prosa o que o banco precisa; o SQL é feito no chat do projeto.
- Investigue antes de implementar. Veja git diff ou trechos específicos antes de reescrever arquivo grande e altere só o necessário.
- Coluna nova em estabelecimentos entra nos dois selects: lib/estabelecimento.js e lib/perfil.js.
- Todo recurso novo diz quem edita e onde (dona, painel global, código fixo ou remover) e ganha linha em INVENTARIO_RECURSOS.md.
- Texto padrão visto pela cliente final é neutro: nunca cita segmento (barbearia), tenant ou Teste.
- Etiqueta ou papel no código: sempre por id ou coluna própria, nunca pelo nome digitado.
- Cores sempre por token do tema (text-on-primary, text-on-card, bg-overlay); regras completas em THEMING.md.
- Datas: new Date(ano, mes-1, dia), nunca new Date("YYYY-MM-DD").
- Arquivos .md de controle: entregue o arquivo completo, nunca só o diff.
