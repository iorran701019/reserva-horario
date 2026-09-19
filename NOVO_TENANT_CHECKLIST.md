# Checklist — configurar um novo tenant do zero

Ordem sugerida (cada item depende do anterior). Rodar sempre em staging primeiro.

## 1. Estabelecimento
```sql
insert into estabelecimentos (slug, nome, whatsapp, segmento, cadastro_completo,
  sinal_regra, sinal_valor_centavos, sinal_chave_pix, granularidade_min, ativo)
values ('slug-aqui', 'Nome Real', '55...', 'manicure_podologia' | 'salao_barbershop',
  true | false, 'desligado'|'novos'|'todos', <centavos ou null>, '<chave pix ou null>',
  30 | 60, true);
```

**Decisões a bater com o cliente antes de rodar:**
- `cadastro_completo`: `true` = pede endereço completo (CEP/número/bairro/cidade) quando
  faltar; `false` = só nome + WhatsApp bastam, nunca pede endereço.
- `sinal_regra`: cobra sinal de quem? (ninguém / só clientes novos / todos)
- `granularidade_min`: só importa se o profissional for modo 'janela' — de quanto em
  quanto tempo a agenda abre horário (30 ou 60 min, geralmente).

## 2. Profissional(is)
```sql
insert into profissionais (estabelecimento_id, nome, ativo, modo_horario)
values ((select id from estabelecimentos where slug='slug-aqui'), 'Nome', true,
  'janela' | 'fixo');
```

**Decisão:** agenda por **janela contínua** (entrada/almoço/saída, gera slots automáticos)
ou **horários fixos** (lista específica tipo 8h/10h/13h/15h, sem passo uniforme)? Pergunte
"você atende em qualquer horário dentro do expediente, ou só em horários certos, mesmo que
espaçados"?

- Se `janela`: configurar pela tela (aba Horários do profissional) — entrada/saída/almoço
  por dia da semana. Hoje o toggle "Tipo de agenda" está oculto na UI por decisão de
  produto; trocar o modo é feito direto no banco quando necessário.
- Se `fixo`: inserir cada horário manualmente:
  ```sql
  insert into horarios_fixos (profissional_id, dia_semana, horario) values
    (<id>, <0=domingo..6=sábado>, 'HH:MM'), ...;
  ```

## 3. Serviços
Cadastrar pela tela (aba Serviços) ou via INSERT em `servicos` — nome, duração, preço,
categoria. Perguntar: algum serviço deve ter um alerta pós-seleção (`alerta_mensagem`, ex.:
regra de manutenção)? E o salão quer esconder preço e/ou duração de TODOS os serviços?
(`estabelecimentos.ocultar_preco_servicos` / `ocultar_duracao_servicos` — config única do
salão; as antigas `servicos.ocultar_preco`/`ocultar_duracao` não são mais lidas.)

## 4. Vincular serviços ao(s) profissional(is)
```sql
insert into servico_profissional (servico_id, profissional_id)
select id, <profissional_id> from servicos
where estabelecimento_id = (select id from estabelecimentos where slug='slug-aqui');
```
Sem esse passo, o `/agendar` mostra "Nenhum profissional atende este serviço" mesmo com
tudo certo nas outras tabelas — já foi causa de bug real, conferir sempre.

## 5. Anamnese (opcional)
Só cria modelo se o negócio pedir explicitamente (ex.: procedimento que exige histórico de
saúde). Sem modelo cadastrado em `anamnese_modelos`, a etapa simplesmente não aparece pro
cliente — não precisa "desligar" nada.

## 6. Horários — Exceções (bloqueio/liberação)
Não precisa de setup inicial, mas explicar pro dono como funciona: "Bloquear horário" fecha
algo que normalmente estaria aberto; "Liberar horário" abre algo pontual fora do padrão.
Mudança recorrente de verdade = editar a agenda normal (item 2), não uma exceção.

## 7. Identidade visual (substituir o padrão)
Todo tenant novo já nasce com `TEMA_PADRAO` (`lib/temas.js`) automaticamente: paleta rosa +
logo genérica (`/images/generico/logo-generico.png`) à esquerda e nome do estabelecimento
(`estabelecimentos.nome`) em texto. Não precisa fazer nada pra ele "ter tema".

Substituir o padrão só quando o cliente tiver marca própria (logo e/ou paleta):
- Ver `THEMING.md` — extrair a paleta real e processar a logo, se houver.
- Criar entrada própria em `TEMAS_POR_SLUG` com o slug do tenant (a entrada tem precedência
  sobre `TEMA_PADRAO`). Objeto próprio, não alias de `TEMA_PADRAO` — assim ajustes futuros no
  padrão não reskinnam esse tenant.
- Sem logo: omitir `marca` — o Hero cai no nome em texto centralizado, nas cores do tema
  (ex.: `teste`).

## 8. Login de produção
- Criar o usuário em Authentication → Users (Supabase) com e-mail/senha reais do dono.
- Vincular o perfil:
  ```sql
  insert into perfis (user_id, estabelecimento_id, papel)
  values ('<uuid do usuário criado>',
    (select id from estabelecimentos where slug='slug-aqui'), 'dono');
  ```

## 9. Checagem final antes de considerar "no ar"
- [ ] RLS ativo e cobrindo `anon` + `authenticated` em toda tabela nova usada por esse tenant
- [ ] Testar `/slug-aqui` (fluxo completo: identificação → serviço → data → confirmação)
- [ ] Testar `/slug-aqui/admin` (login funciona, todas as abas carregam)
- [ ] Confirmar que nenhum outro tenant mudou de comportamento (rodar smoke test rápido em
      `/teste` ou outro tenant de controle)


## Etiquetas de cliente padrão

Ao cadastrar um novo tenant (staging e produção), rodar o SQL abaixo trocando
`<ID_DO_TENANT>` pelo `estabelecimento_id` real:

```sql
-- STAGING ou PRODUÇÃO (trocar <ID_DO_TENANT> pelo id real do novo tenant)
insert into etiquetas_cliente (estabelecimento_id, nome, cor) values
  (<ID_DO_TENANT>, 'Cliente Fixo', 'violeta'),
  (<ID_DO_TENANT>, 'Cliente Nova', 'violeta'),
  (<ID_DO_TENANT>, 'Cliente Ocasional', 'violeta'),
  (<ID_DO_TENANT>, 'Lista de Espera', 'violeta'),
  (<ID_DO_TENANT>, 'Lista de Bloqueio', 'violeta');
```

`cor` aceita só um enum fixo — hoje: `violeta`, `azul`, `rosa`, `esmeralda`, `indigo`,
`ciano`, `fucsia`, `teal` (conferir a constraint `etiquetas_cliente_cor_check` antes de
usar outro valor).

Confirmar com `select * from etiquetas_cliente where estabelecimento_id = <ID_DO_TENANT>;`
antes de considerar o passo concluído.