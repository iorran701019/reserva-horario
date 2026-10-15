// Situação do Pix marcada PELA DONA no card de Pendentes (agendamentos.
// situacao_pix_dona: null | 'pendente_pagamento' | 'pago'). Só existe pro Pix
// manual: quando o salão cobra por AbacatePay, quem confirma é o gateway e a
// tag da dona não faz sentido. Módulo PURO, sem import de supabase.
//
// A coluna sobrepõe a tag derivada (comprovante, declaração, aguardando
// sinal), nunca o Pix confirmado pelo AbacatePay, e nunca toca em `status`.
import { metodoEfetivoSinalPix, sinalPixRebaixado } from "./sinalPix.js";
import { salaoPodeCobrarSinal } from "./sinalRegra.js";

export const SITUACAO_PIX_PAGO = "pago";
export const SITUACAO_PIX_PENDENTE = "pendente_pagamento";

// Textos da tag derivada (ramos 2 a 7 da cadeia do card de Pendentes). Fonte
// única: o card e o menu da dona leem daqui.
export const TEXTO_PIX_COMPROVANTE = "Comprovante do Pix";
export const TEXTO_PIX_DECLARADO = "Comprovante declarado pelo WhatsApp";
export const TEXTO_PIX_AGUARDANDO = "Aguardando sinal";
export const TEXTO_PIX_NAO_COBRADO_CONFIG = "Sinal não cobrado, configurar sinal Pix";
export const TEXTO_PIX_NAO_COBRADO = "Nenhum sinal de Pix foi cobrado";

// Edição e reordenação só valem com Pix MANUAL efetivo (estabelecimento
// presente; 'desligado' e 'abacatepay' ficam de fora) E num agendamento que
// nunca passou pelo AbacatePay.
export function situacaoPixDonaElegivel(item, estabelecimento) {
  if (!item || !estabelecimento) return false;
  if (metodoEfetivoSinalPix(estabelecimento) !== "manual") return false;
  if (item.abacatepay_br_code || item.abacatepay_pago_em) return false;
  return true;
}

// Qual tag mostrar no lugar dos ramos 2 a 7: 'pago' | 'pendente_pagamento' |
// null (cai na cadeia derivada). Inelegível sempre devolve null.
export function tagSituacaoPixDona(item, estabelecimento) {
  if (!situacaoPixDonaElegivel(item, estabelecimento)) return null;
  if (item.situacao_pix_dona === SITUACAO_PIX_PAGO) return SITUACAO_PIX_PAGO;
  if (item.situacao_pix_dona === SITUACAO_PIX_PENDENTE) return SITUACAO_PIX_PENDENTE;
  return null;
}

// 0 = Pix confirmado, 1 = declarado sem conferência ou sem sinal cobrado,
// 2 = aguardando pagamento. Inelegível é sempre 0 (degrau neutro).
export function rankPixPendente(item, estabelecimento) {
  if (!situacaoPixDonaElegivel(item, estabelecimento)) return 0;
  if (item.situacao_pix_dona === SITUACAO_PIX_PAGO) return 0;
  if (item.situacao_pix_dona === SITUACAO_PIX_PENDENTE) return 2;
  if (item.comprovante_pix_url) return 0;
  if (item.sinal_declarado_pago) return 1;
  if (item.status === "aguardando_sinal") return 2;
  return 1;
}

function chaveCliente(item) {
  return String(item.telefone ?? "").replace(/\D/g, "") || `id:${item.id}`;
}

// Ordena por degrau, estável (data/horário da entrada preservados dentro do
// degrau). O grupo por telefone usa o MENOR rank dos membros, pra que o
// agrupamento por cliente que vem depois continue coerente.
export function ordenarPendentesPorPix(lista, estabelecimento) {
  const melhor = new Map();
  for (const item of lista) {
    const chave = chaveCliente(item);
    const rank = rankPixPendente(item, estabelecimento);
    if (!melhor.has(chave) || rank < melhor.get(chave)) melhor.set(chave, rank);
  }
  return lista
    .map((item, indice) => ({ item, indice, rank: melhor.get(chaveCliente(item)) }))
    .sort((a, b) => a.rank - b.rank || a.indice - b.indice)
    .map(({ item }) => item);
}

// Texto da tag DERIVADA (ramos 2 a 7, na mesma ordem do card), ignorando
// situacao_pix_dona. null quando o card não mostraria tag nenhuma. O ramo 1
// (AbacatePay) não entra: item com abacatepay_pago_em é inelegível.
export function textoEstadoOriginalPix(item, estabelecimento) {
  if (!item) return null;
  if (item.comprovante_pix_url) return TEXTO_PIX_COMPROVANTE;
  if (item.sinal_declarado_pago) return TEXTO_PIX_DECLARADO;
  if (item.status === "aguardando_sinal") return TEXTO_PIX_AGUARDANDO;
  if (item.status === "pendente") {
    const cobra = salaoPodeCobrarSinal(estabelecimento);
    if (sinalPixRebaixado(estabelecimento, cobra)) return TEXTO_PIX_NAO_COBRADO_CONFIG;
    if (cobra) return TEXTO_PIX_NAO_COBRADO;
  }
  return null;
}

// Opções do menu "Alterar" do card: [{ rotulo, valor, desabilitada }].
// Estado original "Aguardando sinal": Aguardando sinal (null) e Pago.
// Demais: Aguardando sinal (pendente_pagamento), Pago e o texto original
// (null, omitido quando não há tag). Nunca dois rótulos iguais.
export function opcoesMenuSituacaoPix(item, estabelecimento) {
  const atual = item?.situacao_pix_dona ?? null;
  const original = textoEstadoOriginalPix(item, estabelecimento);
  const pago = { rotulo: "Pago", valor: SITUACAO_PIX_PAGO, desabilitada: atual === SITUACAO_PIX_PAGO };

  if (original === TEXTO_PIX_AGUARDANDO) {
    return [
      { rotulo: TEXTO_PIX_AGUARDANDO, valor: null, desabilitada: atual === null },
      pago,
    ];
  }

  const opcoes = [
    {
      rotulo: TEXTO_PIX_AGUARDANDO,
      valor: SITUACAO_PIX_PENDENTE,
      desabilitada: atual === SITUACAO_PIX_PENDENTE,
    },
    pago,
  ];
  if (original) opcoes.push({ rotulo: original, valor: null, desabilitada: atual === null });
  return opcoes;
}

// O botão "Alterar" aparece? Inelegível nunca. Já marcada pela dona, sempre
// (ela precisa poder desfazer). Sem marca, só nos estados cobrados: comprovante
// anexado, declarado pelo WhatsApp ou aguardando sinal. "Nenhum sinal de Pix
// foi cobrado", "Sinal não cobrado, configurar sinal Pix" e sem tag ficam fora.
export function situacaoPixDonaEditavel(item, estabelecimento) {
  if (!situacaoPixDonaElegivel(item, estabelecimento)) return false;
  if (item.situacao_pix_dona != null) return true;
  const texto = textoEstadoOriginalPix(item, estabelecimento);
  return (
    texto === TEXTO_PIX_COMPROVANTE ||
    texto === TEXTO_PIX_DECLARADO ||
    texto === TEXTO_PIX_AGUARDANDO
  );
}
