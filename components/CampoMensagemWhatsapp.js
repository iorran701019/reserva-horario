"use client";

import { useEffect, useRef, useState } from "react";

// Textarea com autocomplete de variáveis via "/": ao digitar "/", abre um menu
// flutuante logo abaixo do cursor listando variaveisDisponiveis (formatadas
// como {variavel}); continuar digitando filtra a lista pelo texto após a
// barra. Selecionar uma opção (clique, ou Enter/setas pelo teclado) substitui
// "/" + o texto filtrado pela variável escolhida, no formato {variavel}.
//
// Componente controlado e isolado — não faz nenhuma chamada a banco.
//
// Props:
//   value                – texto atual do textarea.
//   onChange              – recebe o novo texto (string) a cada alteração.
//   variaveisDisponiveis  – array de strings (ex.: "nome_cliente") oferecidas
//                           no menu. Vazio desativa o gatilho "/".
export default function CampoMensagemWhatsapp({
  value,
  onChange,
  variaveisDisponiveis = [],
}) {
  const wrapperRef = useRef(null);
  const textareaRef = useRef(null);
  const cursorAlvoRef = useRef(null);

  const [menuAberto, setMenuAberto] = useState(false);
  const [gatilhoInicio, setGatilhoInicio] = useState(null);
  const [filtro, setFiltro] = useState("");
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [posicaoMenu, setPosicaoMenu] = useState({ top: 0, left: 0 });

  const opcoesFiltradas = variaveisDisponiveis.filter((variavel) =>
    variavel.toLowerCase().includes(filtro.toLowerCase())
  );

  // Aplica o reposicionamento do cursor depois que `value` (controlado pelo
  // pai) refletir a inserção da variável.
  useEffect(() => {
    if (cursorAlvoRef.current === null || !textareaRef.current) return;
    textareaRef.current.setSelectionRange(cursorAlvoRef.current, cursorAlvoRef.current);
    cursorAlvoRef.current = null;
  }, [value]);

  useEffect(() => {
    if (!menuAberto) return;

    function handleClickFora(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        fecharMenu();
      }
    }

    document.addEventListener("mousedown", handleClickFora);
    return () => document.removeEventListener("mousedown", handleClickFora);
  }, [menuAberto]);

  function fecharMenu() {
    setMenuAberto(false);
    setGatilhoInicio(null);
    setFiltro("");
    setIndiceAtivo(0);
  }

  function handleChange(e) {
    const novoValor = e.target.value;
    onChange(novoValor);

    if (variaveisDisponiveis.length === 0) return;

    const cursor = e.target.selectionStart;
    const textoAntes = novoValor.slice(0, cursor);
    const indiceBarra = textoAntes.lastIndexOf("/");

    if (indiceBarra === -1) {
      if (menuAberto) fecharMenu();
      return;
    }

    const textoAposBarra = textoAntes.slice(indiceBarra + 1);
    if (/\s/.test(textoAposBarra)) {
      if (menuAberto) fecharMenu();
      return;
    }

    setGatilhoInicio(indiceBarra);
    setFiltro(textoAposBarra);
    setIndiceAtivo(0);
    setPosicaoMenu(calcularPosicaoMenu(e.target, indiceBarra));
    setMenuAberto(true);
  }

  function handleKeyDown(e) {
    if (!menuAberto) return;

    if (e.key === "Escape") {
      e.preventDefault();
      fecharMenu();
      return;
    }

    if (opcoesFiltradas.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndiceAtivo((i) => (i + 1) % opcoesFiltradas.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndiceAtivo((i) => (i - 1 + opcoesFiltradas.length) % opcoesFiltradas.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selecionarVariavel(opcoesFiltradas[indiceAtivo]);
    }
  }

  function selecionarVariavel(variavel) {
    if (!variavel || gatilhoInicio === null) return;

    const fim = gatilhoInicio + 1 + filtro.length;
    const novoValor = `${value.slice(0, gatilhoInicio)}{${variavel}}${value.slice(fim)}`;

    cursorAlvoRef.current = gatilhoInicio + variavel.length + 2;
    onChange(novoValor);
    fecharMenu();
    textareaRef.current?.focus();
  }

  return (
    <div ref={wrapperRef} className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={5}
        placeholder="Digite a mensagem... use / para inserir uma variável"
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
      />

      {menuAberto && (
        <div
          className="absolute z-20 max-h-56 w-56 overflow-y-auto rounded-lg bg-card shadow-lg ring-1 ring-border"
          style={{ top: posicaoMenu.top, left: posicaoMenu.left }}
        >
          {opcoesFiltradas.length === 0 ? (
            <p className="px-3 py-2 text-sm text-body">Nenhuma variável encontrada.</p>
          ) : (
            opcoesFiltradas.map((variavel, indice) => (
              <button
                key={variavel}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selecionarVariavel(variavel)}
                onMouseEnter={() => setIndiceAtivo(indice)}
                className={`block w-full truncate px-3 py-2 text-left text-sm text-heading transition ${
                  indice === indiceAtivo ? "bg-surface" : "hover:bg-surface"
                }`}
              >
                {`{${variavel}}`}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Propriedades de estilo cujo valor precisa ser copiado do textarea real para
// o mock invisível — sem elas, a quebra de linha do texto espelhado não bate
// com a do textarea e a posição calculada do cursor fica errada.
const PROPRIEDADES_ESPELHADAS = [
  "boxSizing",
  "width",
  "height",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
];

// Calcula a posição (top/left, em px, relativa ao wrapper) logo abaixo do
// caractere na posição `indice` do textarea, usando um <div> invisível que
// espelha as propriedades de texto do textarea real.
function calcularPosicaoMenu(textarea, indice) {
  const espelho = document.createElement("div");
  const estilo = window.getComputedStyle(textarea);

  espelho.style.position = "absolute";
  espelho.style.visibility = "hidden";
  espelho.style.whiteSpace = "pre-wrap";
  espelho.style.wordWrap = "break-word";
  espelho.style.top = "0";
  espelho.style.left = "-9999px";

  PROPRIEDADES_ESPELHADAS.forEach((propriedade) => {
    espelho.style[propriedade] = estilo[propriedade];
  });

  document.body.appendChild(espelho);

  espelho.textContent = textarea.value.slice(0, indice);
  const marcador = document.createElement("span");
  marcador.textContent = textarea.value.slice(indice) || ".";
  espelho.appendChild(marcador);

  const alturaLinha =
    parseInt(estilo.lineHeight, 10) || parseInt(estilo.fontSize, 10) * 1.2;

  const posicao = {
    top:
      marcador.offsetTop +
      alturaLinha +
      parseInt(estilo.borderTopWidth, 10) -
      textarea.scrollTop,
    left:
      marcador.offsetLeft +
      parseInt(estilo.borderLeftWidth, 10) -
      textarea.scrollLeft,
  };

  document.body.removeChild(espelho);

  return posicao;
}
