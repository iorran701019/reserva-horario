"use client";

// Popup bloqueante exibido no fluxo público do FormularioAgendamento, antes
// do bloco de pagamento do sinal, quando o salão tem um aviso configurado
// (estabelecimento.aviso_pre_sinal, ver ConfiguracoesSalao). Componente só de
// apresentação: quem decide SE mostra é quem chama (ver avancarParaDados em
// FormularioAgendamento); aqui só desenha o texto e o botão de confirmação.
// Mesmo padrão visual dos outros modais do wizard (ModalConflitoWhatsapp etc).
//
// Props:
//   texto        – aviso_pre_sinal do estabelecimento (texto livre). Quebras
//                  de linha são preservadas; *trecho* vira negrito (mesmo
//                  padrão do WhatsApp), via parse simples de regex.
//   onConfirmar  – clique em "Entendi, continuar".

// "algo *em negrito* aqui" -> partes alternando texto normal e o conteúdo
// entre asteriscos, que vira <strong>. Não lida com *aninhado* nem escaping —
// só o caso comum de destaque simples.
function formatarAviso(texto) {
  return texto.split(/(\*[^*]+\*)/g).map((parte, i) =>
    parte.startsWith("*") && parte.endsWith("*") && parte.length > 1 ? (
      <strong key={i}>{parte.slice(1, -1)}</strong>
    ) : (
      <span key={i}>{parte}</span>
    )
  );
}

export default function PopupAvisoSinal({ texto, onConfirmar }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-aviso-sinal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border">
        <h2 id="titulo-aviso-sinal" className="sr-only">
          Aviso
        </h2>

        <p className="whitespace-pre-wrap text-sm text-body">
          {formatarAviso(texto)}
        </p>

        <div className="mt-6">
          <button
            type="button"
            onClick={onConfirmar}
            className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
          >
            Entendi, continuar
          </button>
        </div>
      </div>
    </div>
  );
}
