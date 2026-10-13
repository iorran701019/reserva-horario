"use client";

// Aviso de "possível cadastro duplicado", aberto pelo botão "Ver cadastros" da
// caixa de aviso do card pendente do /admin. Só informa: não grava nada, não
// junta cadastros. Componente só de apresentação (mesmo padrão de
// ModalClientePendente.js): quem decide quando abrir e o que o WhatsApp envia é
// quem monta.
//
// Props:
//   proprio      – { nome, telefone } do cadastro deste agendamento, ou null
//                  (fechado).
//   candidatos   – [{ id, nome, whatsapp }] dos outros cadastros com o mesmo nome
//                  (quem chama já limita a 3).
//   onWhatsapp   – (nome, telefone) abre a conversa com aquele cadastro.
//   onFechar     – fecha (também o clique no fundo).
import IconeWhatsApp from "@/components/IconeWhatsApp";
import { formatarWhatsappExibicao } from "@/lib/whatsapp";

function CadastroLinha({ rotulo, nome, telefone, onWhatsapp }) {
  return (
    <div className="rounded-lg bg-surface p-3 ring-1 ring-border">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {rotulo}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-heading">{nome}</p>
      <p className="text-sm text-body">
        {formatarWhatsappExibicao(telefone) ?? telefone}
      </p>
      <button
        type="button"
        onClick={() => onWhatsapp(nome, telefone)}
        disabled={!telefone}
        className="mt-2 inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-green-50"
      >
        <IconeWhatsApp className="h-3.5 w-3.5" />
        WhatsApp
      </button>
    </div>
  );
}

export default function ModalPossivelDuplicidade({
  proprio,
  candidatos,
  onWhatsapp,
  onFechar,
}) {
  if (!proprio) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-possivel-duplicidade"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 px-4"
      onClick={onFechar}
    >
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="titulo-possivel-duplicidade"
          className="text-lg font-semibold text-heading"
        >
          Possível cadastro duplicado
        </h2>

        <div className="mt-5 space-y-3">
          <CadastroLinha
            rotulo="Deste agendamento"
            nome={proprio.nome}
            telefone={proprio.telefone}
            onWhatsapp={onWhatsapp}
          />
          {candidatos.map((candidato) => (
            <CadastroLinha
              key={candidato.id}
              rotulo="Outro cadastro com o mesmo nome"
              nome={candidato.nome}
              telefone={candidato.whatsapp}
              onWhatsapp={onWhatsapp}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={onFechar}
          className="mt-6 w-full rounded-lg px-4 py-2 text-sm font-medium text-body transition hover:bg-surface"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
