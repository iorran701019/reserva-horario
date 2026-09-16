"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { chaveCidade } from "@/lib/crm";
import { CLASSE_INPUT } from "./ui";

// A lista de `cidades` é fixa e pequena (~92 linhas): uma query por sessão,
// compartilhada entre os modais. Falha limpa o cache pra próxima abertura
// tentar de novo.
let cacheCidades = null;

function carregarCidades() {
  if (!cacheCidades) {
    cacheCidades = supabase
      .from("cidades")
      .select("nome")
      .order("nome")
      .then(({ data, error }) => {
        if (error) {
          cacheCidades = null;
          throw error;
        }
        return data.map((c) => c.nome);
      });
  }
  return cacheCidades;
}

// "Cidade" do lead: busca na lista fechada de `cidades` e grava o nome
// canônico em leads.cidade. Sem texto livre — o que for digitado e não virar
// uma escolha da lista é descartado, e o campo fica vazio (é opcional).
// Comparação via chaveCidade: acento, maiúscula e espaço sobrando não importam.
//
// Lead antigo com valor fora da lista ("VR", "Teste") aparece como está, com
// aviso; só muda se alguém trocar. Usado no ModalNovoLead e no DetalheLead.
export default function SeletorCidade({ valor, onChange }) {
  const [cidades, setCidades] = useState([]);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [destaque, setDestaque] = useState(0);

  useEffect(() => {
    let ativo = true;
    carregarCidades()
      .then((nomes) => ativo && setCidades(nomes))
      .catch((e) => ativo && setErro(`Não foi possível carregar as cidades: ${e.message}`));
    return () => {
      ativo = false;
    };
  }, []);

  const termo = chaveCidade(busca);
  const sugestoes = termo ? cidades.filter((nome) => chaveCidade(nome).includes(termo)).slice(0, 8) : [];
  const foraDaLista = valor && cidades.length > 0 && !cidades.includes(valor);

  function escolher(nome) {
    onChange(nome);
    setBusca("");
    setDestaque(0);
  }

  // Enter escolhe a sugestão destacada em vez de enviar o form; setas movem.
  function teclar(e) {
    if (!sugestoes.length) {
      if (e.key === "Enter") e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDestaque((i) => Math.min(i + 1, sugestoes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDestaque((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      escolher(sugestoes[Math.min(destaque, sugestoes.length - 1)]);
    } else if (e.key === "Escape") {
      setBusca("");
    }
  }

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-body">Cidade</span>
      {valor ? (
        <div className="flex flex-wrap items-center gap-x-2 py-2 text-sm text-heading">
          {valor}
          {foraDaLista && <span className="text-xs text-muted">(fora da lista)</span>}
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs font-semibold text-red-600 hover:underline"
          >
            trocar
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setDestaque(0);
            }}
            onKeyDown={teclar}
            placeholder="Buscar cidade (opcional)"
            className={CLASSE_INPUT}
          />
          {termo && !erro && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg bg-card shadow-lg ring-1 ring-border">
              {sugestoes.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted">Nenhuma cidade encontrada</li>
              ) : (
                sugestoes.map((nome, i) => (
                  <li key={nome}>
                    <button
                      type="button"
                      onClick={() => escolher(nome)}
                      onMouseEnter={() => setDestaque(i)}
                      className={`block w-full px-3 py-2 text-left text-sm text-heading ${
                        i === destaque ? "bg-surface" : ""
                      }`}
                    >
                      {nome}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
      {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
    </div>
  );
}
