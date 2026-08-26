"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatarPreco } from "@/lib/preco";
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
// comprovante e o checkbox "já paguei". Fonte ÚNICA desse bloco — era
// duplicado entre a etapa "dados" do FormularioAgendamento (wizard, gateado
// por precisaSinal) e o ConfirmacaoSinal (cliente que volta depois pelo
// PainelCliente).
//
// Não tem botão de confirmar nem grava status: quem monta decide isso (o
// wizard confirma no submit dele; o ConfirmacaoSinal tem o próprio botão). O
// único write que este componente faz é o do comprovante — direto na linha do
// agendamento, assim que o arquivo sobe.
//
// Props:
//   estabelecimento – { sinal_valor_centavos, sinal_chave_pix } do salão.
//   agendamentoId   – linha em `agendamentos` a que o comprovante pertence.
//                     No wizard é a reserva já gravada ao entrar em "dados";
//                     null desabilita só o upload, o resto do bloco segue.
//   nomeProfissionalContato – mesmo nome do botão fixo ContatoDono.
//   sinalDeclarado / onSinalDeclaradoChange – checkbox CONTROLADO pelo pai:
//                     é ele que libera (ou não) o botão de confirmar dele.
//   onComprovanteEnviado – (caminho, enviadoEm) após o upload + update darem
//                     certo; opcional, pro pai refletir na UI dele.
export default function BlocoConfirmacaoPix({
  estabelecimento,
  agendamentoId,
  nomeProfissionalContato = "a equipe",
  sinalDeclarado,
  onSinalDeclaradoChange,
  onComprovanteEnviado,
}) {
  const [chavePixCopiada, setChavePixCopiada] = useState(false);
  const [enviandoComprovante, setEnviandoComprovante] = useState(false);
  const [nomeComprovante, setNomeComprovante] = useState("");
  const [erroComprovante, setErroComprovante] = useState("");

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
  // a cliente continua podendo marcar "já paguei" e confirmar. Por isso todo
  // erro aqui vira só uma mensagem avisando que o anexo não foi (e sugerindo
  // mandar pelo WhatsApp), sem mexer no checkbox nem no status.
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
  }

  return (
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

      {/* Upload do comprovante. Label estilizada de botão + input escondido:
          o input de arquivo nativo não é estilizável e destoaria do bloco.
          Reenviar é permitido (upsert no mesmo caminho) — a cliente que mandou
          o print errado só escolhe outro arquivo. */}
      <div className="rounded-lg bg-card px-3 py-2 ring-1 ring-border">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={handleComprovanteChange}
            disabled={enviandoComprovante}
            className="sr-only"
          />
          <span className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover">
            {enviandoComprovante
              ? "Enviando..."
              : nomeComprovante
                ? "Trocar comprovante"
                : "Anexar comprovante"}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-body">
            {nomeComprovante || "Imagem ou PDF (opcional)"}
          </span>
        </label>

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
          onChange={(e) => onSinalDeclaradoChange?.(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30"
        />
        Já realizei o pagamento do sinal via Pix
      </label>
    </div>
  );
}
