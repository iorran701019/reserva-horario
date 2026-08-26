"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import BlocoConfirmacaoPix from "@/components/BlocoConfirmacaoPix";

// Tela de confirmação de pagamento do sinal. O bloco âmbar em si (valor,
// chave Pix, upload do comprovante, checkbox) mora em BlocoConfirmacaoPix,
// compartilhado com a etapa "dados" do FormularioAgendamento — aqui ficam só
// os botões Confirmar/Voltar e o update de status.
//
// Usada quando o cliente já tem uma reserva "aguardando_sinal": pelo
// PainelCliente (botão "Confirmar pagamento") e direto por app/[salon]/page.js
// quando TUDO que ele tem ativo está aguardando sinal — nesse caso o painel é
// pulado e ele cai aqui na hora.
//
// Props:
//   agendamentoId       – id da linha em `agendamentos` a confirmar.
//   estabelecimento     – { sinal_valor_centavos, sinal_chave_pix } do salão.
//   nomeProfissionalContato – mesmo texto usado no bloco do wizard.
//   onConfirmado        – chamado (sem args) após o update ter sucesso.
//   onVoltar            – chamado (sem args) ao clicar em "Voltar".
//   rotuloVoltar        – texto do botão de voltar; o destino muda conforme
//                         quem montou a tela (painel x lista de agendamentos).
export default function ConfirmacaoSinal({
  agendamentoId,
  estabelecimento,
  nomeProfissionalContato = "a equipe",
  onConfirmado,
  onVoltar,
  rotuloVoltar = "Voltar",
}) {
  const [sinalDeclarado, setSinalDeclarado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

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
      <BlocoConfirmacaoPix
        estabelecimento={estabelecimento}
        agendamentoId={agendamentoId}
        nomeProfissionalContato={nomeProfissionalContato}
        sinalDeclarado={sinalDeclarado}
        onSinalDeclaradoChange={setSinalDeclarado}
      />

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
        {rotuloVoltar}
      </button>

      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}
    </div>
  );
}
