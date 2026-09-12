"use client";

import { useEffect, useState } from "react";
import { ChartPie, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabaseClient";
import { formatarPreco } from "@/lib/preco";
import { fimDaRevisaoDeConclusao } from "@/lib/particao";
import { chaveMes, mesDeHoje, rotuloMes } from "@/lib/mes";
import NavegacaoMes from "@/components/NavegacaoMes";

// Aba "Relatórios" do /admin, dividida em duas sub-abas sobre o MESMO mês
// (uma busca só, uma NavegacaoMes só):
//   "Atividades" – dois gráficos de pizza (tipo de serviço dos concluídos;
//                  desfecho de tudo) e um gráfico de linha de concluídos.
//   "Financeiro" – receita/sinais/ticket médio do mês e a mesma linha, mas
//                  somando valor_cobrado_centavos em vez de contar registros.
// Busca client-side, sem RPC — o mês selecionado, mais o semestre quando a
// linha está no modo "Mês".
//
// Props:
//   estabelecimento – o salão inteiro. `id` particiona a query; além dele, o
//     relatório precisa de `conclusao_manual_ativa` + `confirmado_expira_horas`
//     pra saber quando um confirmado vencido já pode ser contado como
//     concluído (ver fimDaRevisaoDeConclusao em lib/particao.js).

// Categorias do gráfico de desfecho. As cores são fixas (não seguem o tema do
// salão) porque precisam continuar distinguíveis entre si em qualquer tema.
const DESFECHOS = [
  { id: "concluido", rotulo: "Concluído", cor: "#10b981" },
  { id: "cliente", rotulo: "Cancelado pelo cliente", cor: "#f59e0b" },
  { id: "salao", rotulo: "Cancelado pela manicure", cor: "#ef4444" },
  { id: "expirado", rotulo: "Expirado automaticamente", cor: "#94a3b8" },
];

const TIPOS_SERVICO = [
  { id: "comum", rotulo: "Serviço comum", cor: "#0ea5e9" },
  { id: "interna", rotulo: "Manutenção interna", cor: "#8b5cf6" },
  { id: "externa", rotulo: "Manutenção externa", cor: "#14b8a6" },
];

// "YYYY-MM" deslocado de `delta` meses. Date local só pra normalizar a virada
// de ano (mês 13 -> janeiro do ano seguinte); nunca interpretado como UTC.
function deslocarMes(chave, delta) {
  const [ano, mes] = chave.split("-").map(Number);
  const d = new Date(ano, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Desfecho de uma linha, ou null se ela ainda não entra no relatório.
//   "concluido" — status 'concluido', OU 'confirmado' cujo PRAZO DE CONCLUSÃO
//                 já passou (fimDaRevisaoDeConclusao < agora). Esse prazo é o
//                 fim do atendimento quando a conclusão manual está desligada,
//                 e fim + confirmado_expira_horas quando está ligada — o mesmo
//                 relógio do cron que grava o status. Confirmado que ainda
//                 está na janela de revisão da dona NÃO conta: o desfecho
//                 depende dela responder o card ("concluiu" ou "não
//                 compareceu"), e antecipar isso faria a pizza afirmar um
//                 resultado que ainda pode virar cancelamento.
//   "cliente"   — cancelado com cancelado_por_cliente.
//   "salao"     — cancelado com cancelado_pelo_salao OU nao_compareceu (o
//                 "Não compareceu" da conclusão grava status cancelado, ver
//                 lib/conclusao.js).
//   "expirado"  — cancelado com expirado_automaticamente (cron da reserva
//                 provisória).
//   "estimado"  — cancelado sem nenhuma das quatro flags: cancelamentos
//                 anteriores à coluna cancelado_pelo_salao. Soma em "Salão"
//                 no gráfico, mas é contado à parte pra legenda de estimativa.
function classificarDesfecho(item, agora, estabelecimento) {
  if (item.status === "concluido") return "concluido";
  if (item.status === "confirmado") {
    // Mesmas guardas de estaAguardandoConclusao (page.js): sem telefone é
    // evento importado do Google Calendar sem cliente vinculado — não aparece
    // na aba de revisão e não deve virar estatística de atendimento. data e
    // horario são o que fimDoAtendimento lê; ausentes, não há prazo a calcular.
    if (!item.telefone || !item.data || !item.horario) return null;
    return fimDaRevisaoDeConclusao(item, estabelecimento) < agora ? "concluido" : null;
  }
  if (item.status !== "cancelado") return null;
  if (item.cancelado_por_cliente) return "cliente";
  if (item.cancelado_pelo_salao || item.nao_compareceu) return "salao";
  if (item.expirado_automaticamente) return "expirado";
  return "estimado";
}

// Tipo de serviço de um concluído. manutencao_externa é independente de
// eh_manutencao (ver checkbox "Manutenção vinda de outro salão" em
// GerenciarServicos), então vence quando as duas estão marcadas. servico_id
// nulo (servico_livre) não tem embed e cai em "comum".
function classificarTipoServico(item) {
  if (item.servicos?.manutencao_externa) return "externa";
  if (item.servicos?.eh_manutencao) return "interna";
  return "comum";
}

function montarResumo(linhas, agora, estabelecimento) {
  const desfecho = { concluido: 0, cliente: 0, salao: 0, expirado: 0 };
  const tipo = { comum: 0, interna: 0, externa: 0 };
  let estimados = 0;

  for (const item of linhas) {
    const categoria = classificarDesfecho(item, agora, estabelecimento);
    if (categoria === null) continue;
    if (categoria === "estimado") {
      estimados += 1;
      desfecho.salao += 1;
      continue;
    }
    desfecho[categoria] += 1;
    if (categoria === "concluido") tipo[classificarTipoServico(item)] += 1;
  }

  return { desfecho, tipo, estimados };
}

// Quantos meses o modo "Mês" cobre (o selecionado + os 5 anteriores).
const MESES_SEMESTRE = 6;

// Nº de dias de "YYYY-MM": dia 0 do mês seguinte é o último deste.
function diasDoMes(chave) {
  const [ano, mes] = chave.split("-").map(Number);
  return new Date(ano, mes, 0).getDate();
}

// "set", "out"... — o eixo X do modo "Mês" tem 6 rótulos e não cabe
// "setembro" no celular. O toLocaleDateString pt-BR devolve "set." com ponto.
function rotuloMesCurto(chave) {
  const [ano, mes] = chave.split("-").map(Number);
  return new Date(ano, mes - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "");
}

// Baldes do eixo X (na ordem de exibição), um por dia do mês selecionado.
function baldesPorDia(chave) {
  return Array.from({ length: diasDoMes(chave) }, (_, i) => ({
    chave: `${chave}-${String(i + 1).padStart(2, "0")}`,
    rotulo: String(i + 1),
  }));
}

// Baldes do eixo X do semestre: o mês selecionado é o ÚLTIMO ponto.
function baldesPorMes(chave) {
  return Array.from({ length: MESES_SEMESTRE }, (_, i) => {
    const m = deslocarMes(chave, i - (MESES_SEMESTRE - 1));
    return { chave: m, rotulo: rotuloMesCurto(m) };
  });
}

// Série de concluídos por balde. "Concluído" é o mesmo critério das pizzas
// (classificarDesfecho), somando comum + manutenção — o gráfico de linha é
// volume de atendimento, não composição. Os baldes vêm prontos de fora porque
// dia/mês sem atendimento precisa aparecer como zero, não sumir do eixo.
function montarSerie(linhas, agora, estabelecimento, baldes, chaveDe) {
  const contagem = new Map(baldes.map((b) => [b.chave, 0]));

  for (const item of linhas) {
    if (classificarDesfecho(item, agora, estabelecimento) !== "concluido") continue;
    const chave = chaveDe(item);
    if (contagem.has(chave)) contagem.set(chave, contagem.get(chave) + 1);
  }

  return baldes.map((b) => ({ rotulo: b.rotulo, valor: contagem.get(b.chave) }));
}

// Números do topo da sub-aba Financeiro. Aqui "concluído" é literalmente
// status 'concluido' — não o critério mais largo de classificarDesfecho: só a
// conclusão (manual ou pelo cron concluir_agendamentos_confirmados_vencidos)
// grava valor_cobrado_centavos, então um 'confirmado' vencido ainda não tem
// dinheiro pra somar.
//   receita  – soma de valor_cobrado_centavos.
//   sinais   – soma de sinal_valor_centavos dos que declararam o Pix pago.
//   ticket   – receita / quantos concluídos TÊM valor. Dividir pelo total de
//              concluídos puxaria a média pra baixo por causa dos antigos,
//              fechados antes da coluna existir. null quando não há nenhum.
//   sinaisRetidos – soma de sinal_valor_centavos das linhas CANCELADAS que
//              tinham o sinal pago. Fica FORA de `receita` e de `sinais` de
//              propósito: é dinheiro que entrou sem atendimento, e misturar
//              inflaria tanto a receita quanto o ticket médio. Também não sai
//              no gráfico de Receita, que é só valor_cobrado_centavos.
function montarFinanceiro(linhas) {
  let receita = 0;
  let sinais = 0;
  let comValor = 0;
  let sinaisRetidos = 0;

  for (const item of linhas) {
    const sinalPago = item.sinal_declarado_pago && item.sinal_valor_centavos != null;

    if (item.status === "cancelado") {
      if (sinalPago) sinaisRetidos += item.sinal_valor_centavos;
      continue;
    }

    if (item.status !== "concluido") continue;
    if (item.valor_cobrado_centavos != null) {
      receita += item.valor_cobrado_centavos;
      comValor += 1;
    }
    if (sinalPago) {
      sinais += item.sinal_valor_centavos;
    }
  }

  return {
    receita,
    sinais,
    sinaisRetidos,
    comValor,
    semValor: linhas.filter(
      (i) => i.status === "concluido" && i.valor_cobrado_centavos == null
    ).length,
    ticket: comValor > 0 ? Math.round(receita / comValor) : null,
  };
}

// Mesma forma de montarSerie (baldes prontos de fora, zero onde não houve
// nada), mas somando centavos em vez de contar linhas.
function montarSerieReceita(linhas, baldes, chaveDe) {
  const soma = new Map(baldes.map((b) => [b.chave, 0]));

  for (const item of linhas) {
    if (item.status !== "concluido" || item.valor_cobrado_centavos == null) continue;
    const chave = chaveDe(item);
    if (soma.has(chave)) soma.set(chave, soma.get(chave) + item.valor_cobrado_centavos);
  }

  return baldes.map((b) => ({ rotulo: b.rotulo, valor: soma.get(b.chave) }));
}

function GraficoPizza({ titulo, categorias, contagens, observacao }) {
  const dados = categorias
    .map((c) => ({ ...c, valor: contagens[c.id] }))
    .filter((c) => c.valor > 0);
  const total = dados.reduce((soma, c) => soma + c.valor, 0);

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-border">
      <h3 className="text-sm font-medium text-heading">{titulo}</h3>
      {total === 0 ? (
        <p className="py-16 text-center text-sm text-muted">Sem dados neste mês.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={dados}
                dataKey="valor"
                nameKey="rotulo"
                innerRadius="45%"
                outerRadius="80%"
                paddingAngle={1}
                isAnimationActive={false}
              >
                {dados.map((c) => (
                  <Cell key={c.id} fill={c.cor} />
                ))}
              </Pie>
              <Tooltip
                formatter={(valor) => `${valor} (${Math.round((valor / total) * 100)}%)`}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      {observacao && <p className="mt-2 text-xs text-muted">{observacao}</p>}
    </div>
  );
}

// Busca as linhas fechadas de [inicio, fim) — mesma query/seleção das pizzas,
// extraída porque o modo "Mês" do gráfico de linha precisa do mesmo formato
// num intervalo de 6 meses.
async function buscarFechados(estabelecimentoId, inicio, fim) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select(
      "id, data, horario, telefone, duracao_min, status, cancelado_por_cliente, cancelado_pelo_salao, nao_compareceu, expirado_automaticamente, valor_cobrado_centavos, sinal_declarado_pago, sinal_valor_centavos, servico_id, servicos(duracao_min, eh_manutencao, manutencao_externa)"
    )
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("finalizado", true)
    .in("status", ["concluido", "confirmado", "cancelado"])
    .gte("data", inicio)
    .lt("data", fim);

  // duracao_min no topo do item é de onde fimDoAtendimento lê. Aqui a COLUNA
  // agendamentos.duracao_min vem primeiro, e o join só cobre o caso dela vir
  // nula: é a coluna que alimenta `periodo` (o tstzrange do EXCLUDE), e é
  // upper(periodo) que o cron compara pra decidir a conclusão. Ler
  // servicos.duracao_min primeiro — como buscarAgendamentos em page.js ainda
  // faz — desalinha o relatório do cron justamente nos servico_livre, que não
  // têm join e caíam no padrão de 40 min mesmo tendo 60 gravados.
  const linhas = (data ?? []).map((item) => ({
    ...item,
    duracao_min: item.duracao_min ?? item.servicos?.duracao_min ?? null,
  }));

  return { linhas, erro: error?.message ?? "" };
}

const MODOS_SERIE = [
  { id: "dia", rotulo: "Dia" },
  { id: "mes", rotulo: "Mês" },
];

// Mesmos eixos/tooltip nos dois modos — só o container e a série mudam:
// "Dia" usa barras (um ponto por dia do mês fica ilegível como linha no
// mobile) e "Mês" segue como linha. `dados` é null enquanto o semestre do
// modo "Mês" ainda está vindo.
//
// `rotuloSerie`/`formatarTooltip`/`formatarEixo`/`cor` existem só pro
// Financeiro reusar o MESMO gráfico com valores em centavos e uma cor própria
// (azul, pra não confundir com a contagem de atendimentos); os defaults
// reproduzem exatamente o gráfico da sub-aba Atividades.
function GraficoLinha({
  titulo,
  dados,
  modo,
  onModo,
  erro,
  rotuloSerie = "Concluídos",
  formatarTooltip = (valor) => valor,
  formatarEixo,
  cor = "#10b981",
}) {
  const total = dados?.reduce((soma, p) => soma + p.valor, 0) ?? 0;
  const Grafico = modo === "dia" ? BarChart : LineChart;

  return (
    <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-heading">{titulo}</h3>
        <div className="flex rounded-lg bg-surface p-0.5 ring-1 ring-border">
          {MODOS_SERIE.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onModo(m.id)}
              aria-pressed={modo === m.id}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                modo === m.id
                  ? "bg-card text-heading shadow-sm"
                  : "text-muted hover:text-heading"
              }`}
            >
              {m.rotulo}
            </button>
          ))}
        </div>
      </div>

      {erro ? (
        <p className="py-16 text-center text-sm text-red-700">{erro}</p>
      ) : dados === null ? (
        <p className="py-16 text-center text-sm text-muted">Carregando...</p>
      ) : total === 0 ? (
        <p className="py-16 text-center text-sm text-muted">
          {modo === "dia" ? "Sem dados neste mês." : "Sem dados neste semestre."}
        </p>
      ) : (
        // O modo "Dia" reserva 16px embaixo pro label do eixo; o modo "Mês"
        // não tem label (os nomes dos meses já se explicam) e segue sem margem.
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <Grafico
              data={dados}
              margin={{ top: 8, right: 8, bottom: modo === "dia" ? 16 : 0, left: -24 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="rotulo"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                interval="preserveStartEnd"
                minTickGap={12}
                label={
                  modo === "dia"
                    ? {
                        value: "Dia do mês",
                        position: "insideBottom",
                        offset: -12,
                        fill: "var(--muted)",
                        fontSize: 11,
                      }
                    : undefined
                }
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                allowDecimals={false}
                width={44}
                tickFormatter={formatarEixo}
              />
              <Tooltip
                formatter={(valor) => [formatarTooltip(valor), rotuloSerie]}
                labelFormatter={(rotulo) => (modo === "dia" ? `Dia ${rotulo}` : rotulo)}
              />
              {modo === "dia" ? (
                <Bar
                  dataKey="valor"
                  fill={cor}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={20}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  type="monotone"
                  dataKey="valor"
                  stroke={cor}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              )}
            </Grafico>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// Sub-abas de Relatórios, no mesmo padrão "de pasta" de Pendentes/Conclusão
// em page.js. Estado local booleano (fora da URL), como verAguardandoConclusao.
const SUB_ABAS = [
  { financeiro: false, rotulo: "Atividades", Icone: ChartPie },
  { financeiro: true, rotulo: "Financeiro", Icone: Wallet },
];

// Número grande do topo do Financeiro. `observacao` é a letrinha embaixo (só
// o ticket médio usa, pra dizer sobre quantos atendimentos é a média).
function Indicador({ rotulo, valor, observacao }) {
  return (
    <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-border">
      <p className="text-xs font-medium text-muted">{rotulo}</p>
      <p className="mt-1 text-xl font-semibold text-heading">{valor}</p>
      {observacao && <p className="mt-1 text-xs text-muted">{observacao}</p>}
    </div>
  );
}

export default function Relatorios({ estabelecimento }) {
  const estabelecimentoId = estabelecimento.id;
  const [mesSelecionado, setMesSelecionado] = useState(() => mesDeHoje());
  const [verFinanceiro, setVerFinanceiro] = useState(false);

  // Resultado da última busca, marcado com o mês a que pertence. "Carregando"
  // é derivado (resultado de outro mês ou nenhum) em vez de um setState no
  // começo do effect — trocar de mês mostra o loading sem render extra.
  const [resultado, setResultado] = useState(null);

  // Gráfico de linha: "dia" (um ponto por dia do mês) ou "mes" (semestre que
  // termina no mês selecionado). O semestre tem busca própria, também marcada
  // com o mês a que pertence.
  const [modoSerie, setModoSerie] = useState("dia");
  const [semestre, setSemestre] = useState(null);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { linhas, erro } = await buscarFechados(
        estabelecimentoId,
        `${mesSelecionado}-01`,
        `${deslocarMes(mesSelecionado, 1)}-01`
      );
      if (!ativo) return;
      setResultado({ mes: mesSelecionado, linhas, erro });
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimentoId, mesSelecionado]);

  // Busca do semestre, só quando o gráfico de linha está em "Mês" — no modo
  // "Dia" a série sai das linhas do mês que as pizzas já carregaram.
  useEffect(() => {
    if (modoSerie !== "mes") return undefined;
    let ativo = true;

    async function carregar() {
      const { linhas, erro } = await buscarFechados(
        estabelecimentoId,
        `${deslocarMes(mesSelecionado, -(MESES_SEMESTRE - 1))}-01`,
        `${deslocarMes(mesSelecionado, 1)}-01`
      );
      if (!ativo) return;
      setSemestre({ mes: mesSelecionado, linhas, erro });
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimentoId, mesSelecionado, modoSerie]);

  const atual = mesDeHoje();
  const carregando = resultado?.mes !== mesSelecionado;
  const erro = carregando ? "" : resultado.erro;

  // Um único `agora` pra classificar tudo no render (mesmo padrão de page.js).
  const agora = new Date();
  const resumo =
    carregando || erro ? null : montarResumo(resultado.linhas, agora, estabelecimento);
  const totalCancelamentos = resumo
    ? resumo.desfecho.cliente + resumo.desfecho.salao + resumo.desfecho.expirado
    : 0;

  const financeiro = carregando || erro ? null : montarFinanceiro(resultado.linhas);

  // Séries da linha: null enquanto a busca daquele modo não chegou (o modo
  // "dia" reaproveita as linhas que as pizzas já têm). As duas sub-abas
  // dividem o mesmo `modoSerie`, então saem juntas do mesmo conjunto.
  const semestreDoMes = semestre?.mes === mesSelecionado ? semestre : null;
  const erroSemestre = semestreDoMes?.erro ?? "";
  const semestreProntas = erroSemestre ? null : (semestreDoMes?.linhas ?? null);
  let serie = null;
  let serieReceita = null;
  if (resumo) {
    serie =
      modoSerie === "dia"
        ? montarSerie(
            resultado.linhas,
            agora,
            estabelecimento,
            baldesPorDia(mesSelecionado),
            (i) => i.data
          )
        : semestreProntas &&
          montarSerie(semestreProntas, agora, estabelecimento, baldesPorMes(mesSelecionado), (i) =>
            chaveMes(i.data)
          );
    serieReceita =
      modoSerie === "dia"
        ? montarSerieReceita(resultado.linhas, baldesPorDia(mesSelecionado), (i) => i.data)
        : semestreProntas &&
          montarSerieReceita(semestreProntas, baldesPorMes(mesSelecionado), (i) =>
            chaveMes(i.data)
          );
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Relatórios"
        className="mb-4 flex items-end gap-1 border-b border-border"
      >
        {SUB_ABAS.map(({ financeiro: ehFinanceiro, rotulo, Icone }) => {
          const ativa = verFinanceiro === ehFinanceiro;
          return (
            <button
              key={rotulo}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setVerFinanceiro(ehFinanceiro)}
              className={`-mb-px inline-flex min-w-0 items-center gap-2 rounded-t-lg border px-3 py-2 text-sm font-semibold transition ${
                ativa
                  ? "border-border border-b-card bg-card text-heading"
                  : "border-transparent text-body hover:text-heading"
              }`}
            >
              <Icone className="h-5 w-5 shrink-0" />
              <span className="truncate">{rotulo}</span>
            </button>
          );
        })}
      </div>

      {/* Mesmo controle do Histórico, com estado local: "<" sempre anda (mês
          vazio mostra zeros), ">" para no mês corrente — mês futuro ainda não
          tem atendimento concluído. */}
      <NavegacaoMes
        rotulo={rotuloMes(mesSelecionado)}
        temAnterior
        temProximo={mesSelecionado < atual}
        noAtual={mesSelecionado === atual}
        onAnterior={() => setMesSelecionado((m) => deslocarMes(m, -1))}
        onProximo={() => setMesSelecionado((m) => (m < atual ? deslocarMes(m, 1) : m))}
        onVoltarAtual={() => setMesSelecionado(atual)}
      />

      {carregando && <p className="text-sm text-muted">Carregando relatório...</p>}

      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}

      {resumo && !verFinanceiro && (
        <>
          <div className="mb-4 space-y-1 text-sm text-body">
            <p>
              <span className="font-medium text-heading">{resumo.desfecho.concluido}</span>{" "}
              {resumo.desfecho.concluido === 1 ? "atendimento concluído" : "atendimentos concluídos"}
            </p>
            <p>
              <span className="font-medium text-heading">{totalCancelamentos}</span>{" "}
              {totalCancelamentos === 1 ? "cancelamento" : "cancelamentos"}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <GraficoPizza
              titulo="Concluídos por tipo de serviço"
              categorias={TIPOS_SERVICO}
              contagens={resumo.tipo}
            />
            <GraficoPizza
              titulo="Desfecho dos agendamentos"
              categorias={DESFECHOS}
              contagens={resumo.desfecho}
            />
          </div>

          <div className="mt-4">
            <GraficoLinha
              titulo="Atendimentos concluídos"
              dados={serie ?? null}
              modo={modoSerie}
              onModo={setModoSerie}
              erro={modoSerie === "mes" ? erroSemestre : ""}
            />
          </div>
        </>
      )}

      {financeiro && verFinanceiro && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador rotulo="Receita do mês" valor={formatarPreco(financeiro.receita)} />
            <Indicador rotulo="Sinais recebidos" valor={formatarPreco(financeiro.sinais)} />
            <Indicador
              rotulo="Sinais retidos (cancelados)"
              valor={formatarPreco(financeiro.sinaisRetidos)}
              observacao="Não entra na receita. Estorno feito por fora do app não aparece aqui."
            />
            <Indicador
              rotulo="Ticket médio"
              valor={financeiro.ticket == null ? "—" : formatarPreco(financeiro.ticket)}
              observacao={
                financeiro.ticket == null
                  ? "Nenhum concluído com valor neste mês."
                  : `Média de ${financeiro.comValor} ${
                      financeiro.comValor === 1 ? "atendimento" : "atendimentos"
                    }${
                      financeiro.semValor > 0
                        ? ` (${financeiro.semValor} sem valor registrado)`
                        : ""
                    }.`
              }
            />
          </div>

          <GraficoLinha
            titulo="Receita"
            dados={serieReceita ?? null}
            modo={modoSerie}
            onModo={setModoSerie}
            erro={modoSerie === "mes" ? erroSemestre : ""}
            rotuloSerie="Receita"
            formatarTooltip={formatarPreco}
            formatarEixo={(centavos) => Math.round(centavos / 100)}
            cor="#3b82f6"
          />
        </>
      )}
    </div>
  );
}
