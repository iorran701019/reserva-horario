// Situação da assinatura Acolhe de um salão, a partir das faturas dele. Pura
// (sem React nem Supabase). `hoje` é "YYYY-MM-DD" em America/Sao_Paulo e as
// datas das faturas ("YYYY-MM-DD") nunca passam por new Date('YYYY-MM-DD'), que
// cai no dia anterior em UTC-3: sempre new Date(ano, mes - 1, dia).

// Quantos dias antes do vencimento a fatura vira "proxima".
export const DIAS_AVISO_VENCIMENTO = 5;

function dataLocal(str) {
  const [ano, mes, dia] = str.slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

// Dias de `hoje` até `data` (negativo = já passou). Math.round absorve a hora
// a mais/menos de uma virada de horário de verão.
function diasAte(hoje, data) {
  return Math.round((dataLocal(data) - dataLocal(hoje)) / 86400000);
}

// Prioridade: 'vencida' (aberta, não informada, vencimento < hoje; inclui
// recusadas) > 'proxima' (a aberta não informada mais antiga vence em até
// DIAS_AVISO_VENCIMENTO dias) > 'em_dia' (inclui informadas aguardando
// confirmação). `fatura` é a que motivou o nível (null em 'em_dia').
export function situacaoAssinatura(faturas, hoje) {
  const maisAntiga = faturas
    .filter((f) => f.status === "aberta" && !f.pagamento_informado_em)
    .sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0))[0];

  if (!maisAntiga) return { nivel: "em_dia", fatura: null };

  const dias = diasAte(hoje, maisAntiga.vencimento);
  if (dias < 0) return { nivel: "vencida", fatura: maisAntiga };
  if (dias <= DIAS_AVISO_VENCIMENTO) return { nivel: "proxima", fatura: maisAntiga };
  return { nivel: "em_dia", fatura: null };
}
