# Pendências — reserva-horario

Reescrito em 19/10/2026 a partir do raio-x (RAIOX_PENDENCIAS.md, commit d1b798a) e conferido de novo contra código e git em 20/10. Só o que está aberto. Entregue, descartado ou "pode ficar" saiu daqui; histórico de sessão mora no handoff.

## Regra de fechamento de sessão
1. Este arquivo guarda só o que está aberto: uma linha por item, com o contexto mínimo e a referência (seção do handoff ou commit).
2. Entregou? Risca a linha e registra no handoff da sessão. Nada de "Entregue" aqui.
3. Item novo entra na seção certa (Agora, Confirmar, Decisões, Backlog), sem repetir em outra.
4. Decisão tomada vira ação ou sai. "Aceito" e "pode ficar" não ficam.
5. Teste manual pendente vai para "Confirmar", com quem faz e onde (produção, Vercel, dona).
6. Se uma linha precisar de mais de 2 frases, o detalhe vai para o handoff.

## Agora (próxima sessão)
1. **Egress do Supabase, fechamento:** compressão no upload e reprocessamento das fotos de produção feitos em 20/10 (57,19 MB para 2,60 MB, 29 gravadas, 0 falhas; backup em `C:\backup-fotos\prod`). Falta: (a) em 2 a 3 dias, conferir no painel de uso se o Cached Egress caiu; (b) rodar `--remover-antigos` em dry-run e depois com `--apply` (17 arquivos antigos com backup); (c) investigar o Log Ingestion (1,9 GB de 1 GB), problema separado. `4/4.heic`, `4/4.png` e os outros órfãos não geram egress; (d) mergear `reprocessar-fotos-storage` na `main` (script `f3eaf92` só existe nessa branch).
2. **Ativar a troca de credenciais das donas**, uma por vez, pelo "Exigir troca" (laysla, flavia, julia, laryssa, layra, lilian), com aviso por WhatsApp e datas na tabela 8.9 do Handoff 90. Não ativar junto com a assinatura na mesma dona no mesmo dia.
3. **Fluxo do "Alterar" nos Pendentes:** depois de editar, o botão confirma e tira o card de Pendentes. Antes: raio-x de `handleAlterar` e `ModalAlterarAgregado.js` para esclarecer a discrepância com a Sessão 84.
4. **Categorias de serviço com menu retrátil próprio** na aba Serviços (componente em arquivo novo). Fazer depois do egress, para o upload já nascer corrigido.
5. **Lilian, antes de mandar o link:** abrir mês atual e seguinte na janela, testar `/lilian` e `/lilian/admin`, cancelar o teste sem notificar.
6. **Datas passadas selecionáveis e mês fechado como calendário cinza sem explicação** (Produto / UX, os dois com print ou caso real).

## Confirmar (só o Iorran resolve; nenhuma é código)
**Banco (Supabase)**
- Serviços com `exige_segunda_data` e `nome_etapa_anterior` vazio em tenant real mostram "Teste" para a cliente?
- `select * from restricoes_agenda where ativa` em produção (a UI está oculta, uma linha antiga afeta o calendário).
- Cron `assinatura_gerar_faturas_diario` existe em staging? `calendar_import_ignorados` existe em produção?
- Policies: `comprovantes-pix` sem filtro de salão (correção em staging primeiro); roles divergentes staging × produção; leituras anônimas `using = true` coluna a coluna; leitura de `authenticated` nas demais tabelas do `/agendar`.
- Trazer ao repo o corpo de `concluir_agendamentos_confirmados_vencidos`.
- Limpezas de dado de teste: produção (clientes "Teste" 24966332133 e 24999187739 e o que a junção gerou; Junior S81; registros de Exceções S76; agendamentos de teste de junior/acolhe) e staging (alerta do serviço 10 `yyyyy`, serviços de nomes aleatórios da Flávia, `conclusao_manual_ativa` do estab. 4, pares do Salão de Teste).
- Chaves da Sessão 64: `GOOGLE_CALENDAR_CLIENT_SECRET` gerado de novo no Google; `NOTIFICACAO_WEBHOOK_SECRET` dentro de `notificar_agendamento` nos dois bancos; `ABACATEPAY_WEBHOOK_SECRET` global sem consumidor (`git grep`).

**Vercel**
- Push novo na `main` vira Production sozinho depois do rollback de 25/09? Conferir como Production: `7a698f0`, `d707f03`, `113f2cf` e os commits das Sessões 83 e 84.

**Teste real (produção ou dona)**
- `/julia` com o login da Laryssa; evento amarelo da Laryssa no Calendar e tom confirmado com ela.
- Modal único "Alterar" em staging e no celular (incluindo `window.open` no Safari/iPhone).
- Ciclo completo da junção de cadastros em produção (aviso, Resolver, Desfazer, Resolver novamente, Números anteriores) e lista de clientes de um salão real carregando.
- Layra: prazo de manutenção e aviso de serviço diferente pelo `/admin` (sem staging).
- Teste controlado do Pix automático por regra especial na Laysla; tela de conexão AbacatePay em salão manual.
- Título do Google Calendar com "A + B" na primeira dona com agregado.
- Admin da Laryssa em produção, claro e noturno; modo noturno com Laysla e Flávia; `/home` em celular real antes de divulgar.
- Calendar: alteração e cancelamento pelo `/admin` sincronizam de fato? (o gatilho existe, a prática nunca foi provada).
- Fluxo da janela mensal: `salvarMes` apaga `etiqueta_liberada_id` e preenche `abre_para_todos_em` sozinho? Raio-x de código + teste em staging.

**Com as donas**
- Avisar sobre o aviso de duplicidade e o Resolver (combinar com a troca de credenciais, um assunto por vez).
- Assinaturas: ativar as donas reais no Financeiro, avisando antes (Laysla a partir de nov/2026, Julia nov/dez isentos, Lilian out isento e nov/dez R$50). Conferir na primeira: fatura cancelada fora do Histórico, link "Voltar para <Mês>", card em Pendentes e bolinha no menu.
- Laryssa: horários reais, mensagens, chave Pix, endereço, segunda data e nome da etapa no serviço de noiva, aviso de cabelo lavado. Julia: abrir novembro e 2027, confirmar horário das 05:00 e se 25/12 e 31/12 são intencionais. Flávia: R$140 × R$150 na manutenção +30, serviços 193/404, duplicidade 35 × 58, quem cancelou Thaisa/Maria Eduarda/Mônica. Laysla: mover o parágrafo do Pix para "Texto do sinal Pix", caso Clara/Vitória/Carla de 11/10.
- Configurar os primeiros agregados reais (Julia e Laysla: remoção + molde F1; Flávia: criar os agregados, conferir, só então **desativar** os combos antigos, nunca apagar).
- Julia e Laryssa: preferem desligar as perguntas no bloco "Alertas e avisos"?
- Laysla: orientar a não editar ago/set depois que outubro começar.

## Decisões de produto abertas
- O que fica no painel global, na tela da dona ou em código fixo na varredura de recursos órfãos; existe tela para `manutencao_valor_cheio_apos_prazo`? Remover `segmento` se ninguém lê?
- `{valor}` entra no texto padrão da mensagem de alteração (Flávia, Julia, Layra, Laysla)?
- Nome e sobrenome obrigatórios no cadastro novo do wizard (só cadastro novo; no admin livre).
- Descartar `CHECKLIST_BLOCO.MD` e `PROCOLO_BLOCO.MD` (estão versionados, a pendência antiga dizia o contrário).
- Laryssa: aplicar `botaoAdmin`/`botaoAdminHover` pretos? (já tem `bgCardAdmin`).
- Pendente e aguardando sinal contam como base de manutenção?
- Cores de etiqueta padrão para Junior, Laysla e Julia, que já personalizaram?
- Chave Pix da plataforma em PF de terceiro: migrar para conta PJ do MEI quando possível.

## Vivo, prioridade média
- **Varredura de recursos órfãos** (ordem no `INVENTARIO_RECURSOS.md`): "Teste" como etapa anterior padrão (`lib/agendamentosCliente.js` ~94); etiquetas por papel em vez de nome (`ETIQUETA_CLIENTE_FIXO`, `NOME_ETIQUETA_CLIENTE_NOVA`); tela "Dados do salão" no painel global (`ativo=false` só existe por SQL); editor estruturado de avisos; tema por slug e aliases `junior`/`valeria`/`barbearia`; duplicatas do Acolhe; limpeza de `prazo_manutencao_dias` (selects em `GerenciarServicos.js` ~399/911 e comentários em `sql/`).
- Dois selects de `estabelecimentos` (`lib/estabelecimento.js` e `lib/perfil.js`) sincronizados à mão; auditoria via `information_schema` nunca feita.
- Bug da pergunta condicional (filha salva com `pergunta_pai_id` NULL). Roteiro de 4 passos no handoff.
- Remarcação e RPCs não conhecem o par: `agendamentos_cliente_ativos` e `..._janela_prazo` sem `reserva_grupo_id` e `abacatepay_cobranca_id`; `remarcar/route.js` recria sem `reserva_grupo_id`; popup de prazo mínimo oferece cancelar a vizinha do par.
- "Alterar" data/horário no `/admin` não valida janela.
- Motor: `PainelCalendario.diasSemVagas` diverge do motor; `erroDeLeitura` perdido ao recriar o Map (fail-closed silencioso); `ausencias` lida sem paginação (Julia já tem 538, limite de 1000 do PostgREST).
- Importação do Calendar grava `finalizado=false`; erro geral do `/admin` apaga a aba aberta.
- Banco não impede agregado em serviço bloqueado (regra só no front e em `agendamento_alterar_agregado`).
- Catálogo do painel global (`AbaAuditoria.js`) desatualizado: "Reduzir janela" ainda lá; faltam restrição de serviço, regra especial, liberação por período, assinatura, duplicidade, avisos da Sessão 83 e 90.
- `sql/` diverge do banco (assinaturas, `ausencias_log`, policies da Sessão 80, colunas da Sessão 90).
- Termos e Privacidade sem canal de contato da Acolhe.
- Ligar a marca de segurança e, depois da ativação: histórico de senhas (3 últimas), troca voluntária em "Minha conta", "Esqueci minha senha" só quando todas tiverem e-mail real, ação "Permitir corrigir e-mail" (caso C nunca testado), revogar INSERT/UPDATE de `anon`/`authenticated` em `perfis`.
- Branch `feature/ordem-foto-perfil` (local e `origin`) não está na `main` e não estava em nenhum item: mergear ou descartar.
- Sem prova no navegador: virada para bloqueio aos 30 dias, aviso 429, provisória recusada como senha nova.

## Backlog (baixa prioridade; só entra na fila se alguém pedir ou incomodar)
- **Pix e sinal:** link do comprovante some quando a dona marca situação; `metodoEfetivoSinalPix` ignora regras especiais; sinal percentual; AbacatePay na assinatura (webhook próprio, R$0,80 por Pix) e bloqueio por inadimplência (aviso antes do bloqueio, fatura informada nunca conta como inadimplente); remarcação sem copiar `comprovante_pix_*`/`situacao_pix_dona`; `allowed_mime_types` do bucket depois do teste com HEIC de iPhone; comprovantes órfãos no reenvio com extensão diferente; job de expiração de comprovantes antigos.
- **Motor de agenda:** modo fixo e liberação não conferem se o serviço cabe; ausência avulsa parcial bloqueia 1h fixa; sem virada de meia-noite (teste `it.fails`); painel ignora `dia_semana` em `recorrente_periodo`; base reaproveitada em 12 meses; mês automático sem nova tentativa; `semDiaDepoisDoTeste` ignora liberações; `LIMITE_DIAS_DESVIO` e janela de 45 dias fixos.
- **Admin / UX:** grade do `/admin` parte 2 (unificar a grade do modal Alterar com a do wizard, itens a–i da Sessão 80); legenda "Fora do expediente" com dois sentidos; lista de Exceções abre no mês corrente; Excluir sem confirmação; avisar ao bloquear/liberar com cliente marcada; etiquetas de nome quase igual; calendário do modal Alterar sem destaque do dia atual; legenda "antes da faixa" no admin; script anti-flash do modo noturno; mês restrito sem etiqueta liberada; `janela_agendamento_fim` oculto (reexibir ou remover); "manutenção vinda de outro salão" a redesenhar; UX da pergunta condicional; aviso de Pix no cancelamento; popup de renovação de anamnese (exige SQL antes).
- **Cores e contraste:** Acolhe (2,60:1) e Julia (3,52:1) sem `textoBotao`; botão do login do admin com `text-white`; bordas fracas no modo claro; `--color-on-card`; cores fixas fora do tema; modo noturno em Relatórios, Configurações, aba Assinatura e cartões da Sessão 90; botão Voltar/setas do calendário e "+ Adicionar" com contraste baixo; botão flutuante do WhatsApp cobrindo a lista da Layra.
- **Mensagens e textos:** texto do sinal só aparece com o texto de regras preenchido; `MENSAGEM_SOLICITACAO_ENVIADA` sem chamador; varredura de textos de gênero; mensagens do par não citam a outra data; `/home` (trechos de SecaoRecursos, SecaoSobre e logo) ainda não aplicados.
- **Atalho Pendentes/Histórico para Novo agendamento** segue sem etiqueta da cliente (precisaria de busca por telefone); o "Fora da janela" em si foi corrigido em `3cb2054` (13/10).
- **Duplicidade:** aviso "nome diferente do cadastro daquele número"; medir o ruído da regra de nome parecido em produção.
- **Produto futuro:** agendamento em grupo para maquiadoras (desenho congelado até alinhar com a Laryssa); motor de vínculos para outros perfis; manutenção + agregado nos dois sentidos (branch própria); tema dinâmico escolhido pela dona (consolidar `buscarTema` primeiro); Programa de Fidelidade (botão "agendar brinde" sem handler); nível "funcionário"; segmento "cabeleireira"; logo do `/admin` linkando o Instagram; tela de leitura do `ausencias_log`.
- **Limpeza de código:** `ModalPossivelDuplicidade.js` sem uso; só no banco, sem consumidor no código: colunas `msg_alteracao_data` e `msg_alteracao_servico`, RPCs `agendamento_alterar_servico` e `clientes_desfazer_manter_dois` e coluna `emoji` de `etiquetas_cliente` (antes, `select slug from estabelecimentos where msg_alteracao_data is not null`: a Laryssa tem texto personalizado; depois `DROP` nos dois bancos com conferência); `lib/horarios.js` (só `gerarSlots`, `estaAberto`, `DIAS_FUNCIONAMENTO` e `WHATSAPP_LOJA` estão mortos; o resto é importado); sem importador em `lib/janelaAgendamento.js`: `restricoesVigentesOuFuturas` e `statusDoMes`/`registroMesJanela`; mapas vazios do Hero; `servicos.ocultar_preco`/`ocultar_duracao`; `buscarUltimasAnamnesesPorCliente`; `BotaoServico`; blocos `{false && ...}` de `restricoes_agenda`; `remotePattern` de `fotos-perfil` (só remover se nada passar foto de perfil por `next/image`; não verificado); string "a equipe" triplicada; variável `livre` em `DetalheSalao.js`; chave `livre` em `ESTADOS_GRADE_ADMIN`; `INVENTARIO_RECURSOS.md` linhas 9a, 17 e 21; retenção do `ausencias_log`; testes do motor (`tests/` já cobre agregado, `disponibilidadeAgenda` e Pix; falta a matriz de precedência de exceções).
- **Bugs menores:** botão flutuante do WhatsApp "gruda"; `jaPendente` nunca passado ao `BlocoConfirmacaoPix`; badge de fidelidade só recalcula ao reabrir a ficha; "Não compareceu" em concluído sem marca depois; aviso React em `salvarMes`; erro HTTP 400 no console; tipos de `servicoManutencaoExternaId` e `patch.servico_id`; Safari e `window.open`; Editar de Exceções insere e apaga em vez de UPDATE (RPC atômica no futuro); fase 2 das perguntas (guardar data/hora ao voltar).
- **Riscos conhecidos e aceitos (não reabrir sem fato novo):** telefone como único fator nas RPCs da cliente; uuid do agendamento como "senha"; `agendamento_criar` não valida regra de negócio; bloqueio de credenciais só de tela e sessões abertas não revogadas no reset; `atualizar_whatsapp_cliente` executável por anon (avaliar exigir o telefone antigo).