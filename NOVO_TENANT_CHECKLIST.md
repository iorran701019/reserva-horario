# Checklist — configurar um novo tenant do zero

Ordem sugerida (cada item depende do anterior). Rodar sempre em staging primeiro.

## 1. Estabelecimento
```sql
insert into estabelecimentos (slug, nome, whatsapp, segmento, cadastro_completo,
  sinal_regra, sinal_valor_centavos, sinal_chave_pix, granularidade_min, ativo,
  janela_agendamento_fim)
values ('slug-aqui', 'Nome Real', '55...',
  'manicure_podologia' | 'salao_barbershop' | 'maquiagem',
  true | false, 'desligado'|'novos'|'todos'|'exceto_manutencao',
  <centavos ou null>, '<chave pix ou null>', 30 | 60, true, '2030-12-31')
returning id, slug, nome;
```

**`janela_agendamento_fim` é obrigatória (NOT NULL, tipo date)** — sem ela o insert falha com
`23502`. Desde a Sessão 41 a coluna é decorativa (quem manda é a janela mensal), então usar
`'2030-12-31'`, como Layra e Laryssa. Guardar o `id` retornado: ele é diferente entre staging e
produção.

**Decisões a bater com o cliente antes de rodar:**
- `cadastro_completo`: `true` = pede endereço completo (CEP/número/bairro/cidade) quando
  faltar; `false` = só nome + WhatsApp bastam, nunca pede endereço.
- `sinal_regra`: cobra sinal de quem? (ninguém / só clientes novos / todos / todos exceto
  manutenção). Valores aceitos hoje: `desligado`, `novos`, `todos`, `exceto_manutencao`. Sem
  chave Pix ainda, é normal deixar `'desligado'` e resolver numa sessão futura (não bloqueia
  o resto).
- `granularidade_min`: só importa se o profissional for modo 'janela' — de quanto em
  quanto tempo a agenda abre horário (30 ou 60 min, geralmente).
- `segmento`: o CHECK aceita `'manicure_podologia'`, `'salao_barbershop'` e `'maquiagem'`
  (conferido no banco em 01/10/2026). Para outro tipo de profissional, ampliar o CHECK por
  SQL em vez de gravar um valor que não descreve o negócio.

## 2. Profissional(is)
```sql
insert into profissionais (estabelecimento_id, nome, ativo, modo_horario)
values ((select id from estabelecimentos where slug='slug-aqui'), 'Nome', true,
  'janela' | 'fixo')
returning id, nome;
```

**Decisão:** agenda por **janela contínua** (entrada/almoço/saída, gera slots automáticos)
ou **horários fixos** (lista específica tipo 8h/10h/13h/15h, sem passo uniforme)? Pergunte
"você atende em qualquer horário dentro do expediente, ou só em horários certos, mesmo que
espaçados"?

- Se `janela`: configurar pela tela (aba Horários do profissional) — entrada/saída/almoço
  por dia da semana. Hoje o toggle "Tipo de agenda" está oculto na UI por decisão de
  produto; trocar o modo é feito direto no banco quando necessário. Se os horários reais
  ainda não estiverem definidos, tudo bem deixar o modo decidido e os horários como
  placeholder temporário, preenchidos depois direto na tela (sem SQL).
- Se `fixo`: inserir os horários. Para o mesmo conjunto de horários em vários dias, gerar
  por produto cartesiano (caso real: Lilian, terça a sábado, 9h/11h/14h/16h = 20 linhas):
```sql
  insert into horarios_fixos (profissional_id, dia_semana, horario)
  select p.id, d.dia, h.hora
  from profissionais p
  cross join (values (2), (3), (4), (5), (6)) as d(dia)   -- 0=domingo..6=sábado
  cross join (values ('09:00'::time), ('11:00'::time), ('14:00'::time), ('16:00'::time)) as h(hora)
  where p.estabelecimento_id = (select id from estabelecimentos where slug='slug-aqui');
```
  Conferir a contagem por dia (`group by dia_semana`). Para horários diferentes por dia,
  inserir linha a linha: `(<id>, <dia>, 'HH:MM'), ...`. Dá para editar depois na aba
  Horários da profissional.

## 3. Serviços
Cadastrar pela tela (aba Serviços) ou via INSERT em `servicos` — nome, duração, preço,
categoria. Categoria é opcional (`categoria_id` aceita nulo); pode ser criada pela tela depois.

Insert por SQL (todas as colunas `NOT NULL` explícitas — preço em centavos; caso real: Lilian):
```sql
insert into servicos (estabelecimento_id, nome, duracao_min, preco_centavos, ativo,
  categoria_id, ocultar_preco, ocultar_duracao, ordem, eh_manutencao, oculto,
  manutencao_externa, exige_segunda_data)
select e.id, v.nome, <duracao_min>, v.preco, true, null, false, false, v.ordem,
  false, false, false, false
from estabelecimentos e
cross join (values ('Serviço A', 4000, 1), ('Serviço B', 7000, 2)) as v(nome, preco, ordem)
where e.slug = 'slug-aqui'
returning id, nome, preco_centavos, duracao_min;
```
Perguntar a duração real de cada serviço (combos como "mãos e pés" costumam levar mais que
o simples).

Perguntar também: algum serviço deve ter um alerta pós-seleção (`alerta_mensagem`, ex.:
regra de manutenção)? E o salão quer esconder preço e/ou duração de TODOS os serviços?
(`estabelecimentos.ocultar_preco_servicos` / `ocultar_duracao_servicos` — config única do
salão; as antigas `servicos.ocultar_preco`/`ocultar_duracao` não são mais lidas.)

## 4. Vincular serviços ao(s) profissional(is)
```sql
insert into servico_profissional (servico_id, profissional_id)
select id, <profissional_id> from servicos
where estabelecimento_id = (select id from estabelecimentos where slug='slug-aqui');

-- conferir
select s.nome, sp.profissional_id
from servicos s join servico_profissional sp on sp.servico_id = s.id
where s.estabelecimento_id = (select id from estabelecimentos where slug='slug-aqui')
order by s.ordem;
```
Sem esse passo, o `/agendar` mostra "Nenhum profissional atende este serviço" mesmo com
tudo certo nas outras tabelas — já foi causa de bug real, conferir sempre (repetiu na
Laryssa, Sessão 21/09 — vira checklist permanente).

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
- Antes de moldar em produção: usar o tenant-modelo `css` em staging (ver Protocolo de
  Desenvolvimento), nunca editar tema direto num tenant que só existe em produção.
- Criar entrada própria em `TEMAS_POR_SLUG` com o slug do tenant (a entrada tem precedência
  sobre `TEMA_PADRAO`). Objeto próprio, não alias de `TEMA_PADRAO` — assim ajustes futuros no
  padrão não reskinnam esse tenant.
- Sem logo: omitir `marca` — o Hero cai no nome em texto centralizado, nas cores do tema
  (ex.: `teste`).
- Logo vinda de foto/JPEG (não vetor) com composição alta/quadrada: separar ícone e
  texto em dois arquivos e usar `layoutMarca: 'esquerda'`, em vez de espremer tudo num
  lockup único — ver técnica no Protocolo de Desenvolvimento.
- **Se `bgHeader` (ou `botao`) do tenant for escuro: definir também `bgCardAdmin`,
  `botaoAdmin`/`botaoAdminHover` e `bordaAdmin`.** O `/admin` herda essas cores do público
  e ignora `textoCard` de propósito — sem os campos próprios, card, drawer mobile e/ou
  botões do admin ficam com texto ilegível (achado real: Laysla e Laryssa, Sessão 21/09).
  Ver mecanismo completo no Protocolo de Desenvolvimento.

## 8. Login de produção
- Criar o usuário em Authentication → Users (Supabase) com e-mail/senha reais do dono,
  marcando "Auto Confirm User". Copiar o UID; a senha nunca passa pelo chat.
- Vincular o perfil:
```sql
  insert into perfis (user_id, estabelecimento_id, papel)
  values ('<uuid do usuário criado>',
    (select id from estabelecimentos where slug='slug-aqui'), 'dono');
```
- **Antes de inserir, confirmar que o UID não existe em `perfis`** (`select * from perfis
  where user_id = '<uuid>'`) — `user_id` é chave primária, então um UID já vinculado a
  outro tenant (ou duplicado por engano) falha com `23505` em vez de sobrescrever.

## 9. Google Calendar (se a dona usar)
A conexão é feita pela própria dona, logada no `/admin`, em Configurações (autorização do
Google). O app só exporta para o Calendar (mão única); bloqueio pessoal continua sendo
lançado em Ausências.

**Cor dos eventos exportados** (Sessão 76, coluna `estabelecimentos.google_calendar_cor_id`):
- [ ] Perguntar à dona se ela organiza o Calendar por cor e qual cor quer para os
      agendamentos do app.
- [ ] Sem preferência: não fazer nada (padrão é `'7'`, Peacock/azul).
- [ ] Com preferência: gravar por SQL (não há tela). Valores válidos, nomes da paleta do
      Google:
      `1` Lavender · `2` Sage · `3` Grape · `4` Flamingo · `5` Banana · `6` Tangerine
      `7` Peacock · `8` Graphite · `9` Blueberry · `10` Basil · `11` Tomato
      Qualquer outro valor cai no azul padrão, sem erro.
```sql
-- PRODUÇÃO
update estabelecimentos
set google_calendar_cor_id = '5'
where slug = 'slug-aqui'
returning slug, google_calendar_ativo, google_calendar_cor_id;
```
- Eventos já exportados só mudam de cor quando o agendamento for alterado; os novos já
  nascem na cor escolhida.
- Pedir à dona que confira no celular dela: alguns aparelhos (ex.: Samsung) desenham tons
  próprios para a mesma cor. Caso real: Laryssa, amarelo (`'5'`).

## 10. Janela de agendamento (obrigatório antes de entregar o link)
Mês sem registro na janela mensal fica **fechado** (Sessão 41): sem este passo o `/slug-aqui`
mostra zero vagas mesmo com horários, serviços e vínculo corretos. Entrar em
`/slug-aqui/admin` → Regras de negócio → janela de agendamento e abrir o mês atual e o
seguinte (status "aberto").

## 11. Checagem final antes de considerar "no ar"
- [ ] RLS ativo e cobrindo `anon` + `authenticated` em toda tabela nova usada por esse tenant
      (toda tabela lida pelo fluxo público precisa de SELECT também para `authenticated`:
      a dona navega o `/agendar` dos outros salões com a sessão ativa — causa da "agenda
      sumiu" da Sessão 80)
- [ ] Testar `/slug-aqui` (fluxo completo: identificação → serviço → data → confirmação) e
      cancelar o agendamento de teste sem notificar
- [ ] Testar `/slug-aqui/admin` (login funciona, todas as abas carregam)
- [ ] Se `bgHeader`/`botao` for escuro: conferir também `bgCardAdmin`/`botaoAdmin`/`bordaAdmin`
      no `/admin` (Regras de negócio, drawer mobile, botões de Clientes/Serviços)
- [ ] Se a dona conectou o Google Calendar: criar um agendamento de teste e conferir que o
      evento aparece no Calendar dela, na cor combinada (depois cancelar sem notificar)
- [ ] Confirmar que nenhum outro tenant mudou de comportamento (rodar smoke test rápido em
      `/teste` ou outro tenant de controle)


## Etiquetas de cliente padrão

Ao cadastrar um novo tenant (staging e produção), rodar o SQL abaixo trocando
`<ID_DO_TENANT>` pelo `estabelecimento_id` real. Desde a Sessão 80 cada etiqueta nasce com
uma cor diferente (antes todas nasciam `violeta`):

```sql
-- STAGING ou PRODUÇÃO (trocar <ID_DO_TENANT> pelo id real do novo tenant)
insert into etiquetas_cliente (estabelecimento_id, nome, cor) values
  (<ID_DO_TENANT>, 'Cliente Fixo', 'esmeralda'),
  (<ID_DO_TENANT>, 'Cliente Nova', 'azul'),
  (<ID_DO_TENANT>, 'Cliente Ocasional', 'violeta'),
  (<ID_DO_TENANT>, 'Lista de Espera', 'fucsia'),
  (<ID_DO_TENANT>, 'Lista de Bloqueio', 'rosa');
```

`cor` aceita só um enum fixo — hoje: `violeta`, `azul`, `rosa`, `esmeralda`, `indigo`,
`ciano`, `fucsia`, `teal` (conferir a constraint `etiquetas_cliente_cor_check` antes de
usar outro valor). O enum não tem vermelho nem verde puro: `rosa` marca a Lista de Bloqueio
e `esmeralda` o Cliente Fixo.

Confirmar com `select * from etiquetas_cliente where estabelecimento_id = <ID_DO_TENANT>;`
antes de considerar o passo concluído.