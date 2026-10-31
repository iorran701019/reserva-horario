// Tipos de profissional do lead no CRM (leads.tipo_profissional guarda o id).
// Texto no banco, sem CHECK: acrescentar um tipo é só incluir uma linha aqui.
// Valor desconhecido (legado ou tipo removido) continua visível como texto cru.
// Sem imports de propósito: este arquivo roda em node --test.

export const TIPOS_PROFISSIONAL = [
  { id: "manicure", rotulo: "Manicure" },
  { id: "nail_designer", rotulo: "Nail Designer" },
  { id: "maquiadora", rotulo: "Maquiadora" },
  { id: "cabeleireira", rotulo: "Cabeleireira" },
];

export function tipoConhecido(valor) {
  return TIPOS_PROFISSIONAL.some((t) => t.id === valor);
}

export function rotuloTipoProfissional(valor) {
  if (valor == null || valor === "") return "";
  return TIPOS_PROFISSIONAL.find((t) => t.id === valor)?.rotulo ?? String(valor);
}
