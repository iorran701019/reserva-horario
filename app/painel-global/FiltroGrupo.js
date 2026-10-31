"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  FILTRO_PADRAO,
  GRUPOS,
  ROTULO_SEM_GRUPO,
  SEM_GRUPO,
  TODOS,
  buscarGruposSaloes,
  contarPorGrupo,
  filtrarSaloesPorGrupo,
  grupoDoSalao,
  rotuloGrupo,
  salvarGrupoSalao,
} from "@/lib/gruposSaloes";
import MenuSuspenso from "./MenuSuspenso";

// Grupos de salões no painel global (ver lib/gruposSaloes.js). Compartilhado
// por Financeiro e Segurança: o hook busca os grupos no navegador, o seletor
// filtra e o selo mostra o grupo de cada linha. Grupo é só rótulo.
//
// Falha ao carregar os grupos: o filtro efetivo vira "todos" (nenhum salão
// escondido) e o seletor dá lugar a um aviso.
export function useGruposSaloes(saloes) {
  const [mapa, setMapa] = useState(new Map());
  const [pronto, setPronto] = useState(false);
  const [erroGrupos, setErroGrupos] = useState(false);
  const [filtro, setFiltro] = useState(FILTRO_PADRAO);

  useEffect(() => {
    let vivo = true;
    buscarGruposSaloes(supabase).then(({ mapa: m, erro }) => {
      if (!vivo) return;
      setMapa(m);
      setErroGrupos(Boolean(erro));
      setPronto(true);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Reflete uma troca de grupo na lista sem recarregar.
  const aplicarGrupo = useCallback((id, grupo) => {
    setMapa((atual) => {
      const novo = new Map(atual);
      if (grupo === SEM_GRUPO) novo.delete(id);
      else novo.set(id, grupo);
      return novo;
    });
  }, []);

  const filtroEfetivo = erroGrupos || !pronto ? TODOS : filtro;
  const lista = useMemo(() => saloes ?? [], [saloes]);
  const visiveis = useMemo(
    () => filtrarSaloesPorGrupo(lista, mapa, filtroEfetivo),
    [lista, mapa, filtroEfetivo]
  );
  const contagem = useMemo(() => contarPorGrupo(lista, mapa), [lista, mapa]);

  return { mapa, pronto, erroGrupos, filtro: filtroEfetivo, setFiltro, aplicarGrupo, visiveis, contagem };
}

export function SeloGrupo({ mapa, estabelecimentoId }) {
  const grupo = grupoDoSalao(mapa, estabelecimentoId);
  return (
    <span className="shrink-0 rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold text-heading ring-1 ring-border">
      {rotuloGrupo(grupo)}
    </span>
  );
}

export function FiltroGrupo({ grupos }) {
  const { erroGrupos, filtro, setFiltro, contagem } = grupos;

  if (erroGrupos) {
    return <p className="mb-3 text-xs text-muted">Não consegui carregar os grupos</p>;
  }

  const opcoes = [
    ...GRUPOS.map((g) => ({ id: g.id, rotulo: g.rotulo })),
    { id: SEM_GRUPO, rotulo: ROTULO_SEM_GRUPO },
    { id: TODOS, rotulo: "Todos" },
  ].map((o) => ({
    id: o.id,
    rotulo: `${o.rotulo} (${contagem[o.id]})`,
    ativo: filtro === o.id,
    onSelecionar: () => setFiltro(o.id),
  }));
  const atual = opcoes.find((o) => o.ativo);
  const semGrupoEscondidos = contagem[SEM_GRUPO] > 0 && filtro !== TODOS && filtro !== SEM_GRUPO;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="w-56">
        <MenuSuspenso rotulo={`Grupo: ${atual.rotulo}`} itens={opcoes} />
      </div>
      {semGrupoEscondidos && (
        <p className="text-xs text-muted">
          {contagem[SEM_GRUPO]} {contagem[SEM_GRUPO] === 1 ? "salão sem grupo" : "salões sem grupo"}{" "}
          <button
            type="button"
            onClick={() => setFiltro(SEM_GRUPO)}
            className="font-semibold text-heading underline"
          >
            Ver
          </button>
        </p>
      )}
    </div>
  );
}

// Campo "Grupo" do detalhe de um salão: salva ao escolher, com feedback local.
export function SeletorGrupoSalao({ salao, grupos }) {
  const { mapa, erroGrupos, aplicarGrupo } = grupos;
  const [estado, setEstado] = useState(null); // "salvando" | "salvo" | "erro"
  const atual = grupoDoSalao(mapa, salao.id);

  async function trocar(e) {
    const novo = e.target.value;
    if (novo === atual) return;
    setEstado("salvando");
    const { gravou } = await salvarGrupoSalao(supabase, salao.id, novo);
    if (!gravou) {
      setEstado("erro");
      return;
    }
    aplicarGrupo(salao.id, novo);
    setEstado("salvo");
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <label htmlFor={`grupo-${salao.id}`} className="text-sm font-semibold text-heading">
        Grupo
      </label>
      <select
        id={`grupo-${salao.id}`}
        value={atual}
        onChange={trocar}
        disabled={estado === "salvando" || erroGrupos}
        className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-heading shadow-sm ring-1 ring-border focus:outline-none focus:ring-2 disabled:opacity-60"
      >
        {GRUPOS.map((g) => (
          <option key={g.id} value={g.id}>
            {g.rotulo}
          </option>
        ))}
        <option value={SEM_GRUPO}>{ROTULO_SEM_GRUPO}</option>
      </select>
      {estado === "salvando" && <span className="text-xs text-muted">Salvando...</span>}
      {estado === "salvo" && <span className="text-xs text-body">Salvo ✓</span>}
      {estado === "erro" && (
        <span role="alert" className="text-xs text-red-700">
          Não foi possível salvar o grupo.
        </span>
      )}
      {erroGrupos && <span className="text-xs text-muted">Grupos indisponíveis.</span>}
    </div>
  );
}
