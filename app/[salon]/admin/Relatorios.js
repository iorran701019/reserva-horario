"use client";

import { useEffect, useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { supabase } from "@/lib/supabaseClient";
import { fimDoAtendimento } from "@/lib/particao";
import { mesDeHoje, rotuloMes } from "@/lib/mes";
import NavegacaoMes from "@/components/NavegacaoMes";

// Aba "Relatórios" do /admin: resumo mensal dos atendimentos fechados do
// salão, em dois gráficos de pizza (tipo de serviço dos concluídos; desfecho
// de tudo). Busca client-side, sem RPC — só o mês selecionado.
//
// Props:
//   estabelecimentoId – id do salão resolvido pelo slug (particiona a query).

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
//   "concluido" — status 'concluido', OU 'confirmado' cujo atendimento já
//                 terminou (fimDoAtendimento < agora — mesmo critério de
//                 estaAguardandoConclusao em page.js). Confirmado futuro NÃO
//                 conta ainda: retorna null.
//   "cliente"   — cancelado com cancelado_por_cliente.
//   "salao"     — cancelado com cancelado_pelo_salao OU nao_compareceu (o
//                 "Não compareceu" da conclusão grava status cancelado, ver
//                 lib/conclusao.js).
//   "expirado"  — cancelado com expirado_automaticamente (cron da reserva
//                 provisória).
//   "estimado"  — cancelado sem nenhuma das quatro flags: cancelamentos
//                 anteriores à coluna cancelado_pelo_salao. Soma em "Salão"
//                 no gráfico, mas é contado à parte pra legenda de estimativa.
function classificarDesfecho(item, agora) {
  if (item.status === "concluido") return "concluido";
  if (item.status === "confirmado") {
    return fimDoAtendimento(item) < agora ? "concluido" : null;
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

function montarResumo(linhas, agora) {
  const desfecho = { concluido: 0, cliente: 0, salao: 0, expirado: 0 };
  const tipo = { comum: 0, interna: 0, externa: 0 };
  let estimados = 0;

  for (const item of linhas) {
    const categoria = classificarDesfecho(item, agora);
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

export default function Relatorios({ estabelecimentoId }) {
  const [mesSelecionado, setMesSelecionado] = useState(() => mesDeHoje());

  // Resultado da última busca, marcado com o mês a que pertence. "Carregando"
  // é derivado (resultado de outro mês ou nenhum) em vez de um setState no
  // começo do effect — trocar de mês mostra o loading sem render extra.
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const inicio = `${mesSelecionado}-01`;
      const fim = `${deslocarMes(mesSelecionado, 1)}-01`;

      const { data, error } = await supabase
        .from("agendamentos")
        .select(
          "id, data, horario, status, cancelado_por_cliente, cancelado_pelo_salao, nao_compareceu, expirado_automaticamente, servico_id, servicos(duracao_min, eh_manutencao, manutencao_externa)"
        )
        .eq("estabelecimento_id", estabelecimentoId)
        .eq("finalizado", true)
        .in("status", ["concluido", "confirmado", "cancelado"])
        .gte("data", inicio)
        .lt("data", fim);

      if (!ativo) return;

      // Eleva duracao_min ao topo do item — é de lá que fimDoAtendimento lê
      // (mesmo tratamento de buscarAgendamentos em page.js).
      const linhas = (data ?? []).map((item) => ({
        ...item,
        duracao_min: item.servicos?.duracao_min ?? null,
      }));
      setResultado({ mes: mesSelecionado, linhas, erro: error?.message ?? "" });
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimentoId, mesSelecionado]);

  const atual = mesDeHoje();
  const carregando = resultado?.mes !== mesSelecionado;
  const erro = carregando ? "" : resultado.erro;

  // Um único `agora` pra classificar tudo no render (mesmo padrão de page.js).
  const agora = new Date();
  const resumo = carregando || erro ? null : montarResumo(resultado.linhas, agora);
  const totalCancelamentos = resumo
    ? resumo.desfecho.cliente + resumo.desfecho.salao + resumo.desfecho.expirado
    : 0;

  return (
    <div>
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

      {resumo && (
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
        </>
      )}
    </div>
  );
}
