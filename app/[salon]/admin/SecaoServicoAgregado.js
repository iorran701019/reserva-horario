"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatarPreco } from "@/lib/preco";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";

// Seção "Permitir agregar outro serviço" do card de serviço em
// GerenciarServicos (tabela `servico_agregados`). SÓ CONFIGURAÇÃO: nada aqui é
// lido pelo /agendar, pelo wizard, pelas RPCs ou pela disponibilidade.
//
// `preco_centavos` e `duracao_min` do agregado são o que ele ACRESCENTA ao
// serviço principal (total = principal + agregado). Ao escolher o serviço
// agregado, os dois campos são pré-preenchidos com os valores do próprio
// serviço escolhido e continuam editáveis.
//
// Visual da janela e da confirmação: mesmo padrão de SecaoAusencias
// (GerenciarProfissionais.js, role="dialog").
//
// Props:
//   servico         – serviço principal, JÁ salvo (com id)
//   servicos        – todos os serviços do salão (nomes e opções da lista)
//   agendaFixa      – true quando TODOS os profissionais ativos são
//                     modo_horario 'fixo' (o tempo vira só informativo)

const classeCampo =
  "w-full rounded-lg border border-border px-2 py-1.5 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10";

const COLUNAS = "id, servico_id, servico_agregado_id, preco_centavos, duracao_min, ordem, ativo";

const FORM_VAZIO = {
  agregadoId: "",
  preco: "",
  duracao: "",
  ativo: true,
};

function reaisParaCentavos(reais) {
  const numero = Number(String(reais).replace(",", "."));
  if (Number.isNaN(numero)) return NaN;
  return Math.round(numero * 100);
}

function centavosParaReais(centavos) {
  return (centavos / 100).toFixed(2);
}

export default function SecaoServicoAgregado({ servico, servicos, agendaFixa }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(false);

  // null = janela fechada; "novo" = adicionando; objeto = editando.
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [erroForm, setErroForm] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [paraExcluir, setParaExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState("");

  useEffect(() => {
    let vivo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("servico_agregados")
        .select(COLUNAS)
        .eq("servico_id", servico.id)
        .order("ordem", { ascending: true })
        .order("id", { ascending: true });

      if (!vivo) return;
      if (error) {
        setErro(`Não foi possível carregar os agregados: ${error.message}`);
      } else {
        setErro("");
        const linhas = data ?? [];
        setLista(linhas);
        // Já vem marcado quando existe algum agregado ativo.
        if (linhas.some((a) => a.ativo)) setAberto(true);
      }
      setCarregando(false);
    }

    carregar();
    return () => {
      vivo = false;
    };
  }, [servico.id]);

  function nomeDoServico(id) {
    return servicos.find((s) => s.id === id)?.nome ?? "Serviço removido";
  }

  // Serviços ativos do salão, menos o próprio, os já adicionados, as
  // manutenções e os de segunda data (não fazem sentido como agregado).
  const jaAdicionados = new Set(lista.map((a) => a.servico_agregado_id));
  const opcoes = servicos.filter(
    (s) =>
      s.ativo &&
      !s.eh_manutencao &&
      !s.exige_segunda_data &&
      s.id !== servico.id &&
      !jaAdicionados.has(s.id)
  );

  // Com agregado ativo, a área não pode ser recolhida/desligada.
  const temAtivo = lista.some((a) => a.ativo);

  function abrirAdicionar() {
    setForm(FORM_VAZIO);
    setErroForm("");
    setEditando("novo");
  }

  function abrirEditar(item) {
    setForm({
      agregadoId: String(item.servico_agregado_id),
      preco: centavosParaReais(item.preco_centavos),
      duracao: String(item.duracao_min),
      ativo: item.ativo,
    });
    setErroForm("");
    setEditando(item);
  }

  function fecharJanela() {
    if (salvando) return;
    setEditando(null);
    setErroForm("");
  }

  function escolherServico(valor) {
    const escolhido = servicos.find((s) => String(s.id) === valor);
    setForm((atual) => ({
      ...atual,
      agregadoId: valor,
      // Pré-preenche com os valores do próprio serviço escolhido.
      preco: escolhido ? centavosParaReais(escolhido.preco_centavos ?? 0) : "",
      duracao: escolhido ? String(escolhido.duracao_min ?? 0) : "",
    }));
  }

  async function salvar() {
    if (salvando) return;
    const ehNovo = editando === "novo";

    if (ehNovo && !form.agregadoId) {
      setErroForm("Escolha o serviço que será agregado.");
      return;
    }
    const preco = reaisParaCentavos(form.preco);
    if (form.preco === "" || Number.isNaN(preco) || preco < 0) {
      setErroForm("Informe um preço válido (0 ou mais).");
      return;
    }
    const duracao = Number(form.duracao);
    if (form.duracao === "" || !Number.isInteger(duracao) || duracao < 0 || duracao > 720) {
      setErroForm("Informe um tempo em minutos entre 0 e 720.");
      return;
    }

    setSalvando(true);
    setErroForm("");

    if (ehNovo) {
      const proximaOrdem = lista.reduce((m, a) => Math.max(m, a.ordem ?? 0), 0) + 1;
      const { data, error } = await supabase
        .from("servico_agregados")
        .insert({
          servico_id: servico.id,
          servico_agregado_id: Number(form.agregadoId),
          preco_centavos: preco,
          duracao_min: duracao,
          ordem: proximaOrdem,
          ativo: form.ativo,
        })
        .select(COLUNAS);
      setSalvando(false);
      if (error || !data?.length) {
        setErroForm(`Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
        return;
      }
      setLista((atual) => [...atual, data[0]]);
    } else {
      const { data, error } = await supabase
        .from("servico_agregados")
        .update({ preco_centavos: preco, duracao_min: duracao, ativo: form.ativo })
        .eq("id", editando.id)
        .select(COLUNAS);
      setSalvando(false);
      if (error || !data?.length) {
        setErroForm(`Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
        return;
      }
      setLista((atual) => atual.map((a) => (a.id === data[0].id ? data[0] : a)));
    }

    setEditando(null);
  }

  async function confirmarExclusao() {
    if (!paraExcluir || excluindo) return;
    setExcluindo(true);
    setErroExcluir("");
    const { data, error } = await supabase
      .from("servico_agregados")
      .delete()
      .eq("id", paraExcluir.id)
      .select("id");
    setExcluindo(false);
    if (error || !data?.length) {
      setErroExcluir(`Não foi possível excluir: ${mensagemFalhaSalvar(error)}`);
      return;
    }
    setLista((atual) => atual.filter((a) => a.id !== paraExcluir.id));
    setParaExcluir(null);
  }

  // Manutenção e serviço de duas datas não oferecem agregado no wizard (ver
  // confirmarSelecaoServico em FormularioAgendamento.js), então configurar um
  // aqui não teria efeito: a seção some. Depois dos hooks, de propósito.
  if (servico.eh_manutencao || servico.exige_segunda_data) return null;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <label className="flex items-center gap-2 text-sm font-medium text-heading">
        <input
          type="checkbox"
          checked={aberto || temAtivo}
          disabled={temAtivo}
          onChange={(e) => setAberto(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Permitir agregar outro serviço
      </label>
      {temAtivo && (
        <p className="mt-1 text-xs text-muted">
          Desative ou exclua os agregados para desligar.
        </p>
      )}

      {(aberto || temAtivo) && (
        <div className="mt-3">
          {carregando ? (
            <p className="rounded-lg bg-surface px-3 py-3 text-center text-sm text-body ring-1 ring-border">
              Carregando agregados...
            </p>
          ) : (
            <>
              {erro && (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                  {erro}
                </p>
              )}

              {lista.length === 0 && !erro && (
                <p className="text-xs text-muted">Nenhum serviço agregado cadastrado.</p>
              )}

              <ul className="space-y-2">
                {lista.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-3 rounded-xl bg-card p-3 ring-1 ring-border"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-heading">
                        {nomeDoServico(a.servico_agregado_id)}
                        {!a.ativo && (
                          <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-border">
                            Inativo
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-body">
                        + {formatarPreco(a.preco_centavos)}, + {a.duracao_min} min
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => abrirEditar(a)}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-body ring-1 ring-border transition hover:bg-surface"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setErroExcluir("");
                          setParaExcluir(a);
                        }}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                      >
                        Excluir
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={abrirAdicionar}
                className="mt-3 inline-flex items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-primary ring-1 ring-primary/40 transition hover:bg-surface"
              >
                + Adicionar
              </button>
            </>
          )}
        </div>
      )}

      {editando && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`titulo-agregado-${servico.id}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 px-4"
          onClick={fecharJanela}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id={`titulo-agregado-${servico.id}`}
              className="text-lg font-semibold text-heading"
            >
              {editando === "novo" ? "Adicionar serviço agregado" : "Editar serviço agregado"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              Os valores abaixo são o que o agregado acrescenta a {servico.nome}.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-body">
                  Serviço agregado
                </label>
                {editando === "novo" ? (
                  <select
                    value={form.agregadoId}
                    onChange={(e) => escolherServico(e.target.value)}
                    className={classeCampo}
                  >
                    <option value="">Selecione...</option>
                    {opcoes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-heading">
                    {nomeDoServico(editando.servico_agregado_id)}
                  </p>
                )}
                {editando === "novo" && opcoes.length === 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Não há outros serviços ativos disponíveis para agregar.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-body">
                  Preço acrescentado (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.preco}
                  onChange={(e) => setForm((f) => ({ ...f, preco: e.target.value }))}
                  className={classeCampo}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-body">
                  Tempo acrescentado (min)
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="720"
                  value={form.duracao}
                  onChange={(e) => setForm((f) => ({ ...f, duracao: e.target.value }))}
                  className={classeCampo}
                />
                {agendaFixa && (
                  <p className="mt-1 text-xs text-muted">
                    Informativo: sua agenda é fixa, o tempo não altera os horários.
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-heading">
                <input
                  type="checkbox"
                  checked={form.ativo}
                  onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                  className="h-4 w-4 accent-primary"
                />
                Ativo
              </label>
            </div>

            {erroForm && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroForm}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={salvar}
                disabled={salvando}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={fecharJanela}
                disabled={salvando}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {paraExcluir && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`titulo-excluir-agregado-${servico.id}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 px-4"
          onClick={() => !excluindo && setParaExcluir(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id={`titulo-excluir-agregado-${servico.id}`}
              className="text-lg font-semibold text-heading"
            >
              Excluir serviço agregado
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja excluir{" "}
              <span className="font-medium text-heading">
                {nomeDoServico(paraExcluir.servico_agregado_id)}
              </span>{" "}
              de {servico.nome}?
            </p>

            {erroExcluir && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroExcluir}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={confirmarExclusao}
                disabled={excluindo}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {excluindo ? "Excluindo..." : "Confirmar"}
              </button>
              <button
                type="button"
                onClick={() => setParaExcluir(null)}
                disabled={excluindo}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
