"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatarPreco } from "@/components/FormularioAgendamento";

// Aba "Serviços" do /admin: CRUD dos serviços do salão (tabela `servicos`),
// sempre particionado por estabelecimento_id (o consumidor já resolveu o salão
// e passa o objeto via prop). Segue o mesmo padrão visual das outras abas
// (cards ring-border, botões verdes/vermelhos), então nenhuma lógica de
// resolução de tenant vive aqui.
//
// Convenções da tabela (mesmas usadas em FormularioAgendamento):
//   preco_centavos – inteiro em centavos (UI mostra/edita em reais)
//   duracao_min    – inteiro em minutos
//   ativo          – "excluir" é soft delete (ativo=false); NUNCA DELETE físico,
//                    pra preservar agendamentos antigos que referenciam o serviço.
//   servico_profissional – vínculo N:N (servico_id, profissional_id): quais
//                    profissionais atendem o serviço. É a MESMA tabela editada
//                    pela Janela C do form de profissional (os dois lados
//                    refletem os mesmos vínculos). Gravado com "substitui tudo"
//                    (apaga os vínculos do servico_id e reinsere os marcados).

// Estado inicial do formulário. `preco` fica em REAIS (string do input); só é
// convertido pra centavos na hora de gravar. `profissionais` é a lista de ids
// (profissionais.id) vinculados ao serviço.
const FORM_INICIAL = { nome: "", preco: "", duracao: "", profissionais: [] };

// Reais digitado (aceita "35", "35,50" ou "35.50") -> centavos inteiros.
// Devolve NaN quando não dá pra interpretar, pra validação barrar.
function reaisParaCentavos(reais) {
  const numero = Number(String(reais).replace(",", "."));
  if (Number.isNaN(numero)) return NaN;
  return Math.round(numero * 100);
}

// centavos -> string em reais pro input de edição ("3550" -> "35.50").
function centavosParaReais(centavos) {
  return (centavos / 100).toFixed(2);
}

// Seção de profissionais do form de serviço: lista os profissionais ATIVOS do
// salão com checkbox; marcar define quem atende o serviço (grava em
// servico_profissional). `selecionados` é o array de ids marcados; `onToggle(id)`
// liga/desliga um. Sem profissionais, orienta a cadastrar antes.
function ListaProfissionais({ profissionais, carregando, erro, selecionados, onToggle }) {
  if (carregando) {
    return (
      <p className="rounded-lg bg-surface px-3 py-3 text-sm text-body ring-1 ring-border">
        Carregando profissionais...
      </p>
    );
  }

  if (erro) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
        {erro}
      </p>
    );
  }

  if (profissionais.length === 0) {
    return (
      <div className="rounded-xl bg-surface px-4 py-6 text-center ring-1 ring-border">
        <p className="text-sm text-body">
          Cadastre profissionais primeiro na aba Profissionais.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {profissionais.map((profissional) => {
        const marcado = selecionados.includes(profissional.id);
        return (
          <li key={profissional.id}>
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-1 transition ${
                marcado ? "bg-card ring-primary/40" : "bg-surface ring-border hover:bg-card"
              }`}
            >
              <input
                type="checkbox"
                checked={marcado}
                onChange={() => onToggle(profissional.id)}
                className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-heading">
                {profissional.nome}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export default function GerenciarServicos({ estabelecimento }) {
  const [servicos, setServicos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Formulário de criar/editar. `editando`:
  //   null       – formulário fechado (só a lista)
  //   "novo"     – criando um serviço
  //   objeto     – editando o serviço correspondente (guardamos o id em .id)
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [erroForm, setErroForm] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Carregando os vínculos do serviço em edição (quais profissionais atendem).
  const [carregandoForm, setCarregandoForm] = useState(false);

  // Serviço "armado" para soft delete (controla o modal de confirmação).
  const [servicoParaExcluir, setServicoParaExcluir] = useState(null);

  // Profissionais ATIVOS do salão, pra montar os checkboxes do form. Carregados
  // uma vez; a seleção por serviço vive em `form.profissionais`.
  const [profissionaisSalao, setProfissionaisSalao] = useState([]);
  const [carregandoProfissionais, setCarregandoProfissionais] = useState(true);
  const [erroProfissionais, setErroProfissionais] = useState("");

  // Carga inicial. Traz ATIVOS e INATIVOS (o CRUD precisa mostrar os dois, com
  // ação de reativar). Ordena ativos primeiro e, dentro, por nome.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("servicos")
        .select("id, nome, duracao_min, preco_centavos, ativo")
        .eq("estabelecimento_id", estabelecimento.id)
        .order("ativo", { ascending: false })
        .order("nome", { ascending: true });

      if (!ativo) return;

      if (error) {
        setErro(error.message);
      } else {
        setErro("");
        setServicos(data ?? []);
      }
      setCarregando(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Carrega os profissionais ATIVOS do salão (os que podem ser vinculados). O
  // vínculo em si (quem atende o serviço) vem do form, não daqui.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("profissionais")
        .select("id, nome")
        .eq("estabelecimento_id", estabelecimento.id)
        .eq("ativo", true)
        .order("nome", { ascending: true });

      if (!ativo) return;

      if (error) {
        setErroProfissionais(error.message);
      } else {
        setErroProfissionais("");
        setProfissionaisSalao(data ?? []);
      }
      setCarregandoProfissionais(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((anterior) => ({ ...anterior, [name]: value }));
  }

  function abrirNovo() {
    setForm(FORM_INICIAL);
    setErroForm("");
    setEditando("novo");
  }

  async function abrirEdicao(servico) {
    setForm({
      nome: servico.nome,
      preco: centavosParaReais(servico.preco_centavos),
      duracao: String(servico.duracao_min),
      profissionais: [],
    });
    setErroForm("");
    setEditando(servico);
    setCarregandoForm(true);

    // Vínculos atuais do serviço (quais profissionais o atendem). Pré-marcam os
    // checkboxes; a mesma tabela é editada pela Janela C do form de profissional.
    const { data, error } = await supabase
      .from("servico_profissional")
      .select("profissional_id")
      .eq("servico_id", servico.id);

    setCarregandoForm(false);

    if (error) {
      setErroForm(`Não foi possível carregar os profissionais: ${error.message}`);
      return;
    }

    setForm((anterior) => ({
      ...anterior,
      profissionais: (data ?? []).map((v) => v.profissional_id),
    }));
  }

  // Liga/desliga o vínculo com um profissional (por id) na seleção do form.
  function alternarProfissional(id) {
    setForm((anterior) => ({
      ...anterior,
      profissionais: anterior.profissionais.includes(id)
        ? anterior.profissionais.filter((p) => p !== id)
        : [...anterior.profissionais, id],
    }));
  }

  function fecharForm() {
    setEditando(null);
    setForm(FORM_INICIAL);
    setErroForm("");
  }

  // Valida os campos e devolve o payload pronto pro banco, ou uma string de erro.
  // Regras: nome obrigatório, preço > 0, duração > 0 (inteiro).
  function validarForm() {
    const nome = form.nome.trim();
    if (!nome) return { erro: "Informe o nome do serviço." };

    const centavos = reaisParaCentavos(form.preco);
    if (Number.isNaN(centavos) || centavos <= 0) {
      return { erro: "Informe um preço maior que zero." };
    }

    const duracao = Number(form.duracao);
    if (!Number.isInteger(duracao) || duracao <= 0) {
      return { erro: "Informe uma duração (em minutos) maior que zero." };
    }

    return {
      payload: {
        nome,
        preco_centavos: centavos,
        duracao_min: duracao,
      },
    };
  }

  // Regrava os vínculos do serviço: apaga os do servico_id e insere os marcados.
  // Mesma estratégia "substitui tudo" usada na Janela C do form de profissional.
  // Devolve o erro do Supabase ou null.
  async function salvarVinculos(servicoId, profissionalIds) {
    const { error: erroDelete } = await supabase
      .from("servico_profissional")
      .delete()
      .eq("servico_id", servicoId);
    if (erroDelete) return erroDelete;

    if (profissionalIds.length === 0) return null;

    const linhas = profissionalIds.map((profissional_id) => ({
      servico_id: servicoId,
      profissional_id,
    }));
    const { error: erroInsert } = await supabase
      .from("servico_profissional")
      .insert(linhas);
    return erroInsert ?? null;
  }

  async function handleSalvar(e) {
    e.preventDefault();

    const { erro: erroValidacao, payload } = validarForm();
    if (erroValidacao) {
      setErroForm(erroValidacao);
      return;
    }

    setSalvando(true);
    setErroForm("");

    if (editando === "novo") {
      // Cria já ativo, particionado pelo estabelecimento resolvido.
      const { data, error } = await supabase
        .from("servicos")
        .insert({
          ...payload,
          ativo: true,
          estabelecimento_id: estabelecimento.id,
        })
        .select("id, nome, duracao_min, preco_centavos, ativo")
        .single();

      if (error) {
        setSalvando(false);
        setErroForm(error.message);
        return;
      }

      const erroVinculos = await salvarVinculos(data.id, form.profissionais);
      setSalvando(false);
      if (erroVinculos) {
        // Serviço criado; os vínculos falharam. Mantém o form aberto na edição
        // (a seleção continua em memória) pra reenviar no próximo salvar.
        setServicos((atuais) => ordenar([...atuais, data]));
        setEditando(data);
        setErroForm(`Serviço criado, mas os profissionais falharam: ${erroVinculos.message}`);
        return;
      }

      // Insere no topo local e reordena (ativos primeiro, depois por nome).
      setServicos((atuais) => ordenar([...atuais, data]));
      fecharForm();
      return;
    }

    // Edição: atualiza o serviço existente.
    const { error } = await supabase
      .from("servicos")
      .update(payload)
      .eq("id", editando.id);

    if (error) {
      setSalvando(false);
      setErroForm(error.message);
      return;
    }

    const erroVinculos = await salvarVinculos(editando.id, form.profissionais);
    setSalvando(false);
    if (erroVinculos) {
      setErroForm(`Serviço salvo, mas os profissionais falharam: ${erroVinculos.message}`);
      return;
    }

    setServicos((atuais) => ordenar(atuais.map((s) =>
      s.id === editando.id ? { ...s, ...payload } : s
    )));
    fecharForm();
  }

  // Soft delete: marca ativo=false (nunca DELETE físico). Roda só depois do
  // "Confirmar exclusão" no modal.
  async function handleExcluir(servico) {
    const { error } = await supabase
      .from("servicos")
      .update({ ativo: false })
      .eq("id", servico.id);

    if (error) {
      setErro(`Não foi possível excluir o serviço: ${error.message}`);
      setServicoParaExcluir(null);
      return;
    }

    setErro("");
    setServicos((atuais) => ordenar(atualizarAtivo(atuais, servico.id, false)));
    setServicoParaExcluir(null);
  }

  // Reativa um serviço soft-deleted (ativo=true).
  async function handleReativar(servico) {
    const { error } = await supabase
      .from("servicos")
      .update({ ativo: true })
      .eq("id", servico.id);

    if (error) {
      setErro(`Não foi possível reativar o serviço: ${error.message}`);
      return;
    }

    setErro("");
    setServicos((atuais) => ordenar(atualizarAtivo(atuais, servico.id, true)));
  }

  if (carregando) {
    return (
      <p className="rounded-lg bg-card px-4 py-3 text-sm text-body shadow-sm ring-1 ring-border">
        Carregando serviços...
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

  return (
    <>
      {/* Cabeçalho da aba + ação de criar. O botão some enquanto o formulário
          está aberto pra não competir com ele. */}
      {!editando && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-body">
            {servicos.length} serviço{servicos.length === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={abrirNovo}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            Novo serviço
          </button>
        </div>
      )}

      {/* Formulário de criar/editar (inline). Aparece no lugar da lista quando
          `editando` está setado. */}
      {editando && (
        <form
          onSubmit={handleSalvar}
          className="mb-4 space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border"
        >
          <h3 className="text-base font-semibold text-heading">
            {editando === "novo" ? "Novo serviço" : "Editar serviço"}
          </h3>

          <div>
            <label htmlFor="nome" className="mb-1 block text-sm font-medium text-body">
              Nome
            </label>
            <input
              id="nome"
              name="nome"
              type="text"
              value={form.nome}
              onChange={handleChange}
              placeholder="Ex.: Corte masculino"
              className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="preco" className="mb-1 block text-sm font-medium text-body">
                Preço (R$)
              </label>
              <input
                id="preco"
                name="preco"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.preco}
                onChange={handleChange}
                placeholder="35,00"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>

            <div className="flex-1">
              <label htmlFor="duracao" className="mb-1 block text-sm font-medium text-body">
                Duração (min)
              </label>
              <input
                id="duracao"
                name="duracao"
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                value={form.duracao}
                onChange={handleChange}
                placeholder="30"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
          </div>

          {/* Profissionais que atendem este serviço (tabela servico_profissional).
              Enquanto os vínculos do serviço em edição carregam, mostra o estado
              de carregando pra não exibir checkboxes desmarcadas antes da hora. */}
          <div>
            <span className="mb-2 block text-sm font-medium text-body">Profissionais</span>
            <ListaProfissionais
              profissionais={profissionaisSalao}
              carregando={carregandoProfissionais || carregandoForm}
              erro={erroProfissionais}
              selecionados={form.profissionais}
              onToggle={alternarProfissional}
            />
          </div>

          {erroForm && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erroForm}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={salvando || carregandoForm}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={fecharForm}
              className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Lista de serviços. Some enquanto o formulário está aberto pra manter o
          foco numa coisa só (mobile). */}
      {!editando && (
        servicos.length === 0 ? (
          <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
            Nenhum serviço cadastrado.
          </p>
        ) : (
          <ul className="space-y-3">
            {servicos.map((servico) => (
              <li
                key={servico.id}
                className={`rounded-2xl p-4 shadow-sm ring-1 transition ${
                  servico.ativo
                    ? "bg-card ring-border"
                    : "bg-surface ring-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-heading">
                      {servico.nome}
                    </p>
                    <p className="mt-0.5 text-sm text-body">
                      {formatarPreco(servico.preco_centavos)} · {servico.duracao_min} min
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                      servico.ativo
                        ? "bg-green-50 text-green-700 ring-green-100"
                        : "bg-surface text-body ring-border"
                    }`}
                  >
                    {servico.ativo ? "Ativo" : "Inativo"}
                  </span>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {servico.ativo ? (
                    <>
                      <button
                        type="button"
                        onClick={() => abrirEdicao(servico)}
                        className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setServicoParaExcluir(servico)}
                        className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                      >
                        Excluir
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReativar(servico)}
                      className="inline-flex flex-1 items-center justify-center rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
                    >
                      Reativar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {/* Modal de confirmação do soft delete. Deixa claro que o histórico é
          preservado (o serviço só fica inativo). */}
      {servicoParaExcluir && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-excluir-servico"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setServicoParaExcluir(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-excluir-servico"
              className="text-lg font-semibold text-heading"
            >
              Excluir serviço
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja excluir{" "}
              <span className="font-medium text-heading">
                {servicoParaExcluir.nome}
              </span>
              ? Ele deixará de aparecer para novos agendamentos, mas os
              agendamentos antigos são preservados.
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => handleExcluir(servicoParaExcluir)}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Confirmar exclusão
              </button>
              <button
                type="button"
                onClick={() => setServicoParaExcluir(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Reordena a lista pela mesma chave da query (ativos primeiro, depois nome).
// Usado após inserts/updates locais pra manter a ordem consistente sem refetch.
function ordenar(lista) {
  return [...lista].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.nome.localeCompare(b.nome);
  });
}

// Patch imutável do campo `ativo` de um serviço na lista.
function atualizarAtivo(lista, id, ativo) {
  return lista.map((s) => (s.id === id ? { ...s, ativo } : s));
}
