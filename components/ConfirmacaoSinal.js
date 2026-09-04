"use client";

import { useState } from "react";
import BlocoConfirmacaoPix from "@/components/BlocoConfirmacaoPix";
import { cancelarAgendamentoCliente } from "@/lib/agendamentosCliente";
import ModalConfirmarCancelamento from "@/components/ModalConfirmarCancelamento";
import { formatarData } from "@/components/FormularioAgendamento";

// Tela de confirmação de pagamento do sinal. O bloco âmbar em si (valor,
// chave Pix, upload do comprovante, checkbox) mora em BlocoConfirmacaoPix,
// compartilhado com a etapa "dados" do FormularioAgendamento — aqui ficam só
// os botões ao redor.
//
// NÃO existe mais botão "Confirmar": quem grava o status é o próprio
// BlocoConfirmacaoPix, no gesto (marcar a caixa ou anexar o comprovante). O
// que era `handleConfirmar` aqui virou `marcarPendente` lá; `onConfirmado`
// continua com o mesmo contrato — é chamado quando o agendamento vira
// "pendente" — só que agora vem do bloco, via onStatusMudou.
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
//   onConfirmado        – chamado (sem args) quando o agendamento passa a
//                         "pendente" (checkbox ou comprovante).
//   onVoltar            – opcional. Havendo, mostra o botão de voltar e é
//                         chamado (sem args) ao clicar nele. Sem ele o botão
//                         não aparece — é o caso da entrada direta na
//                         confirmação de sinal, que não tem pra onde voltar.
//   rotuloVoltar        – texto do botão de voltar; o destino muda conforme
//                         quem montou a tela (painel x lista de agendamentos).
//   onEditar            – opcional. Havendo, mostra "Editar": quem monta
//                         reabre o wizard já carregado com esta reserva (ver
//                         agendamentoEmEdicao em FormularioAgendamento).
//   onCancelado         – opcional. Havendo (junto de `agendamento` e
//                         `nomeCliente`), mostra "Cancelar" — mesmo helper
//                         compartilhado da lista do PainelCliente.
//   agendamento         – { data, horario, servicos?: { nome } } da reserva.
//                         Monta a mensagem de cancelamento no WhatsApp E o
//                         resumo do topo do BlocoConfirmacaoPix (o que a
//                         cliente confere antes de mandar o Pix). Os dois
//                         consumidores já passam a linha inteira que veio de
//                         buscarAgendamentosAtivos, que traz servicos(nome).
//   nomeCliente         – idem, e o "nome" do resumo.
export default function ConfirmacaoSinal({
  agendamentoId,
  estabelecimento,
  nomeProfissionalContato = "a equipe",
  onConfirmado,
  onVoltar,
  rotuloVoltar = "Voltar",
  onEditar = null,
  onCancelado = null,
  agendamento = null,
  nomeCliente = "",
}) {
  const [sinalDeclarado, setSinalDeclarado] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [erro, setErro] = useState("");
  // O clique em "Cancelar agendamento" abre a confirmação (ver
  // ModalConfirmarCancelamento); quem chama o helper é o botão de dentro dela.
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  const podeCancelar = Boolean(onCancelado && agendamento);

  async function handleCancelar() {
    setErro("");
    setCancelando(true);

    const { ok, erro: erroCancelamento } = await cancelarAgendamentoCliente({
      agendamentoId,
      estabelecimento,
      nomeCliente,
      dataFormatada: formatarData(agendamento.data),
      horario: agendamento.horario,
    });

    setCancelando(false);

    if (!ok) {
      setErro(erroCancelamento);
      return;
    }

    setConfirmandoCancelamento(false);
    onCancelado();
  }

  return (
    <div className="space-y-4">
      <BlocoConfirmacaoPix
        estabelecimento={estabelecimento}
        agendamentoId={agendamentoId}
        nomeCliente={nomeCliente}
        servicoNome={
          agendamento ? (agendamento.servicos?.nome ?? "Serviço") : ""
        }
        data={agendamento?.data}
        horario={agendamento?.horario}
        nomeProfissionalContato={nomeProfissionalContato}
        sinalDeclarado={sinalDeclarado}
        onSinalDeclaradoChange={setSinalDeclarado}
        onStatusMudou={() => onConfirmado?.()}
      />

      {onEditar && (
        <button
          type="button"
          onClick={onEditar}
          className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
        >
          Editar agendamento
        </button>
      )}

      {onVoltar && (
        <button
          type="button"
          onClick={onVoltar}
          className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
        >
          {rotuloVoltar}
        </button>
      )}

      {podeCancelar && (
        <button
          type="button"
          onClick={() => {
            setErro("");
            setConfirmandoCancelamento(true);
          }}
          disabled={cancelando}
          className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-red-700 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cancelando ? "Cancelando..." : "Cancelar agendamento"}
        </button>
      )}

      {/* Enquanto a confirmação está aberta o erro aparece DENTRO dela — aqui
          fora só sobra o que ficou de uma tentativa já encerrada. */}
      {erro && !confirmandoCancelamento && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}

      <ModalConfirmarCancelamento
        aberto={confirmandoCancelamento}
        cancelando={cancelando}
        erro={erro}
        onConfirmar={handleCancelar}
        onFechar={() => {
          setConfirmandoCancelamento(false);
          setErro("");
        }}
      />
    </div>
  );
}
