import { supabase } from "@/lib/supabaseClient";

// Resolução do estabelecimento (salão) ativo a partir do slug do PATH
// (rota dinâmica /[salon] — ver useParams nas páginas client).
//
// O slug é um SELETOR DE TESTE multi-tenant, não isolamento de segurança: ele
// só escolhe por qual estabelecimento_id as queries de cliente e admin vão
// filtrar. A partição de slots/ocupados continua igual — nada disso é mexido
// aqui.

// Busca o estabelecimento ativo pelo slug. Devolve { id, nome, whatsapp, slug,
// sinal_regra, sinal_valor_centavos, sinal_chave_pix, aviso_regras_agendamento,
// cadastro_completo, granularidade_min, cancelamento_prazo_horas,
// link_localizacao, foto_perfil_url, foto_perfil_posicao, rodape_selo1,
// rodape_selo2, rodape_selo3, msg_* (11 colunas — ver MENSAGENS_WHATSAPP_CONFIG
// em lib/whatsapp.js) } ou null (slug inexistente, inativo ou erro). Quem
// chama decide entre "loading", "não encontrado" e seguir com os dados. O
// `slug` volta no objeto pra que quem resolve o salão (por path OU por
// perfil) tenha uma fonte única do slug ativo, sem depender de re-ler o path.
// Os campos de sinal alimentam o bloco de reserva do FormularioAgendamento
// (ver precisaSinal lá). rodape_selo1/2/3 são os 3 selos de confiança do
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
// cancelamento pelo /admin. `link_localizacao` é o link de compartilhamento
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
// "Fora da janela de agendamento" no /admin (ver MENSAGENS_WHATSAPP_CONFIG em
// lib/whatsapp.js). `reserva_provisoria_expira_horas` alimenta só o contador
// visual "Expira em Xh" da aba Pendentes (ver app/[salon]/admin/page.js,
// horasRestantesReserva) — null = salão não configurou, contador nunca
// aparece. Regra fixa do projeto (ver QA_CHECKLIST.md): toda coluna nova de
// `estabelecimentos` entra nos DOIS selects — este aqui (usado por /agendar e
// por contas 'global') E lib/perfil.js (usado por contas 'dono'), nunca só um.
export async function buscarEstabelecimento(slug) {
  const { data, error } = await supabase
    .from("estabelecimentos")
    .select(
      "id, nome, whatsapp, slug, sinal_regra, sinal_valor_centavos, sinal_chave_pix, aviso_regras_agendamento, cadastro_completo, exigir_endereco, granularidade_min, cancelamento_prazo_horas, link_localizacao, foto_perfil_url, foto_perfil_posicao, foto_perfil_zoom, rodape_selo1, rodape_selo2, rodape_selo3, fidelidade_ativa, fidelidade_meta_servicos, fidelidade_descricao_brinde, janela_agendamento_fim, antecedencia_minima_horas, cutoff_dia_seguinte_ativo, cutoff_dia_seguinte_hora, reserva_provisoria_expira_horas, msg_confirmacao, msg_lembrete, msg_cancelamento, msg_reativacao, msg_solicitacao_enviada, msg_duvida_generica, msg_cancelamento_cliente, msg_ajuda_prazo_expirado, msg_falha_cadastro, msg_contato_admin, msg_fora_da_janela"
    )
    .eq("slug", slug)
    .eq("ativo", true)
    .single();

  if (error || !data) return null;
  return data;
}
