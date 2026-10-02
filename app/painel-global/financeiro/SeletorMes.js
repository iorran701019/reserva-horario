"use client";

import { MESES, MES_MINIMO, competenciaMaxima, hojeSaoPaulo } from "./util";

// Seletor de mês em dois <select> (mês + ano) em vez de <input type="month">:
// o nativo não segue o idioma do app. `valor` é uma competência "YYYY-MM-01"
// ou "" (só quando `opcional`); `onChange` recebe a mesma forma.
const CLASSE_SELECT =
  "rounded-lg border border-border bg-card px-2 py-2 text-sm text-heading outline-none focus:border-primary";

export default function SeletorMes({ valor, onChange, opcional = false, rotulo, limitarAoTeto = false }) {
  const { ano: anoHoje } = hojeSaoPaulo();
  const [ano, mes] = valor ? valor.split("-").map(Number) : ["", ""];

  const [anoMin, mesMin] = MES_MINIMO.split("-").map(Number);
  // limitarAoTeto: mês máximo = corrente + 6 (teto da RPC de geração de faturas).
  const maximo = limitarAoTeto ? competenciaMaxima() : null;
  const [anoMax, mesMax] = maximo ? maximo.split("-").map(Number) : [null, null];
  const anos = [];
  const ate = maximo ? anoMax : Math.max(anoHoje + 2, ano || 0);
  for (let a = anoMin; a <= ate; a++) anos.push(a);

  function emitir(novoAno, novoMes) {
    if (novoAno && novoMes) {
      const candidato = `${novoAno}-${String(novoMes).padStart(2, "0")}-01`;
      if (candidato < MES_MINIMO) {
        onChange(MES_MINIMO);
        return;
      }
      if (maximo && candidato > maximo) {
        onChange(maximo);
        return;
      }
    }
    if (!novoAno || !novoMes) {
      // opcional: limpar um dos dois limpa o par; obrigatório: completa com o
      // que já existe ou o ano corrente.
      onChange(opcional ? "" : `${novoAno || anoHoje}-${String(novoMes || 1).padStart(2, "0")}-01`);
      return;
    }
    onChange(`${novoAno}-${String(novoMes).padStart(2, "0")}-01`);
  }

  return (
    <span className="inline-flex gap-1" role="group" aria-label={rotulo}>
      <select
        aria-label={`${rotulo} — mês`}
        value={mes}
        onChange={(e) => emitir(ano || anoHoje, e.target.value)}
        className={CLASSE_SELECT}
      >
        {opcional && <option value="">—</option>}
        {MESES.map((nome, i) =>
          (Number(ano) === anoMin && i + 1 < mesMin) || (maximo && Number(ano) === anoMax && i + 1 > mesMax) ? null : (
            <option key={nome} value={i + 1}>
              {nome}
            </option>
          )
        )}
      </select>
      <select
        aria-label={`${rotulo} — ano`}
        value={ano}
        onChange={(e) => emitir(e.target.value, mes || 1)}
        className={CLASSE_SELECT}
      >
        {opcional && <option value="">—</option>}
        {anos.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </span>
  );
}
