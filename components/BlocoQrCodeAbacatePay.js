"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatarPreco } from "@/lib/preco";
import { montarResumoAgendamento } from "@/lib/data";

// Intervalo do polling de status. 5s é o compromisso entre a cliente ver a
// tela virar logo depois de pagar no app do banco e não martelar a API do
// Abacate — a rota de status ainda corta a maioria das chamadas no atalho de
// terminal dela (ver app/api/abacatepay/status/route.js).
const INTERVALO_POLLING_MS = 5000;

// A AbacatePay devolve o brCodeBase64 já como data URI, mas o campo é
// repassado cru pelo nosso banco (ver gerar-cobranca) e um base64 puro num
// src daria uma imagem quebrada em silêncio. Prefixar quando faltar custa uma
// linha e cobre os dois formatos.
function srcDoQrCode(brCodeBase64) {
  if (!brCodeBase64) return "";
  return brCodeBase64.startsWith("data:")
    ? brCodeBase64
    : `data:image/png;base64,${brCodeBase64}`;
}

// Bloco do sinal quando o salão usa cobrança AUTOMÁTICA
// (estabelecimentos.metodo_cobranca_pix === 'abacatepay'). Irmão do
// BlocoConfirmacaoPix, não substituto: os dois vivem lado a lado, e quem
// escolhe são os dois pais (FormularioAgendamento e ConfirmacaoSinal).
//
// A diferença de fundo é QUEM declara o pagamento. No manual é a cliente
// (marca a caixa, anexa o comprovante) e o próprio componente faz o update de
// status. Aqui quem declara é o Abacate: o componente só exibe o QR Code e
// pergunta o status; o update de "aguardando_sinal" pra "pendente" acontece
// no servidor, na rota de status. Por isso NÃO existem aqui as props
// sinalDeclarado/onSinalDeclaradoChange/jaPendente/onComprovanteEnviado — não
// há gesto de declaração nem anexo neste fluxo.
//
// Props (as que fazem sentido, com o mesmo contrato do BlocoConfirmacaoPix):
//   estabelecimento – { sinal_valor_centavos } do salão.
//   agendamentoId   – linha em `agendamentos` a cobrar. É por ele que a
//                     cobrança é gerada e o status consultado; sem ele não há
//                     o que exibir.
//   nomeCliente / servicoNome / data / horario – resumo em uma linha na caixa
//                     cinza do topo, MESMA caixa e mesmo texto do bloco
//                     manual (montarResumoAgendamento, lib/data.js). `data` é
//                     o ISO cru ("YYYY-MM-DD"), formatado lá dentro.
//   nomeProfissionalContato – mesmo nome do botão fixo ContatoDono.
//   onStatusMudou   – chamado (sem args) quando o polling vê a reserva sair de
//                     "aguardando_sinal", pro pai trocar de tela (mesmo
//                     contrato do bloco manual).
export default function BlocoQrCodeAbacatePay({
  estabelecimento,
  agendamentoId,
  nomeCliente = "",
  servicoNome = "",
  data = "",
  horario = "",
  nomeProfissionalContato = "a equipe",
  onStatusMudou,
}) {
  const [cobranca, setCobranca] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCobranca, setErroCobranca] = useState("");
  const [codigoCopiado, setCodigoCopiado] = useState(false);
  // Trava o polling depois que ele já avisou o pai: sem isso, um
  // onStatusMudou que não desmonte o componente na hora (troca de tela
  // assíncrona) dispararia de novo no tick seguinte.
  const confirmadoRef = useRef(false);
  // onStatusMudou guardado em ref, não lido direto no efeito do polling: os
  // dois pais passam uma arrow inline, que muda de identidade a cada render.
  // Como dependência, ela recriaria o setInterval a cada render do wizard e o
  // relógio de 5s nunca chegaria ao fim — o polling não rodaria nunca.
  const onStatusMudouRef = useRef(onStatusMudou);
  onStatusMudouRef.current = onStatusMudou;

  // useCallback porque o botão "Tentar novamente" chama a MESMA função do
  // efeito de montagem — gerar cobrança é idempotente do lado do servidor
  // (a rota reaproveita cobrança válida em vez de criar outra).
  const gerarCobranca = useCallback(async () => {
    if (!agendamentoId) return;

    setErroCobranca("");
    setCarregando(true);

    try {
      const resposta = await fetch("/api/abacatepay/gerar-cobranca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agendamentoId }),
      });

      if (!resposta.ok) throw new Error("Falha ao gerar cobrança.");

      const json = await resposta.json();
      if (!json?.brCode) throw new Error("Cobrança sem código Pix.");

      setCobranca({ brCode: json.brCode, brCodeBase64: json.brCodeBase64 });
    } catch {
      setErroCobranca(
        "Não foi possível gerar o Pix agora. Verifique sua conexão e tente de novo."
      );
    } finally {
      setCarregando(false);
    }
  }, [agendamentoId]);

  useEffect(() => {
    confirmadoRef.current = false;
    gerarCobranca();
  }, [gerarCobranca]);

  // Polling do status. Roda desde a montagem (não espera o QR Code aparecer):
  // a cliente pode ter pago numa visita anterior e voltado a esta tela, e nesse
  // caso o primeiro tick já responde "pendente" pelo atalho de terminal da
  // rota. Só o intervalo é limpo no unmount — uma resposta que chegue depois
  // disso cai no guard do confirmadoRef.
  useEffect(() => {
    if (!agendamentoId) return undefined;

    let cancelado = false;

    async function consultarStatus() {
      if (confirmadoRef.current) return;

      try {
        const resposta = await fetch(
          `/api/abacatepay/status?agendamentoId=${encodeURIComponent(agendamentoId)}`
        );
        if (!resposta.ok) return;

        const json = await resposta.json();
        if (cancelado || confirmadoRef.current) return;

        // Qualquer status que não seja "aguardando_sinal" encerra a espera —
        // inclusive os que não são pagamento (cancelado pelo salão, reserva
        // expirada pelo pg_cron). Quem decide o que mostrar depois é o pai,
        // que relê a linha; aqui só faz sentido parar de perguntar.
        if (json?.status && json.status !== "aguardando_sinal") {
          confirmadoRef.current = true;
          onStatusMudouRef.current?.();
        }
      } catch {
        // Rede oscilando não é erro de tela: o próximo tick tenta de novo, e o
        // QR Code continua válido e visível enquanto isso.
      }
    }

    const intervalo = setInterval(consultarStatus, INTERVALO_POLLING_MS);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, [agendamentoId]);

  // Mesmo resumo, mesma caixa cinza e mesmo lugar do BlocoConfirmacaoPix — a
  // cliente confere O QUE está pagando antes de abrir o app do banco. Sem
  // profissionalNome, pelo mesmo motivo de lá: quem atende não é informação do
  // fluxo público.
  const resumo = montarResumoAgendamento({
    nomeCliente,
    servicoNome,
    data,
    horario,
  });

  async function copiarCodigo() {
    try {
      await navigator.clipboard.writeText(cobranca?.brCode ?? "");
      setCodigoCopiado(true);
      setTimeout(() => setCodigoCopiado(false), 2000);
    } catch {
      // Clipboard indisponível (permissão negada, contexto não seguro etc.):
      // o código já está em tela pra copiar manualmente.
    }
  }

  return (
    // Fragmento pelo mesmo motivo do bloco manual: o resumo é uma caixa cinza
    // IRMÃ da caixa âmbar, e quem separa as duas é o space-y do container do
    // pai.
    <>
      {resumo && (
        <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
          {resumo}
        </p>
      )}

      <div className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <div>
          <p className="text-base font-medium text-amber-800">
            {`Este agendamento exige um sinal de ${formatarPreco(estabelecimento.sinal_valor_centavos)} via Pix para confirmar a reserva.`}
          </p>
          <p className="mt-1 text-base font-medium text-amber-800">
            Escaneie o QR Code abaixo ou copie o código Pix e pague pelo app do
            seu banco.
          </p>
        </div>

        {carregando && (
          <p className="text-sm text-amber-900">Gerando o Pix...</p>
        )}

        {/* Mesma caixa vermelha com "Tentar novamente" do erroStatus do
            BlocoConfirmacaoPix: sem o QR Code não há como pagar, então esta é
            a única falha deste bloco que precisa de retentativa em tela. */}
        {erroCobranca && (
          <div className="rounded-lg bg-red-50 px-3 py-2 ring-1 ring-red-100">
            <p className="text-sm text-red-700">{erroCobranca}</p>
            <button
              type="button"
              onClick={gerarCobranca}
              disabled={carregando}
              className="mt-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {carregando ? "Gerando..." : "Tentar novamente"}
            </button>
          </div>
        )}

        {cobranca && !erroCobranca && (
          <>
            {cobranca.brCodeBase64 && (
              <div className="flex justify-center rounded-lg bg-card p-3 ring-1 ring-border">
                {/* next/image não entra aqui: o src é um data URI vindo da
                    AbacatePay, sem domínio pra configurar nem ganho de
                    otimização. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={srcDoQrCode(cobranca.brCodeBase64)}
                  alt="QR Code do Pix do sinal de reserva"
                  className="h-56 w-56"
                />
              </div>
            )}

            {/* Código copia-e-cola: truncado porque o brCode tem centenas de
                caracteres e ninguém digita isso à mão — o que importa é o
                botão. Mesmo "Copiado!" por 2s do bloco manual. */}
            <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 ring-1 ring-border">
              <span className="min-w-0 flex-1 truncate text-sm text-heading">
                {cobranca.brCode}
              </span>
              <button
                type="button"
                onClick={copiarCodigo}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover"
              >
                {codigoCopiado ? "Copiado!" : "Copiar código"}
              </button>
            </div>

            <p className="text-sm text-amber-900">
              {`Em caso de dúvidas, aperte o botão verde "Falar com ${nomeProfissionalContato}".`}
            </p>
          </>
        )}
      </div>
    </>
  );
}
