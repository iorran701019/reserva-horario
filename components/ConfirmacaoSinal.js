"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatarPreco } from "@/components/FormularioAgendamento";

// Tela de confirmação de pagamento do sinal, reaproveitando o mesmo bloco
// âmbar do FormularioAgendamento (etapa "dados"). Usada pelo PainelCliente
// quando o cliente já tem uma reserva "aguardando_sinal" e volta depois pra
// declarar o Pix — em vez de reabrir o wizard inteiro.
//
// Props:
//   agendamentoId       – id da linha em `agendamentos` a confirmar.
//   estabelecimento     – { sinal_valor_centavos, sinal_chave_pix } do salão.
//   nomeProfissionalContato – mesmo texto usado no bloco do wizard.
//   onConfirmado        – chamado (sem args) após o update ter sucesso.
//   onVoltar            – chamado (sem args) ao clicar em "Voltar".
export default function ConfirmacaoSinal({
  agendamentoId,
  estabelecimento,
  nomeProfissionalContato = "a equipe",
  onConfirmado,
  onVoltar,
}) {
  const [sinalDeclarado, setSinalDeclarado] = useState(false);
  const [chavePixCopiada, setChavePixCopiada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function copiarChavePix() {
    try {
      await navigator.clipboard.writeText(estabelecimento.sinal_chave_pix ?? "");
      setChavePixCopiada(true);
      setTimeout(() => setChavePixCopiada(false), 2000);
    } catch {
      // Clipboard indisponível (permissão negada, contexto não seguro etc.):
      // a chave já está visível na tela pra copiar manualmente.
    }
  }

  async function handleConfirmar() {
    setErro("");
    setEnviando(true);

    const { error } = await supabase
      .from("agendamentos")
      .update({ sinal_declarado_pago: true, status: "pendente" })
      .eq("id", agendamentoId);

    setEnviando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    onConfirmado?.();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <div>
          <p className="text-base font-medium text-amber-800">
            {`Este agendamento exige um sinal de ${formatarPreco(estabelecimento.sinal_valor_centavos)} via Pix para confirmar a reserva.`}
          </p>
          <p className="mt-1 text-base font-medium text-amber-800">
            {`Aperte o botão verde "Falar com ${nomeProfissionalContato}" e envie o comprovante do Pix.`}
          </p>
          <p className="mt-1 text-base font-medium text-amber-800">
            O profissional irá confirmar seu agendamento.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 ring-1 ring-border">
          <span className="min-w-0 flex-1 truncate text-sm text-heading">
            {estabelecimento.sinal_chave_pix}
          </span>
          <button
            type="button"
            onClick={copiarChavePix}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            {chavePixCopiada ? "Copiado!" : "Copiar chave"}
          </button>
        </div>

        <label className="flex items-start gap-2 text-sm text-amber-900">
          <input
            type="checkbox"
            checked={sinalDeclarado}
            onChange={(e) => setSinalDeclarado(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30"
          />
          Já realizei o pagamento do sinal via Pix
        </label>
      </div>

      <button
        type="button"
        onClick={handleConfirmar}
        disabled={enviando || !sinalDeclarado}
        className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {enviando ? "Confirmando..." : "Confirmar"}
      </button>

      <button
        type="button"
        onClick={onVoltar}
        className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
      >
        Voltar
      </button>

      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}
    </div>
  );
}
