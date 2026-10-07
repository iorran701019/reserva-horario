# Novo tenant — da conversa ao ar

A **Parte A** é a conversa presencial com a dona (o que pedir, o que perguntar, critério de negócio de cada decisão). A **Parte B** é a execução técnica, em ordem (SQL e telas); cada passo que depende de uma decisão aponta para o item da Parte A ("ver A.n"). Rodar sempre em staging primeiro. Baseado no onboarding real da Julia (Sessão 62) — atualizar aqui sempre que uma sessão de onboarding encontrar uma pergunta nova que faltou.

---

# Parte A — Conversa presencial com a dona

Roteiro pra otimizar a conversa com uma nova profissional: o que pedir com antecedência, o que perguntar na hora, e o que já sai pronto sem precisar de decisão dela.

## A.0 Antes da conversa (pedir por WhatsApp, com antecedência)

Pedir com folga pra já chegar com o pré-trabalho feito, igual foi feito com a Julia:

- Nome que ela quer ver no topo do app (nome do salão ou nome dela).
- Se tiver logo próprio, mandar em boa resolução — senão, o app já nasce com a identidade padrão (paleta rosa + logo genérica), sem trabalho nenhum de design antes da conversa.
- WhatsApp de contato (o mesmo que aparece pro cliente final).

Com isso já dá pra pré-criar o tenant em staging antes da conversa (B.1), deixando só as decisões de negócio pra hora presencial.

**Nota sobre logo:** se o material vier de foto/JPEG (não PDF/SVG vetorial) e a composição for alta/quadrada (ícone e nome empilhados), já esperar que o header vai precisar do tratamento de "separar ícone do texto" (`layoutMarca: 'esquerda'`) em vez de um lockup único — ver `PROTOCOLO_DESENVOLVIMENTO.md` e B.8.

## Decisões de negócio (rápidas, sim/não ou escolha)

### A.1 Cadastro da cliente final
Só nome + WhatsApp, ou pede endereço completo também? São **quatro flags independentes** em `estabelecimentos` (conferido no código em 07/10/2026), todas editáveis só no `/painel-global`, aba Cadastro:

- **`cadastro_completo`** — liga o cadastro completo. `true`: a identificação por WhatsApp só libera direto pro agendamento se o bloco de endereço (CEP/número/bairro/cidade) estiver completo; senão abre o cadastro pré-preenchido pra completar; no `/admin`, cliente sem data de nascimento ganha o aviso "Cadastro incompleto". `false`: só nome + WhatsApp bastam, nunca pede endereço. As três flags abaixo são sub-opções e só aparecem no painel quando esta está ligada.
- **`exigir_endereco`** — decide se o cadastro e a tela "Atualizar dados" pedem o bloco de endereço (CEP/número/complemento/bairro/cidade/estado) ou, no lugar dele, um campo opcional "Contato de emergência (WhatsApp)". Padrão `true` (preserva o comportamento antigo; coluna ausente conta como `true`). É a única das três sub-opções que o fluxo público lê hoje (está nos dois selects de `estabelecimentos`).
- **`exigir_contato_emergencia`** — toggle "Contato de emergência" (campo opcional de WhatsApp de emergência, independente do endereço). **Atenção:** só achei leitura e escrita dessa coluna no `/painel-global`; não achei nenhum consumidor no fluxo público (o campo de contato de emergência hoje aparece só quando `exigir_endereco` é `false`). Confirmar no banco e no uso antes de prometer o efeito à dona.
- **`exigir_instagram`** — toggle de Instagram. Mesma situação: só o painel global lê e escreve; o campo Instagram do cadastro aparece sempre, opcional, sem consultar a flag. Confirmar antes de prometer o efeito.

### A.2 Sinal
Cobra de todo mundo, só de cliente nova, todo mundo exceto manutenção, ou não cobra? Se cobra, valor e chave Pix (pode ser provisória — trocar depois é 1 linha de SQL). Se ela ainda não decidiu a chave/gateway, tudo bem deixar `sinal_regra='desligado'` por enquanto e resolver numa sessão futura — não trava o resto do onboarding (caso real: Laryssa).

### A.3 Corte do dia seguinte
Até que horário do dia atual um agendamento ainda conta como "hoje" antes de virar "amanhã" na exibição? (a Laysla usa 19h, a Flávia 21h — não existe padrão único, é decisão dela mesmo)

### A.4 Conclusão manual
Quer revisar manualmente os atendimentos vencidos (pra registrar valor/forma de pagamento) ou deixar 100% automático?

### A.5 Rotina de horário — janela contínua ou lista fixa?
Essa é a pergunta mais importante, com mais tempo: não é sim/não. Ela atende num intervalo corrido (ex.: 9h às 18h, cliente escolhe qualquer horário dentro disso) ou só em horários específicos que ela já define de antemão (ex.: só 9h, 11h, 14h, 16h — mesmo que espaçados)? A pergunta pra fazer a ela: "você atende em qualquer horário dentro do expediente, ou só em horários certos?". A resposta decide o `modo_horario` do profissional (`'janela'` ou `'fixo'`) — não dá pra deixar como placeholder por muito tempo, porque muda como a cliente vê e escolhe horário na tela. Sinal de que é `'janela'`: ela descreve os horários como "variados" e a agenda dela "se estende por meses" sem grade fixa (caso real: Laryssa) — nesse caso, tudo bem fechar o modo agora e preencher os horários reais depois, direto na aba Horários do `/admin` (autosave, sem precisar de SQL).

Em modo janela, ainda decidir de quanto em quanto tempo a agenda abre horário (`granularidade_min`, geralmente 30 ou 60 min). O padrão é 60 minutos — só mudar se a rotina dela pedir passos menores (ex.: serviços muito curtos e variados).

### A.6 Segmento
O app nasceu pra manicures/salões de beleza. O `segmento` é um rótulo interno, sem efeito funcional. O CHECK aceita `manicure_podologia`, `salao_barbershop` e `maquiagem` (o valor `maquiagem` foi criado na Sessão 72, em staging e produção, para a primeira maquiadora, Laryssa). Se o negócio for outro tipo de profissional de estética que nenhum valor descreva, avisar que o produto funciona igual (catálogo, agenda, admin) e que o rótulo exige ampliar o CHECK por SQL (ver B.1) — não gravar um valor que não descreve o negócio.

### A.7 Catálogo de serviços — o que perguntar por serviço
Pedir a lista completa nome por nome, e pra cada um:

- Duração (minutos). **Se o material dela (catálogo, tabela de preços) não trouxer duração nenhuma, não travar o onboarding por isso** — combinar um valor padrão temporário (ex.: 60min pra tudo) e deixar registrado que ela ajusta depois pelo `/admin`, serviço por serviço, quando tiver os números reais (caso real: Laryssa). Perguntar a duração real de cada serviço: combos como "mãos e pés" costumam levar mais que o simples.
- Preço. Da mesma forma, se algum item do material não tiver preço fechado (ex.: um combo ou pacote com "valor a combinar"), registrar como está e não inventar número.
- Tem manutenção? Se sim, prazo (dias) e se a manutenção pode vir de outra profissional (categoria separada, não é a mesma coisa que a manutenção normal).
- Alguma observação que deveria aparecer pro cliente (ex.: "precisa enviar foto da decoração antes")? Na prática, é o alerta pós-seleção do serviço (`alerta_mensagem`, ex.: regra de manutenção).
- O salão quer esconder preço e/ou duração de TODOS os serviços? (config única do salão.)

**Nota aprendida com a Julia:** ao copiar catálogo de uma cliente existente como modelo pra outra, sempre desconfiar de preços muito fora da curva dos serviços vizinhos (ex.: R$1,00 no meio de R$150-170) — provável erro de digitação na origem, não replicar sem confirmar antes com a própria dona de origem.

### A.8 Serviços em grupo (combos/eventos)
Se o material dela mencionar atendimento coletivo (ex.: "combo mínimo 4 pessoas" pra formatura/casamento/madrinhas), isso não é um serviço com preço próprio — é uma regra de agendamento. O agendamento em grupo está com **desenho congelado e não implementado** (ver "Agendamento em grupo pra maquiadoras" no `PENDENCIAS.md`; as colunas `permite_agendamento_grupo` e `max_pessoas_grupo` não existem). Não inventar um serviço fake pra representar isso; registrar como pendência de produto separada.

### A.9 Agenda pessoal misturada com a profissional
Se ela usa o mesmo Google Calendar pra vida pessoal e atendimentos, não tentar filtrar isso automaticamente — reforçar que o jeito certo é ela bloquear compromisso pessoal direto na aba Ausências do app. A importação em massa (histórico do Calendar) é só pra trazer atendimentos profissionais antigos pro sistema uma única vez, antes dela começar a usar o app pra valer — ela já mostra os eventos ignorados numa lista, então dá pra garimpar manualmente qualquer atendimento real que o filtro automático não reconheceu (comum quando ela só escreve o nome da cliente, sem palavra de serviço, no título do evento).

### A.10 O que já sai pronto, sem perguntar

- Identidade visual: paleta rosa + logo genérica por padrão — só perguntar sobre isso se ela trouxer material próprio ou pedir explicitamente para mudar (ver B.8).
- Etiquetas de cliente padrão (Cliente Fixo, Cliente Nova, Cliente Ocasional, Lista de Espera, Lista de Bloqueio) — ver B.12.
- Granularidade de 60 minutos (ver A.5).

---

# Parte B — Execução técnica

Ordem sugerida (cada item depende do anterior). Rodar sempre em staging primeiro.

## B.1 Estabelecimento
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

**`janela_agendamento_fim` é obrigatória (NOT NULL, tipo date)** — sem ela o insert falha com `23502`. Desde a Sessão 41 a coluna é decorativa (quem manda é a janela mensal), então usar `'2030-12-31'`, como Layra e Laryssa. Guardar o `id` retornado: ele é diferente entre staging e produção.

**Se o insert falhar por coluna obrigatória nova** (erro `23502`), listar as colunas `NOT NULL` sem padrão e completar o insert:
```sql
select column_name
from information_schema.columns
where table_name = 'estabelecimentos' and is_nullable = 'NO' and column_default is null;
```

**Valores a gravar, conforme as decisões da Parte A:**
- `cadastro_completo`: `true`/`false` (ver A.1). As outras três flags (`exigir_endereco`, `exigir_contato_emergencia`, `exigir_instagram`) não entram nesse insert: ficam no padrão do banco e são ajustadas depois no `/painel-global`, aba Cadastro.
- `sinal_regra`: valores aceitos hoje: `desligado`, `novos`, `todos`, `exceto_manutencao` (ver A.2). Sem chave Pix ainda, é normal deixar `'desligado'`.
- `granularidade_min`: só importa se o profissional for modo 'janela' (ver A.5); 30 ou 60 min, geralmente.
- `segmento`: o CHECK aceita `'manicure_podologia'`, `'salao_barbershop'` e `'maquiagem'` (conferido no banco em 01/10/2026; ver A.6). Para outro tipo de profissional, ampliar o CHECK por SQL em vez de gravar um valor que não descreve o negócio.

## B.2 Profissional(is)
```sql
insert into profissionais (estabelecimento_id, nome, ativo, modo_horario)
values ((select id from estabelecimentos where slug='slug-aqui'), 'Nome', true,
  'janela' | 'fixo')
returning id, nome;
```

`modo_horario` vem da decisão A.5 (`janela` ou `fixo`).

- Se `janela`: configurar pela tela (aba Horários do profissional) — entrada/saída/almoço por dia da semana. Hoje o toggle "Tipo de agenda" está oculto na UI por decisão de produto; trocar o modo é feito direto no banco quando necessário. Se os horários reais ainda não estiverem definidos, tudo bem deixar o modo decidido e os horários como placeholder temporário, preenchidos depois direto na tela (sem SQL).
- Se `fixo`: inserir os horários. Para o mesmo conjunto de horários em vários dias, gerar por produto cartesiano (caso real: Lilian, terça a sábado, 9h/11h/14h/16h = 20 linhas):
```sql
  insert into horarios_fixos (profissional_id, dia_semana, horario)
  select p.id, d.dia, h.hora
  from profissionais p
  cross join (values (2), (3), (4), (5), (6)) as d(dia)   -- 0=domingo..6=sábado
  cross join (values ('09:00'::time), ('11:00'::time), ('14:00'::time), ('16:00'::time)) as h(hora)
  where p.estabelecimento_id = (select id from estabelecimentos where slug='slug-aqui');
```
  Conferir a contagem por dia (`group by dia_semana`). Para horários diferentes por dia, inserir linha a linha: `(<id>, <dia>, 'HH:MM'), ...`. Dá para editar depois na aba Horários da profissional.

## B.3 Serviços
Cadastrar pela tela (aba Serviços) ou via INSERT em `servicos` — nome, duração, preço, categoria (perguntas e critérios em A.7). Categoria é opcional (`categoria_id` aceita nulo); pode ser criada pela tela depois.

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

Alerta pós-seleção por serviço: coluna `alerta_mensagem` (ver B.5 para a sintaxe). Esconder preço e/ou duração de TODOS os serviços do salão: `estabelecimentos.ocultar_preco_servicos` / `ocultar_duracao_servicos` — config única do salão; as antigas `servicos.ocultar_preco`/`ocultar_duracao` não são mais lidas.

## B.4 Vincular serviços ao(s) profissional(is)
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
Sem esse passo, o `/agendar` mostra "Nenhum profissional atende este serviço" mesmo com tudo certo nas outras tabelas — já foi causa de bug real, conferir sempre (repetiu na Laryssa, Sessão 21/09 — vira checklist permanente).

## B.5 Catálogo e avisos do serviço
Conferir depois de cadastrar e vincular os serviços (critérios de negócio em A.7):

- [ ] **Manutenções:** conferir a pergunta de pés e o aviso dos 30 dias (`{valor_manutencao_30}` no serviço-base). A manutenção vinculada precisa de `servico_origem_id`, `prazo_inicio_dias` e preço, e não pode estar oculta.
- [ ] **Categoria com serviço de pés e serviço só de mãos:** aviso "Só mãos: este serviço não inclui os pés. Para incluir, escolha um serviço com pedicure." nos serviços de mãos (não nos que já incluem pedicure nem nas manutenções).
- [ ] **Alertas com mais de um popup:** separar por uma linha `---` e dar título na primeira linha de cada pedaço; testar em aba anônima.
- [ ] **Serviço sem categoria** só se for intencional (aparece por último no público).
- [ ] **Texto padrão:** preencher `msg_reativacao` e `nome_etapa_anterior` do tenant enquanto o padrão do código ainda cita barbearia e "Teste".
- [ ] **Qualquer ajuste feito só por SQL para o tenant** entra no `INVENTARIO_RECURSOS.md` com o destino definitivo.
- [ ] **Etiquetas padrão por nome** (Cliente Fixo, Lista de Bloqueio, Cliente Nova): conferir a grafia exata até as etiquetas passarem a ter papel por id (ver B.12).

## B.6 Anamnese (opcional)
Só cria modelo se o negócio pedir explicitamente (ex.: procedimento que exige histórico de saúde). Sem modelo cadastrado em `anamnese_modelos`, a etapa simplesmente não aparece pro cliente — não precisa "desligar" nada.

## B.7 Horários — Exceções (bloqueio/liberação)
Não precisa de setup inicial, mas explicar pro dono como funciona: "Bloquear horário" fecha algo que normalmente estaria aberto; "Liberar horário" abre algo pontual fora do padrão. Mudança recorrente de verdade = editar a agenda normal (B.2), não uma exceção.

## B.8 Identidade visual (substituir o padrão)
Todo tenant novo já nasce com `TEMA_PADRAO` (`lib/temas.js`) automaticamente: paleta rosa + logo genérica (`/images/generico/logo-generico.png`) à esquerda e nome do estabelecimento (`estabelecimentos.nome`) em texto. Não precisa fazer nada pra ele "ter tema" (ver A.10).

Substituir o padrão só quando o cliente tiver marca própria (logo e/ou paleta):
- Ver `THEMING.md` — extrair a paleta real e processar a logo, se houver.
- Antes de moldar em produção: usar o tenant-modelo `css` em staging (ver Protocolo de Desenvolvimento), nunca editar tema direto num tenant que só existe em produção.
- Criar entrada própria em `TEMAS_POR_SLUG` com o slug do tenant (a entrada tem precedência sobre `TEMA_PADRAO`). Objeto próprio, não alias de `TEMA_PADRAO` — assim ajustes futuros no padrão não reskinnam esse tenant.
- Sem logo: omitir `marca` — o Hero cai no nome em texto centralizado, nas cores do tema (ex.: `teste`).
- Logo vinda de foto/JPEG (não vetor) com composição alta/quadrada: separar ícone e texto em dois arquivos e usar `layoutMarca: 'esquerda'`, em vez de espremer tudo num lockup único — ver técnica no Protocolo de Desenvolvimento.
- **Se `bgHeader` (ou `botao`) do tenant for escuro: definir também `bgCardAdmin`, `botaoAdmin`/`botaoAdminHover` e `bordaAdmin`.** O `/admin` herda essas cores do público e ignora `textoCard` de propósito — sem os campos próprios, card, drawer mobile e/ou botões do admin ficam com texto ilegível (achado real: Laysla e Laryssa, Sessão 21/09). Ver mecanismo completo no Protocolo de Desenvolvimento.

## B.9 Login de produção
- Criar o usuário em Authentication → Users (Supabase) com e-mail/senha reais do dono, marcando "Auto Confirm User". Copiar o UID; a senha nunca passa pelo chat.
- Vincular o perfil:
```sql
  insert into perfis (user_id, estabelecimento_id, papel)
  values ('<uuid do usuário criado>',
    (select id from estabelecimentos where slug='slug-aqui'), 'dono');
```
- **Antes de inserir, confirmar que o UID não existe em `perfis`** (`select * from perfis where user_id = '<uuid>'`) — `user_id` é chave primária, então um UID já vinculado a outro tenant (ou duplicado por engano) falha com `23505` em vez de sobrescrever.

## B.10 Google Calendar (se a dona usar)
A conexão é feita pela própria dona, logada no `/admin`, em Configurações (autorização do Google). O app só exporta para o Calendar (mão única); bloqueio pessoal continua sendo lançado em Ausências (ver A.9).

**Cor dos eventos exportados** (Sessão 76, coluna `estabelecimentos.google_calendar_cor_id`):
- [ ] Perguntar à dona se ela organiza o Calendar por cor e qual cor quer para os agendamentos do app.
- [ ] Sem preferência: não fazer nada (padrão é `'7'`, Peacock/azul).
- [ ] Com preferência: gravar por SQL (não há tela). Valores válidos, nomes da paleta do Google:
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
- Eventos já exportados só mudam de cor quando o agendamento for alterado; os novos já nascem na cor escolhida.
- Pedir à dona que confira no celular dela: alguns aparelhos (ex.: Samsung) desenham tons próprios para a mesma cor. Caso real: Laryssa, amarelo (`'5'`).

## B.11 Janela de agendamento (obrigatório antes de entregar o link)
Mês sem registro na janela mensal fica **fechado** (Sessão 41): sem este passo o `/slug-aqui` mostra zero vagas mesmo com horários, serviços e vínculo corretos. Entrar em `/slug-aqui/admin` → Regras de negócio → janela de agendamento e abrir o mês atual e o seguinte (status "aberto").

## B.12 Etiquetas de cliente padrão

Ao cadastrar um novo tenant (staging e produção), rodar o SQL abaixo trocando `<ID_DO_TENANT>` pelo `estabelecimento_id` real (ver A.10). Desde a Sessão 80 cada etiqueta nasce com uma cor diferente (antes todas nasciam `violeta`):

```sql
-- STAGING ou PRODUÇÃO (trocar <ID_DO_TENANT> pelo id real do novo tenant)
insert into etiquetas_cliente (estabelecimento_id, nome, cor) values
  (<ID_DO_TENANT>, 'Cliente Fixo', 'esmeralda'),
  (<ID_DO_TENANT>, 'Cliente Nova', 'azul'),
  (<ID_DO_TENANT>, 'Cliente Ocasional', 'violeta'),
  (<ID_DO_TENANT>, 'Lista de Espera', 'fucsia'),
  (<ID_DO_TENANT>, 'Lista de Bloqueio', 'rosa');
```

`cor` aceita só um enum fixo — hoje: `violeta`, `azul`, `rosa`, `esmeralda`, `indigo`, `ciano`, `fucsia`, `teal` (conferir a constraint `etiquetas_cliente_cor_check` antes de usar outro valor). O enum não tem vermelho nem verde puro: `rosa` marca a Lista de Bloqueio e `esmeralda` o Cliente Fixo.

Confirmar com `select * from etiquetas_cliente where estabelecimento_id = <ID_DO_TENANT>;` antes de considerar o passo concluído.

## B.13 Assinatura da plataforma
- [ ] Ativar a assinatura do salão no Financeiro do `/painel-global` (produção), com as condições negociadas — **sempre com mês final** (condição sem fim vale para sempre). Marcar "exige nota fiscal" quando combinado.
- [ ] Avisar a dona pelo WhatsApp **antes** de ativar: a aba "Assinatura" do `/admin` aparece com valor e chave Pix assim que a assinatura é ativada.
- Padrões: mensalidade R$100, vencimento dia 10 (ver "Assinaturas da plataforma" no `PENDENCIAS.md`).

## B.14 Checagem final antes de considerar "no ar"
- [ ] RLS ativo e cobrindo `anon` + `authenticated` em toda tabela nova usada por esse tenant (toda tabela lida pelo fluxo público precisa de SELECT também para `authenticated`: a dona navega o `/agendar` dos outros salões com a sessão ativa — causa da "agenda sumiu" da Sessão 80)
- [ ] Testar `/slug-aqui` (fluxo completo: identificação → serviço → data → confirmação) e cancelar o agendamento de teste sem notificar
- [ ] Testar `/slug-aqui/admin` (login funciona, todas as abas carregam)
- [ ] Se `bgHeader`/`botao` for escuro: conferir também `bgCardAdmin`/`botaoAdmin`/`bordaAdmin` no `/admin` (Regras de negócio, drawer mobile, botões de Clientes/Serviços)
- [ ] Se a dona conectou o Google Calendar: criar um agendamento de teste e conferir que o evento aparece no Calendar dela, na cor combinada (depois cancelar sem notificar)
- [ ] Confirmar que nenhum outro tenant mudou de comportamento (rodar smoke test rápido em `/teste` ou outro tenant de controle)
