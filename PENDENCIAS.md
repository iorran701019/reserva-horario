# Pendências — reserva-horario

Reescrito em 19/10/2026 a partir do raio-x (RAIOX_PENDENCIAS.md, commit d1b798a), conferido contra código e git em 20/10 e atualizado em 28/10 (Sessão 96: adicional de domingo em produção). Só o que está aberto. Entregue, descartado ou "pode ficar" saiu daqui; histórico de sessão mora no handoff.

## Regra de fechamento de sessão
1. Este arquivo guarda só o que está aberto: uma linha por item, com o contexto mínimo e a referência (seção do handoff ou commit).
2. Entregou? Risca a linha e registra no handoff da sessão. Nada de "Entregue" aqui.
3. Item novo entra na seção certa (Agora, Confirmar, Decisões, Backlog), sem repetir em outra.
4. Decisão tomada vira ação ou sai. "Aceito" e "pode ficar" não ficam.
5. Teste manual pendente vai para "Confirmar", com quem faz e onde (produção, Vercel, dona).
6. Se uma linha precisar de mais de 2 frases, o detalhe vai para o handoff.
7. Dados de teste em staging **não** são limpos (decisão de 26/10): servem de histórico. Limpeza de teste só em produção.

## Inadiável (próxima sessão)
- **Lista de agendamentos do `/admin` sem limite:** `buscarAgendamentos` carrega o histórico inteiro do salão, sem `.limit`/`.range`; acima de 1000 linhas a lista pode ser truncada sem aviso. Medição de 26/10 em produção: Laysla 410, Flávia 288, Julia 232, Layra 183, Junior 135. Raio-x de todos os usos da lista (Pendentes, Histórico, Financeiro, Relatórios, Clientes, respostas por agendamento) antes de decidir entre paginação e corte por período. Handoff 96, seções 4.10 e 7.

## Agora
1. **Grade em mês fechado:** no Agendar e no Alterar do `/admin`, num mês fechado na janela, os horários do expediente aparecem como "Disponível" (o calendário mostra o dia tracejado). Mês fechado não tem horário aberto, nem na visão da dona: mostrar "Fora da janela" e decidir o âmbar de domingo em mês fechado. Demanda própria, com raio-x; junto, o desenho da regra de assinatura sobre a janela (ver Decisões). Handoff 96, seção 4.11.
2. **Egress do Supabase, fechamento:** (a) olhar o Usage do ciclo novo (era por volta de 28/10); o painel avisou restrição a partir de 20/11 se a organização seguir acima da cota (se o ritmo passar do limite, Pro com spend cap antes de 20/11); (b) `--remover-antigos` em dry-run e depois com `--apply` (17 arquivos antigos com backup em `C:\backup-fotos\prod`); (c) investigar o Log Ingestion (1,9 GB de 1 GB).
3. **Ativar a troca de credenciais das donas**, uma por vez, pelo "Exigir troca" (laysla, flavia, julia, laryssa, layra, lilian), com aviso por WhatsApp e datas na tabela 8.9 do Handoff 90. Não ativar junto com a assinatura na mesma dona no mesmo dia.
4. **Lilian, antes de mandar o link:** abrir o mês atual e o seguinte na janela, testar `/lilian` e `/lilian/admin`, cancelar o teste sem notificar.
5. **Datas passadas selecionáveis e mês fechado como calendário cinza sem explicação** (Produto / UX, os dois com print ou caso real).
6. **Versionar SQL à mão em `sql/`:** `sql/acrescimo_domingo.sql` (Handoff 96, seção 11, e Handoff 95, seção 5) e `sql/clientes_desativar_reativar.sql` (apêndice do Handoff 92); sem isso o repositório não tem essas funções.

## Confirmar (só o Iorran resolve; nenhuma é código)
**Banco (Supabase)**
- Serviços com `exige_segunda_data` e `nome_etapa_anterior` vazio em tenant real mostram "Teste" para a cliente?
- `select * from restricoes_agenda where ativa` em produção (a UI está oculta, uma linha antiga afeta o calendário).
- Cron `assinatura_gerar_faturas_diario` existe em staging? `calendar_import_ignorados` existe em produção?
- Policies: `comprovantes-pix` sem filtro de salão (correção em staging primeiro); roles divergentes staging × produção (`agendamentos` UPDATE é `{public}` em staging e `{authenticated}` em produção; `perfis`); leituras anônimas `using = true` coluna a coluna; leitura de `authenticated` nas demais tabelas do `/agendar`.
- Trazer ao repo os corpos lidos em 23 e 24/10: `agendamento_alterar`, `agendamento_alterar_agregado`, `agendamento_cancelar_cliente`, `agendamentos_cliente_ativos`, `agendamento_criar`, `agendamento_criar_interno`, `agendamento_criar_com_agregado`, `agendamento_criar_par`, `sinal_resolver`, `set_duracao_min`.
- Limpezas de dado de teste **em produção**: clientes "Teste" 24966332133 e 24999187739 e o que a junção gerou; clientes de teste desativados em 20 e 21/10 no tenant de teste; Junior S81; registros de Exceções S76; agendamentos de teste de junior/acolhe.
- Chaves da Sessão 64: `GOOGLE_CALENDAR_CLIENT_SECRET` gerado de novo no Google; `NOTIFICACAO_WEBHOOK_SECRET` dentro de `notificar_agendamento` nos dois bancos; `ABACATEPAY_WEBHOOK_SECRET` global sem consumidor (`git grep`).
- `ausencias` e `anon`: grants de INSERT, UPDATE, DELETE e TRUNCATE para `anon` (a RLS barra a escrita; o TRUNCATE não passa pela API) e leitura `using true` de todos os salões; revisar e ver se `motivo` precisa ficar público.

**Vercel**
- Push novo na `main` vira Production sozinho depois do rollback de 25/09? `46c8292` (adicional de domingo, 28/10) foi conferido como Production e Ready. Ainda sem conferência registrada: `7a698f0`, `d707f03`, `113f2cf`, os commits das Sessões 83 e 84, o `148e8d3`, `14c9b17` e `798afaa`.

**Teste real (produção ou dona)**
- **Adicional de domingo, sem prova na tela:** remarcação com sinal pago para um domingo com acréscimo (em staging, marcar `abacatepay_pago_em` numa reserva de teste por SQL e remarcar); card de conclusão de reserva com acréscimo; domingo sem marca sem a caixa; tenant de tema escuro no `/agendar` (horário âmbar legível); celular.
- Categorias retráteis em produção (tenant `junior`): linha "Ajustar foto" fechada, abrir uma categoria, mexer no zoom e ver o "Salvo", celular e modo noturno.
- `/julia` com o login da Laryssa; evento amarelo da Laryssa no Calendar e tom confirmado com ela.
- Modal único "Alterar" no celular (incluindo `window.open` no Safari/iPhone).
- Ciclo completo da junção de cadastros em produção (aviso, Resolver, Desfazer, Resolver novamente, Números anteriores) e lista de clientes de um salão real carregando.
- Desativar cliente em produção (Sessão 92): popup com aviso de agendamento futuro, reativar com número já em uso, modo noturno do quadro "Desativados" e dos popups, contador no celular com "Ver desativados · 1 de 2".
- Layra: prazo de manutenção e aviso de serviço diferente pelo `/admin` (sem staging).
- Teste controlado do Pix automático por regra especial na Laysla; tela de conexão AbacatePay em salão manual.
- Título do Google Calendar com "A + B" na primeira dona com agregado.
- Admin da Laryssa em produção, claro e noturno; modo noturno com Laysla e Flávia; `/home` em celular real antes de divulgar.
- Calendar: alteração e cancelamento pelo `/admin` sincronizam de fato? (o gatilho existe, a prática nunca foi provada).
- Fluxo da janela mensal: `salvarMes` apaga `etiqueta_liberada_id` e preenche `abre_para_todos_em` sozinho? Raio-x de código + teste em staging.

**Com as donas**
- **Adicional de domingo, antes de anunciar:** mostrar o desenho à Julia, combinar o percentual (padrão 40% desde 28/10, teto 50) e o texto; levar a regra a um advogado ou ao Procon (CDC, art. 39 X e 31). A cliente vê "Acréscimo de Domingo no valor total do serviço", sem percentual. Avisar as donas da caixa de negociação no Agendar e no Alterar.
- Flávia, Julia e Laysla: avisar que o valor sugerido ao concluir um atendimento passa a somar as respostas com ajuste de preço, e que o "Valor total" agora aparece para a cliente em toda reserva no `/agendar`.
- Laryssa: avisar que "Desativar cliente" já está no ar (lixeira na ficha, "Ver desativados" ao lado do contador). Às demais donas, junto com o aviso de duplicidade e o Resolver (combinar com a troca de credenciais, um assunto por vez).
- Assinaturas: ativar as donas reais no Financeiro, avisando antes (Laysla a partir de nov/2026, Julia nov/dez isentos, Lilian out isento e nov/dez R$50). Conferir na primeira: fatura cancelada fora do Histórico, link "Voltar para <Mês>", card em Pendentes e bolinha no menu.
- Laryssa: horários reais, mensagens, chave Pix, endereço, segunda data e nome da etapa no serviço de noiva, aviso de cabelo lavado. Julia: abrir novembro e 2027, confirmar horário das 05:00 e se 25/12 e 31/12 são intencionais. Flávia: R$140 × R$150 na manutenção +30, serviços 193/404, duplicidade 35 × 58, quem cancelou Thaisa/Maria Eduarda/Mônica. Laysla: mover o parágrafo do Pix para "Texto do sinal Pix", caso Clara/Vitória/Carla de 11/10.
- Configurar os primeiros agregados reais (Julia e Laysla: remoção + molde F1; Flávia: criar os agregados, conferir, só então **desativar** os combos antigos, nunca apagar).
- Julia e Laryssa: preferem desligar as perguntas no bloco "Alertas e avisos"?
- Laysla: orientar a não editar ago/set depois que outubro começar.

## Decisões de produto abertas
- **Bloqueio da janela pela assinatura (ideia do Iorran, 28/10):** mensalidade em atraso impede abrir meses novos na janela, mantendo sem incômodo o que a dona já agendou. Ponto delicado: decidir se o bloqueio por falta de pagamento é mais firme que o fechamento comum (a dona ainda pode agendar ou mover "mesmo assim"?) e como tratar quem já tem meses abertos adiante (Laryssa até março de 2027). Revisar junto com a grade em mês fechado.
- **Grade em mês fechado:** a regra vale para o Agendar e o Alterar do `/admin`? O âmbar de domingo some em mês fechado?
- **Alterar confirma o pendente num segundo UPDATE:** juntar alteração e confirmação numa operação só (uma notificação, sem estado intermediário se um gate parar)? Hoje notificação e Calendar disparam duas vezes. Handoff 96, seção 7.
- **Adicional de domingo:** painel da cliente ("Meus agendamentos") com valor e texto (exige recriar `agendamentos_cliente_ativos` com os grants); campo do percentual no painel global, quando; pares com acréscimo (backlog do perfil maquiadora).
- O que fica no painel global, na tela da dona ou em código fixo na varredura de recursos órfãos; existe tela para `manutencao_valor_cheio_apos_prazo`? Remover `segmento` se ninguém lê?
- `{valor}` entra no texto padrão da mensagem de alteração (Flávia, Julia, Layra, Laysla)? Com acréscimo, o valor sai das mensagens.
- Nome e sobrenome obrigatórios no cadastro novo do wizard (só cadastro novo; no admin livre).
- Descartar `CHECKLIST_BLOCO.MD` e `PROCOLO_BLOCO.MD` (estão versionados, a pendência antiga dizia o contrário).
- Laryssa: aplicar `botaoAdmin`/`botaoAdminHover` pretos? (já tem `bgCardAdmin`).
- Pendente e aguardando sinal contam como base de manutenção?
- Cores de etiqueta padrão para Junior, Laysla e Julia, que já personalizaram?
- Chave Pix da plataforma em PF de terceiro: migrar para conta PJ do MEI quando possível.

## Vivo, prioridade média
- **Adicional de domingo, acabamentos:** erro 23514 no insert direto do Agendar do admin aparece como texto técnico cru; rota de remarcação devolve 500 genérico no 23514; popup "Alterar sem avisar a cliente?" aparece quando a dona mexe só na caixa; o percentual viaja no select público de `estabelecimentos` (a cliente não o vê); `acrescimoPorHorario` é propriedade não enumerável (spread, cópia ou `filtrarPorAntecedenciaMinima` perdem; ler sempre o mapa cru); etiqueta da cliente desconhecida quando o Alterar abre pela ficha (só a cor do calendário).
- **Alterar:** profissional que não faz o serviço novo deixa a grade vazia sem explicação; restrição por etiqueta não é checada ao salvar (a janela mensal já pede confirmação).
- **Varredura de recursos órfãos** (ordem no `INVENTARIO_RECURSOS.md`): "Teste" como etapa anterior padrão (`lib/agendamentosCliente.js` ~94); etiquetas por papel em vez de nome (`ETIQUETA_CLIENTE_FIXO`, `NOME_ETIQUETA_CLIENTE_NOVA`); tela "Dados do salão" no painel global (`ativo=false` só existe por SQL); editor estruturado de avisos; tema por slug e aliases `junior`/`valeria`/`barbearia`; duplicatas do Acolhe; limpeza de `prazo_manutencao_dias` (selects em `GerenciarServicos.js` ~399/911 e comentários em `sql/`).
- Dois selects de `estabelecimentos` (`lib/estabelecimento.js` e `lib/perfil.js`) sincronizados à mão; auditoria via `information_schema` nunca feita.
- Bug da pergunta condicional (filha salva com `pergunta_pai_id` NULL). Roteiro de 4 passos no handoff.
- Remarcação e RPCs não conhecem o par: `agendamentos_cliente_ativos` e `..._janela_prazo` sem `reserva_grupo_id` e `abacatepay_cobranca_id`; `remarcar/route.js` recria sem `reserva_grupo_id` (e herda `sinal_valor_centavos`); popup de prazo mínimo oferece cancelar a vizinha do par.
- Motor: `PainelCalendario.diasSemVagas` diverge do motor; `erroDeLeitura` perdido ao recriar o Map (fail-closed silencioso); `ausencias` lida sem paginação (produção tem 800 linhas no total e a Julia 538; o limite do PostgREST é 1000 por consulta); o motor não entende `recorrente_periodo` em liberação ou bloqueio.
- Importação do Calendar grava `finalizado=false`; erro geral do `/admin` apaga a aba aberta.
- Banco não impede agregado em serviço bloqueado (regra só no front e em `agendamento_alterar_agregado`).
- Catálogo do painel global (`AbaAuditoria.js`) desatualizado: "Reduzir janela" ainda lá; faltam restrição de serviço, regra especial, liberação por período, domingo com acréscimo (caixa da dona, confirmação de remoção, confirmação de janela no Alterar), assinatura, duplicidade, avisos da Sessão 83 e 90.
- `sql/` diverge do banco (assinaturas, `ausencias_log`, policies da Sessão 80, colunas da Sessão 90; `ausencias` nem existe em `sql/`; `clientes_anon_update_policy.sql` descreve uma policy pública de UPDATE em `clientes` que não existe em staging nem em produção; faltam os corpos de `cliente_buscar_por_whatsapp`, `cliente_identificar_ou_criar` e `cliente_cadastro_completo`).
- Termos e Privacidade sem canal de contato da Acolhe.
- Ligar a marca de segurança e, depois da ativação: histórico de senhas (3 últimas), troca voluntária em "Minha conta", "Esqueci minha senha" só quando todas tiverem e-mail real, ação "Permitir corrigir e-mail" (caso C nunca testado), revogar INSERT/UPDATE de `anon`/`authenticated` em `perfis`.
- Branch `feature/ordem-foto-perfil` (local e `origin`) não está na `main`: mergear ou descartar. Junto, decidir os três stashes antigos (dois dela e um da `main` chamado "Enter").
- Sem prova no navegador: virada para bloqueio aos 30 dias, aviso 429, provisória recusada como senha nova.

## Backlog (baixa prioridade; só entra na fila se alguém pedir ou incomodar)
- **Múltiplas profissionais (em manutenção desde 28/10; nenhum salão real usa):** troca de profissional usa a visão da cliente (só quem está livre no expediente), a duração do serviço e não a da reserva, e troca só uma linha do par, deixando a irmã com a profissional antiga; caixa de acréscimo na troca. Só entra quando houver dona real com 2+ profissionais ativas.
- **Adicional de domingo:** em datas que não são domingo (feriados) se as donas pedirem; pares com acréscimo; conector tracejado entre slots ocupados (`ligaAoProximo`) no Alterar; desconto e promoção por período reaproveitando o padrão do acréscimo.
- **Categorias:** miniatura da foto também dentro da linha retrátil (ideia original do Iorran, 21/10), se a tela de Serviços ainda parecer cheia.
- **Desativar cliente (acabamento):** `hojeStr` de `lib/clientesAdmin.js` vem de `app/painel-global/financeiro/util.js` (mover para um helper de `lib/`); busca por nome sem acento nas duas listas (ativos e desativados); botão de tentar de novo quando a carga inicial dos desativados falha.
- **Pix e sinal:** link do comprovante some quando a dona marca situação; `metodoEfetivoSinalPix` ignora regras especiais; sinal percentual; AbacatePay na assinatura (webhook próprio, R$0,80 por Pix) e bloqueio por inadimplência (aviso antes do bloqueio, fatura informada nunca conta como inadimplente); remarcação sem copiar `comprovante_pix_*`/`situacao_pix_dona`; `allowed_mime_types` do bucket depois do teste com HEIC de iPhone; comprovantes órfãos no reenvio com extensão diferente; job de expiração de comprovantes antigos.
- **Motor de agenda:** modo fixo e liberação não conferem se o serviço cabe; ausência avulsa parcial bloqueia 1h fixa; sem virada de meia-noite (teste `it.fails`); painel ignora `dia_semana` em `recorrente_periodo`; base reaproveitada em 12 meses; mês automático sem nova tentativa; `semDiaDepoisDoTeste` ignora liberações; `LIMITE_DIAS_DESVIO` e janela de 45 dias fixos; no contexto admin, só vira "ocupado" o horário que começa dentro de um agendamento (o que invadiria o seguinte aparece livre; a proteção é o 23P01).
- **Admin / UX:** legenda "Fora do expediente" com dois sentidos; lista de Exceções abre no mês corrente; Excluir sem confirmação; avisar ao bloquear/liberar com cliente marcada; etiquetas de nome quase igual; calendário do modal Alterar sem destaque do dia atual; legenda "antes da faixa" no admin; script anti-flash do modo noturno; mês restrito sem etiqueta liberada; `janela_agendamento_fim` oculto (reexibir ou remover); "manutenção vinda de outro salão" a redesenhar; UX da pergunta condicional; aviso de Pix no cancelamento; popup de renovação de anamnese (exige SQL antes); grade de Liberar horário marca "já liberado" mas não bloqueia o clique (a proteção contra duplicidade avisa só ao salvar).
- **Cores e contraste:** Acolhe (2,60:1) e Julia (3,52:1) sem `textoBotao`; botão do login do admin com `text-white`; bordas fracas no modo claro; `--color-on-card`; cores fixas fora do tema; modo noturno em Relatórios, Configurações, aba Assinatura e cartões da Sessão 90; botão Voltar/setas do calendário e "+ Adicionar" com contraste baixo; botão flutuante do WhatsApp cobrindo a lista da Layra; `page.js` ~4220 (`bg-amber-100/70` com `text-body`, contraste não medido).
- **Mensagens e textos:** texto do sinal só aparece com o texto de regras preenchido; `MENSAGEM_SOLICITACAO_ENVIADA` sem chamador; varredura de textos de gênero; mensagens do par não citam a outra data; `/home` (trechos de SecaoRecursos, SecaoSobre e logo) ainda não aplicados.
- **Atalho Pendentes/Histórico para Novo agendamento** segue sem etiqueta da cliente (precisaria de busca por telefone).
- **Duplicidade de cliente:** aviso "nome diferente do cadastro daquele número"; medir o ruído da regra de nome parecido em produção.
- **Produto futuro:** agendamento em grupo para maquiadoras (desenho congelado até alinhar com a Laryssa); motor de vínculos para outros perfis; manutenção + agregado nos dois sentidos (branch própria); tema dinâmico escolhido pela dona (consolidar `buscarTema` primeiro); Programa de Fidelidade (botão "agendar brinde" sem handler); nível "funcionário"; segmento "cabeleireira"; logo do `/admin` linkando o Instagram; tela de leitura do `ausencias_log`.
- **Limpeza de código:** `ModalPossivelDuplicidade.js` sem uso; só no banco, sem consumidor no código: colunas `msg_alteracao_data` e `msg_alteracao_servico`, RPCs `agendamento_alterar_servico` e `clientes_desfazer_manter_dois` e coluna `emoji` de `etiquetas_cliente` (antes, `select slug from estabelecimentos where msg_alteracao_data is not null`: a Laryssa tem texto personalizado; depois `DROP` nos dois bancos com conferência); `lib/horarios.js` (só `gerarSlots`, `estaAberto`, `DIAS_FUNCIONAMENTO` e `WHATSAPP_LOJA` estão mortos; o resto é importado); sem importador em `lib/janelaAgendamento.js`: `restricoesVigentesOuFuturas` e `statusDoMes`/`registroMesJanela`; mapas vazios do Hero; `servicos.ocultar_preco`/`ocultar_duracao`; `buscarUltimasAnamnesesPorCliente`; `BotaoServico`; blocos `{false && ...}` de `restricoes_agenda`; `remotePattern` de `fotos-perfil` (só remover se nada passar foto de perfil por `next/image`; não verificado); string "a equipe" triplicada; variável `livre` em `DetalheSalao.js`; `INVENTARIO_RECURSOS.md` linhas 9a, 17 e 21; retenção do `ausencias_log`; testes do motor (falta a matriz de precedência de exceções).
- **Bugs menores:** botão flutuante do WhatsApp "gruda"; `jaPendente` nunca passado ao `BlocoConfirmacaoPix`; badge de fidelidade só recalcula ao reabrir a ficha; "Não compareceu" em concluído sem marca depois; aviso React em `salvarMes`; erro HTTP 400 no console; tipos de `servicoManutencaoExternaId` e `patch.servico_id`; Safari e `window.open`; Editar de Exceções insere e apaga em vez de UPDATE (RPC atômica no futuro); fase 2 das perguntas (guardar data/hora ao voltar).
- **Riscos conhecidos e aceitos (não reabrir sem fato novo):** telefone como único fator nas RPCs da cliente; uuid do agendamento como "senha"; `agendamento_criar` não valida regra de negócio; `agendamento_criar_com_acrescimo` e a rota de remarcação aceitam o sim/não de acréscimo do navegador (o percentual nunca vem de fora; o banco recusa fora de domingo e acima de 50; toda reserva passa pela dona); o insert direto do Agendar do admin manda o percentual do salão (a dona só grava no próprio salão; o banco limita a domingo e 1 a 50); bloqueio de credenciais só de tela e sessões abertas não revogadas no reset; `atualizar_whatsapp_cliente` executável por anon (avaliar exigir o telefone antigo); `cliente_identificar_ou_criar` atualiza cliente por id sem checar a lixeira (só atinge quem guardou no navegador o id de um cadastro desativado no meio do agendamento).