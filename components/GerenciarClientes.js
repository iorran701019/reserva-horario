"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  buscarClientes,
  buscarResumoCliente,
  buscarHistoricoCompleto,
  buscarAnamneseDetalhe,
  buscarObservacoes,
  buscarAnotacoesLivres,
  criarAnotacaoLivre,
} from "@/lib/clientesAdmin";
import { classificarAgendamento } from "@/lib/particao";
import { linkWhatsApp } from "@/lib/whatsapp";

// Aba "Clientes" do /admin: lista somente-leitura dos clientes do salão
// (tabela `clientes`, particionada por estabelecimento_id) com busca por nome
// e um "modo detalhe" que traz o resumo do relacionamento (próximo
// agendamento, último atendimento concluído, situação da anamnese). Mesmo
// padrão visual/estrutural de GerenciarProfissionais.js: cards
// `rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border`, clique abre o
// detalhe substituindo a lista, botão "Voltar" fecha.

// Selo de status dos agendamentos ATIVOS. Mesma paleta do PainelCliente
// (SELO_STATUS) — mantém a linguagem visual do status já usada no público.
const SELO_STATUS = {
  aguardando_sinal: {
    rotulo: "Aguardando sinal",
    classe: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  pendente: {
    rotulo: "Pendente",
    classe: "bg-gray-100 text-gray-700 ring-gray-200",
  },
  confirmado: {
    rotulo: "Confirmado",
    classe: "bg-green-100 text-green-700 ring-green-200",
  },
};

// "YYYY-MM-DD" (date do Postgres) -> "DD/MM/AAAA". Monta o Date por partes
// (nunca new Date("YYYY-MM-DD"), que seria interpretada como UTC e desloca o
// dia em GMT-3) — mesma convenção do resto do projeto.
function formatarDataBR(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// "HH:MM:SS"/"HH:MM" -> "HH:MM".
function formatarHorario(horario) {
  return horario ? String(horario).slice(0, 5) : "";
}

// true se o mês de `nascimento` (date "YYYY-MM-DD") for o mês atual — decide o
// badge "🎂 Aniversário" do card. Lê o mês por partes (sem construir Date),
// mesma convenção anti-fuso do resto do arquivo.
function ehAniversarianteDoMes(nascimento) {
  if (!nascimento) return false;
  const mes = Number(String(nascimento).slice(5, 7));
  return mes === new Date().getMonth() + 1;
}

// Situação da anamnese mais recente: null (nunca preenchida) ou "em_dia"/
// "vencida" (mais de 12 meses desde `criadoEm`, um timestamptz).
function situacaoAnamnese(criadoEm) {
  if (!criadoEm) return null;
  const limite = new Date();
  limite.setMonth(limite.getMonth() - 12);
  return new Date(criadoEm) < limite ? "vencida" : "em_dia";
}

// Bloco "Próximo agendamento" / "Último atendimento" do detalhe: data,
// horário e serviço de um item de agendamento (ou o texto vazio informado).
function BlocoAgendamento({ titulo, item, vazio, mostrarSelo }) {
  return (
    <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
      <h4 className="text-sm font-semibold text-heading">{titulo}</h4>
      {item ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-body">
          <span className="font-medium text-heading">
            {formatarDataBR(item.data)} · {formatarHorario(item.horario)}
          </span>
          <span>{item.servicos?.nome ?? "Serviço"}</span>
          {mostrarSelo && SELO_STATUS[item.status] && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${SELO_STATUS[item.status].classe}`}
            >
              {SELO_STATUS[item.status].rotulo}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-body">{vazio}</p>
      )}
    </div>
  );
}

// Cabeçalho clicável do padrão de acordeão usado em Histórico, Anamnese e
// Observações: título + contador opcional + seta que indica aberto/fechado.
function CabecalhoRetratil({ titulo, contador, aberto, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 text-left"
    >
      <h4 className="text-sm font-semibold text-heading">
        {titulo}
        {contador !== undefined && (
          <span className="ml-2 text-xs font-normal text-body">
            ({contador})
          </span>
        )}
      </h4>
      {aberto ? (
        <ChevronDown className="h-4 w-4 shrink-0 text-body" />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-body" />
      )}
    </button>
  );
}

// Tipo exibido para um item com observação: deriva da partição já usada no
// resto do painel (lib/particao) em vez de reimplementar a regra —
// "confirmado" (ainda ativo) é "Observação", qualquer outra coisa (histórico
// ou, por segurança, um "inbox" que não devia ter chegado aqui) é "Anotação".
function tipoObservacao(item) {
  return classificarAgendamento(item) === "confirmado" ? "Observação" : "Anotação";
}

// Detalhe de um cliente: dados cadastrais + resumo do relacionamento
// (próximo agendamento, anamnese) + três seções retráteis carregadas sob
// demanda (histórico completo, detalhe da anamnese, observações/anotações).
// `cliente` já traz os campos cadastrais de buscarClientes.
function DetalheCliente({ cliente, estabelecimentoId, onVoltar }) {
  const [resumo, setResumo] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [historico, setHistorico] = useState(null);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  const [anamneseAberta, setAnamneseAberta] = useState(false);
  const [anamneseDetalhe, setAnamneseDetalhe] = useState(null);
  const [carregandoAnamneseDetalhe, setCarregandoAnamneseDetalhe] = useState(false);

  const [observacoesAbertas, setObservacoesAbertas] = useState(false);
  const [observacoes, setObservacoes] = useState(null);
  const [carregandoObservacoes, setCarregandoObservacoes] = useState(false);
  const [filtroObs, setFiltroObs] = useState("todos");

  const [adicionandoAnotacao, setAdicionandoAnotacao] = useState(false);
  const [rascunhoAnotacao, setRascunhoAnotacao] = useState("");
  const [salvandoAnotacao, setSalvandoAnotacao] = useState(false);
  const [erroAnotacao, setErroAnotacao] = useState("");

  const telefoneDigitos = String(cliente.whatsapp ?? "").replace(/\D/g, "");

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    buscarResumoCliente(cliente.id, estabelecimentoId, telefoneDigitos).then(
      (dados) => {
        if (ativo) {
          setResumo(dados);
          setCarregando(false);
        }
      }
    );
    return () => {
      ativo = false;
    };
  }, [cliente.id, telefoneDigitos, estabelecimentoId]);

  async function toggleHistorico() {
    const abrir = !historicoAberto;
    setHistoricoAberto(abrir);
    if (abrir && historico === null) {
      setCarregandoHistorico(true);
      const dados = await buscarHistoricoCompleto(estabelecimentoId, telefoneDigitos);
      setHistorico(dados);
      setCarregandoHistorico(false);
    }
  }

  async function toggleAnamnese() {
    const abrir = !anamneseAberta;
    setAnamneseAberta(abrir);
    if (abrir && anamneseDetalhe === null) {
      setCarregandoAnamneseDetalhe(true);
      const detalhe = await buscarAnamneseDetalhe(cliente.id, estabelecimentoId);
      setAnamneseDetalhe(detalhe);
      setCarregandoAnamneseDetalhe(false);
    }
  }

  // Mescla observações de agendamento (lib/clientesAdmin buscarObservacoes)
  // com anotações livres (buscarAnotacoesLivres) num único array de notas
  // normalizadas — cada uma já com { id, data, tipo, texto } prontos pro
  // render e pro filtro, sem precisar saber de onde a nota veio.
  async function toggleObservacoes() {
    const abrir = !observacoesAbertas;
    setObservacoesAbertas(abrir);
    if (abrir && observacoes === null) {
      setCarregandoObservacoes(true);
      const [doAgendamento, livres] = await Promise.all([
        buscarObservacoes(estabelecimentoId, telefoneDigitos),
        buscarAnotacoesLivres(cliente.id, estabelecimentoId),
      ]);
      const mescladas = [
        ...doAgendamento.map((item) => ({
          id: `agendamento-${item.id}`,
          data: item.data,
          tipo: tipoObservacao(item),
          texto: item.observacao,
        })),
        ...livres.map((item) => ({
          id: `livre-${item.id}`,
          data: item.criado_em,
          tipo: "Anotação",
          texto: item.texto,
        })),
      ].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
      setObservacoes(mescladas);
      setCarregandoObservacoes(false);
    }
  }

  async function handleSalvarAnotacao() {
    const texto = rascunhoAnotacao.trim();
    if (!texto) return;

    setSalvandoAnotacao(true);
    setErroAnotacao("");
    const { data, error } = await criarAnotacaoLivre(cliente.id, estabelecimentoId, texto);
    setSalvandoAnotacao(false);

    if (error) {
      setErroAnotacao(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setObservacoes((atual) => [
      { id: `livre-${data.id}`, data: data.criado_em, tipo: "Anotação", texto: data.texto },
      ...(atual ?? []),
    ]);
    setRascunhoAnotacao("");
    setAdicionandoAnotacao(false);
  }

  const observacoesFiltradas = useMemo(() => {
    const lista = observacoes ?? [];
    if (filtroObs === "todos") return lista;
    const alvo = filtroObs === "observacao" ? "Observação" : "Anotação";
    return lista.filter((item) => item.tipo === alvo);
  }, [observacoes, filtroObs]);

  const anamnese = situacaoAnamnese(resumo?.anamneseData?.criado_em);

  return (
    <div className="space-y-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <button
        type="button"
        onClick={onVoltar}
        className="text-sm font-medium text-body transition hover:text-heading"
      >
        ← Voltar
      </button>

      <div>
        <h3 className="text-base font-semibold text-heading">{cliente.nome}</h3>
        <a
          href={linkWhatsApp(cliente.whatsapp, `Olá ${cliente.nome}!`)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-sm text-primary underline-offset-2 hover:underline"
        >
          {cliente.whatsapp}
        </a>
      </div>

      <dl className="space-y-1 text-sm">
        {(cliente.endereco || cliente.bairro || cliente.cidade || cliente.estado) && (
          <div className="flex justify-between gap-3">
            <dt className="text-body">Endereço</dt>
            <dd className="text-right font-medium text-heading">
              {[cliente.endereco, cliente.bairro, cliente.cidade, cliente.estado]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        )}
        {cliente.instagram && (
          <div className="flex justify-between gap-3">
            <dt className="text-body">Instagram</dt>
            <dd className="text-right font-medium text-heading">{cliente.instagram}</dd>
          </div>
        )}
        {cliente.nascimento && (
          <div className="flex justify-between gap-3">
            <dt className="text-body">Nascimento</dt>
            <dd className="text-right font-medium text-heading">
              {formatarDataBR(cliente.nascimento)}
            </dd>
          </div>
        )}
      </dl>

      {carregando ? (
        <p className="text-sm text-body">Carregando resumo...</p>
      ) : (
        <div className="space-y-3">
          <BlocoAgendamento
            titulo="Próximo agendamento"
            item={resumo.proximoAgendamento}
            vazio="Nenhum agendamento ativo."
            mostrarSelo
          />
          <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
            <CabecalhoRetratil
              titulo="Histórico"
              contador={historico?.length}
              aberto={historicoAberto}
              onClick={toggleHistorico}
            />
            {historicoAberto && (
              <div className="mt-2 space-y-2">
                {carregandoHistorico ? (
                  <p className="text-sm text-body">Carregando histórico...</p>
                ) : (historico ?? []).length === 0 ? (
                  <p className="text-sm text-body">
                    Nenhum atendimento no histórico ainda.
                  </p>
                ) : (
                  historico.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center gap-2 text-sm text-body"
                    >
                      <span className="font-medium text-heading">
                        {formatarDataBR(item.data)} · {formatarHorario(item.horario)}
                      </span>
                      <span>{item.servicos?.nome ?? "Serviço"}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                          item.status === "cancelado"
                            ? "bg-gray-100 text-gray-700 ring-gray-200"
                            : "bg-green-100 text-green-700 ring-green-200"
                        }`}
                      >
                        {item.status === "cancelado" ? "Cancelado" : "Concluído"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
            <CabecalhoRetratil
              titulo="Anamnese"
              aberto={anamneseAberta}
              onClick={toggleAnamnese}
            />
            {anamnese === null ? (
              <p className="mt-1.5 text-sm text-body">Nunca preenchida.</p>
            ) : (
              <p
                className={`mt-1.5 text-sm font-medium ${
                  anamnese === "vencida" ? "text-amber-700" : "text-green-700"
                }`}
              >
                {anamnese === "vencida" ? "Vencida" : "Em dia"} (preenchida em{" "}
                {formatarDataBR(resumo.anamneseData.criado_em)})
              </p>
            )}

            {anamneseAberta && (
              <div className="mt-2">
                {carregandoAnamneseDetalhe ? (
                  <p className="text-sm text-body">Carregando anamnese...</p>
                ) : (
                  anamneseDetalhe?.resposta && (
                    <div className="space-y-3">
                      {anamneseDetalhe.modelo?.titulo && (
                        <h5 className="text-sm font-semibold text-heading">
                          {anamneseDetalhe.modelo.titulo}
                        </h5>
                      )}

                      {(anamneseDetalhe.modelo?.secoes ?? []).map((secao, si) => (
                        <div
                          key={si}
                          className="space-y-1.5 rounded-lg bg-card p-2.5 ring-1 ring-border"
                        >
                          <p className="text-sm font-medium text-heading">
                            {secao.titulo}
                          </p>
                          {(secao.perguntas ?? []).map((pergunta, pi) => (
                            <div
                              key={pi}
                              className="flex items-center justify-between gap-2 text-sm text-body"
                            >
                              <span>{pergunta}</span>
                              <span className="font-medium text-heading">
                                {anamneseDetalhe.resposta.respostas?.[pergunta] === "sim"
                                  ? "Sim"
                                  : "Não"}
                              </span>
                            </div>
                          ))}
                          {anamneseDetalhe.resposta.observacoes?.[secao.titulo] && (
                            <p className="mt-1 text-xs text-body">
                              Obs: {anamneseDetalhe.resposta.observacoes[secao.titulo]}
                            </p>
                          )}
                        </div>
                      ))}

                      <p className="text-sm text-body">
                        Termos aceitos:{" "}
                        <span className="font-medium text-heading">
                          {anamneseDetalhe.resposta.termos_aceitos ? "Sim" : "Não"}
                        </span>{" "}
                        ({formatarDataBR(anamneseDetalhe.resposta.criado_em)})
                      </p>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
            <CabecalhoRetratil
              titulo="Observações e anotações"
              contador={observacoes?.length}
              aberto={observacoesAbertas}
              onClick={toggleObservacoes}
            />
            {observacoesAbertas && (
              <div className="mt-2 space-y-2">
                {adicionandoAnotacao ? (
                  <div className="flex flex-col gap-2 rounded-lg bg-card p-2.5 ring-1 ring-border">
                    <textarea
                      value={rascunhoAnotacao}
                      onChange={(e) => setRascunhoAnotacao(e.target.value)}
                      maxLength={280}
                      rows={3}
                      placeholder="Anotação sobre o cliente..."
                      className="w-full resize-none break-words rounded-lg bg-surface px-3 py-2 text-sm text-heading ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted">
                        {rascunhoAnotacao.length}/280
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAdicionandoAnotacao(false);
                            setRascunhoAnotacao("");
                            setErroAnotacao("");
                          }}
                          className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={salvandoAnotacao || !rascunhoAnotacao.trim()}
                          onClick={handleSalvarAnotacao}
                          className="inline-flex items-center justify-center rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100 disabled:opacity-60"
                        >
                          {salvandoAnotacao ? "Salvando..." : "Salvar"}
                        </button>
                      </div>
                    </div>
                    {erroAnotacao && (
                      <p className="text-xs text-red-700">{erroAnotacao}</p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAdicionandoAnotacao(true)}
                    className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface"
                  >
                    + Adicionar anotação
                  </button>
                )}

                <div className="flex gap-2">
                  {[
                    { valor: "observacao", rotulo: "Observações" },
                    { valor: "anotacao", rotulo: "Anotações" },
                    { valor: "todos", rotulo: "Todos" },
                  ].map((opcao) => (
                    <button
                      key={opcao.valor}
                      type="button"
                      onClick={() => setFiltroObs(opcao.valor)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                        filtroObs === opcao.valor
                          ? "bg-primary text-white ring-primary"
                          : "bg-card text-body ring-border hover:bg-surface"
                      }`}
                    >
                      {opcao.rotulo}
                    </button>
                  ))}
                </div>

                {carregandoObservacoes ? (
                  <p className="text-sm text-body">Carregando observações...</p>
                ) : observacoesFiltradas.length === 0 ? (
                  <p className="text-sm text-body">
                    Nenhuma observação registrada ainda.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {observacoesFiltradas.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-lg bg-card p-2.5 text-sm ring-1 ring-border"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-heading">
                            {formatarDataBR(item.data)}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                              item.tipo === "Observação"
                                ? "bg-blue-50 text-blue-700 ring-blue-200"
                                : "bg-purple-50 text-purple-700 ring-purple-200"
                            }`}
                          >
                            {item.tipo}
                          </span>
                        </div>
                        <p className="mt-1 text-body">{item.texto}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GerenciarClientes({ estabelecimento }) {
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState(null);

  useEffect(() => {
    let ativo = true;

    buscarClientes(estabelecimento.id).then((dados) => {
      if (!ativo) return;
      setClientes(dados);
      setCarregando(false);
    });

    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  const clientesFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return clientes;
    return clientes.filter((c) => c.nome?.toLowerCase().includes(termo));
  }, [clientes, busca]);

  if (carregando) {
    return (
      <p className="rounded-lg bg-card px-4 py-3 text-sm text-body shadow-sm ring-1 ring-border">
        Carregando clientes...
      </p>
    );
  }

  if (erro) {
    return (
      <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
        {erro}
      </p>
    );
  }

  if (selecionado) {
    return (
      <DetalheCliente
        cliente={selecionado}
        estabelecimentoId={estabelecimento.id}
        onVoltar={() => setSelecionado(null)}
      />
    );
  }

  return (
    <>
      <div className="mb-4">
        <label htmlFor="busca-cliente" className="sr-only">
          Buscar cliente
        </label>
        <input
          id="busca-cliente"
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome..."
          className="w-full rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </div>

      {clientesFiltrados.length === 0 ? (
        <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
          Nenhum cliente encontrado.
        </p>
      ) : (
        <ul className="space-y-3">
          {clientesFiltrados.map((cliente) => (
            <li key={cliente.id}>
              <button
                type="button"
                onClick={() => setSelecionado(cliente)}
                className="w-full rounded-2xl bg-card p-4 text-left shadow-sm ring-1 ring-border transition hover:bg-surface"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-medium text-heading">
                    {cliente.nome}
                  </p>
                  {ehAniversarianteDoMes(cliente.nascimento) && (
                    <span className="shrink-0 rounded-full bg-pink-50 px-2.5 py-0.5 text-xs font-medium text-pink-700 ring-1 ring-pink-100">
                      🎂 Aniversário
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-body">{cliente.whatsapp}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
