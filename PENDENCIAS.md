# Pendências — reserva-horario

## Em aberto

### Segurança (prioridade alta)
- **Troca das chaves expostas no chat da Sessão 64 — em andamento pelo Iorran (23/09).** `SUPABASE_SERVICE_ROLE_KEY` de staging, `GOOGLE_CALENDAR_CLIENT_SECRET`, `NOTIFICACAO_WEBHOOK_SECRET` e `ABACATEPAY_WEBHOOK_SECRET`. Atualizar nos painéis (Supabase, Google Cloud, AbacatePay), nas variáveis da Vercel (Preview e Production) e no `.env.local`. Com a service role, qualquer policy fechada na auditoria é ignorada — só remover este item depois de confirmar as quatro trocas.
- **Bug intermitente, alta prioridade: pergunta condicional (filha) salva com `pergunta_pai_id`/`opcao_gatilho_id` NULL pela tela do admin**, mesmo com o checkbox "depende de outra" marcado e os dois selects preenchidos. Reproduzido em produção (Júnior, serviços 148 e 150), em aba anônima e com o fix `bb37040` já no ar. Contornado criando o vínculo por SQL (funciona, usado na Julia na Sessão 67). Já descartado: trigger no banco, cache do navegador, deploy desatualizado, bug de exibição em `perguntaDeveAparecer`, e nenhum caminho do state/payload de `GerenciarServicos.js` deveria produzir o NULL. Roteiro para a retomada: (1) recapturar o Network confirmando que é o **Request Payload** do POST/PATCH em `servico_perguntas`, não a Response; (2) testar a hipótese de corrida — escolher a opção-gatilho, esperar ~2s e só então salvar; (3) `console.log(formPergunta)` imediatamente antes do insert/update em `handleSalvarPergunta`; (4) reproduzir também em staging para isolar se é algo do ambiente de produção. Achados laterais da mesma investigação: trocar o tipo da pergunta mãe apaga o vínculo da filha em silêncio (`ON DELETE SET NULL` via `salvarOpcoesPergunta`); `opcaoGatilhoId` pode ficar no state e ser salvo quando a mãe deixa de ser candidata; a lista de perguntas não indica visualmente qual é filha de qual.

### Segurança — residuais da auditoria de 22–23/09 (baixa prioridade)
- **Bucket `comprovantes-pix` sem lista de tipos aceitos.** Aplicado só `file_size_limit = 10 MB` (staging e produção). `allowed_mime_types` (jpeg, png, webp, heic, heif, pdf) ficou de fora até testar uma foto HEIC de iPhone de verdade — o filtro casa com o content-type enviado e pode recusar em silêncio. Testar iPhone e então aplicar.
- **Comprovantes órfãos no reenvio com extensão diferente** (print `.jpg` e depois `.pdf`): o arquivo antigo fica no bucket, sem nada apagando. A rota `app/api/agendamentos/comprovante-upload` (service role) poderia listar `<id>/` e remover os antigos antes de emitir o token — item separado.
- **Divergência de `roles` entre staging e produção** nas policies `leitura de agendamentos para logados` e `atualizacao de agendamentos para logados`: staging `{public}`, produção `{authenticated}`. Sem risco (as duas exigem `auth.uid()` de dona ou global), mas alinhar staging a produção quando houver uma janela.
- **Leituras anônimas com `using = true` ainda não revisadas coluna a coluna:** `estabelecimentos` (toda coluna é legível por anônimo — RLS é por linha, não por coluna; conferir se alguma coluna sensível entrou ali desde a Sessão 49), `ausencias` (inclui o campo `motivo`, texto livre da dona), `horarios_trabalho`, `horarios_fixos`, `profissionais`, `servico_profissional`, `categorias_servico`, `servicos`, `servico_perguntas`, `servico_pergunta_opcoes`, `janela_agendamento_meses`. São dados de catálogo/agenda necessários ao `/agendar`, mas nunca foram auditados campo a campo.
- **Riscos aceitos, registrados para não serem redescobertos:** (1) as RPCs de leitura do painel da cliente usam o telefone como único fator — quem souber o número de outra pessoa vê os agendamentos dela naquele salão (mesmo modelo de `cliente_buscar_por_whatsapp`; segundo fator é decisão de produto); (2) as RPCs por id e a rota de upload do comprovante confiam no `uuid` aleatório do agendamento como "senha" — vale também para `agendamento_cancelar_cliente_par` (Sessão 73), que além disso só alcança irmãs do mesmo grupo, mesmo salão e mesmo telefone; (3) `agendamento_criar` valida pertencimento e limites, mas não regra de negócio — uma chamada direta à RPC ainda reserva fora da janela/antecedência e escolhe entre `pendente`/`aguardando_sinal`; a revisão manual da dona nos Pendentes é a trava final.
- **`sql/` do repositório diverge do banco em vários arquivos** — enganou a investigação na Sessão 71: `sql/pendencias_admin.sql` declara `agendamento_id bigint` (no banco é `uuid`); `sql/fidelidade_resgates.sql` declara `criado_em` (no banco é `resgatado_em`) e não tem a policy pública que existia em produção; `sql/agendamentos_anon_update_policy.sql` descreve uma policy removida na Etapa 5; as policies do bucket `comprovantes-pix` nunca estiveram no repo; `sql/estabelecimentos_segmento.sql` não tem o valor `maquiagem` (Sessão 72); `concluir_agendamentos_confirmados_vencidos` só existe no banco. Atualizar para o estado real (ou marcar como históricos) numa sessão curta dedicada.

### Cores, contraste e modo noturno — residuais (Sessão 74)
- **Acolhe e Julia sem `textoBotao` no tema:** botão de destaque em tom médio cai no fallback quase branco `#fdfcfa`. Contraste no público e no `/admin`: Acolhe 2,60:1 em repouso e 3,99:1 no hover; Julia 3,52:1 em repouso (hover 4,64:1 passa). Correção é só dado de tema (`textoBotao` escuro em `lib/temas.js`), mas muda a cara do botão — na Julia, mostrar a ela antes.
- **Cartão de serviço não selecionado no fluxo público** (`FormularioAgendamento.js` ~216, `bg-card text-body`): cinza sobre cinza em vários tenants — Laysla 1,46:1, Laryssa 2,37:1, teste/barbearia 2,71:1, Acolhe 3,75:1, TEMA_PADRAO 4,07:1. No `/admin` Laysla passa por causa do `bgCardAdmin`. Provável correção: `text-on-card`, com tabela de contraste por tenant antes.
- **Script anti-flash do modo noturno:** hoje o admin abre claro e troca para escuro depois de montar. Solução desenhada: `<script>` inline síncrono antes do primeiro paint lendo `localStorage['adminModoNoturno']` e setando `document.documentElement.dataset.modo` (técnica do `next-themes`), restrito às rotas do `/admin`.
- **Botão da tela de login do admin** (`app/[salon]/admin/login/page.js` ~135) ainda usa `bg-primary text-white`. A rota não aplica o tema do tenant, então hoje não quebra — trocar por `text-on-primary` por consistência.
- **Bordas fracas no modo claro em todos os tenants:** `border-border` contra `bg-field` entre 1,32:1 (Flávia) e 1,95:1 (TEMA_PADRAO); trilho desligado do `Interruptor` contra a bolinha branca, 1,42 a 2,13:1; checkbox "Almoço" contra o campo chega a 2,44:1 (Acolhe). Mínimo recomendado para elementos de interface é 3:1. Dívida de design sistêmica.
- **`--color-on-card` no `/admin` é sempre `textoPrincipal`** (ignora `textoCard` de propósito). Com header escuro sem `bgCardAdmin`, o card fica escuro com texto escuro. Contornado pelo checklist de tenant com header escuro (ver "Processo") — conferir a Laryssa (ver seção dela).
- **Cores fixas fora do tema (Sessão 68):** dias de manutenção no calendário do público (`bg-green-50`/`bg-orange-50`) e o botão "Entrar em contato" da ficha do cliente (`bg-blue-50`) não leem o tema — destoam da paleta bege da Layra. Baixa prioridade.
- **Modo noturno — pontos não cobertos:** cores inline do `CORES_EVENTO` (`PainelCalendario.js`) e de `Relatorios.js` não mudam (pílulas claras sobre a grade escura, legíveis mas "acesas"); a cor "interna" `#8b5cf6` de Relatórios fica em 4,42:1 sobre o fundo escuro; `bg-stone-300` (1 uso), tons 300/400 de borda/anel e a cauda longa das escalas (rose, fuchsia, cyan, sky, orange etc.) sem override; dias passados do calendário a 2,09:1 (desabilitado, isento). Não testado ainda: Relatórios e Configurações inteiras no noturno.
- **Preferência do modo noturno é por aparelho e por endereço** (localStorage): ligar no localhost não liga em produção, e trocar de celular zera. Se as donas pedirem sincronização, a opção é uma coluna em `perfis`, aceitando uma piscada no carregamento.
- **Conferir o modo noturno em produção** com a Laysla e a Flávia (ligar pelo menu na primeira vez) e colher a impressão delas.

### Agendamento com segunda data — residuais (Sessão 73)
- **Vercel depois do rollback instantâneo de 25/09:** confirmar que um push novo na `main` volta a virar Production sozinho (o rollback pode desligar a promoção automática até um deploy ser promovido à mão). Na Sessão 74 houve seis pushes na `main` — conferir em produção que o modo noturno do admin e o "Alterar data" da ficha da cliente estão no ar; se o deploy ficou só como Preview, promover manualmente e conferir a configuração do projeto.
- **Laryssa:** ligar a segunda data no serviço de noiva e confirmar com ela o nome da etapa ("Teste" é o padrão). Configurar também o aviso da categoria (Penteados e/ou Noiva) pedindo o cabelo lavado, se ainda não foi feito.
- **Duas pushes por pedido de par sem sinal** (`app/api/notificacoes/route.js` dispara uma por linha inserida como `pendente`). Com sinal, sai uma só, citando a data do teste.
- **Popup de prazo mínimo do wizard** (`confirmarTrocaPrazo`, `FormularioAgendamento.js`) ainda oferece cancelar a "vizinha" mesmo quando ela é metade de um par, e cancela só uma linha. A RPC `agendamentos_cliente_janela_prazo` não devolve `reserva_grupo_id`; corrigir exige SQL ou esconder o botão. No `/admin` o mesmo popup já esconde a opção.
- **RPC `agendamentos_cliente_ativos` também não devolve `reserva_grupo_id`** (Sessão 74): na ficha da cliente, o botão "Alterar data" aparece para par pendente e, ao clicar, mostra o aviso âmbar "Confirme o pedido em Pendentes". Ideal é a RPC devolver a coluna (SQL em staging e produção) para esconder o botão. Fazer junto com a RPC do item anterior.
- **`app/api/agendamentos/remarcar/route.js` não conhece o par:** cancela a linha e recria sem `reserva_grupo_id`/`papel_reserva`. Hoje o wizard bloqueia remarcação de par ("fale com o salão"), mas a rota em si não checa.
- **`concluir_agendamentos_confirmados_vencidos` grava o preço cheio do serviço na etapa anterior** quando conclui sozinho. Relatórios já ignoram esse valor; o dado gravado fica "errado". A função não está no repositório — trazer o corpo antes de mexer.
- **"Último atendimento" pode ser a etapa anterior** (`buscarUltimoAtendimento` na ficha e `agendamentos_cliente_ultimos_sucesso` na manutenção sugerida).
- **Mensagens de WhatsApp** (`lib/whatsapp.js`) de confirmação/cancelamento não citam a outra data do par.
- **"Alterar data" no `/admin` não valida janela nem antecedência** — vale para o detalhe de qualquer confirmado (Sessão 73), para "Fora da janela" (comportamento antigo) e, desde a Sessão 74, para a ficha da cliente, que reaproveita o mesmo modal e o mesmo `handleAlterarData`.
- **Aviso de janela ao reduzir** (`ConfiguracoesSalao.js`) conta as duas linhas do par. Cosmético.
- **Quadro de fase no tema da Laysla (público):** o `botao` do tema é `#E9E7E3`, então a borda do quadro quase some. O quadro continua destacado pelo fundo claro sobre o card escuro.
- **Achados de baixa gravidade da bateria de testes:** a confirmação no `/admin` decide a irmã com o estado do momento do clique (janela de milissegundos com duas ações simultâneas); o gate de prazo recebe o próprio id duplicado (inofensivo, usa `Set`); cancelar o par pelo id da anterior faria o card de pendência citar a data do teste (nenhum caminho faz isso hoje).

### Motor de agenda — achados do raio-x de 22/09 (nenhum com perda confirmada em produção hoje)
- **Liberação em dia sem expediente nunca chega ao público.** `diasSemanaAtivos` (`FormularioAgendamento.js`) só lê `horarios_trabalho`/`horarios_fixos` e ignora as liberações de `ausencias` — o dia fica fechado e inclicável no calendário, embora o motor calcule o horário certo. No admin (modo livre) parece aberto, então a dona acredita que liberou. Consulta de 22/09 em produção: zero liberações nessa situação. Correção de poucas linhas; prioridade antes que alguma dona use liberação num domingo/folga.
- **Mês do `/admin` diverge do motor.** `PainelCalendario.diasSemVagas` reimplementa "dia sem vaga" olhando só expediente semanal + ausência de dia inteiro (sem horários fixos parciais, liberações, exclusividade, restrição, janela de mês nem ocupação real). A faixa visual do dia usa `HORA_ABERTURA`/`HORA_FECHAMENTO` fixos em 09:00–18:00 (`lib/horarios.js`), e ausência de dia inteiro é desenhada como bloco 09–18 mesmo para quem trabalha 07–21. Não perde vaga diretamente, mas induz a dona a decisões erradas.
- **Ausência avulsa parcial bloqueia 1h fixa** (`somarUmaHora(hora_inicio)` em `GerenciarProfissionais.js`), independente da granularidade e da duração — em grade de 30 min, marcar um horário derruba dois.
- **Modo `fixo` não confere se o serviço cabe no expediente** (candidatos de `horarios_fixos` sem `hora_fim`): um fixo às 17h oferece serviço de 3h. Vaga indevida, não perda.
- **Liberação não confere se o serviço cabe** (usa só `hora_inicio`, ignora `hora_fim`) e não trata virada de meia-noite. Baixo volume.
- **Importação do Google Calendar escolhe profissional arbitrário** (`.limit(1)` sem `.order()` em `app/api/google-calendar/importar/route.js`). Inofensivo em tenant de uma profissional; em multi-profissional o evento pode bloquear a agenda da colega.
- **Marca `erroDeLeitura` do Map de `janela_agendamento_meses` se perde ao recriar o Map** (`new Map(atual)`), e o fail-open por falha de rede vira fail-closed silencioso (agenda inteira fechada). Baixa frequência, impacto total quando ocorre.
- **Sem virada de meia-noite em expediente e exceções:** `hora_fim < hora_inicio` gera zero horários em silêncio (o formulário só valida dentro do mesmo dia).
- **Regra de sinal usa a configuração carregada ao abrir a página** — no teste de 22/09, duas reservas feitas logo depois de desligar o Pix ainda nasceram `aguardando_sinal` (página provavelmente aberta antes da troca). Investigar só se reproduzir com a página recarregada.
- `app/api/notificacoes/route.js:27` monta data local para `getDay()` — correto em UTC, quebraria só em fuso a leste de UTC. Cosmético.
- `ModalPrazoMinimo`: quando o conflito é um atendimento concluído, o botão "Cancelar <data> e confirmar <data>" some (decisão da Sessão 71) e nenhum botão restante fica com estilo primário. Ajuste visual opcional.

### Página institucional /home — ajustes combinados, ainda não aplicados no código (Sessão 66)
Trechos já revisados, falta só aplicar numa branch isolada e testar no dev server:
- `SecaoRecursos.js` — descrição de "Painel simples" sem repetir "dados":
  ```jsx
      descricao:
        "Tenha em mão sua agenda, o histórico de cada cliente e relatórios financeiros, tudo em um só lugar.",
  ```
- `SecaoSobre.js` — eyebrow sem repetir "Acolhe"/"cuidar" perto do h2 e da tagline:
  ```jsx
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              Quem cuida de cada detalhe
            </span>
  ```
- `app/home/page.js` — logo do header de ~400% para 300–350%: trocar `h-24 w-auto sm:h-28` por `h-24 w-auto`.
- Teste em celular de verdade (até a Sessão 66 a validação mobile foi só via devtools), antes de divulgar o link no Instagram.

### Layra — configuração avançada (Sessões 67–68)
- Catálogo completo no ar em produção: categorias Unhas Naturais e Alongamentos, 5 serviços base + 2 manutenções vinculadas por `servico_origem_id`, sem janela de prazo (preço único, a pedido dela), vínculo `servico_profissional` inserido pra todos.
- Identidade visual completa: logo SVG própria, paleta bege-palha/dourado/preto em `TEMAS_POR_SLUG.layra`, header mais fino, contraste ajustado entre item e container (público e `/admin`), botão dourado no público e bronze no `/admin`.
- Horários fixos cadastrados: segunda a sexta 10h/13h/15h/17h, sábado 8h30/10h30, sem atendimento domingo.
- Login de produção vinculado (UID `16e126c7-7606-473f-95ab-eb4d640b091e`, perfil `dono`).
- **Falta:** mensagens de WhatsApp personalizadas, chave Pix (aguardando ela passar), foto de perfil.

### Laryssa — onboarding (Sessões 67, 69 e 72)
- **Segmento próprio:** maquiadora, primeiro tenant fora do escopo original. Valor `maquiagem` criado no CHECK constraint (staging e produção, Sessão 72) e gravado pra ela em produção (id 12). Sem efeito funcional por enquanto.
- **Catálogo completo no ar em produção:** 3 categorias (Maquiagem, Penteados, Noiva), 6 serviços (sem cílios R$90, com cílios R$100, infantil R$50, escova R$70, penteado R$140, noiva R$360), todos com 60min provisórios, vínculo `servico_profissional` inserido.
- `cadastro_completo=false` e `sinal_regra='desligado'` já gravados em produção.
- `modo_horario='janela'` confirmado como decisão real. **Falta:** os horários de verdade ainda não foram preenchidos na aba Horários do `/admin` — o Iorran vai lançar horários modelo e depois substituir pelos reais.
- Identidade visual completa: logo em duas peças (`laryssa-marca.png` e `laryssa-marcaTexto.png`), `layoutMarca:'esquerda'`, paleta preto/branco/rosa (`#FF68AF`), header calibrado via `alturaMonograma`/`alturaMarcaTexto`.
- **Correção do `/admin` NÃO está em produção (corrigido nesta revisão):** a branch `tema-laryssa-fix-botao-admin` (`bgCardAdmin: '#F2F2F2'`, `botaoAdmin: '#000000'`, `botaoAdminHover: '#2A2A2A'`), aberta no worktree separado `C:\Users\Iorran\BarberShop-laryssa`, nunca foi mergeada (Sessão 69). O raio-x da Sessão 74 confirma a Laryssa sem `botaoAdmin`; desde então o admin dela herda o `textoBotao` preto (botões rosa passam de 2,67:1 para 7,85:1). **Falta:** conferir em `lib/temas.js` se a entrada `laryssa` tem `bgCardAdmin` (sem ele, header preto deixa acordeões de Regras de negócio e o drawer mobile com texto preto sobre preto); decidir entre aplicar só `bgCardAdmin` sobre a `main` atual ou descartar a branch; fechar o worktree e apagar a branch em seguida. Conferir o admin dela em produção, claro e noturno.
- Login de produção vinculado (UID `6f56b137-ca46-4a8b-962e-83cb829b6bb2`, perfil `dono`).
- **Falta:** horários reais, mensagens de WhatsApp personalizadas, chave Pix (decisão adiada), endereço do studio (o Iorran cadastra manualmente: Praça Doutor Teixeira Brandão, 286, Centro, Quatis/RJ), segunda data no serviço de noiva e aviso de cabelo lavado na categoria (ver "Agendamento com segunda data — residuais").

### Agendamento em grupo pra maquiadoras — desenho congelado, aguardando alinhamento com a Laryssa
Demanda motivada pela Laryssa: uma cliente agenda pra um grupo (2 a um teto configurável, sugerido 8), cada pessoa ocupando um horário consecutivo — ex.: 4 pessoas = 4 agendamentos de 1h seguidos, todos sob o cadastro da cliente principal. Investigação técnica já feita:
- **Modelo escolhido:** N linhas normais em `agendamentos` (duração normal, sem override), mesma `cliente_id`, todas marcadas com o mesmo identificador de grupo. A coluna `agendamentos.reserva_grupo_id` já existe desde a Sessão 73 e deve ser reaproveitada; decidir o valor de `papel_reserva` nas linhas de grupo (nulo ou um valor novo no CHECK) e conferir que as regras do par (confirmação, cancelamento, Relatórios, Fidelidade) filtram por `papel_reserva`, não só por `reserva_grupo_id`.
- **Achar o horário** não muda nada em `disponibilidade.js`: `duracaoMinOverride = duracao_min × quantidade` já encontra o bloco livre certo.
- **Base da RPC já existe:** `agendamento_criar` é wrapper público sobre `agendamento_criar_interno` (sem grant), e `agendamento_criar_par` cria duas linhas na mesma transação chamando a interna. Um futuro `agendamento_criar_grupo(...)` chama a interna N vezes — se uma bater na exclusion constraint (`agendamentos_sem_sobreposicao`), todas somem juntas.
- **Onde liga/desliga:** dois campos novos em `estabelecimentos` (`permite_agendamento_grupo`, `max_pessoas_grupo`), editáveis só no `/painel-global` — sem criar categoria geral de "tipo de salão".
- **v1 assume:** todas as pessoas do grupo fazem o mesmo serviço.
- Fatiado em 5 demandas (schema → RPC de grupo → wizard público → exibição no admin → tela no painel-global). Congelado a pedido do Iorran até alinhar decisões com a Laryssa.

### Horário reservado pra múltiplos serviços (ex: "dia só dos pés")
Sugestão informal da Flávia, não é pedido recorrente. Seria uma 4ª aba em Exceções de Horário: um horário/dia reservado pra uma lista cumulativa de serviços, bloqueando todos os outros — o oposto da "Exclusividade de serviço" já em produção.

Investigação feita (duas rodadas de raio-x, sem código): viável, sem SQL novo (mesmo modelo de `ausencias`, um `tipo_registro` novo). Achado que simplifica: as grades de horário no modo janela são aninhadas (`gerarSlotsDaJanela` produz uma cadeia, nunca sobreposição parcial), então a interseção de N serviços é só o `max` das durações.

Decisões de UI em aberto, caso retome: componente de chip cumulativo pra serviços (generalizar `TagHorario`), o que fazer quando um dia fica sem horário depois de adicionar um serviço mais longo (recomendado: manter o dia e barrar o salvamento com aviso), e como o card mostra vários serviços "iguais". Custo/benefício não fechou desta vez.

### Processo — tenant com header escuro precisa de token próprio no /admin
O `/admin` herda `bgHeader` pro `--color-card` e ignora `textoCard` por decisão de projeto (usa sempre `textoPrincipal`). Se `bgHeader` for escuro, o card e o drawer mobile ficam ilegíveis. Mecanismo de correção: `bgCardAdmin`, `botaoAdmin`/`botaoAdminHover`, `bordaAdmin`, todos com fallback pros campos públicos. **Item de checklist permanente** (`NOVO_TENANT_CHECKLIST.md`): todo tenant com `bgHeader` escuro precisa definir esses campos antes de considerar o tema pronto.

Mudança da Sessão 74: o `/admin` agora define `--color-on-primary` e todos os botões `bg-primary` usam `text-on-primary`. Com `botaoAdmin` definido, o texto é `textoBotaoAdmin ?? "#fdfcfa"` (campo novo, opcional, nenhum tenant usa hoje); sem `botaoAdmin`, usa `textoBotao ?? "#fdfcfa"`, igual ao público. Tenant com botão claro no admin precisa de `textoBotao` (ou `textoBotaoAdmin`) escuro — incluir no checklist e conferir com o modo noturno ligado.

### Processo — catálogo criado por SQL direto não popula `servico_profissional` (Sessão 67)
- O vínculo `servico_profissional` só é gravado automaticamente pela tela `GerenciarServicos.js` no submit. Catálogo criado direto por SQL fica sem vínculo e o `/agendar` reporta "nenhum profissional disponível".
- **Checklist permanente:** todo catálogo novo criado via banco precisa do INSERT manual em `servico_profissional`. Desde a Sessão 71 isso também é exigido pela RPC `agendamento_criar` (erro AG004 sem o vínculo).

### Documentação — alinhar `PROTOCOLO_DESENVOLVIMENTO.md` com as sessões recentes
- Conferir se o arquivo do repositório já tem: as diretrizes de resposta do Claude (Sessão 70: análise por diff antes de reescrever, prosa corrida sem headers fixos, até 3 parágrafos curtos em linguagem de negócio antes do código); a regra da Sessão 73 (quando a feature exige SQL em produção, os comandos de merge para `main` nunca vão na mesma resposta que o SQL — merge só depois da conferência de produção colada pelo Iorran); as regras da Sessão 74 (`text-on-primary` sobre `bg-primary`, `text-on-card` sobre `bg-card`, `bg-overlay/NN` no véu de modal, token com versão noturna para fundo derivado por `color-mix`, cor nova no admin só por token, aviso de recusa dentro de aba sem `setErro` global, Claude Code não roda `next build`/`next dev` com o servidor do usuário ligado).

### Popups no /admin — investigação fechada, confirmação pendente (Sessão 67)
- Os únicos dois popups de aviso de serviço (`alerta_mensagem` e "Confirmar manutenção") já respeitam `modoLivre` + `pular_perguntas_adicionais_admin`, e esse toggle já está `true` em todos os tenants reais (Flávia, Julia, Laysla, Acolhe-comercial). Não existe popup "Selecione a manutenção" implementado nem aviso de "vence em N dias" fora do `PainelCliente.js`. Não sobrou nada pra codar.
- **Falta só a confirmação de campo** da Laysla e da Flávia se o relato original ainda procede. Até lá, tratar como resolvido.

### Julia — pendências residuais (Sessões 62 e 67)
- Testar ao vivo, com a conta Google da Julia, a lista de eventos ignorados na importação do Calendar e garimpar manualmente os que forem atendimento real.
- Confirmar merge de `fix/lista-ignorados-import-calendar` e `fix/equipe-acordeao` pra `main`, se ainda não tiver sido feito.
- **Terceiro UID de login gerado pro mesmo e-mail dela (`julia@julia.com`)** — vínculo em `perfis` refeito e funcionando (Sessão 67), mas o padrão de precisar recriar o login três vezes não foi investigado. Hipótese registrada na Sessão 66: dashboard do Supabase apontando para o projeto errado (staging × produção) na hora do vínculo.
- Sinal fixo em R$50 (`sinal_regra='todos'`) foi a aproximação aceita pro "50% do valor" que ela pediu — o sistema não suporta sinal percentual. Reavaliar se vira demanda real.
- Botão de destaque sem `textoBotao` (3,52:1) — ver "Cores, contraste e modo noturno". Mostrar a ela a versão com texto escuro antes de aplicar.

### Acolhe — tenant de demonstração (Sessão 65)
- **Fotos das categorias:** o catálogo migrado da Laysla foi criado com `foto_url` em branco de propósito (as fotos originais são do salão real dela) — decidir com ela, ou fotografar/gerar fotos próprias, antes de usar o Acolhe amplamente como prospecção.
- Ainda não testado em produção depois do último deploy (faixa de aviso, fonte, logo centralizada, botão "Acolhe") — conferir isso e o `/admin` do tenant.
- Botão de destaque sem `textoBotao` (2,60:1) — tenant próprio, pode ser corrigido sem consulta.
- Quando a fase de demonstração terminar, decidir se o tenant `acolhe` fica permanente (`janela_agendamento_fim` está em 2030) ou é desativado.

### Laysla — popups escondidos no /admin (Sessão 65)
- **Nota de semântica:** com `pular_perguntas_adicionais_admin` ligado, o popup "Confirmar manutenção" nunca aparece no `/admin`, e pular equivale a escolher "Sim, fiz aqui" — os ramos "Sim, em outro salão" (`servico_manutencao_externa_id`) e "Não, está natural" ficam inalcançáveis por lá. Se a Laysla usar esses ramos com frequência, reconsiderar o toggle.

### Laysla — financeiro (Sessão 64)
- **Decisão de negócio:** relatório financeiro de agosto e setembro/2026 tratado como não confiável (64 agendamentos importados do Google Calendar com `finalizado=false`, que nunca entram no relatório, mais edições manuais não investigadas, mais receita de curso que o sistema não rastreia). Não corrigir retroativamente. Medição "oficial" recomeça em outubro/2026; comparação com a percepção dela prevista pra meados de outubro.
- Os 64 importados de ago/set ficam como estão — ela pode vincular manualmente se quiser, sem prioridade de produto.
- **Atenção pra outubro:** orientar a Laysla a não editar/vincular nada de agosto ou setembro depois que outubro começar, pra não confundir a comparação.
- Pendente: conversa presencial pra reconciliar o valor do curso de setembro (R$800 numa conversa, R$1.600 em outra).
- Rastrear receita fora de agendamentos (cursos etc.) seria funcionalidade nova — avaliar só se ela confirmar interesse.

### CRM Comercial (trilha separada — Sessão 63 e reconstrução de 16/09)
- **Estado corrigido nesta revisão:** o schema do CRM (`leads`, `tags`, `lead_tags`, `interacoes`, `tipos_atendimento`, `cidades` + RLS só para `papel='global'`) e o tenant `acolhe-comercial` existem em staging **e produção**, sincronizados desde 16/09; todo o código está em `main`. O item antigo "existe só em staging — replicar" não vale mais.
- **Decisão de 16/09 que substitui o teste antigo do gatilho de demonstração:** todo agendamento criado pelo CRM fica permanentemente `status='pendente'` (nunca `confirmado`, para poder apagar/recriar sob a policy de DELETE), com `telefone=null` e `origem='crm'`. O cenário "agendamento termina `confirmado` no Painel do `acolhe-comercial`" não se aplica mais.
- **Revalidar depois da Sessão 71:** o CRM insere agendamentos como `authenticated` (papel global) — continua coberto pela policy de insert do admin, mas criar/remarcar/apagar atendimento pelo CRM não foi exercitado depois das mudanças de RLS.
- Decidir se o push "Pendente: {nome}" disparado pelo insert do CRM incomoda (só chega a quem ativou notificação no `acolhe-comercial`).
- **Adiados de propósito:** aba de Relatórios do CRM (motivo de perda, taxa de conversão, leads sem resposta) só quando houver volume de dado; busca rápida por nome/WhatsApp/Instagram só quando o Iorran sentir falta no uso diário.

### Dados de teste a limpar
- Staging, Laysla (`estabelecimento_id=3`, slug `laysla`): lotes nunca limpos — `Teste Aguardando Confirmação`, `Teste Editar no Histórico`, `Teste Sinal - Aguardando Conclusão`, `Teste Sinal - Editar Histórico`, `Teste Sinal - Sem Valor Registrado`, `TESTE QA - Sinal Pago`, `TESTE QA - Sem Sinal`, `TESTE QA - Marca Editado`, mais os agendamentos e comprovantes de teste da Sessão 71 e as alterações de data do teste da Sessão 74. Os dois "Molde F1" da cliente `xuxa` são dado pré-existente — não apagar.
- Staging, Flávia: serviços de teste com nomes aleatórios (`teste`, `ffjfdfddjj`, `xzcbxzbcbzbxzbxzc`) vistos na Sessão 74 — confirmar se são lixo e apagar.
- Produção, tenants de teste `junior` e `acolhe`: agendamentos e comprovantes de teste da Sessão 71.
- Salão de Teste (staging): setembro e outubro/2026 gravados como `'fechado'` em `janela_agendamento_meses` (Sessão 57). Novembro e dezembro/2026 marcados `'aberto'` de propósito na Sessão 72.
- Salão de Teste (staging): cliente `Cliente Teste Par` (`(24) 98888-0001`) e os pares das Sessões 72–73; "Segunda data" ligada nos serviços do teste e fidelidade ligada com meta baixa — desligar/reverter se ainda não foi feito.
- Salão de Teste (staging, id 1): `sinal_valor_centavos`/`sinal_chave_pix` preenchidos com `sinal_regra` desligado — residual da marca Acolhe.
- Salão de Teste: clientes `Teste Logo Rodape` e `Teste Anamnese Rodape`.
- Lixo de teste (`Cancelamento: {nome}`) em `pendencias_admin` de staging.

### Configuração retroativa pendente
- Etiquetas padrão (5) nunca criadas para Valéria (produção) e Flávia/Junior/Valéria (staging) — só a Laysla tem em staging. Valéria é tenant de teste, então é baixa prioridade; enquanto isso, o checkbox de sinal obrigatório pra "Lista de Bloqueio" fica desabilitado nela.

### Bugs conhecidos
- **Erro geral do `/admin` apaga a aba aberta** (Sessão 74): o estado `erro` de `app/[salon]/admin/page.js` (~475, exibido em ~2964) é condição de renderização de todas as abas (`!carregando && !erro && viewPai === ...`). Quando uma operação falha e chama `setErro` (ex.: `handleCancelar`), a aba ativa é desmontada — na aba Clientes a ficha some — e só volta depois de outra operação bem-sucedida. Precisa de raio-x próprio (separar "erro de carregamento" de "erro de operação" e dar ao segundo um aviso não destrutivo). O "Alterar data" da ficha já usa aviso âmbar local.
- **Google Calendar não é atualizado por nenhuma remarcação/cancelamento feito pelo `/admin`** — o gatilho automático nunca foi criado; a sincronização só roda via curl manual. Vale também para o "Alterar data" no detalhe de qualquer confirmado, o cancelamento das duas linhas de um par e o "Alterar data" da ficha. Impacto real desconhecido para donas que usam o Google como agenda principal — investigação própria.
- **Botão flutuante do WhatsApp pode "grudar" na posição de um layout anterior** (Sessão 65): o botão (`fixed`, recalculado só em `scroll`/`resize` via `IntersectionObserver`) fica preso quando a altura do conteúdo muda sem esses eventos (troca de etapa do wizard, sumiço de campo, página mais curta que a tela). Afeta todos os tenants. Sem raio-x de correção ainda.
- **Importação do Google Calendar sempre grava `finalizado=false`, inclusive quando o vínculo com cliente/serviço é feito depois** — atendimentos importados ficam fora do relatório financeiro e de telas que exigem `finalizado=true` (contagem de "cliente nova", painel da cliente). Correção considerada segura (Sessão 64: incluir `finalizado: true` no UPDATE do `ModalVincularCliente.js` e na rota de importação automática), não aplicada. Relevante para qualquer tenant que importe (ex.: Julia).
- `calendar_import_ignorados` existe em staging mas não em produção — possível quebra da importação lá, não confirmado na prática.
- **Colunas de `estabelecimentos` divergentes entre `lib/estabelecimento.js` e `lib/perfil.js`** — as duas listas já divergem em vários campos (regra do `QA_CHECKLIST.md`; auditoria formal nunca feita: listar colunas via `information_schema.columns` e comparar com os dois selects).
- `jaPendente` nunca é passado ao `BlocoConfirmacaoPix` pelo wizard. Parcialmente mitigado na Sessão 71: `agendamento_declarar_sinal` só carimba `pendente_desde` quando está vazio. A edição que cancela e recria a linha ainda gera carimbo novo — revalidar se ainda incomoda.
- **Checkbox nativo do `/admin` não segue o tema** (azul padrão do navegador) — todos os tenants, cosmético.
- `buscarAgendamentos` (`page.js`) usa `duracao_min` do join com `servicos` em vez da coluna própria de `agendamentos` — mesma inversão já corrigida em `buscarFechados` (12/09). Relevante de novo se o agendamento em grupo avançar.
- Segundo comprovante Pix enviado com a linha já em `pendente`: desde a Sessão 71 o anexo atualiza normalmente e `sinal_valor_centavos` vem do estabelecimento via `coalesce`. Revalidar se o caso "não grava o valor do sinal" ainda existe antes de fechar.
- Remarcação no fluxo manual (não-AbacatePay) cancela e recria a linha; a nova só recebe `sinal_valor_centavos` quando a cliente declarar o pagamento de novo.
- Badge de fidelidade só recalcula depois de reabrir a ficha do cliente, ao editar um concluído.
- Marcar "Não compareceu" sobre um item já concluído corrige o sinal, mas nenhuma tela mostra essa marca depois — o item vira cancelado e o botão "Editar" some desses cards.
- Sem backfill retroativo de `editado_manualmente_em`: concluídos manuais antes de 14/09 não aparecem como "Editado".
- Aviso de React pré-existente: "Cannot update AdminPage while rendering ConfiguracoesSalao" em `salvarMes`.
- Erro HTTP 400 recorrente no console, origem não identificada.
- Dívida técnica de tipos: `ConfiguracoesSalao.js` (`servicoManutencaoExternaId` sem `String()`) e `ModalVincularCliente.js` (`patch.servico_id` grava string crua) — inofensivo hoje. Vale um grep geral por `Number(e.target.value)` perto de campos `_id` (já causou dois bugs de uuid gravando `null`).
- Bug de navegação por voltar físico a partir do Pix: modo edição não investigado ao vivo (`sairDaEdicao` deveria levar de volta ao Pix); no fluxo novo sem edição há toques "mortos" — mexer no mecanismo tem risco desproporcional ao ganho.

### Produto / UX
- **Datas passadas nos calendários do app em geral** precisam ficar não-selecionáveis, com mensagem clara em vez de "Preencha as duas datas" quando a data digitada é impossível (ex.: 31/09). Prioridade — reportado com print (Sessão 72).
- **Aviso quando a duração de um serviço muda com agendamentos futuros** (Sessão 23, sem decisão): `duracao_min` é foto do momento da reserva, então mudar a duração no catálogo não corrige agendamentos já feitos e pode gerar sobreposição real na agenda. Opções: listar/avisar ao salvar quantos agendamentos futuros usam a duração antiga, ou aceitar como responsabilidade da dona.
- "Manutenção vinda de outro salão" (`servicos.manutencao_externa`) precisa de redesenho: hoje pode ser marcado em vários serviços, mas deveria ser único por estabelecimento e mutuamente exclusivo com "Este item é uma manutenção".
- UX da pergunta condicional (mãe/filha) em `GerenciarServicos.js` — funcional, mas complexa de configurar; considerar assistente passo-a-passo.
- Polish visual dos botões de upload de comprovante (botão principal "Enviar comprovante" + link "ou enviar como PDF") — desenhado, adiado até confirmar fricção no uso real. Os dois inputs separados por `accept` (fix Android da Sessão 32) continuam sendo a razão dos dois botões.
- Popup de renovação de anamnese (12 meses vs. manter prazo já editado) — precisa de duas colunas novas via SQL antes de qualquer código (vencimento explícito em `anamnese_respostas`, prazo configurável em `estabelecimentos`).
- Aviso de Pix no cancelamento (valor não volta automaticamente) — cobrir tanto `/agendar` quanto `/admin`.
- Falta (`cancelado` + `nao_compareceu=true`) aparece só como "Cancelado" no Histórico — decidir se vale rótulo próprio.
- Mensagem de WhatsApp "Fora da janela" (`MENSAGEM_FORA_DA_JANELA`) cita `{janela_fim}`, campo sem relação real com a disponibilidade — remover ou substituir o texto.
- Campo `janela_agendamento_fim` escondido em Regras de negócio (`{false && (...)}`) sem UI — decidir entre reexibir editável ou remover de vez (coluna, loaders, save). Não participa de nenhuma decisão de disponibilidade hoje.
- Bloqueio temporário de novembro (Laysla) — bloquear o mês inteiro com liberação automática numa data. Pedido anterior à janela mensal (Sessão 41): conferir com ela se "mês restrito + `abre_para_todos_em`" já atende antes de construir algo novo.
- Default de "Cliente Fixo" em mês restrito não filtra por `ativa` em `etiquetasSelect`.
- Insert de sinal pelo `/admin` (agendamento novo com sinal declarado) não foi exercitado ao vivo com sessão autenticada — confirmar que grava o valor certo.
- Sinal retido histórico de cancelados ficou fora do backfill de sinal por incerteza de estorno — se um dia quiser recuperar, precisa de critério próprio.
- Rota estática `/home` colide conceitualmente com `/[salon]`: não é bloqueante (estático vence dinâmico), mas o slug `home` fica indisponível para qualquer tenant.
- **Segmento "cabeleireira"** não existe no CHECK de `estabelecimentos.segmento` — criar só quando entrar a primeira. Sem tela de segmento no `/painel-global` enquanto nenhuma regra depender dele.

### AbacatePay — itens residuais (baixo risco)
- Remarcação (`app/api/agendamentos/remarcar/route.js`): restauração best-effort do status da linha antiga quando o insert da nova falha, sem transação atômica (a correção definitiva seria uma RPC). Desde a Sessão 71 a rota grava as respostas das perguntas com service role; resposta inválida é descartada com log.
- Fail-open silencioso na leitura de credencial (`abacatepay_conectado: true` em erro de leitura, rota `/api/abacatepay/conectado`) — decisão consciente para um blip de rede não virar "parou de cobrar".
- Rebaixamento silencioso da cascata de sinal Pix pra "desligado" quando falta chave manual e credencial AbacatePay ao mesmo tempo.
- Toda conta AbacatePay nova precisa de chave com escopo **Completo** (sem ele, o webhook é criado mas não removido); Flávia e Laysla ainda não criaram contas próprias (CNPJ/MEI obrigatório).

### Limpeza de código
- String de fallback `"a equipe"` duplicada em três lugares.
- Colunas antigas `servicos.ocultar_preco` e `servicos.ocultar_duracao` sem uso.
- Coluna `estabelecimentos.reserva_provisoria_expira_horas` ainda no banco, usada só pelo bloco de rascunho abandonado de `expirar_pendentes_vencidos` — `DROP COLUMN` fica pra depois, manual.
- Campo `emoji` em `etiquetas_cliente` sem consumidor (ainda selecionado nas queries).
- `buscarUltimasAnamnesesPorCliente` (`lib/anamnese.js`) sem consumidor.
- `components/BotaoServico` (`FormularioAgendamento.js`) é código morto.
- `gerarSlots`, `estaAberto` e `DIAS_FUNCIONAMENTO` em `lib/horarios.js` são código morto.
- `dentroDaJanelaAgendamento`/`diasRestantesJanela` (`lib/janelaAgendamento.js`) continuam exportadas sem participar de decisão nenhuma desde a janela mensal.
- Bloco oculto de `restricoes_agenda` em `ConfiguracoesSalao.js` (`{false && ...}`): se algum dia reativado, depende de state removido do `page.js` na Sessão 41. Mecanismo aposentado em favor da janela mensal — decidir remoção.
- `remotePattern` de `fotos-perfil` em `next.config.mjs` sem consumidor desde a Sessão 34 (dialog de zoom usa `<img>` nativa).
- `salvarRespostasPerguntas` agora só é usada pelo `/admin` — conferir se ainda precisa morar em `FormularioAgendamento.js`.
- **`buscarTema` é chamado em 5 pontos independentes** (`page.js`, `admin/page.js`, `FormularioAgendamento.js`, `Hero.js`, `AvisoTopo.js`), sem contexto único — pré-requisito antes de qualquer tema vindo do banco.
- **eslint acusa 13 erros `set-state-in-effect`** em `app/[salon]/admin/page.js` e vizinhos (pré-existentes, o build passa).
- Conteúdo dentro do `<div className="escopo-admin">` de `admin/page.js` não foi reindentado (de propósito) — só estética.

## Backlog
- **Cobrança automática da mensalidade das assinantes** (planejamento financeiro de 05/09, meta de ~1 mês; MEI aberto em 17/09 para usar a AbacatePay também nessa cobrança): tirar o Iorran do papel de cobrador manual, com lógica de atraso ligada a funcionalidades do app, atrás de feature flag. Cuidado extra: erro de data não pode travar agenda de cliente adimplente. Relacionado (negócio): CNAE secundário de desenvolvimento de software (6201-5/01) no MEI.
- **Tema dinâmico (a dona escolhe as cores no app)** — raio-x completo feito na Sessão 74, viável. Proposta: 3 cores de entrada (header, fundo, destaque) e o resto derivado por luminância, com texto claro/escuro escolhido automaticamente para garantir 4,5:1 (em vez de chave manual "header claro/escuro" — a Laysla mostra que header escuro não prediz botão escuro). Ordem: consolidar as chamadas de `buscarTema` → derivação automática validada nos tenants atuais → tema no banco (cuidado com flash de cor errada: as páginas são `"use client"`) → tela de escolha no admin. A tokenização dos botões foi feita na Sessão 74.
- **Bateria de testes automatizados do motor de agenda** (raio-x de 22/09, nada implementado — o projeto não tem infraestrutura de teste). Camada 1: `node:test` nativo sobre as funções puras de `lib/disponibilidade.js`, `lib/horarios.js` e `lib/janelaAgendamento.js` (exportar 5 funções internas; `agora` já é injetável em `filtrarPorAntecedenciaMinima`), com matriz de precedência de exceções e testes de fuso `TZ=UTC` vs `America/Sao_Paulo`. Camada 2: script read-only de auditoria de ociosidade em staging ("minutos órfãos" e "minutos indevidos" por tenant/dia), exige cliente Supabase injetável em `carregarBaseDisponibilidade`. No Git Bash `TZ=America/Sao_Paulo` não funciona — usar PowerShell ou `MSYS_NO_PATHCONV=1`.
- **Motor de agendamentos vinculados para outros perfis** (oportunidade comercial da Sessão 73): o mesmo recurso da segunda data serve a massoterapeutas (avaliação + sessão, pacotes), procedimentos com revisão/retoque depois (cílios, micropigmentação) e 3 ou mais agendamentos vinculados. Já genérico: agrupamento por `reserva_grupo_id`, criação atômica via `agendamento_criar_interno`, cancelamento público de todas as irmãs, filtros de Relatórios/Fidelidade/"Cliente Nova" por `papel_reserva`, Pendentes agregados, sinal preso ao principal. Preso a "par": CHECK de `papel_reserva` (`principal`/`anterior`), `servicos.exige_segunda_data` + `nome_etapa_anterior` (uma etapa, sempre antes), wizard de duas fases, helpers no singular (`irmaDoPar`, `etapaAnteriorDoPar`, `irmaCancelavel`), `agendamento_criar_par` com duas datas. Caminho sugerido quando houver o primeiro cliente real: `papel_reserva='etapa'` + `ordem_etapa` e antes/depois; tabela `servico_etapas` (nome, ordem, antes/depois, intervalo mínimo/máximo, preço opcional), migrando as `'anterior'` atuais para etapa de ordem 1; RPC `agendamento_criar_com_etapas(..., p_etapas jsonb)`; wizard com N fases e intervalo mínimo; helpers no plural. Decisões de negócio da época: etapa depois pode ter preço? Fidelidade conta 1 ou N visitas num pacote? Sinal só no principal ou proporcional? Não misturar com o agendamento em grupo (várias pessoas) sem antes decidir como distinguir os dois.
- **Agendamento em grupo pra maquiadoras** — ver seção própria em "Em aberto".
- Sessão dedicada ao Programa de Fidelidade (ver documento próprio: botão "agendar brinde" sem handler, ponto só na virada pra histórico, notificação à cliente, expiração de 12 meses, brinde físico). A leitura pública passou pela RPC `fidelidade_base_cliente` na Sessão 71; desde a Sessão 73 ela ignora a etapa anterior de um par.
- Reforçar com as donas o uso da aba Ausências pra bloqueio de agenda pessoal, em vez de automatizar leitura do Google Calendar (decisão da Sessão 62).
- Callback de patch para `sinal_regra` em `ConfiguracoesSalao.js` → `AdminPage`, evitando staleness do aviso de Pendentes até reload.
- Confirmar no código real como `clienteEhNovo` é calculado em `precisaSinal` (ramo `'novos'`).
- Auditoria não iniciada: varredura livre de padrões de risco não previstos, continuação do raio-x de risco silencioso.
- Job de expiração de comprovantes Pix antigos (Sessão 29): `pg_cron` apagando do Storage comprovantes de agendamentos concluídos/cancelados há mais de 12 meses. Sem urgência pelo volume atual.
- Nível de acesso "funcionário" (terceiro papel além de `dono`/`global`) — nunca desenhado.
- Considerar suporte a sinal percentual (não só valor fixo) — motivado pelo pedido da Julia.
- Painel de Alertas (`/painel-global` → Auditoria → Alertas, Sessão 65): v1 cobre só os 3 toggles que já eram coluna. Os ~27 itens da "Cesta 2" (popups fixos no código) ficam catalogados só como leitura — migrar item a item conforme a necessidade real.
- Fase futura: logo do `/admin` virar link pro Instagram do Acolhe.
- Sessão dedicada de limpeza das branches antigas já mergeadas (a lista local passa de 130; `tema-laryssa-fix-botao-admin` está aberta em outra worktree e precisa ser resolvida lá antes — ver seção da Laryssa).