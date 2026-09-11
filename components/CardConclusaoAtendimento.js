"use client";

import { useState } from "react";
import { formatarPreco } from "@/lib/preco";
import { temSinal } from "@/lib/particao";
import {
  concluirAgendamento,
  marcarNaoCompareceu,
  registrarValorCobrado,
} from "@/lib/conclusao";

// Reais digitado ("35", "35,50" ou "35.50") -> centavos inteiros. NaN quando
// não dá pra interpretar — mesmo contrato de reaisParaCentavos do
// GerenciarServicos, pra validação barrar.
function reaisParaCentavos(reais) {
  const numero = Number(String(reais).replace(",", "."));
  if (Number.isNaN(numero)) return NaN;
  return Math.round(numero * 100);
}

// Centavos -> texto do campo ("35.00"); "" quando não há valor.
function centavosParaTexto(centavos) {
  return centavos != null ? (centavos / 100).toFixed(2) : "";
}

// Card de exceção da conclusão de um atendimento: "Concluiu normalmente?"
// (Sim/Cancelado) + o valor cobrado, com opção de substituir. Um componente
// só pros dois lugares que o usam:
//   - "Aguardando Conclusão" (sub-toggle da aba Pendentes) do /admin: agendamento ainda "confirmado",
//     horário já passou e o cron ainda não concluiu. Sim = conclui antes do
//     prazo (concluirAgendamento).
//   - botão "Editar" dos concluídos no Histórico (geral e ficha do cliente):
//     agendamento já "concluido", pelo cron ou pela dona. Sim = só corrige o
//     valor (registrarValorCobrado).
// Em ambos, Cancelado = falta (marcarNaoCompareceu: cancelado + nao_compareceu).
//
// Acima da pergunta, o bloco do sinal, em três estados (ver temSinal):
//   - sem sinal                        -> "Sem pagamento de sinal".
//   - sinal com valor gravado          -> a conta Sinal + Restante = Total.
//   - sinal sem valor gravado (linhas  -> "Sinal já pago (valor não
//     anteriores a sinal_valor_centavos)   registrado)", sem conta.
// valor_cobrado_centavos é SEMPRE o total do atendimento, nos três estados.
// Só muda o que o "Substituir valor" pede: no estado com a conta, a dona
// informa o que recebeu ALÉM do sinal e o total é esse valor + o sinal; nos
// outros dois, o valor cheio.
//
// "Substituir valor" é uma edição LOCAL: "Salvar valor" só troca o valor
// exibido (e o que o Sim vai gravar) e sai do modo edição; "Cancelar" volta
// ao valor anterior. Nada vai pro banco até o Sim — assim a dona sempre tem
// uma saída do campo, e o Sim continua sendo o único gesto que grava.
//
// Props:
//   agendamento – precisa de id, status, valor_cobrado_centavos,
//                 servicos.preco_centavos (valor padrão quando ainda não há
//                 valor cobrado gravado), sinal_declarado_pago e
//                 sinal_valor_centavos.
//   onSalvo     – recebe o patch gravado ({ status, valor_cobrado_centavos,
//                 nao_compareceu }, só os campos que mudaram), pra quem chama
//                 refletir no estado local sem refazer a busca.
//   onFechar    – opcional; mostra um "Cancelar" que fecha o card sem gravar
//                 (usado pelo "Editar" do Histórico).
export default function CardConclusaoAtendimento({ agendamento, onSalvo, onFechar }) {
  const valorPadrao =
    agendamento.valor_cobrado_centavos ?? agendamento.servicos?.preco_centavos ?? null;

  // Total escolhido pelo "Salvar valor" (centavos, já com o sinal somado no
  // estado 2). null = a dona não substituiu, vale o valor padrão.
  const [valorSubstituido, setValorSubstituido] = useState(null);
  const valorAtual = valorSubstituido ?? valorPadrao;

  const comSinal = temSinal(agendamento);
  // Valor do sinal só quando dá pra fazer a conta (estado 2). null nos outros
  // dois estados — é o que decide o bloco e o rótulo do campo.
  const sinalCentavos = comSinal ? agendamento.sinal_valor_centavos ?? null : null;
  // Restante só existe com um total conhecido que cubra o sinal. Preço 0 ou
  // ausente (serviço "sob avaliação", servico_livre) daria restante negativo
  // ou sem base — aí o bloco mostra o sinal e "não informado", sem inventar.
  const restanteCentavos =
    sinalCentavos != null && valorAtual != null && valorAtual >= sinalCentavos
      ? valorAtual - sinalCentavos
      : null;

  // O campo edita o total (estados 1 e 3) ou o que veio além do sinal
  // (estado 2); o texto inicial acompanha.
  const valorAtualCampo = sinalCentavos != null ? restanteCentavos : valorAtual;

  const [corrigindo, setCorrigindo] = useState(false);
  const [valorTexto, setValorTexto] = useState(centavosParaTexto(valorAtualCampo));
  // Cancelado = cancela o agendamento: pede um segundo clique antes de gravar.
  const [confirmandoNao, setConfirmandoNao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const jaConcluido = agendamento.status === "concluido";
  // Atendimento que não aconteceu não tem valor a editar. Hoje nenhum dos dois
  // pontos de uso monta o card num cancelado (a aba Conclusão só lista
  // confirmados e o "Editar" do Histórico só aparece em concluídos); a guarda
  // é pra não depender disso.
  const cancelado = agendamento.status === "cancelado";

  function abrirSubstituicao() {
    setErro("");
    setValorTexto(centavosParaTexto(valorAtualCampo));
    setCorrigindo(true);
  }

  function cancelarSubstituicao() {
    setErro("");
    setValorTexto(centavosParaTexto(valorAtualCampo));
    setCorrigindo(false);
  }

  function salvarSubstituicao() {
    let valorCentavos = reaisParaCentavos(valorTexto);
    if (valorTexto.trim() === "" || Number.isNaN(valorCentavos) || valorCentavos < 0) {
      setErro("Informe um valor válido.");
      return;
    }
    // Estado 2: o digitado é o que veio além do sinal; guarda o total.
    if (sinalCentavos != null) valorCentavos += sinalCentavos;

    setErro("");
    setValorSubstituido(valorCentavos);
    setCorrigindo(false);
  }

  async function handleSim() {
    const valorCentavos = valorAtual;

    setSalvando(true);
    setErro("");
    const { ok, erro: erroSalvar } = jaConcluido
      ? await registrarValorCobrado(agendamento.id, valorCentavos)
      : await concluirAgendamento(agendamento.id, valorCentavos);
    setSalvando(false);

    if (!ok) {
      setErro(erroSalvar);
      return;
    }

    onSalvo(
      jaConcluido
        ? { valor_cobrado_centavos: valorCentavos }
        : { status: "concluido", valor_cobrado_centavos: valorCentavos }
    );
  }

  async function handleNaoCompareceu() {
    setSalvando(true);
    setErro("");
    const { ok, erro: erroSalvar } = await marcarNaoCompareceu(agendamento.id);
    setSalvando(false);

    if (!ok) {
      setErro(erroSalvar);
      return;
    }

    onSalvo({ status: "cancelado", nao_compareceu: true });
  }

  return (
    <div className="space-y-3 rounded-xl bg-surface p-3 ring-1 ring-border">
      {!comSinal ? (
        <p className="text-sm text-body">Sem pagamento de sinal</p>
      ) : sinalCentavos != null ? (
        <div className="space-y-0.5 text-sm text-body">
          <p>
            Sinal (Pix) já recebido:{" "}
            <span className="font-medium text-heading">{formatarPreco(sinalCentavos)}</span>
          </p>
          <p>
            Valor restante:{" "}
            <span className="font-medium text-heading">
              {restanteCentavos != null ? formatarPreco(restanteCentavos) : "não informado"}
            </span>
          </p>
          {restanteCentavos != null && (
            <p>
              Total:{" "}
              <span className="font-medium text-heading">{formatarPreco(valorAtual)}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-body">Sinal já pago (valor não registrado)</p>
      )}

      <p className="text-sm font-semibold text-heading">Concluiu normalmente?</p>

      {!cancelado &&
        (corrigindo ? (
          <div className="space-y-2">
            <div>
              <label
                htmlFor={`valor-cobrado-${agendamento.id}`}
                className="mb-1 block text-xs font-medium text-body"
              >
                {/* Estado 2 edita só o que veio além do sinal; estado 3 (sinal
                    pago sem valor registrado) edita o total cobrado; sem sinal
                    nenhum, é simplesmente o que a dona recebeu. */}
                {sinalCentavos != null
                  ? "Valor recebido além do sinal (R$)"
                  : comSinal
                    ? "Valor cobrado (R$)"
                    : "Valor recebido (R$)"}
              </label>
              {/* type="text" + inputMode="decimal" em vez de type="number": o
                  number descarta "35,50" (vírgula) em navegador/teclado pt-BR e
                  o campo parecia não aceitar valor. reaisParaCentavos já
                  entende vírgula e ponto. */}
              <input
                id={`valor-cobrado-${agendamento.id}`}
                type="text"
                inputMode="decimal"
                autoFocus
                value={valorTexto}
                onChange={(e) => setValorTexto(e.target.value)}
                placeholder="35,00"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={salvarSubstituicao}
                className="inline-flex items-center justify-center rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-100"
              >
                Salvar valor
              </button>
              <button
                type="button"
                onClick={cancelarSubstituicao}
                className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-body">
            {/* Com a conta completa no bloco do sinal (restante calculado), o
                Total já aparece acima — aqui fica só o "Substituir valor". Sem
                ela (estados 1 e 3, ou sinal gravado com preço 0/ausente/menor
                que o sinal), esta linha é a única referência de valor do card. */}
            {restanteCentavos == null && (
              <span>
                Valor:{" "}
                <span className="font-medium text-heading">
                  {valorAtual != null ? formatarPreco(valorAtual) : "não informado"}
                </span>
              </span>
            )}
            <button
              type="button"
              disabled={salvando}
              onClick={abrirSubstituicao}
              className="inline-flex items-center justify-center rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-100 disabled:opacity-60"
            >
              Substituir valor
            </button>
          </div>
        ))}

      {/* Sim/Cancelado somem enquanto o valor está sendo substituído: a dona
          fecha a edição (Salvar valor ou Cancelar) antes de decidir, e o Sim
          nunca grava um texto que ela ainda não confirmou. */}
      {corrigindo ? null : confirmandoNao ? (
        <div className="space-y-2 rounded-lg bg-red-50 p-3 ring-1 ring-red-100">
          <p className="text-sm text-red-700">
            Marcar este agendamento como cancelado?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={salvando}
              onClick={() => setConfirmandoNao(false)}
              className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:opacity-60"
            >
              Voltar
            </button>
            <button
              type="button"
              disabled={salvando}
              onClick={handleNaoCompareceu}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Confirmar cancelamento"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={salvando}
            onClick={handleSim}
            className="inline-flex items-center justify-center rounded-lg bg-green-50 px-4 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100 disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Sim"}
          </button>
          <button
            type="button"
            disabled={salvando}
            onClick={() => {
              setErro("");
              setConfirmandoNao(true);
            }}
            className="inline-flex items-center justify-center rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700 ring-1 ring-red-100 transition hover:bg-red-100 disabled:opacity-60"
          >
            Cancelado
          </button>
          {onFechar && (
            <button
              type="button"
              disabled={salvando}
              onClick={onFechar}
              className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:opacity-60"
            >
              Cancelar
            </button>
          )}
        </div>
      )}

      {erro && <p className="text-sm text-red-700">{erro}</p>}
    </div>
  );
}
