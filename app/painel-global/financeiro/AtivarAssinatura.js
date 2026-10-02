"use client";

import { useState } from "react";
import SeletorMes from "./SeletorMes";
import { MES_MINIMO, competenciaAtual, inputParaCentavos } from "./util";

const CLASSE_INPUT =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10";
const CLASSE_BOTAO_PRIMARIO =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

// Formulário de configuração de um salão que ainda não tem linha em
// assinaturas. `aoAtivar(campos)` insere a assinatura e gera as faturas.
export default function AtivarAssinatura({ aoAtivar, avisar }) {
  const [valorPadrao, setValorPadrao] = useState("");
  const [diaVencimento, setDiaVencimento] = useState(10);
  const [inicioCobranca, setInicioCobranca] = useState(
    competenciaAtual() > MES_MINIMO ? competenciaAtual() : MES_MINIMO
  );
  const [exigeNf, setExigeNf] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    const campos = {
      dia_vencimento: Number(diaVencimento),
      inicio_cobranca: inicioCobranca,
      exige_nota_fiscal: exigeNf,
      observacao: observacao.trim() || null,
    };
    // Vazio = valor padrão do banco.
    if (valorPadrao.trim()) {
      const centavos = inputParaCentavos(valorPadrao);
      if (centavos === null) {
        avisar("erro", "Valor padrão inválido.");
        return;
      }
      campos.valor_padrao_centavos = centavos;
    }
    setSalvando(true);
    await aoAtivar(campos);
    setSalvando(false);
  }

  return (
    <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <h3 className="mb-3 text-sm font-semibold text-heading">Configuração</h3>
      <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-body">
          Valor padrão (R$)
          <input
            inputMode="decimal"
            value={valorPadrao}
            onChange={(e) => setValorPadrao(e.target.value)}
            placeholder="Padrão do sistema"
            className={`mt-1 ${CLASSE_INPUT}`}
          />
        </label>
        <label className="block text-sm text-body">
          Dia de vencimento
          <select
            value={diaVencimento}
            onChange={(e) => setDiaVencimento(e.target.value)}
            className={`mt-1 ${CLASSE_INPUT}`}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm text-body">
          Início da cobrança
          <div className="mt-1">
            <SeletorMes
              valor={inicioCobranca}
              onChange={setInicioCobranca}
              rotulo="Início da cobrança"
            />
          </div>
        </div>
        <div className="flex flex-col justify-end gap-2 text-sm text-body">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={exigeNf} onChange={(e) => setExigeNf(e.target.checked)} />
            Exige nota fiscal
          </label>
        </div>
        <label className="block text-sm text-body sm:col-span-2">
          Observação
          <textarea
            rows={2}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className={`mt-1 ${CLASSE_INPUT}`}
          />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={salvando} className={CLASSE_BOTAO_PRIMARIO}>
            {salvando ? "Ativando..." : "Ativar assinatura"}
          </button>
        </div>
      </form>
    </section>
  );
}
