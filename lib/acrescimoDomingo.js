// Parte PURA do "Domingo com acréscimo" das liberações de horário (aba
// Exceções de Horário). Fica fora do componente pra ser testável sem React.

// "YYYY-MM-DD" cai num domingo? Date por partes (nunca new Date("YYYY-MM-DD"),
// que é UTC e pode voltar um dia em GMT-3).
export function ehDomingoISO(iso) {
  if (!iso) return false;
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia).getDay() === 0;
}

// Conjunto de dias da semana (0–6) que a liberação por período usa. No modo
// "Vários domingos num período" só existem domingos; nos demais valem os dias
// escolhidos. coletarLinhas e o resumo ao vivo usam esta MESMA função, pra
// nunca divergirem.
export function diasDoPeriodoDeLiberacao(soDomingos, diasEscolhidos) {
  return soDomingos ? new Set([0]) : new Set(diasEscolhidos);
}

const hhmm = (h) => String(h ?? "").slice(0, 5);

function diaSemanaISO(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia).getDay();
}

function ddmm(iso) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

// Primeira data de ini..fim (ISO, inclusive) que cai em `dow`, ou null.
function primeiraDataNoDia(ini, fim, dow) {
  const [ano, mes, dia] = ini.split("-").map(Number);
  for (let i = 0; i < 7; i++) {
    const d = new Date(ano, mes - 1, dia + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (iso > fim) return null;
    if (d.getDay() === dow) return iso;
  }
  return null;
}

// A liberação existente `e` cobre a nova `n` (mesmo horário e data que casa)?
// Devolve { data } (data da cobertura, null se só há recorrência) ou null.
// Linha 'periodo' vale pelo intervalo data_inicio..data_fim (data_fim nulo =
// data_inicio), como o motor (lib/disponibilidade.js); `hoje` é
// "YYYY-MM-DD" e intervalo já encerrado não conta.
function cobre(e, n, hoje) {
  if ((e.tipo_registro ?? "ausencia") !== "liberacao") return null;
  if (hhmm(e.hora_inicio) !== hhmm(n.hora_inicio)) return null;
  const fimE = e.data_fim ?? e.data_inicio;
  if (e.tipo === "periodo" && fimE < hoje) return null;

  if (n.tipo === "recorrente") {
    if (e.tipo === "recorrente") return e.dia_semana === n.dia_semana ? { data: null } : null;
    if (e.tipo !== "periodo") return null;
    const ini = e.data_inicio < hoje ? hoje : e.data_inicio;
    const data = primeiraDataNoDia(ini, fimE, n.dia_semana);
    return data ? { data } : null;
  }
  if (n.tipo !== "periodo" || !n.data_inicio) return null;
  if (e.tipo === "periodo") {
    return e.data_inicio <= n.data_inicio && n.data_inicio <= fimE ? { data: n.data_inicio } : null;
  }
  if (e.tipo === "recorrente" && e.dia_semana === diaSemanaISO(n.data_inicio)) {
    return { data: n.data_inicio };
  }
  return null;
}

// PURA. Procura a primeira liberação nova que repete horário já liberado de
// um jeito que anula ou duplica o acréscimo de domingo (o motor faz o
// acréscimo sumir quando uma liberação sem marca cobre o mesmo horário).
// Sem marca x sem marca NÃO é conflito. Devolve null ou
// { tipo, data, hora, mensagem }. Também compara as novas entre si.
export function conflitoDeHorario(novas, existentes, hoje) {
  const marcada = (a) => a.acrescimo_domingo === true;

  function avaliar(n, e) {
    if (!marcada(n) && !marcada(e)) return null;
    const cob = cobre(e, n, hoje);
    if (!cob) return null;

    const hora = hhmm(n.hora_inicio);
    const data = cob.data;
    const quando = data ? `Em ${ddmm(data)} às ${hora}` : `Todo domingo às ${hora}`;

    if (marcada(n) && !marcada(e)) {
      return {
        tipo: "sem_marca",
        data,
        hora,
        mensagem: `${quando} já existe uma liberação sem acréscimo. Exclua essa liberação antes, senão o acréscimo não vale.`,
      };
    }
    if (!marcada(n)) {
      return {
        tipo: "com_marca",
        data,
        hora,
        mensagem: `${quando} já existe um domingo com acréscimo. Exclua o acréscimo antes de liberar este horário.`,
      };
    }
    if (e.tipo === "recorrente") {
      return {
        tipo: "marcada_recorrente",
        data,
        hora,
        mensagem: `Todos os domingos já estão liberados com acréscimo às ${hora}.`,
      };
    }
    return {
      tipo: "marcada_data",
      data,
      hora,
      mensagem: `${quando} já existe um domingo com acréscimo.`,
    };
  }

  const lista = existentes ?? [];
  for (let i = 0; i < novas.length; i++) {
    for (const e of lista) {
      const c = avaliar(novas[i], e);
      if (c) return c;
    }
    for (let j = 0; j < i; j++) {
      const c = avaliar(novas[i], { ...novas[j], tipo_registro: "liberacao" });
      if (c) return c;
    }
  }
  return null;
}
