"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatarPreco } from "@/lib/preco";
import { formatarData } from "@/lib/data";
import { comprimirImagem } from "@/lib/comprimirImagem";

// Bucket PRIVADO (anon só faz INSERT; leitura é só do lado autenticado, no
// /admin). Por isso o que gravamos em agendamentos.comprovante_pix_url é o
// CAMINHO dentro do bucket, não uma URL: signed URL expira, e uma URL morta
// gravada na linha seria pior que nenhuma. Quem precisa exibir gera a signed
// url na hora (ver createSignedUrl em app/[salon]/admin/page.js).
export const BUCKET_COMPROVANTES = "comprovantes-pix";

// Caminho determinístico por agendamento: reenviar substitui (upsert) em vez
// de acumular lixo — mesmo padrão de handleFotoPerfilChange
// (app/[salon]/admin/ConfiguracoesSalao.js), só que a chave aqui é o
// agendamento, não o tenant.
function caminhoComprovante(agendamentoId, arquivo) {
  const extensao =
    arquivo.type === "application/pdf"
      ? "pdf"
      : arquivo.name.split(".").pop()?.toLowerCase() || "jpg";
  return `${agendamentoId}/comprovante.${extensao}`;
}

// Bloco âmbar do sinal de reserva: valor, chave Pix copiável, upload do
// comprovante e o checkbox "enviei o comprovante". Fonte ÚNICA desse bloco —
// era duplicado entre a etapa "dados" do FormularioAgendamento (wizard,
// gateado por precisaSinal) e o ConfirmacaoSinal (cliente que volta depois
// pelo PainelCliente).
//
// É AQUI que o agendamento sai de "aguardando_sinal" e vira "pendente": tanto
// marcar a caixa quanto concluir o upload do comprovante já disparam esse
// update sozinhos (ver marcarPendente). Não existe mais um botão "Confirmar"
// em tela pra isso — a cliente que declarou o pagamento (de um jeito ou de
// outro) já entregou o que dependia dela.
//
// Props:
//   estabelecimento – { sinal_valor_centavos, sinal_chave_pix } do salão.
//   agendamentoId   – linha em `agendamentos` a marcar como pendente e a que
//                     o comprovante pertence. No wizard é a reserva já
//                     gravada ao entrar em "dados"; null desabilita o upload
//                     e o checkbox, o resto do bloco segue.
//   nomeCliente / servicoNome / data / horario – resumo em uma linha na caixa
//                     cinza ACIMA do bloco âmbar, pra cliente conferir O QUE
//                     está pagando antes de mandar o Pix (mesma caixa que o
//                     wizard usava pro "Agendando para", que saiu daqui em
//                     diante). TODOS opcionais e independentes: o que
//                     não vier some da linha (nada de "undefined" em tela), e
//                     sem nenhum deles a linha inteira não é renderizada.
//                     `data` é o ISO cru ("YYYY-MM-DD"), formatado aqui.
//   nomeProfissionalContato – mesmo nome do botão fixo ContatoDono.
//   sinalDeclarado / onSinalDeclaradoChange – checkbox CONTROLADO pelo pai
//                     (o wizard ainda lê esse valor no submit final dele).
//   jaPendente      – true quando o agendamento JÁ está em "pendente" (a
//                     cliente voltou a esta tela depois de declarar): evita
//                     reescrever pendente_desde e reiniciar a janela de
//                     protocolo a cada novo comprovante.
//   onStatusMudou   – chamado (sem args) logo após o update de status dar
//                     certo, pro pai trocar de tela (ver app/[salon]/page.js).
//   onComprovanteEnviado – (caminho, enviadoEm) após o upload + update darem
//                     certo; opcional, pro pai refletir na UI dele.
export default function BlocoConfirmacaoPix({
  estabelecimento,
  agendamentoId,
  nomeCliente = "",
  servicoNome = "",
  data = "",
  horario = "",
  nomeProfissionalContato = "a equipe",
  sinalDeclarado,
  onSinalDeclaradoChange,
  jaPendente = false,
  onStatusMudou,
  onComprovanteEnviado,
}) {
  const [chavePixCopiada, setChavePixCopiada] = useState(false);
  const [enviandoComprovante, setEnviandoComprovante] = useState(false);
  const [nomeComprovante, setNomeComprovante] = useState("");
  const [erroComprovante, setErroComprovante] = useState("");
  // Erro do update de status (marcarPendente). Separado do erro do
  // comprovante de propósito: um anexo que não subiu é contornável pelo
  // WhatsApp, mas o status que não mudou trava a solicitação — e é o único
  // dos dois que oferece "Tentar novamente".
  const [erroStatus, setErroStatus] = useState("");
  const [marcandoPendente, setMarcandoPendente] = useState(false);
  // Id do agendamento que ESTE componente já marcou como pendente. Guardado
  // como id (não booleano) porque no wizard o `agendamentoId` troca sem
  // desmontar o bloco: trocar de horário cancela a reserva e cria outra, e a
  // nova precisa ser marcada de novo. Ref, não state: só serve pra decidir se
  // o próximo update deve rodar, nunca muda o que está na tela.
  const marcadoPendenteParaRef = useRef(jaPendente ? agendamentoId : null);
  // Dois inputs de arquivo separados, um por tipo, em vez de um só com
  // accept="image/*,application/pdf": no Android (confirmado em POCO X7, e o
  // padrão se repete em outros Xiaomi/MIUI) o accept misto faz o seletor
  // nativo esconder a Galeria/Fotos e oferecer só Câmera e Arquivos. Com
  // accept="image/*" sozinho o seletor de fotos volta. Escondidos e
  // disparados por .click() nos dois botões visíveis — o input nativo não é
  // estilizável e destoaria do bloco.
  const inputImagemRef = useRef(null);
  const inputPdfRef = useRef(null);

  // Leva o agendamento de "aguardando_sinal" pra "pendente" — o único write
  // de status do fluxo público do sinal. Chamado pelos DOIS gestos que
  // significam "paguei e avisei": marcar a caixa e concluir o upload do
  // comprovante.
  //
  // pendente_desde marca a ENTRADA em pendente: é dele que a régua de telas
  // de app/[salon]/page.js tira a janela em que a cliente ainda vê a tela de
  // protocolo em vez do painel. Por isso não é reescrito quando o
  // agendamento já estava pendente (segundo comprovante, por exemplo) — só
  // quando de fato entra no status.
  //
  // Devolve true/false em vez de lançar: quem chama decide o que fazer com a
  // falha (o upload, por exemplo, já subiu o arquivo e não deve desfazer
  // nada). Nunca desfaz o checkbox nem apaga o comprovante — a cliente segue
  // com o gesto dela registrado em tela e um "Tentar novamente" à mão.
  async function marcarPendente() {
    if (!agendamentoId) return false;
    if (marcadoPendenteParaRef.current === agendamentoId) return true;

    setErroStatus("");
    setMarcandoPendente(true);

    const { error } = await supabase
      .from("agendamentos")
      .update({
        status: "pendente",
        sinal_declarado_pago: true,
        pendente_desde: new Date().toISOString(),
      })
      .eq("id", agendamentoId);

    setMarcandoPendente(false);

    if (error) {
      setErroStatus(
        "Não foi possível registrar o envio do comprovante. Verifique sua conexão e tente de novo."
      );
      return false;
    }

    marcadoPendenteParaRef.current = agendamentoId;
    onStatusMudou?.();
    return true;
  }

  // Marcar a caixa É a confirmação: avisa o pai (o wizard ainda usa esse
  // valor no submit dele) e já grava. Desmarcar não desfaz o update — o
  // status não volta atrás sozinho; quem reabre uma solicitação é o salão.
  async function handleSinalDeclaradoChange(marcado) {
    onSinalDeclaradoChange?.(marcado);
    if (!marcado) return;
    await marcarPendente();
  }

  // Linha de resumo do topo: "Nome · Serviço · 27/08 · quarta-feira às
  // 14:00". Data e horário andam JUNTOS num único trecho porque formatarData
  // já traz um "·" dentro (dd/mm · dia da semana) e separar os dois com outro
  // "·" viraria uma fileira de pontos. Cada trecho ausente é descartado em
  // vez de virar vazio — daí o filter, e não um template fixo; o "às" também
  // só entra se houver data, senão sobraria um "às 14:00" solto.
  const dataFormatada = formatarData(data);
  const horarioCurto = horario ? String(horario).slice(0, 5) : "";
  const horarioTrecho = dataFormatada ? `às ${horarioCurto}` : horarioCurto;
  const quando = [dataFormatada, horarioCurto && horarioTrecho]
    .filter(Boolean)
    .join(" ");
  const resumo = [nomeCliente, servicoNome, quando].filter(Boolean).join(" · ");

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

  // Falha de upload NUNCA trava o fluxo: o comprovante é um anexo opcional, e
  // a cliente continua podendo marcar a caixa. Por isso todo erro aqui vira só
  // uma mensagem avisando que o anexo não foi (e sugerindo mandar pelo
  // WhatsApp), sem mexer no checkbox nem no status.
  //
  // Já o upload que DÁ CERTO conta como declaração de pagamento: chama
  // marcarPendente logo depois de gravar o caminho na linha (ver
  // marcarPendente). Se esse segundo update falhar, o comprovante enviado
  // continua em tela e no banco — a cliente só vê o "Tentar novamente" do
  // erro de status, sem perder o arquivo que já subiu.
  async function handleComprovanteChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setErroComprovante("");

    if (!agendamentoId) {
      setErroComprovante(
        "Não foi possível anexar o comprovante agora. Você pode enviá-lo pelo WhatsApp."
      );
      return;
    }

    setEnviandoComprovante(true);

    // Imagem passa pelo canvas (foto de celular costuma ter vários MB); PDF
    // sobe como veio. Falha de compressão devolve o original, nunca lança.
    const arquivo = await comprimirImagem(file);
    const caminho = caminhoComprovante(agendamentoId, arquivo);

    const { error: erroUpload } = await supabase.storage
      .from(BUCKET_COMPROVANTES)
      .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type });

    if (erroUpload) {
      setEnviandoComprovante(false);
      setErroComprovante(
        "Não foi possível enviar o comprovante. Você pode enviá-lo pelo WhatsApp."
      );
      return;
    }

    const enviadoEm = new Date().toISOString();
    const { error: erroUpdate } = await supabase
      .from("agendamentos")
      .update({
        comprovante_pix_url: caminho,
        comprovante_pix_enviado_em: enviadoEm,
      })
      .eq("id", agendamentoId);

    setEnviandoComprovante(false);

    if (erroUpdate) {
      setErroComprovante(
        "Não foi possível salvar o comprovante. Você pode enviá-lo pelo WhatsApp."
      );
      return;
    }

    setNomeComprovante(file.name);
    onComprovanteEnviado?.(caminho, enviadoEm);

    // Comprovante no lugar = pagamento declarado. Marca a caixa junto (o
    // wizard lê esse valor no submit) e muda o status.
    onSinalDeclaradoChange?.(true);
    await marcarPendente();
  }

  return (
    // Fragmento, não um wrapper: o resumo é uma caixa cinza IRMÃ do bloco
    // âmbar, não parte dele — o âmbar é só o aviso do Pix. Os dois pais
    // (wizard e ConfirmacaoSinal) empilham por space-y no container deles, que
    // é o que separa as duas caixas.
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
            {`Anexe o comprovante abaixo ou aperte o botão verde "Falar com ${nomeProfissionalContato}" e envie o comprovante do Pix.`}
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

        {/* Upload do comprovante. Dois botões, um por tipo de arquivo, cada um
            disparando o SEU input escondido (ver inputImagemRef/inputPdfRef):
            os dois caem no mesmo handleComprovanteChange, o que muda é só o
            accept do seletor nativo. Reenviar é permitido (upsert no mesmo
            caminho) — a cliente que mandou o print errado só escolhe outro
            arquivo. */}
        <div className="rounded-lg bg-card px-3 py-2 ring-1 ring-border">
          <input
            ref={inputImagemRef}
            type="file"
            accept="image/*"
            onChange={handleComprovanteChange}
            disabled={enviandoComprovante}
            className="hidden"
          />
          <input
            ref={inputPdfRef}
            type="file"
            accept="application/pdf"
            onChange={handleComprovanteChange}
            disabled={enviandoComprovante}
            className="hidden"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputImagemRef.current?.click()}
              disabled={enviandoComprovante}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviandoComprovante ? "Enviando..." : "Enviar print/foto"}
            </button>
            <button
              type="button"
              onClick={() => inputPdfRef.current?.click()}
              disabled={enviandoComprovante}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Enviar PDF
            </button>
          </div>

          <p className="mt-1.5 min-w-0 truncate text-sm text-body">
            {nomeComprovante || "Imagem ou PDF (opcional)"}
          </p>

          {nomeComprovante && !erroComprovante && (
            <p className="mt-1.5 text-sm text-green-700">
              Comprovante anexado com sucesso.
            </p>
          )}
          {erroComprovante && (
            <p className="mt-1.5 text-sm text-red-700">{erroComprovante}</p>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm text-amber-900">
          <input
            type="checkbox"
            checked={sinalDeclarado}
            onChange={(e) => handleSinalDeclaradoChange(e.target.checked)}
            disabled={!agendamentoId || marcandoPendente}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
          />
          Enviei o comprovante pelo WhatsApp
        </label>

        {/* Erro do update de status — o único dos dois erros deste bloco que
            precisa de retentativa em tela: sem ele o agendamento continua em
            "aguardando_sinal" e a solicitação não chega pro salão. O gesto da
            cliente (caixa marcada, comprovante anexado) fica intacto. */}
        {erroStatus && (
          <div className="rounded-lg bg-red-50 px-3 py-2 ring-1 ring-red-100">
            <p className="text-sm text-red-700">{erroStatus}</p>
            <button
              type="button"
              onClick={marcarPendente}
              disabled={marcandoPendente}
              className="mt-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {marcandoPendente ? "Enviando..." : "Tentar novamente"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
