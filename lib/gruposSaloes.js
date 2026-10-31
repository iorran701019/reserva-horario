// Grupo de organização dos salões no /painel-global (tabela
// estabelecimento_grupos, só papel global). É só um rótulo: não mexe em
// `ativo` nem bloqueia nada. Salão sem linha na tabela = "Sem grupo".
// Imports relativos de propósito: este arquivo roda em node --test.

export const GRUPOS = [
  { id: "producao", rotulo: "Produção" },
  { id: "desligamento", rotulo: "Em desligamento" },
  { id: "bloqueio_financeiro", rotulo: "Bloqueio financeiro" },
  { id: "teste_interno", rotulo: "Teste e interno" },
  { id: "inativo", rotulo: "Inativo" },
];

export const SEM_GRUPO = "sem_grupo";
export const TODOS = "todos";
export const ROTULO_SEM_GRUPO = "Sem grupo";
export const ROTULO_TODOS = "Todos";
export const FILTRO_PADRAO = "producao";

const IDS_GRUPOS = new Set(GRUPOS.map((g) => g.id));

export function grupoValido(grupo) {
  return IDS_GRUPOS.has(grupo);
}

export function rotuloGrupo(grupo) {
  if (grupo === TODOS) return ROTULO_TODOS;
  return GRUPOS.find((g) => g.id === grupo)?.rotulo ?? ROTULO_SEM_GRUPO;
}

// `mapa`: Map(estabelecimento_id -> grupo). Ausente (ou valor desconhecido) = sem_grupo.
export function grupoDoSalao(mapa, estabelecimentoId) {
  const grupo = mapa?.get(estabelecimentoId);
  return grupoValido(grupo) ? grupo : SEM_GRUPO;
}

// Sempre parte da lista de salões: quem não tem linha em `mapa` continua
// existindo (sem_grupo) e aparece em "todos".
export function filtrarSaloesPorGrupo(saloes, mapa, filtro) {
  if (filtro === TODOS) return saloes;
  return saloes.filter((s) => grupoDoSalao(mapa, s.id) === filtro);
}

// { todos, sem_grupo, producao, ... } — todos os grupos presentes, mesmo com 0.
export function contarPorGrupo(saloes, mapa) {
  const contagem = { [TODOS]: saloes.length, [SEM_GRUPO]: 0 };
  for (const g of GRUPOS) contagem[g.id] = 0;
  for (const s of saloes) contagem[grupoDoSalao(mapa, s.id)] += 1;
  return contagem;
}

export async function buscarGruposSaloes(supabase) {
  const { data, error } = await supabase
    .from("estabelecimento_grupos")
    .select("estabelecimento_id, grupo");
  if (error) return { mapa: new Map(), erro: error };
  return {
    mapa: new Map((data ?? []).map((l) => [l.estabelecimento_id, l.grupo])),
    erro: null,
  };
}

// Retorno: { gravou: boolean, erro }. 0 linhas afetadas é falha (RLS filtra em
// silêncio). Em delete, 0 linhas também conta como falha para o chamador:
// salão que já estava sem grupo nem chega aqui pela UI.
export async function salvarGrupoSalao(supabase, estabelecimentoId, grupo) {
  const consulta =
    grupo === SEM_GRUPO
      ? supabase
          .from("estabelecimento_grupos")
          .delete()
          .eq("estabelecimento_id", estabelecimentoId)
          .select("estabelecimento_id")
      : grupoValido(grupo)
        ? supabase
            .from("estabelecimento_grupos")
            .upsert(
              {
                estabelecimento_id: estabelecimentoId,
                grupo,
                atualizado_em: new Date().toISOString(),
              },
              { onConflict: "estabelecimento_id" }
            )
            .select("estabelecimento_id")
        : null;
  if (!consulta) return { gravou: false, erro: new Error("grupo inválido") };

  const { data, error } = await consulta;
  if (error || !data?.length) return { gravou: false, erro: error ?? null };
  return { gravou: true, erro: null };
}
