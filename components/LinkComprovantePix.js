"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { BUCKET_COMPROVANTES } from "@/components/BlocoConfirmacaoPix";

// Segundos de validade da signed url. Curto de propósito: ela só precisa
// sobreviver ao tempo entre a dona clicar e olhar o comprovante.
const VALIDADE_SEGUNDOS = 600;

// Comprovante de Pix anexado pela cliente (ver BlocoConfirmacaoPix), exibido
// no card da aba Pendentes do /admin.
//
// O bucket comprovantes-pix é PRIVADO, então a coluna
// agendamentos.comprovante_pix_url guarda o CAMINHO, não uma URL utilizável —
// a signed url é gerada aqui, SOB DEMANDA (primeiro clique), e não na
// listagem: gerar uma por item pendente seria uma requisição por card só pra,
// na maioria das vezes, ninguém abrir. É o primeiro uso de createSignedUrl no
// projeto; o resto do código usa getPublicUrl, que só serve pra bucket público
// (ver foto de perfil).
//
// Props:
//   caminho   – agendamentos.comprovante_pix_url (caminho dentro do bucket).
//   enviadoEm – agendamentos.comprovante_pix_enviado_em.
//   formatarEnviadoEm – formatador de timestamp de quem monta (o /admin já
//               tem o dele, em hora LOCAL).
export default function LinkComprovantePix({
  caminho,
  enviadoEm,
  formatarEnviadoEm,
}) {
  const [url, setUrl] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  if (!caminho) return null;

  const ehPdf = caminho.toLowerCase().endsWith(".pdf");

  async function abrir() {
    setErro("");
    setCarregando(true);

    const { data, error } = await supabase.storage
      .from(BUCKET_COMPROVANTES)
      .createSignedUrl(caminho, VALIDADE_SEGUNDOS);

    setCarregando(false);

    if (error || !data?.signedUrl) {
      setErro("Não foi possível abrir o comprovante. Tente de novo.");
      return;
    }

    setUrl(data.signedUrl);
  }

  return (
    <div className="mt-3 rounded-lg bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs font-bold text-heading">Comprovante do Pix</p>
        {enviadoEm && (
          <p className="text-xs text-body">
            enviado em {formatarEnviadoEm ? formatarEnviadoEm(enviadoEm) : enviadoEm}
          </p>
        )}
      </div>

      {!url ? (
        <button
          type="button"
          onClick={abrir}
          disabled={carregando}
          className="mt-1.5 rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-heading ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
        >
          {carregando ? "Abrindo..." : "Ver comprovante"}
        </button>
      ) : (
        // Já com a signed url em mãos: imagem vira miniatura clicável (e o
        // <a> é um gesto direto do usuário, sem risco de bloqueio de popup
        // como teria um window.open depois do await acima); PDF só vira link,
        // já que não dá pra miniaturizar.
        <div className="mt-1.5">
          {!ehPdf && (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {/* next/image exigiria configurar o host do Supabase em
                  next.config; é uma miniatura de uso interno, atrás de signed
                  url que expira — img cru resolve. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="Comprovante do Pix enviado pela cliente"
                className="max-h-40 w-auto rounded-lg ring-1 ring-border"
              />
            </a>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-xs font-medium text-primary underline"
          >
            {ehPdf ? "Abrir PDF do comprovante" : "Abrir em tamanho real"}
          </a>
        </div>
      )}

      {erro && <p className="mt-1.5 text-xs text-red-700">{erro}</p>}
    </div>
  );
}
