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
// link_localizacao, foto_perfil_url, foto_perfil_posicao, msg_* (10 colunas —
// ver MENSAGENS_WHATSAPP_CONFIG em lib/whatsapp.js) } ou null (slug
// inexistente, inativo ou erro). Quem chama decide entre "loading", "não
// encontrado" e seguir com os dados. O `slug` volta no objeto pra que quem
// resolve o salão (por path OU por perfil) tenha uma fonte única do slug
// ativo, sem depender de re-ler o path. Os campos de sinal alimentam o bloco
// de reserva do FormularioAgendamento (ver precisaSinal lá).
// `aviso_regras_agendamento` é o texto do popup mostrado na etapa final de
// confirmação, no fluxo público (ver PopupRegrasAgendamento); null/vazio =
// nenhum popup.
// `cadastro_completo` decide, por tenant, se IdentificacaoCliente exige o
// bloco de endereço completo ou só nome + WhatsApp (ver lá).
// `granularidade_min` é o passo (em minutos) da grade de horários no modo
// 'janela' — ver gerarSlotsDaJanela/calcularVagasPorHorario.
// `cancelamento_prazo_horas` é o mínimo de horas de antecedência pra cliente
// cancelar pelo painel público (ver PainelCliente) — não afeta o
// cancelamento pelo /admin. `link_localizacao` é o link de compartilhamento
// do Google Maps mostrado no card "Ver localização" da tela de confirmação
// (ver app/[salon]/page.js); null/vazio = card não aparece.
// `foto_perfil_url`/`foto_perfil_posicao` alimentam o círculo clicável do
// fluxo público (ver FotoPerfilCircular e app/[salon]/page.js); url null =
// nenhum círculo é renderizado.
export async function buscarEstabelecimento(slug) {
  const { data, error } = await supabase
    .from("estabelecimentos")
    .select(
      "id, nome, whatsapp, slug, sinal_regra, sinal_valor_centavos, sinal_chave_pix, aviso_regras_agendamento, cadastro_completo, granularidade_min, cancelamento_prazo_horas, link_localizacao, foto_perfil_url, foto_perfil_posicao, msg_confirmacao, msg_lembrete, msg_cancelamento, msg_reativacao, msg_solicitacao_enviada, msg_duvida_generica, msg_cancelamento_cliente, msg_ajuda_prazo_expirado, msg_falha_cadastro, msg_contato_admin"
    )
    .eq("slug", slug)
    .eq("ativo", true)
    .single();

  if (error || !data) return null;
  return data;
}
