"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buscarEtiquetasAtivas } from "@/lib/clientesAdmin";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";

// Classe única do badge de etiqueta — mesma anatomia dos outros badges do
// /admin (ver classesStatus/HISTORICO_BADGE): `rounded-full px-2.5 py-0.5
// text-xs font-medium ring-1` + uma família de cor. Violeta porque nenhum
// outro selo do painel usa essa família: âmbar é "pendente", verde é
// "confirmado/agendado", vermelho é "cancelado", cinza é histórico — a
// etiqueta não pode ser confundida com nenhum deles.
const CLASSE_BADGE =
  "rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-100";

// Chip do cliente ainda sem etiqueta. Âmbar (a mesma família do "pendente")
// porque é justamente um convite a agir, não um estado neutro.
const CLASSE_CHIP_VAZIO =
  "rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200";

// Texto do badge: emoji é opcional na tabela, então o espaço só entra quando
// há emoji (senão o badge nasce com um espaço solto antes do nome).
// Exportado porque outros pontos do /admin precisam do MESMO rótulo fora de um
// badge — ver o banner de restrição de agenda em app/[salon]/admin/page.js e o
// CRUD de restrições em ConfiguracoesSalao.js. Continua sendo informação
// EXCLUSIVA do /admin: nada no fluxo público chama isto.
export function rotuloEtiqueta(etiqueta) {
  if (!etiqueta) return "";
  return etiqueta.emoji ? `${etiqueta.emoji} ${etiqueta.nome}` : etiqueta.nome;
}

// Badge somente-leitura, sem popover. Exportado à parte porque nem todo ponto
// de exibição tem um cliente gravável por trás (ver `clienteId` abaixo).
export function BadgeEtiqueta({ etiqueta }) {
  if (!etiqueta) return null;
  return <span className={CLASSE_BADGE}>{rotuloEtiqueta(etiqueta)}</span>;
}

// Popover pequeno pra ver/trocar a etiqueta de UM cliente, reaproveitado em
// todos os pontos do /admin que mostram um cliente (inbox de Pendentes,
// bandeja do grupo, dropdown da busca por nome, linha "Agendando para X",
// card e ficha da aba Clientes). Grava direto em `clientes.etiqueta_id`.
//
// O gatilho é o próprio badge: com etiqueta mostra o selo violeta, sem
// etiqueta mostra o chip âmbar "Sem etiqueta". Clicar abre a lista das
// etiquetas ATIVAS do salão (carregada só na primeira abertura, pra que N
// badges numa tela não virem N queries no load).
//
// Posicionamento FIXO, calculado a partir do rect do gatilho: vários dos
// pontos de uso ficam dentro de containers com `overflow-hidden` (a bandeja
// de grupo do inbox, o dropdown da busca por nome), onde um popover
// `absolute` seria recortado. Rolagem ou resize fecham o popover em vez de
// tentar reposicioná-lo em tempo real.
//
// Props:
//   estabelecimentoId  – particiona a lista de etiquetas do popover.
//   clienteId          – linha de `clientes` que recebe o update. null =
//                        não há cliente cadastrado por trás deste ponto (ex.:
//                        um agendamento cujo telefone não casa com nenhuma
//                        linha de `clientes`): o componente vira somente-
//                        leitura — mostra o badge se houver etiqueta, e nada
//                        se não houver. Nunca oferece um chip que não teria
//                        onde gravar.
//   etiqueta           – { nome, emoji } atual, ou null.
//   onEtiquetaAlterada – recebe a etiqueta nova ({ id, nome, emoji }) ou null
//                        (ao remover), DEPOIS do update ter confirmado linha.
//                        Quem monta patcha o próprio state com isso — este
//                        componente não guarda cópia do valor exibido.
//   abrirAgora         – abre o popover de fora, sem passar pelo clique no
//                        badge. Serve ao gate de etiqueta do inbox de
//                        Pendentes (ver page.js): a dona escolhe "Definir
//                        etiqueta" no modal e o popover deste cliente abre
//                        sozinho. Somado ao estado interno, nunca o
//                        substitui — o popover fica aberto se QUALQUER um dos
//                        dois pedir.
//   onFechar           – avisa que o popover fechou (clique fora, Esc,
//                        rolagem, escolha feita). Quem usa `abrirAgora`
//                        precisa disto pra baixar a própria flag: sem isso ela
//                        continuaria true e o popover reabriria na hora.
export default function SeletorEtiquetaRapido({
  estabelecimentoId,
  clienteId,
  etiqueta,
  onEtiquetaAlterada,
  abrirAgora = false,
  onFechar,
}) {
  // Aberto = pedido interno (clique no badge) OU externo (`abrirAgora`).
  // Derivado em vez de sincronizado por efeito de propósito: um efeito que
  // copiasse `abrirAgora` pro state renderizaria duas vezes e ainda precisaria
  // de guarda pra não reabrir o que o usuário acabou de fechar.
  const [abertoInterno, setAbertoInterno] = useState(false);
  const aberto = abertoInterno || abrirAgora;
  const [etiquetas, setEtiquetas] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [posicao, setPosicao] = useState(null);

  const gatilhoRef = useRef(null);
  const popoverRef = useRef(null);
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // Fechar precisa baixar as DUAS fontes: o state local e, via callback, a
  // flag externa de quem passou `abrirAgora`. Todo caminho de fechamento
  // (clique fora, Esc, rolagem, escolha gravada) passa por aqui.
  //
  // useCallback porque os listeners de document/window abaixo dependem desta
  // função: recriada a cada render, o efeito registraria uma versão e o
  // cleanup tentaria remover outra — os listeners iam se acumulando, e o
  // `onFechar` chamado seria o de um render antigo.
  const fechar = useCallback(() => {
    setAbertoInterno(false);
    onFechar?.();
  }, [onFechar]);

  function alternar() {
    if (aberto) fechar();
    else setAbertoInterno(true);
  }

  // Carrega a lista na PRIMEIRA abertura e mantém em cache no state — abrir e
  // fechar de novo não repete a query. `etiquetas === null` é "nunca
  // carregada"; [] é "carregada e vazia" (salão sem etiqueta cadastrada).
  useEffect(() => {
    if (!aberto || etiquetas !== null) return;

    let ativo = true;
    setCarregando(true);
    buscarEtiquetasAtivas(estabelecimentoId).then((lista) => {
      if (!ativo) return;
      setEtiquetas(lista);
      setCarregando(false);
    });

    return () => {
      ativo = false;
    };
  }, [aberto, etiquetas, estabelecimentoId]);

  // Ancoragem: mede o gatilho ANTES da pintura (useLayoutEffect) pra o
  // popover não aparecer um frame no canto da tela. Alinhado pela direita do
  // gatilho, com um recuo mínimo da borda da janela pra não vazar no mobile.
  useLayoutEffect(() => {
    if (!aberto || !gatilhoRef.current) return;
    const rect = gatilhoRef.current.getBoundingClientRect();
    const LARGURA = 208;
    const MARGEM = 8;
    const esquerda = Math.min(
      Math.max(MARGEM, rect.right - LARGURA),
      window.innerWidth - LARGURA - MARGEM
    );
    setPosicao({ topo: rect.bottom + 4, esquerda, largura: LARGURA });
  }, [aberto]);

  // Fecha por clique fora, Esc, rolagem e resize. A rolagem entra na lista
  // porque a posição é medida uma vez só (ver acima): deixar o popover aberto
  // durante o scroll o descolaria do badge. `true` na fase de captura pega
  // também a rolagem de containers internos, que não borbulha.
  useEffect(() => {
    if (!aberto) return;

    function fecharSeForaClique(e) {
      if (popoverRef.current?.contains(e.target)) return;
      if (gatilhoRef.current?.contains(e.target)) return;
      fechar();
    }
    function fecharNoEsc(e) {
      if (e.key === "Escape") fechar();
    }
    function fecharDireto() {
      fechar();
    }

    document.addEventListener("mousedown", fecharSeForaClique);
    document.addEventListener("keydown", fecharNoEsc);
    window.addEventListener("scroll", fecharDireto, true);
    window.addEventListener("resize", fecharDireto);
    return () => {
      document.removeEventListener("mousedown", fecharSeForaClique);
      document.removeEventListener("keydown", fecharNoEsc);
      window.removeEventListener("scroll", fecharDireto, true);
      window.removeEventListener("resize", fecharDireto);
    };
  }, [aberto, fechar]);

  // Grava a escolha. `nova` = a etiqueta escolhida, ou null pra remover.
  // .select("id") + checagem de linhas: sem isso um update filtrado pelo RLS
  // volta com error null e 0 linhas, e a tela mostraria a etiqueta nova em
  // cima de um banco que não gravou nada (mesmo padrão dos outros pontos de
  // escrita do painel).
  async function escolher(nova) {
    if (salvando) return;
    setSalvando(true);
    setErro("");

    const { data: linhas, error } = await supabase
      .from("clientes")
      .update({ etiqueta_id: nova?.id ?? null })
      .eq("id", clienteId)
      .select("id");

    if (!montadoRef.current) return;
    setSalvando(false);

    if (error || !linhas?.length) {
      setErro(mensagemFalhaSalvar(error));
      return;
    }

    onEtiquetaAlterada?.(nova ?? null);
    fechar();
  }

  // Sem cliente gravável por trás: vira somente-leitura (ver `clienteId`).
  if (!clienteId) return <BadgeEtiqueta etiqueta={etiqueta} />;

  return (
    <>
      <button
        ref={gatilhoRef}
        type="button"
        onClick={(e) => {
          // O gatilho nunca é filho de outro <button> (isso seria HTML
          // inválido e quebra a hidratação) — nos pontos onde o card inteiro
          // era clicável, o botão do card virou IRMÃO deste, ver
          // GerenciarClientes.js e IdentificacaoClienteAdmin.js. O
          // stopPropagation continua aqui porque irmão ou não, o clique ainda
          // borbulha pro container, que em alguns pontos tem onClick próprio.
          e.stopPropagation();
          e.preventDefault();
          setErro("");
          alternar();
        }}
        aria-haspopup="menu"
        aria-expanded={aberto}
        title={etiqueta ? `Etiqueta: ${rotuloEtiqueta(etiqueta)}` : "Definir etiqueta"}
        className={`${etiqueta ? CLASSE_BADGE : CLASSE_CHIP_VAZIO} shrink-0 transition hover:brightness-95`}
      >
        {etiqueta ? rotuloEtiqueta(etiqueta) : "Sem etiqueta"}
      </button>

      {aberto && posicao && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="Escolher etiqueta"
          style={{ top: posicao.topo, left: posicao.esquerda, width: posicao.largura }}
          className="fixed z-50 overflow-hidden rounded-xl bg-card shadow-lg ring-1 ring-border"
          // O popover é filho visual de cards/botões clicáveis (ver o
          // stopPropagation do gatilho): sem isto, clicar numa opção também
          // acionaria o container por trás.
          onClick={(e) => e.stopPropagation()}
        >
          {carregando && (
            <p className="px-3 py-2 text-xs text-body">Carregando etiquetas...</p>
          )}

          {!carregando && etiquetas?.length === 0 && (
            <p className="px-3 py-2 text-xs text-body">
              Nenhuma etiqueta ativa. Crie uma no bloco &quot;Etiquetas&quot; da aba
              Clientes.
            </p>
          )}

          {!carregando &&
            (etiquetas ?? []).map((item) => {
              const atual = item.id === etiqueta?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => escolher(item)}
                  disabled={salvando}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 ${
                    atual ? "bg-surface font-medium text-heading" : "text-body"
                  }`}
                >
                  <span className="min-w-0 truncate">{rotuloEtiqueta(item)}</span>
                  {atual && <span className="ml-auto shrink-0 text-xs text-body">atual</span>}
                </button>
              );
            })}

          {/* Só faz sentido oferecer "remover" pra quem tem etiqueta. */}
          {!carregando && etiqueta && (
            <button
              type="button"
              role="menuitem"
              onClick={() => escolher(null)}
              disabled={salvando}
              className="w-full border-t border-border px-3 py-2 text-left text-sm text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Remover etiqueta
            </button>
          )}

          {erro && (
            <p className="border-t border-border bg-red-50 px-3 py-2 text-xs text-red-700">
              Não foi possível salvar: {erro}
            </p>
          )}
        </div>
      )}
    </>
  );
}
