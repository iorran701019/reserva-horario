// Modo da troca obrigatória de credenciais da dona (puro, sem I/O).
//   'nenhum'  → sem marca, ou conta que não é de dona.
//   'aviso'   → marca ligada há menos de DIAS_AVISO dias: cartão no topo de
//               Pendentes, sem travar o resto do /admin.
//   'bloqueio'→ marca ligada sem data (reset) ou há DIAS_AVISO dias ou mais:
//               o /admin fica travado até a troca.
export const DIAS_AVISO = 30;

const MS_DIA = 24 * 60 * 60 * 1000;

export function modoTrocaCredenciais(perfil, agora = Date.now()) {
  if (!perfil || perfil.papel !== "dono" || perfil.precisa_trocar_credenciais !== true) {
    return "nenhum";
  }
  const desde = perfil.troca_exigida_em ? new Date(perfil.troca_exigida_em).getTime() : NaN;
  if (Number.isNaN(desde)) return "bloqueio";
  // Data no futuro (relógio adiantado) conta como dia 0.
  if (desde > agora) return "aviso";
  return agora - desde >= DIAS_AVISO * MS_DIA ? "bloqueio" : "aviso";
}
