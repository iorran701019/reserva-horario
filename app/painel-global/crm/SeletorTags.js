"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  CORES_ETIQUETA,
  COR_ETIQUETA_PADRAO,
  classesBadgeEtiqueta,
} from "@/components/SeletorEtiquetaRapido";

// Multi-seleção de tags do CRM + criação de tag nova ali mesmo. `tags.cor`
// guarda a MESMA chave de paleta das etiquetas de cliente (CORES_ETIQUETA),
// pra reaproveitar os badges estáticos (purge do Tailwind).
//
// Não grava vínculo nenhum: quem consome decide o que fazer com onToggle
// (estado local no cadastro, insert/delete imediato no detalhe).
export default function SeletorTags({ tags, selecionadas, onToggle, onCriada }) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(COR_ETIQUETA_PADRAO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function criar() {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) return;
    setSalvando(true);
    setErro("");
    const { data, error } = await supabase
      .from("tags")
      .insert({ nome: nomeLimpo, cor })
      .select("id, nome, cor")
      .single();
    setSalvando(false);
    if (error) {
      setErro(error.code === "23505" ? "Já existe uma tag com esse nome." : error.message);
      return;
    }
    onCriada(data);
    onToggle(data.id);
    setNome("");
    setCriando(false);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const ativa = selecionadas.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onToggle(tag.id)}
              className={`${classesBadgeEtiqueta(tag.cor)} transition ${
                ativa ? "" : "opacity-40 hover:opacity-70"
              }`}
              aria-pressed={ativa}
            >
              {ativa ? "✓ " : ""}
              {tag.nome}
            </button>
          );
        })}
        {!criando && (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="rounded-full px-2.5 py-0.5 text-xs font-medium text-body ring-1 ring-border hover:text-heading"
          >
            + nova tag
          </button>
        )}
      </div>

      {criando && (
        <div className="mt-2 space-y-2 rounded-lg bg-surface p-2 ring-1 ring-border">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome da tag"
            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-heading outline-none focus:border-primary"
          />
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CORES_ETIQUETA).map(([chave, { rotulo, swatch }]) => (
              <button
                key={chave}
                type="button"
                title={rotulo}
                aria-label={rotulo}
                onClick={() => setCor(chave)}
                className={`h-6 w-6 rounded-full ${swatch} ${
                  cor === chave ? "ring-2 ring-heading ring-offset-2" : ""
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={criar}
              disabled={salvando || !nome.trim()}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {salvando ? "Criando..." : "Criar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCriando(false);
                setErro("");
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-body ring-1 ring-border"
            >
              Cancelar
            </button>
          </div>
          {erro && <p className="text-xs text-red-700">{erro}</p>}
        </div>
      )}
    </div>
  );
}
