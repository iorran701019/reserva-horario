import { vi } from "vitest";

// Query builder falso do supabase-js: todo método encadeável devolve o próprio
// objeto e `await` entrega o resultado. `resultados` pode ser um único
// { data, error } ou um mapa por operação ({ select, insert, update, delete });
// select depois de insert/update/delete mantém a operação (é o padrão
// `.insert(...).select(...)` do app).
const OPERACOES = ["select", "insert", "update", "delete"];

export function consulta(resultados) {
  const porOperacao = Boolean(resultados) && OPERACOES.some((op) => op in resultados);
  let operacao = "select";
  const q = {};
  for (const metodo of ["eq", "neq", "in", "order", "limit", "maybeSingle", "single"]) {
    q[metodo] = vi.fn(() => q);
  }
  q.select = vi.fn(() => q);
  for (const op of ["insert", "update", "delete"]) {
    q[op] = vi.fn(() => {
      operacao = op;
      return q;
    });
  }
  q.then = (resolve, reject) =>
    Promise.resolve(porOperacao ? resultados[operacao] : resultados).then(resolve, reject);
  return q;
}

// `tabelas`: { nome_da_tabela: resultados }. `consultas` guarda cada query
// criada, pra os testes inspecionarem filtros e ordenação.
export function supabaseFalso(tabelas, rpc) {
  const consultas = [];
  return {
    from: vi.fn((tabela) => {
      const q = consulta(tabelas[tabela]);
      consultas.push({ tabela, q });
      return q;
    }),
    rpc: rpc ?? vi.fn(),
    consultas,
  };
}
