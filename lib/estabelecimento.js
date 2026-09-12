import { supabase } from "@/lib/supabaseClient";

// Resolução do estabelecimento (salão) ativo a partir do slug do PATH
// (rota dinâmica /[salon] — ver useParams nas páginas client).
//
// O slug é um SELETOR DE TESTE multi-tenant, não isolamento de segurança: ele
// só escolhe por qual estabelecimento_id as queries de cliente e admin vão
// filtrar. A partição de slots/ocupados continua igual — nada disso é mexido
// aqui.

// Busca o estabelecimento ativo pelo slug. Devolve { id, nome, whatsapp, slug,
// sinal_regra, sinal_valor_centavos, sinal_chave_pix, metodo_cobranca_pix,
// aviso_regras_agendamento,
// cadastro_completo, granularidade_min, cancelamento_prazo_horas,
// link_localizacao, foto_perfil_url, foto_perfil_posicao, rodape_selo1,
// rodape_selo2, rodape_selo3, msg_* (12 colunas — ver MENSAGENS_WHATSAPP_CONFIG
// em lib/whatsapp.js) } ou null (slug inexistente, inativo ou erro). Quem
// chama decide entre "loading", "não encontrado" e seguir com os dados. O
// `slug` volta no objeto pra que quem resolve o salão (por path OU por
// perfil) tenha uma fonte única do slug ativo, sem depender de re-ler o path.
// Os campos de sinal alimentam o bloco de reserva do FormularioAgendamento
// (ver precisaSinal lá). Os quatro (`sinal_regra`, `metodo_cobranca_pix`,
// `sinal_chave_pix` e o `abacatepay_conectado` acrescentado por
// hidratarAbacatepayConectado, no fim deste arquivo) são a entrada de
// calcularStatusSinalPix (lib/sinalPix.js): NENHUM ponto de decisão deve ler
// `metodo_cobranca_pix` cru, só o `metodoEfetivo` que sai de lá. rodape_selo1/2/3 são os 3 selos de confiança do
// rodapé público (ver RodapeSelos.js) — null mantém o texto padrão do
// componente, string preenchida substitui aquele selo específico só pro
// tenant.
// `aviso_regras_agendamento` é o texto do popup mostrado na etapa final de
// confirmação, no fluxo público (ver PopupRegrasAgendamento); null/vazio =
// nenhum popup.
// `cadastro_completo` decide, por tenant, se IdentificacaoCliente exige o
// bloco de endereço completo ou só nome + WhatsApp (ver lá).
// `exigir_endereco` decide, por tenant, se CadastroCliente/AtualizarDadosCliente
// pedem o bloco de endereço (CEP/número/complemento/bairro/cidade/estado) ou,
// no lugar dele, um "Contato de emergência (WhatsApp)" opcional — default
// true preserva o comportamento atual.
// `granularidade_min` é o passo (em minutos) da grade de horários no modo
// 'janela' — ver gerarSlotsDaJanela/calcularVagasPorHorario.
// `cancelamento_prazo_horas` é o mínimo de horas de antecedência pra cliente
// cancelar pelo painel público (ver PainelCliente) — não afeta o
// cancelamento pelo /admin.
// `prazo_minimo_entre_agendamentos_dias` é quantos dias devem separar dois
// agendamentos do MESMO cliente. Não bloqueia: alimenta o aviso consciente
// mostrado antes de gravar nos dois fluxos (ver buscarConflitoPrazoMinimo em
// lib/agendamentosCliente.js e ModalPrazoMinimo). null/0 = regra desligada.
// `link_localizacao` é o link de compartilhamento
// do Google Maps mostrado no card "Ver localização" da tela de confirmação
// (ver app/[salon]/page.js); null/vazio = card não aparece.
// `foto_perfil_url`/`foto_perfil_posicao`/`foto_perfil_zoom` alimentam o
// círculo clicável do fluxo público (ver FotoPerfilCircular e
// app/[salon]/page.js); url null = nenhum círculo é renderizado; zoom
// null cai no fallback 1 (sem zoom extra) dentro do próprio componente.
// `fidelidade_ativa`/`fidelidade_meta_servicos`/`fidelidade_descricao_brinde`
// alimentam o card de progresso do programa de fidelidade (ver
// buscarProgressoFidelidade em lib/fidelidade.js e BadgeFidelidade.js).
// `janela_agendamento_fim` é a data ("YYYY-MM-DD") além da qual nenhum dia
// pode ser agendado, público ou /admin (ver lib/janelaAgendamento.js ->
// dentroDaJanelaAgendamento, a checagem única reutilizada nos dois fluxos).
// null = salão ainda não configurou (sem restrição).
// `antecedencia_minima_horas` é quantas horas de antecedência o cliente
// precisa ter pra agendar pelo app (null = sem restrição); combinada com
// `cutoff_dia_seguinte_ativo`/`cutoff_dia_seguinte_hora` (só relevantes
// quando antecedencia_minima_horas é 12) pra fechar TODO o dia seguinte a
// partir de uma hora do dia corrente (ver filtrarPorAntecedenciaMinima em
// lib/disponibilidade.js, a checagem única reaproveitada no wizard público E
// na revalidação server-side de app/api/agendamentos/validar-antecedencia).
// `msg_fora_da_janela` é a mensagem do botão "Entrar em contato" da seção
// "Fora da janela de agendamento" no /admin; `msg_alteracao_data` é a
// mensagem da zona grande do botão dividido "Alterar data" na mesma seção
// (ver MENSAGENS_WHATSAPP_CONFIG em lib/whatsapp.js).
// `etiqueta_bloqueio_sinal_id` é a etiqueta "Lista de Bloqueio" do salão
// quando a dona marcou "Cobrar sinal de clientes na Lista de Bloqueio" (null =
// desmarcado). Cliente com essa etiqueta paga sinal mesmo fora da sinal_regra
// (ver clienteNaListaBloqueio em FormularioAgendamento).
// `ocultar_preco_servicos`/`ocultar_duracao_servicos` escondem preço e duração
// de TODOS os serviços no wizard (ver ocultarPreco/ocultarDuracao em
// FormularioAgendamento) — substituíram as flags por serviço
// servicos.ocultar_preco/ocultar_duracao, que não são mais lidas nem gravadas.
// `conclusao_manual_ativa` liga a sub-aba "Conclusão" de Pendentes e o
// "Editar" de concluídos no Histórico do /admin (ver page.js); desligada, o
// admin fica como era antes dessa feature existir.
// `reserva_provisoria_expira_horas` vale só pro rascunho abandonado no meio do
// wizard (finalizado = false) — bloco (a) de expirar_pendentes_vencidos.
// Pendente que já apareceu na aba Pendentes expira pelo horário do serviço,
// não por essa coluna. null = salão não configurou, rascunho nunca é limpo.
// Regra fixa do projeto (ver QA_CHECKLIST.md): toda coluna nova de
// `estabelecimentos` entra nos DOIS selects — este aqui (usado por /agendar e
// por contas 'global') E lib/perfil.js (usado por contas 'dono'), nunca só um.
export async function buscarEstabelecimento(slug) {
  const { data, error } = await supabase
    .from("estabelecimentos")
    .select(
      "id, nome, whatsapp, slug, sinal_regra, sinal_valor_centavos, sinal_chave_pix, metodo_cobranca_pix, aviso_regras_agendamento, cadastro_completo, exigir_endereco, granularidade_min, cancelamento_prazo_horas, prazo_minimo_entre_agendamentos_dias, link_localizacao, foto_perfil_url, foto_perfil_posicao, foto_perfil_zoom, rodape_selo1, rodape_selo2, rodape_selo3, fidelidade_ativa, fidelidade_meta_servicos, fidelidade_descricao_brinde, janela_agendamento_fim, antecedencia_minima_horas, cutoff_dia_seguinte_ativo, cutoff_dia_seguinte_hora, reserva_provisoria_expira_horas, msg_confirmacao, msg_lembrete, msg_cancelamento, msg_reativacao, msg_solicitacao_enviada, msg_duvida_generica, msg_cancelamento_cliente, msg_ajuda_prazo_expirado, msg_falha_cadastro, msg_contato_admin, msg_fora_da_janela, msg_alteracao_data, servico_manutencao_externa_id, etiqueta_bloqueio_sinal_id, ocultar_preco_servicos, ocultar_duracao_servicos, conclusao_manual_ativa"
    )
    .eq("slug", slug)
    .eq("ativo", true)
    .single();

  if (error || !data) return null;
  return await hidratarAbacatepayConectado(data);
}

// Acrescenta `abacatepay_conectado` (booleano) ao objeto do estabelecimento.
// É o campo que fecha a entrada de calcularStatusSinalPix (lib/sinalPix.js) —
// os outros três (`sinal_regra`, `metodo_cobranca_pix`, `sinal_chave_pix`) já
// vêm dos selects. Fica AQUI, e não em lib/sinalPix.js, pra aquele módulo
// continuar puro e testável; lib/perfil.js importa esta mesma função, pros
// dois loaders hidratarem por um caminho só.
//
// Não é join: `abacatepay_credenciais` não tem policy de RLS e o browser não
// enxerga a tabela — um join embutido devolveria null silenciosamente pra todo
// mundo (ver app/api/abacatepay/conectado/route.js, que existe por isso).
//
// Só consulta quando a resposta pode MUDAR alguma decisão: salão de cobrança
// manual ou com sinal desligado nunca chega no degrau da credencial (ver a
// ordem dos degraus em calcularStatusSinalPix), então gastar um round-trip no
// carregamento de toda página pública seria desperdício — hoje isso poupa a
// consulta em todos os salões de produção, que estão em 'manual'.
//
// FALHA DE LEITURA VIRA `true`, não `false`. Mesma assimetria deliberada do
// fail-open de lib/janelaAgendamento.js: "não sei" não pode virar "desligado".
// Com `false` num blip de rede, um salão corretamente configurado seria
// rebaixado e PARARIA DE COBRAR sinal sem ninguém perceber; com `true`, o pior
// caso é a cliente ver a mesma caixa vermelha de "não foi possível gerar o
// Pix" que já existe hoje — e quem tem a palavra final continua sendo a rota
// de gerar-cobranca, que lê a credencial de verdade com service role.
export async function hidratarAbacatepayConectado(estabelecimento) {
  if (!estabelecimento) return estabelecimento;

  if (
    estabelecimento.metodo_cobranca_pix !== "abacatepay" ||
    estabelecimento.sinal_regra === "desligado"
  ) {
    return { ...estabelecimento, abacatepay_conectado: false };
  }

  try {
    const resposta = await fetch(
      `/api/abacatepay/conectado?estabelecimentoId=${estabelecimento.id}`
    );
    if (!resposta.ok) throw new Error("Falha ao consultar conexão AbacatePay.");
    const corpo = await resposta.json();
    return { ...estabelecimento, abacatepay_conectado: Boolean(corpo?.conectado) };
  } catch {
    return { ...estabelecimento, abacatepay_conectado: true };
  }
}
