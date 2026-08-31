"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatarDataBR, formatarHorario } from "@/lib/data";

// Selo de status dos agendamentos ATIVOS. Mesma paleta do PainelCliente
// (SELO_STATUS) — mantém a linguagem visual do status já usada no público.
// Veio de GerenciarClientes.js junto com o miolo do antigo BlocoAgendamento,
// que este carrossel substituiu; é o único lugar que ainda lê o selo.
const SELO_STATUS = {
  aguardando_sinal: {
    rotulo: "Aguardando sinal",
    classe: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  pendente: {
    rotulo: "Pendente",
    classe: "bg-gray-100 text-gray-700 ring-gray-200",
  },
  confirmado: {
    rotulo: "Agendado",
    classe: "bg-green-100 text-green-700 ring-green-200",
  },
};

// Carrossel de agendamentos: mostra UM item por vez com setas pra navegar e
// um contador "(n/total)" no título quando há mais de um. Substituiu o card
// único "Próximo agendamento" da ficha do cliente (ver DetalheCliente em
// GerenciarClientes.js), que só sabia mostrar o primeiro da lista.
//
// `itens` chega já ordenado por quem busca (buscarProximosAgendamentos, em
// lib/clientesAdmin, devolve em ordem ascendente de data/horário) — o
// carrossel NÃO reordena, só pagina.
//
// `renderAcoes` é uma render prop que recebe o item ATUAL e devolve os botões
// de ação exibidos dentro do card. Fica de fora do componente de propósito:
// as ações (cancelar, notificar) dependem de callbacks e dados do cliente que
// só a ficha conhece, e assim o carrossel continua reutilizável em outra tela
// que queira ações diferentes — ou nenhuma.
//
// `onSelecionarItem` (opcional) recebe o item ATUAL quando o conteúdo do card
// é clicado. Mesma separação de responsabilidade: o carrossel só avisa QUAL
// item foi escolhido, quem decide o que fazer com isso é a tela (na ficha do
// cliente, navegar pro Painel na data do agendamento). Sem a prop, o conteúdo
// não é clicável.
export default function CarrosselAgendamentos({
  titulo,
  itens,
  vazio,
  renderAcoes,
  onSelecionarItem,
}) {
  const [indice, setIndice] = useState(0);
  const total = itens.length;
  const atual = itens[indice] ?? null;

  // O conteúdo do card vira <button> quando há onSelecionarItem e <div>
  // quando não há — mesmo padrão condicional do antigo BlocoAgendamento, que
  // este carrossel substituiu. Só o conteúdo troca de tag: o cabeçalho (que
  // já tem as setas) e a área de renderAcoes (que tem os próprios botões)
  // ficam de fora, senão seriam botões aninhados.
  const ConteudoItem = onSelecionarItem ? "button" : "div";

  // A lista encolhe embaixo do carrossel quando um agendamento é cancelado
  // (a ficha rebusca o resumo, ver recarregarResumo). Se o índice apontava
  // pro último item, ele passa a apontar pro vazio — puxa de volta pro novo
  // último em vez de renderizar um card em branco.
  useEffect(() => {
    if (indice >= total && total > 0) setIndice(total - 1);
  }, [total, indice]);

  if (total === 0) {
    return (
      <div className="w-full rounded-xl bg-surface p-3 ring-1 ring-border">
        <h4 className="text-sm font-medium text-body">{titulo}</h4>
        <p className="mt-1 text-sm text-body">{vazio}</p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl bg-surface p-3 ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIndice((i) => Math.max(0, i - 1))}
          disabled={indice === 0}
          className="rounded p-1 text-body transition hover:bg-card disabled:opacity-30"
          aria-label="Agendamento anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h4 className="text-sm font-medium text-body">
          {titulo} {total > 1 && `(${indice + 1}/${total})`}
        </h4>
        <button
          type="button"
          onClick={() => setIndice((i) => Math.min(total - 1, i + 1))}
          disabled={indice === total - 1}
          className="rounded p-1 text-body transition hover:bg-card disabled:opacity-30"
          aria-label="Próximo agendamento"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {/* Miolo do antigo BlocoAgendamento: data/horário, serviço, selo de
            status e as respostas do popup de perguntas do serviço (ver
            lib/agendamentoRespostas). Sem <h4> próprio — o título agora é do
            carrossel, logo acima. */}
        {atual && (
          <ConteudoItem
            className={`mb-2 flex w-full flex-wrap items-center gap-2 rounded-lg text-left text-sm text-body ${
              onSelecionarItem ? "-m-1 p-1 transition hover:bg-card" : ""
            }`}
            {...(onSelecionarItem
              ? { type: "button", onClick: () => onSelecionarItem(atual) }
              : {})}
          >
            <span className="font-medium text-heading">
              {formatarDataBR(atual.data)} · {formatarHorario(atual.horario)}
            </span>
            <span>{atual.servicos?.nome ?? "Serviço"}</span>
            {SELO_STATUS[atual.status] && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${SELO_STATUS[atual.status].classe}`}
              >
                {SELO_STATUS[atual.status].rotulo}
              </span>
            )}
            {(atual.respostas ?? []).length > 0 && (
              <ul className="mt-1 basis-full space-y-0.5">
                {atual.respostas.map((texto, i) => (
                  <li key={i} className="text-xs text-body">
                    {texto}
                  </li>
                ))}
              </ul>
            )}
          </ConteudoItem>
        )}
        {renderAcoes && renderAcoes(atual)}
      </div>
    </div>
  );
}
