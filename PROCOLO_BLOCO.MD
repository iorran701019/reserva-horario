## Recursos órfãos e inventário (regra da Sessão 82)

- Todo recurso novo — coluna, flag, texto padrão, sintaxe dentro de campo, constante por salão — nasce com a resposta para "quem edita e onde?": **dona** (conteúdo do negócio), **painel global** (identidade, cobrança, infraestrutura), **código fixo documentado** ou **remover**.
- A resposta entra no `INVENTARIO_RECURSOS.md` no mesmo commit/fechamento da demanda. Nada novo fica "só SQL" ou "só código" sem entrada no inventário.
- Texto padrão visto pela cliente final é neutro: nunca cita tenant, segmento ("barbearia") nem "Teste".
- Papel no código (etiqueta, tipo) sempre por id ou coluna própria, nunca pelo nome que a dona digitou.
- Sintaxe especial dentro de campo de texto (`---`, `{marcador}`) só nasce com dica na tela ou editor estruturado.
- Hotfix por SQL para um tenant é aceitável, mas abre uma linha no inventário com o destino definitivo.
- Confirmar o deploy em Production antes de rodar SQL de dado que depende do código novo.
- Prompt do Claude Code local: criar a branch (`git checkout -b`, a partir da `main` atualizada) antes de qualquer edição; pedir `git show` do diff antes de aprovar.
- Fechamento de sessão: revisar o inventário (o que mudou de decisão) junto do `PENDENCIAS.md`.