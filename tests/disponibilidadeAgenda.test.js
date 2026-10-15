import { beforeEach, describe, expect, it, vi } from "vitest";

// Motor de horários (lib/disponibilidade.js) contra o gabarito medido no banco,
// pra agenda em modo janela com serviço agregado.
//
// Como foi feito: calcularVagasPorHorario depende do supabase, então
// @/lib/supabaseClient é mockado com um banco falso EM MEMÓRIA (abaixo). Ele
// responde por tabela e aplica `.eq`/`.neq` na view `slots_ocupados` — assim a
// consulta por data (`.eq("data", ...)`) é exercida de verdade, o que o helper
// tests/helpers/consulta.js não faz (ele ignora os filtros). montarMapaDoDia
// não é exportada; ela é exercida por dentro de calcularVagasPorHorario.
//
// Gabarito do banco (já medido, NÃO reproduzido aqui — não há banco nos testes):
//   X às 10:00, serviço 30 + agregado 45 = 75 min, termina 11:15; reserva às
//   11:14 é recusada, às 11:15 é aceita; cancelada não bloqueia; teto 720;
//   22:00 + 330 min ocupa até 03:30 do dia seguinte (01:00 recusa, 04:00 aceita).

const banco = vi.hoisted(() => ({ tabelas: {}, consultasOcupados: [] }));

vi.mock("@/lib/supabaseClient", () => {
  function construtor(tabela) {
    const filtros = [];
    let unico = false;
    const q = {
      select: () => q,
      eq: (coluna, valor) => (filtros.push({ op: "eq", coluna, valor }), q),
      neq: (coluna, valor) => (filtros.push({ op: "neq", coluna, valor }), q),
      in: () => q,
      single: () => ((unico = true), q),
      then(resolve, reject) {
        let dados = banco.tabelas[tabela] ?? [];
        if (tabela === "slots_ocupados") {
          banco.consultasOcupados.push(filtros.map((f) => ({ ...f })));
          dados = dados.filter((linha) =>
            filtros.every((f) =>
              f.op === "eq" ? linha[f.coluna] === f.valor : linha[f.coluna] !== f.valor
            )
          );
        }
        if (unico) dados = Array.isArray(dados) ? dados[0] : dados;
        return Promise.resolve({ data: dados, error: null }).then(resolve, reject);
      },
    };
    return q;
  }
  return { supabase: { from: (tabela) => construtor(tabela) } };
});

const { calcularVagasPorHorario } = await import("@/lib/disponibilidade");
const { somarTempo, agregadoSomaTempo, DURACAO_MAXIMA_MIN, DURACAO_MINIMA_MIN } = await import(
  "@/lib/servicoAgregado"
);

// 2026-03-02 é segunda-feira (dia_semana 1); 2026-03-03, terça (dia_semana 2).
const SEGUNDA = "2026-03-02";
const TERCA = "2026-03-03";
const PROF = 7;

// Cenário padrão: um profissional em modo janela, 00:00-23:59 não é aceito por
// gerarSlotsDaJanela como "fim" útil, então a janela vai de 08:00 a 20:00 (e
// uma variante madrugada nos testes de meia-noite).
function montar({
  granularidade = 15,
  modo = "janela",
  janela = { hora_inicio: "08:00:00", hora_fim: "20:00:00" },
  reservas = [],
  fixos = [],
} = {}) {
  banco.consultasOcupados.length = 0;
  banco.tabelas = {
    estabelecimentos: { granularidade_min: granularidade },
    // Mês sem registro é FECHADO (mesAgendavel): março/2026 precisa estar aberto.
    janela_agendamento_meses: [{ id: 1, ano: 2026, mes: 3, status: "aberto" }],
    restricoes_agenda: [],
    servicos: { duracao_min: 30 },
    servico_profissional: [
      {
        profissional_id: PROF,
        profissionais: { ativo: true, estabelecimento_id: 1, modo_horario: modo },
      },
    ],
    horarios_trabalho: [1, 2].map((dia) => ({
      profissional_id: PROF,
      dia_semana: dia,
      almoco_inicio: null,
      almoco_fim: null,
      ...janela,
    })),
    horarios_fixos: fixos.map((horario) => ({ profissional_id: PROF, dia_semana: 1, horario })),
    ausencias: [],
    slots_ocupados: reservas,
  };
}

// Reserva ATIVA como a view `slots_ocupados` a entrega ao motor.
function reserva(data, horario, duracao_min, extra = {}) {
  return { estabelecimento_id: 1, data, profissional_id: PROF, horario, duracao_min, ...extra };
}

async function vagas(duracaoMinOverride, data = SEGUNDA) {
  const mapa = await calcularVagasPorHorario({
    estabelecimentoId: 1,
    servicoId: 10,
    data,
    duracaoMinOverride,
  });
  return Object.keys(mapa).sort();
}

const entre = (lista, de, ate) => lista.filter((h) => h >= de && h <= ate);

describe("agenda em janela: reserva X às 10:00 (30 + agregado 45 = 75 min)", () => {
  const duracaoX = somarTempo({ duracaoServico: 30, tempoAgregado: 45, somaTempo: true });

  beforeEach(() => {
    montar({ reservas: [reserva(SEGUNDA, "10:00:00", duracaoX)] });
  });

  it("a duração efetiva da reserva é 75", () => {
    expect(duracaoX).toBe(75);
  });

  // 1. Candidatos de 15 min: 10:00 a 11:00 somem, 09:45 (encosta no início) e
  // 11:15 (encosta no fim) aparecem.
  it("granularidade 15: some de 10:00 a 11:00 (inclusive) e 11:15 aparece", async () => {
    const lista = await vagas(15);
    for (const h of ["10:00", "10:15", "10:30", "10:45", "11:00"]) {
      expect(lista).not.toContain(h);
    }
    expect(lista).toContain("09:45");
    expect(lista).toContain("11:15");
  });

  it("granularidade 30: o primeiro candidato livre depois de X é 11:30", async () => {
    montar({ granularidade: 30, reservas: [reserva(SEGUNDA, "10:00:00", duracaoX)] });
    const lista = await vagas(15);
    expect(entre(lista, "10:00", "11:29")).toEqual([]);
    expect(lista.find((h) => h >= "10:00")).toBe("11:30");
  });

  // 2. A duração do candidato também entra (modelo de intervalos [inicio, fim)).
  it("candidato de 75 min: 09:00 invade X, 08:45 cabe até 10:00 exato", async () => {
    const lista = await vagas(75);
    expect(lista).not.toContain("09:00");
    expect(lista).not.toContain("09:15");
    expect(lista).not.toContain("08:50");
    expect(lista).toContain("08:45");
    // Depois do fim de X o candidato de 75 volta a caber.
    expect(lista).toContain("11:15");
    expect(lista).not.toContain("11:00");
  });
});

// 3. Cancelada não bloqueia.
describe("reserva cancelada", () => {
  // O motor NÃO filtra status: ele lê a view `slots_ocupados` (que só entrega
  // reservas ativas) e seleciona apenas profissional_id/horario/duracao_min.
  // Então "cancelada não bloqueia" aqui prova a metade do motor: o que a view
  // não entrega não ocupa nada. A outra metade (a view excluir 'cancelado') é
  // do banco e não é exercida por este teste.
  it("linha que a view não entrega não bloqueia o horário", async () => {
    montar({ reservas: [] });
    expect(await vagas(15)).toContain("10:00");
  });

  it("o motor consulta a view slots_ocupados filtrando só por salão e data", async () => {
    montar({ reservas: [reserva(SEGUNDA, "10:00:00", 75)] });
    await vagas(15);
    expect(banco.consultasOcupados).toHaveLength(1);
    expect(banco.consultasOcupados[0]).toEqual([
      { op: "eq", coluna: "estabelecimento_id", valor: 1 },
      { op: "eq", coluna: "data", valor: SEGUNDA },
    ]);
  });
});

// 4. Teto de 720 e piso de 5.
describe("teto de 720 e piso de 5 da duração efetiva", () => {
  it("somarTempo: teto 720 com agregado e piso 5 com ajuste negativo", () => {
    expect(DURACAO_MAXIMA_MIN).toBe(720);
    expect(DURACAO_MINIMA_MIN).toBe(5);
    expect(somarTempo({ duracaoServico: 700, tempoAgregado: 100, somaTempo: true })).toBe(720);
    expect(somarTempo({ duracaoServico: 30, ajusteDuracao: -60 })).toBe(5);
  });

  it("somarTempo -> motor: 720 dentro de 08:00-20:00 só abre o candidato das 08:00", async () => {
    montar();
    const efetiva = somarTempo({ duracaoServico: 700, tempoAgregado: 100, somaTempo: true });
    expect(await vagas(efetiva)).toEqual(["08:00"]);
  });

  it("teto e piso são de quem chama: o motor não clampa o override", async () => {
    // duracaoMinOverride é usado como veio (> 0). O teto/piso é de somarTempo;
    // se um chamador pular somarTempo, o motor aceita 900 min sem cortar em 720
    // (nenhum candidato cabe na janela de 12 h) e 3 min sem subir pra 5.
    montar();
    expect(await vagas(900)).toEqual([]);
    expect(await vagas(720)).toEqual(["08:00"]);
    montar({ reservas: [reserva(SEGUNDA, "10:00:00", 30)] });
    // 3 min: 09:57 não é candidato (grade de 15), mas 19:45 + 3 cabe e 19:45 + 5 também;
    // o piso só seria visível numa janela que termina em 19:48-19:49, então aqui
    // fica documentado apenas que o valor 3 é aceito sem erro.
    expect(await vagas(3)).toContain("09:45");
  });
});

// 5. Reserva que atravessa a meia-noite.
describe("reserva que atravessa a meia-noite (22:00 + 330 min até 03:30)", () => {
  const janelaMadrugada = { hora_inicio: "00:00:00", hora_fim: "23:00:00" };

  // ESPERADO pelo banco: 01:00 do dia seguinte é recusado, 04:00 é aceito.
  // O QUE O MOTOR FAZ: `slots_ocupados` é consultada com `.eq("data", <dia>)`
  // (disponibilidade.js, calcularVagasPorHorario) e agruparOcupados só vê as
  // reservas DAQUELA data. A reserva de 22:00 de segunda tem data = segunda; o
  // mapa de terça não a enxerga, e 01:00 (assim como 00:00 a 03:15) é devolvido
  // como LIVRE, enquanto o banco recusaria (23P01). Não corrigido, de propósito.
  // Obs.: não há como saber, daqui, se a view slots_ocupados já "parte" a
  // reserva em duas linhas (uma por data) — a definição da view não está em sql/.
  // Este teste falha contra o motor + view como modelados aqui (uma linha por
  // reserva, na data de início), que é o que o app lê hoje.
  it.fails("terça 01:00 deveria sumir e 04:00 aparecer (motor não vê o trecho de segunda)", async () => {
    montar({
      janela: janelaMadrugada,
      reservas: [reserva(SEGUNDA, "22:00:00", 330)],
    });
    const lista = await vagas(15, TERCA);
    expect(lista).not.toContain("01:00");
    expect(lista).toContain("04:00");
  });

  it("documenta o que o motor devolve hoje: terça 01:00 aparece como livre", async () => {
    montar({
      janela: janelaMadrugada,
      reservas: [reserva(SEGUNDA, "22:00:00", 330)],
    });
    const lista = await vagas(15, TERCA);
    expect(lista).toContain("01:00");
    expect(lista).toContain("04:00");
    // A reserva ainda bloqueia o próprio dia dela (22:00 em diante).
    const segunda = await vagas(15, SEGUNDA);
    expect(segunda).not.toContain("22:30");
  });
});

// 6. Modo fixo: o agregado não soma tempo.
describe("profissional em modo fixo", () => {
  it("agregadoSomaTempo é false e somarTempo usa só a duração do serviço", () => {
    expect(agregadoSomaTempo([{ ativo: true, modo_horario: "fixo" }])).toBe(false);
    const efetiva = somarTempo({
      duracaoServico: 30,
      tempoAgregado: 45,
      somaTempo: agregadoSomaTempo([{ ativo: true, modo_horario: "fixo" }]),
    });
    expect(efetiva).toBe(30);
  });

  it("motor: sobreposição usa 30 (sem agregado); com 75 o mesmo horário sumiria", async () => {
    montar({
      modo: "fixo",
      fixos: ["09:30:00", "10:00:00"],
      reservas: [reserva(SEGUNDA, "10:30:00", 30)],
    });
    // 09:30 + 30 = 10:00, encosta em 10:30: livre.
    expect(await vagas(30)).toContain("09:30");
    // Se o agregado fosse somado por engano (75): 09:30-10:45 invade 10:30.
    expect(await vagas(75)).not.toContain("09:30");
  });
});

// 7. Ajuste de tempo das perguntas.
describe("ajuste_duracao_min das perguntas (aplicar_duracao_na_agenda)", () => {
  // O wizard (FormularioAgendamento.calcularAjusteDuracao) soma o ajuste das
  // opções com aplicar_duracao_na_agenda = true e passa tudo por somarTempo,
  // que vira duracaoMinOverride. O motor trata esse valor como a duração do
  // CANDIDATO. Divergência com o banco: o gatilho do banco calcula a duração
  // só com serviço (+ agregado em modo janela) e ignora o ajuste — então o
  // motor pode esconder um horário que o banco aceitaria, e a duração que o
  // cliente vê não é a mesma que o gatilho confere.
  it("o motor soma o ajuste: 30 sem ajuste cabe às 09:30, 30 + 30 não cabe", async () => {
    montar({ reservas: [reserva(SEGUNDA, "10:00:00", 30)] });
    const semAjuste = somarTempo({ duracaoServico: 30, ajusteDuracao: 0 });
    const comAjuste = somarTempo({ duracaoServico: 30, ajusteDuracao: 30 });
    expect(semAjuste).toBe(30);
    expect(comAjuste).toBe(60);

    expect(await vagas(semAjuste)).toContain("09:30"); // 09:30-10:00 encosta
    expect(await vagas(comAjuste)).not.toContain("09:30"); // 09:30-10:30 invade
    expect(await vagas(comAjuste)).toContain("09:00");
  });
});
