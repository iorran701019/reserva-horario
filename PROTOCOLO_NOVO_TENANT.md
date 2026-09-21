# Protocolo de Novo Tenant — coleta presencial

Roteiro pra otimizar a conversa presencial com uma nova manicure: o que pedir
com antecedência, o que perguntar na hora, e o que já sai pronto sem
precisar de decisão dela. Baseado na experiência real de onboarding da
Julia (Sessão 62) — atualizar aqui sempre que uma sessão de onboarding
futura encontrar uma pergunta nova que faltou.

## Antes da conversa (pedir por WhatsApp, com antecedência)

Pedir com folga pra já chegar com o pré-trabalho feito, igual foi feito
com a Julia:

- Nome que ela quer ver no topo do app (nome do salão ou nome dela).
- Se tiver logo próprio, mandar em boa resolução — senão, o app já nasce
  com a identidade padrão (paleta rosa + logo genérica), sem trabalho
  nenhum de design antes da conversa.
- WhatsApp de contato (o mesmo que aparece pro cliente final).

Com isso já dá pra pré-criar o tenant em staging antes da conversa (Passo
1 do `NOVO_TENANT_CHECKLIST.md`), deixando só as decisões de negócio pra
hora presencial.

**Nota sobre logo:** se o material vier de foto/JPEG (não PDF/SVG vetorial) e a composição
for alta/quadrada (ícone e nome empilhados), já esperar que o header vai precisar do
tratamento de "separar ícone do texto" (`layoutMarca: 'esquerda'`) em vez de um lockup único
— ver Protocolo de Desenvolvimento.

**Nota sobre segmento:** o app nasceu pra manicures/salões de beleza. Se o negócio for outro
tipo de profissional de estética (ex.: maquiadora), avisar que hoje `segmento` não tem valor
próprio pra isso — grava no enum existente mais próximo, sem efeito funcional, e o produto
em si já funciona igual (catálogo, agenda, admin), só o rótulo interno é aproximado.

## Na conversa — decisões de negócio (rápidas, sim/não ou escolha)

1. **Cadastro do cliente final:** só nome + WhatsApp, ou pede endereço
   completo também?
2. **Sinal:** cobra de todo mundo, só de cliente nova, todo mundo exceto
   manutenção, ou não cobra? Se cobra, valor e chave Pix (pode ser
   provisória — trocar depois é 1 linha de SQL). Se ela ainda não decidiu a chave/gateway,
   tudo bem deixar `sinal_regra='desligado'` por enquanto e resolver numa sessão futura —
   não trava o resto do onboarding (caso real: Laryssa).
3. **Corte do dia seguinte:** até que horário do dia atual um agendamento
   ainda conta como "hoje" antes de virar "amanhã" na exibição? (a
   Laysla usa 19h, a Flávia 21h — não existe padrão único, é decisão
   dela mesmo)
4. **Conclusão manual:** quer revisar manualmente os atendimentos vencidos
   (pra registrar valor/forma de pagamento) ou deixar 100% automático?

## Na conversa — a pergunta mais importante, com mais tempo

5. **Rotina de horário — janela contínua ou lista fixa?** Essa é a que
   mais precisa de conversa de verdade, não é sim/não: ela atende num
   intervalo corrido (ex.: 9h às 18h, cliente escolhe qualquer horário
   dentro disso) ou só em horários específicos que ela já define de
   antemão (ex.: só 9h, 11h, 14h, 16h)? A resposta decide o `modo_horario`
   do profissional (`'janela'` ou `'fixo'`) — não dá pra deixar como
   placeholder por muito tempo, porque muda como a cliente vê e escolhe
   horário na tela. Sinal de que é `'janela'`: ela descreve os horários como
   "variados" e a agenda dela "se estende por meses" sem grade fixa (caso
   real: Laryssa) — nesse caso, tudo bem fechar o modo agora e preencher os
   horários reais depois, direto na aba Horários do `/admin` (autosave, sem
   precisar de SQL).

## Catálogo de serviços — o que perguntar por serviço

Pedir a lista completa nome por nome, e pra cada um:

- Duração (minutos). **Se o material dela (catálogo, tabela de preços) não trouxer
  duração nenhuma, não travar o onboarding por isso** — combinar um valor padrão
  temporário (ex.: 60min pra tudo) e deixar registrado que ela ajusta depois pelo
  `/admin`, serviço por serviço, quando tiver os números reais (caso real: Laryssa).
- Preço. Da mesma forma, se algum item do material não tiver preço fechado (ex.: um
  combo ou pacote com "valor a combinar"), registrar como está e não inventar número.
- Tem manutenção? Se sim, prazo (dias) e se a manutenção pode vir de
  outra profissional (categoria separada, não é a mesma coisa que a
  manutenção normal — ver nota abaixo).
- Alguma observação que deveria aparecer pro cliente (ex.: "precisa
  enviar foto da decoração antes")?

**Nota aprendida com a Julia:** ao copiar catálogo de uma cliente
existente como modelo pra outra, sempre desconfiar de preços muito fora
da curva dos serviços vizinhos (ex.: R$1,00 no meio de R$150-170) —
provável erro de digitação na origem, não replicar sem confirmar antes
com a própria dona de origem.

**Nota sobre serviços em grupo (combos/eventos):** se o material dela mencionar
atendimento coletivo (ex.: "combo mínimo 4 pessoas" pra formatura/casamento/madrinhas),
isso não é um serviço com preço próprio — é uma regra de agendamento que o app ainda não
modela nativamente (ver "Agendamento em grupo pra maquiadoras" no `PENDENCIAS.md`). Não
inventar um serviço fake pra representar isso; registrar como pendência de produto
separada.

## Agenda pessoal misturada com a profissional

Se ela usa o mesmo Google Calendar pra vida pessoal e atendimentos,
não tentar filtrar isso automaticamente — reforçar que o jeito certo é
ela bloquear compromisso pessoal direto na aba Ausências do app. A
importação em massa (histórico do Calendar) é só pra trazer atendimentos
profissionais antigos pro sistema uma única vez, antes dela começar a
usar o app pra valer — ela já mostra os eventos ignorados numa lista,
então dá pra garimpar manualmente qualquer atendimento real que o filtro
automático não reconheceu (comum quando ela só escreve o nome da cliente,
sem palavra de serviço, no título do evento).

## O que já sai pronto, sem perguntar

- Identidade visual: paleta rosa + logo genérica por padrão — só
  perguntar sobre isso se ela trouxer material próprio ou pedir
  explicitamente para mudar.
- Etiquetas de cliente padrão (Cliente Fixo, Cliente Nova, Cliente
  Ocasional, Lista de Espera, Lista de Bloqueio).
- Granularidade de 60 minutos — só mudar se a rotina dela pedir passos
  menores (ex.: serviços muito curtos e variados).