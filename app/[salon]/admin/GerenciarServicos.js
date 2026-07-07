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
// (profissionais.id) vinculados ao serviço. `categoria_id` é string ("" = "Sem
// categoria"), porque valores de <select> são sempre string; vira null/número
// na hora de gravar.
const FORM_INICIAL = { nome: "", preco: "", duracao: "", profissionais: [], categoria_id: "" };

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

  // Categorias do salão (tabela categorias_servico). Alimentam tanto o seletor
  // do form quanto a seção de gerenciamento. Ordenadas por `ordem`.
  const [categorias, setCategorias] = useState([]);
  const [carregandoCategorias, setCarregandoCategorias] = useState(true);
  const [erroCategorias, setErroCategorias] = useState("");

  // Carga inicial. Traz ATIVOS e INATIVOS (o CRUD precisa mostrar os dois, com
  // ação de reativar). Ordena ativos primeiro e, dentro, por nome.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("servicos")
        .select("id, nome, duracao_min, preco_centavos, ativo, categoria_id")
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

  // Carrega as categorias do salão (para o seletor e a seção de gerenciamento),
  // na ordem de exibição definida por `ordem`.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("categorias_servico")
        .select("id, nome, ordem")
        .eq("estabelecimento_id", estabelecimento.id)
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true });

      if (!ativo) return;

      if (error) {
        setErroCategorias(error.message);
      } else {
        setErroCategorias("");
        setCategorias(data ?? []);
      }
      setCarregandoCategorias(false);
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
      categoria_id: servico.categoria_id != null ? String(servico.categoria_id) : "",
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
        // "" (Sem categoria) -> null; senão o id numérico da categoria.
        categoria_id: form.categoria_id === "" ? null : Number(form.categoria_id),
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
        .select("id, nome, duracao_min, preco_centavos, ativo, categoria_id")
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

          {/* Categoria (opcional). "Sem categoria" grava categoria_id null. */}
          <div>
            <label htmlFor="categoria_id" className="mb-1 block text-sm font-medium text-body">
              Categoria
            </label>
            <select
              id="categoria_id"
              name="categoria_id"
              value={form.categoria_id}
              onChange={handleChange}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              <option value="">Sem categoria</option>
              {categorias.map((categoria) => (
                <option key={categoria.id} value={String(categoria.id)}>
                  {categoria.nome}
                </option>
              ))}
            </select>
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

      {/* Seção de categorias do salão. Recolhida por padrão; some junto com a
          lista enquanto o formulário de serviço está aberto. */}
      {!editando && (
        <GerenciarCategorias
          estabelecimento={estabelecimento}
          categorias={categorias}
          setCategorias={setCategorias}
          carregando={carregandoCategorias}
          erro={erroCategorias}
          aoApagarCategoria={(id) =>
            setServicos((atuais) =>
              atuais.map((s) => (s.categoria_id === id ? { ...s, categoria_id: null } : s))
            )
          }
        />
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
                    {(() => {
                      const categoria = categorias.find((c) => c.id === servico.categoria_id);
                      return categoria ? (
                        <p className="mt-0.5 truncate text-xs text-body">{categoria.nome}</p>
                      ) : null;
                    })()}
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

// Seção de gerenciamento das categorias do salão (criar, renomear, reordenar,
// apagar). Fica recolhida por padrão pra não competir com a lista de serviços;
// expande sob demanda. Reordenar troca `ordem` entre vizinhos. Apagar só
// desagrupa os serviços (FK on delete set null); avisamos o pai por
// `aoApagarCategoria` pra zerar o categoria_id na lista em memória.
function GerenciarCategorias({
  estabelecimento,
  categorias,
  setCategorias,
  carregando,
  erro,
  aoApagarCategoria,
}) {
  const [aberto, setAberto] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [nomeEdicao, setNomeEdicao] = useState("");
  const [categoriaParaExcluir, setCategoriaParaExcluir] = useState(null);
  const [erroAcao, setErroAcao] = useState("");
  // Trava as ações de linha (renomear/mover/apagar) enquanto uma grava, pra não
  // disparar swaps concorrentes de `ordem`.
  const [ocupado, setOcupado] = useState(false);

  const ordenadas = ordenarCategorias(categorias);

  async function criar(e) {
    e.preventDefault();
    const nome = novoNome.trim();
    if (!nome) return;

    setCriando(true);
    setErroAcao("");
    // Nova categoria vai pro fim da ordem (maior `ordem` atual + 1).
    const proximaOrdem = categorias.reduce((max, c) => Math.max(max, c.ordem), -1) + 1;
    const { data, error } = await supabase
      .from("categorias_servico")
      .insert({ estabelecimento_id: estabelecimento.id, nome, ordem: proximaOrdem })
      .select("id, nome, ordem")
      .single();

    setCriando(false);
    if (error) {
      setErroAcao(error.message);
      return;
    }
    setCategorias((atuais) => ordenarCategorias([...atuais, data]));
    setNovoNome("");
  }

  function abrirRenomear(categoria) {
    setEditandoId(categoria.id);
    setNomeEdicao(categoria.nome);
    setErroAcao("");
  }

  async function salvarRenome(categoria) {
    const nome = nomeEdicao.trim();
    if (!nome) return;
    if (nome === categoria.nome) {
      setEditandoId(null);
      return;
    }

    setOcupado(true);
    setErroAcao("");
    const { error } = await supabase
      .from("categorias_servico")
      .update({ nome })
      .eq("id", categoria.id);

    setOcupado(false);
    if (error) {
      setErroAcao(error.message);
      return;
    }
    setCategorias((atuais) =>
      ordenarCategorias(atuais.map((c) => (c.id === categoria.id ? { ...c, nome } : c)))
    );
    setEditandoId(null);
  }

  // Move a categoria uma posição pra cima (-1) ou baixo (+1) trocando o valor de
  // `ordem` com a vizinha. Dois updates sequenciais; `ocupado` evita corrida.
  async function mover(categoria, direcao) {
    const i = ordenadas.findIndex((c) => c.id === categoria.id);
    const j = i + direcao;
    if (j < 0 || j >= ordenadas.length) return;
    const vizinha = ordenadas[j];

    setOcupado(true);
    setErroAcao("");
    const { error: erro1 } = await supabase
      .from("categorias_servico")
      .update({ ordem: vizinha.ordem })
      .eq("id", categoria.id);
    const { error: erro2 } = await supabase
      .from("categorias_servico")
      .update({ ordem: categoria.ordem })
      .eq("id", vizinha.id);

    setOcupado(false);
    if (erro1 || erro2) {
      setErroAcao((erro1 || erro2).message);
      return;
    }
    setCategorias((atuais) =>
      ordenarCategorias(
        atuais.map((c) => {
          if (c.id === categoria.id) return { ...c, ordem: vizinha.ordem };
          if (c.id === vizinha.id) return { ...c, ordem: categoria.ordem };
          return c;
        })
      )
    );
  }

  async function apagar(categoria) {
    setOcupado(true);
    setErroAcao("");
    const { error } = await supabase
      .from("categorias_servico")
      .delete()
      .eq("id", categoria.id);

    setOcupado(false);
    if (error) {
      setErroAcao(error.message);
      setCategoriaParaExcluir(null);
      return;
    }
    setCategorias((atuais) => atuais.filter((c) => c.id !== categoria.id));
    aoApagarCategoria(categoria.id);
    setCategoriaParaExcluir(null);
  }

  return (
    <div className="mb-4 rounded-2xl bg-card shadow-sm ring-1 ring-border">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
      >
        <span className="text-base font-semibold text-heading">Categorias</span>
        <span className="text-sm text-body">
          {carregando ? "..." : `${categorias.length} · ${aberto ? "ocultar" : "gerenciar"}`}
        </span>
      </button>

      {aberto && (
        <div className="space-y-4 border-t border-border px-6 py-4">
          {/* Criar categoria. */}
          <form onSubmit={criar} className="flex gap-2">
            <input
              type="text"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Nova categoria (ex.: Cabelo)"
              className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <button
              type="submit"
              disabled={criando || !novoNome.trim()}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {criando ? "..." : "Adicionar"}
            </button>
          </form>

          {(erro || erroAcao) && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erro || erroAcao}
            </p>
          )}

          {carregando ? (
            <p className="rounded-lg bg-surface px-3 py-3 text-sm text-body ring-1 ring-border">
              Carregando categorias...
            </p>
          ) : ordenadas.length === 0 ? (
            <p className="rounded-lg bg-surface px-3 py-3 text-sm text-body ring-1 ring-border">
              Nenhuma categoria ainda. Crie a primeira acima.
            </p>
          ) : (
            <ul className="space-y-2">
              {ordenadas.map((categoria, indice) => (
                <li
                  key={categoria.id}
                  className="flex items-center gap-2 rounded-xl bg-surface p-2 ring-1 ring-border"
                >
                  {editandoId === categoria.id ? (
                    <>
                      <input
                        type="text"
                        value={nomeEdicao}
                        onChange={(e) => setNomeEdicao(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-border px-2 py-1.5 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                      />
                      <button
                        type="button"
                        onClick={() => salvarRenome(categoria)}
                        disabled={ocupado || !nomeEdicao.trim()}
                        className="shrink-0 rounded-lg bg-green-50 px-2.5 py-1.5 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditandoId(null)}
                        className="shrink-0 rounded-lg bg-card px-2.5 py-1.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex shrink-0 flex-col">
                        <button
                          type="button"
                          onClick={() => mover(categoria, -1)}
                          disabled={ocupado || indice === 0}
                          aria-label="Mover para cima"
                          className="px-1 text-xs leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => mover(categoria, 1)}
                          disabled={ocupado || indice === ordenadas.length - 1}
                          aria-label="Mover para baixo"
                          className="px-1 text-xs leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-heading">
                        {categoria.nome}
                      </span>
                      <button
                        type="button"
                        onClick={() => abrirRenomear(categoria)}
                        className="shrink-0 rounded-lg bg-card px-2.5 py-1.5 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                      >
                        Renomear
                      </button>
                      <button
                        type="button"
                        onClick={() => setCategoriaParaExcluir(categoria)}
                        className="shrink-0 rounded-lg bg-card px-2.5 py-1.5 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                      >
                        Apagar
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Confirmação de exclusão. Deixa claro que os serviços só ficam sem
          categoria (não são apagados). */}
      {categoriaParaExcluir && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-excluir-categoria"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setCategoriaParaExcluir(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="titulo-excluir-categoria" className="text-lg font-semibold text-heading">
              Apagar categoria
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja apagar{" "}
              <span className="font-medium text-heading">{categoriaParaExcluir.nome}</span>? Os
              serviços dela apenas ficam sem categoria.
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => apagar(categoriaParaExcluir)}
                disabled={ocupado}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Apagar categoria
              </button>
              <button
                type="button"
                onClick={() => setCategoriaParaExcluir(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Ordena as categorias pela sequência de exibição (ordem asc, depois nome).
// Usado após inserts/updates locais pra manter a ordem consistente sem refetch.
function ordenarCategorias(lista) {
  return [...lista].sort((a, b) => {
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return a.nome.localeCompare(b.nome);
  });
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
