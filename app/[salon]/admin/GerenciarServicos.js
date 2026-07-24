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
// Categorias e serviços vivem num único acordeão (mesmo padrão retrátil do
// /agendar — ver `categoriasComServicos`/`alternarCategoria` em
// FormularioAgendamento): cada categoria é um cabeçalho que expande/recolhe
// pra mostrar os serviços dela; o grupo sintético "Sem categoria" (serviços
// com categoria_id null) sempre aparece por último.
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

// Sentinel do grupo sintético "Sem categoria" no acordeão — nunca colide com
// um id de categoria (numérico).
const SEM_CATEGORIA = "sem-categoria";

// Estado inicial do formulário. `preco` fica em REAIS (string do input); só é
// convertido pra centavos na hora de gravar. `profissionais` é a lista de ids
// (profissionais.id) vinculados ao serviço. `adicionarAlerta` só controla a
// UI (mostrar/esconder a textarea); o que vai pro banco é `alertaMensagem`
// (null se a caixa estiver desmarcada ou vazia — ver validarForm).
const FORM_INICIAL = {
  nome: "",
  preco: "",
  duracao: "",
  profissionais: [],
  categoria_id: "",
  ocultarPreco: false,
  ocultarDuracao: false,
  adicionarAlerta: false,
  alertaMensagem: "",
  servico_origem_id: "",
  prazoInicioDias: "",
  prazoFimDias: "",
  ehManutencao: false,
};

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

// Texto da faixa de dias de uma manutenção, pro card da listagem (ex.: "20 a
// 30 dias", ou "até 30 dias" quando prazo_inicio_dias é null). null quando não
// há prazo_fim_dias cadastrado (faixa não preenchida).
function faixaManutencao(servico) {
  if (servico.prazo_fim_dias == null) return null;
  if (servico.prazo_inicio_dias == null) return `até ${servico.prazo_fim_dias} dias`;
  return `${servico.prazo_inicio_dias} a ${servico.prazo_fim_dias} dias`;
}

// Perguntas por serviço (servico_perguntas/servico_pergunta_opcoes): cada
// pergunta tem um `tipo` que determina como as opções funcionam.
//   sim_nao          – sempre exatamente duas opções fixas ("Sim"/"Não"),
//                      só o ajuste de preço é editável.
//   multipla_escolha – lista dinâmica de opções (label + ajuste de preço).
//   texto_livre       – sem opções; a resposta é digitada pelo cliente depois.
// `opcoes` no form fica em reais (mesmo padrão de `preco` no form de
// serviço); só vira `ajuste_preco_centavos` na hora de gravar.
function opcoesSimNaoIniciais() {
  return [
    { id: null, label: "Sim", preco: centavosParaReais(0) },
    { id: null, label: "Não", preco: centavosParaReais(0) },
  ];
}

const FORM_PERGUNTA_INICIAL = {
  texto: "",
  tipo: "sim_nao",
  opcoes: opcoesSimNaoIniciais(),
};

function rotuloTipoPergunta(tipo) {
  if (tipo === "sim_nao") return "Sim ou não";
  if (tipo === "multipla_escolha") return "Múltipla escolha";
  return "Texto livre";
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
  // Conflito de faixa de dias detectado em handleSalvar (duas manutenções do
  // mesmo servico_origem_id com prazos sobrepostos) — controla o popup de
  // aviso que bloqueia o salvamento até o usuário ajustar o prazo.
  const [conflitoManutencao, setConflitoManutencao] = useState(null);
  // Carregando os vínculos do serviço em edição (quais profissionais atendem).
  const [carregandoForm, setCarregandoForm] = useState(false);

  // Serviço "armado" para soft delete / desativação (controla o modal de confirmação).
  const [servicoParaDesativar, setServicoParaDesativar] = useState(null);

  // Seção retrátil "Serviços desativados", no final da aba — fechada por padrão.
  const [secaoDesativadosAberta, setSecaoDesativadosAberta] = useState(false);

  // Serviço "armado" para exclusão PERMANENTE (DELETE físico), disparado a
  // partir da seção de desativados — controla o modal de confirmação.
  const [servicoParaExcluirPermanente, setServicoParaExcluirPermanente] = useState(null);
  const [excluindoPermanente, setExcluindoPermanente] = useState(false);
  const [erroExcluirPermanente, setErroExcluirPermanente] = useState("");

  // Trava as setinhas de reordenação enquanto um swap de `ordem` está em
  // andamento, pra não disparar dois swaps concorrentes (mesmo padrão do
  // `ocupadoCategoria` abaixo).
  const [reordenando, setReordenando] = useState(false);
  const [erroReordenar, setErroReordenar] = useState("");

  // Profissionais ATIVOS do salão, pra montar os checkboxes do form. Carregados
  // uma vez; a seleção por serviço vive em `form.profissionais`.
  const [profissionaisSalao, setProfissionaisSalao] = useState([]);
  const [carregandoProfissionais, setCarregandoProfissionais] = useState(true);
  const [erroProfissionais, setErroProfissionais] = useState("");

  // Categorias do salão (tabela categorias_servico). Alimentam tanto o seletor
  // do form quanto o acordeão de gerenciamento. Ordenadas por `ordem`.
  const [categorias, setCategorias] = useState([]);
  const [carregandoCategorias, setCarregandoCategorias] = useState(true);
  const [erroCategorias, setErroCategorias] = useState("");

  // Acordeão único (Categorias + Serviços): qual grupo está expandido — o id
  // da categoria, ou o sentinel SEM_CATEGORIA. Só um aberto por vez, mesmo
  // padrão do acordeão de /agendar (ver `categoriaAberta` em
  // FormularioAgendamento).
  const [grupoAberto, setGrupoAberto] = useState(null);

  // Criar categoria: form inline, acima do botão "Novo serviço".
  const [criandoCategoriaAberto, setCriandoCategoriaAberto] = useState(false);
  const [novoNomeCategoria, setNovoNomeCategoria] = useState("");
  const [salvandoCategoria, setSalvandoCategoria] = useState(false);
  const [erroCriarCategoria, setErroCriarCategoria] = useState("");

  // Renomear categoria: inline, na própria linha do cabeçalho do grupo.
  const [categoriaEditandoId, setCategoriaEditandoId] = useState(null);
  const [nomeEdicaoCategoria, setNomeEdicaoCategoria] = useState("");

  // Categoria "armada" para exclusão (modal de confirmação) — mesmo padrão do
  // servicoParaDesativar.
  const [categoriaParaExcluir, setCategoriaParaExcluir] = useState(null);

  // Trava as ações de categoria (criar/renomear/mover/apagar) enquanto uma
  // grava, pra não disparar swaps concorrentes de `ordem`.
  const [ocupadoCategoria, setOcupadoCategoria] = useState(false);
  const [erroAcaoCategoria, setErroAcaoCategoria] = useState("");

  // Seção "Perguntas" de cada card de serviço: quais estão expandidas (chave
  // servico.id) e, pra cada uma, as perguntas já carregadas (+ suas opções).
  // Carregado sob demanda na primeira expansão e cacheado aqui — nunca
  // refetchado depois (as mutações abaixo atualizam este cache localmente,
  // mesmo padrão usado pra `servicos`/`categorias`).
  const [perguntasAberto, setPerguntasAberto] = useState({});
  const [perguntasPorServico, setPerguntasPorServico] = useState({});

  // Form de criar/editar pergunta: no máximo um aberto por vez em toda a tela.
  // `perguntaEditando`: null (fechado) | { servicoId, id: null } pra criar |
  // { servicoId, id } pra editar.
  const [perguntaEditando, setPerguntaEditando] = useState(null);
  const [formPergunta, setFormPergunta] = useState(FORM_PERGUNTA_INICIAL);
  const [erroFormPergunta, setErroFormPergunta] = useState("");
  const [salvandoPergunta, setSalvandoPergunta] = useState(false);

  // Pergunta "armada" pra exclusão (modal de confirmação) — mesmo padrão do
  // servicoParaDesativar/categoriaParaExcluir. O ON DELETE CASCADE do banco cuida
  // de apagar as opções vinculadas.
  const [perguntaParaExcluir, setPerguntaParaExcluir] = useState(null);
  const [erroExcluirPergunta, setErroExcluirPergunta] = useState("");

  // Carga inicial. Traz ATIVOS e INATIVOS (o CRUD precisa mostrar os dois, com
  // ação de reativar). Ordena por categoria_id, ordem — mesmo critério do
  // acordeão de /agendar — pra manter os grupos de categoria juntos e as
  // setinhas de reordenação operando sobre vizinhos visíveis lado a lado.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("servicos")
        .select(
          "id, nome, duracao_min, preco_centavos, ativo, oculto, categoria_id, ordem, ocultar_preco, ocultar_duracao, alerta_mensagem, servico_origem_id, prazo_manutencao_dias, eh_manutencao, prazo_inicio_dias, prazo_fim_dias"
        )
        .eq("estabelecimento_id", estabelecimento.id)
        .order("categoria_id", { ascending: true, nullsFirst: true })
        .order("ordem", { ascending: true });

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

  // Carrega as categorias do salão (para o seletor e o acordeão de
  // gerenciamento), na ordem de exibição definida por `ordem`.
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

  function handleCheckbox(e) {
    const { name, checked } = e.target;
    setForm((anterior) => ({ ...anterior, [name]: checked }));
  }

  // Desmarcar "Adicionar alerta" também limpa a mensagem digitada — ao salvar,
  // uma caixa desmarcada sempre grava alerta_mensagem null (ver validarForm).
  function handleToggleAlerta(e) {
    const checked = e.target.checked;
    setForm((anterior) => ({
      ...anterior,
      adicionarAlerta: checked,
      alertaMensagem: checked ? anterior.alertaMensagem : "",
    }));
  }

  function abrirNovo() {
    setForm({
      ...FORM_INICIAL,
      // Novo serviço: pré-marca todos os profissionais ativos por padrão (a
      // dona desmarca manualmente se algum não atender). Edição não passa
      // por aqui — ver abrirEdicao, que carrega o vínculo já salvo.
      profissionais: profissionaisSalao.map((p) => p.id),
    });
    setErroForm("");
    setEditando("novo");
  }

  // Atalho "+ Criar manutenção" num card de serviço original: abre o mesmo
  // formulário de criação, mas já pré-preenchido como uma manutenção daquele
// Manutenção não tem campo de categoria no form — herda a categoria
        // do servico_origem_id (mesmo categoria_id do serviço-base, pra
        // aparecer agrupada com ele no acordeão), recalculada em
        // handleSalvar logo antes de salvar. Placeholder null aqui,
        // sobrescrito lá.
        categoria_id: form.ehManutencao
          ? null
          : form.categoria_id === ""
            ? null
            : Number(form.categoria_id),
  function abrirCriarManutencao(servicoOrigem) {
    setForm({
      ...FORM_INICIAL,
      nome: `Manutenção – ${servicoOrigem.nome}`,
      servico_origem_id: String(servicoOrigem.id),
      categoria_id:
        servicoOrigem.categoria_id != null ? String(servicoOrigem.categoria_id) : "",
      ehManutencao: true,
      // Mesmo padrão do abrirNovo: pré-marca todos os profissionais ativos.
      profissionais: profissionaisSalao.map((p) => p.id),
    });
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
      ocultarPreco: Boolean(servico.ocultar_preco),
      ocultarDuracao: Boolean(servico.ocultar_duracao),
      // A caixa nasce marcada se já houver mensagem salva.
      adicionarAlerta: Boolean(servico.alerta_mensagem),
      alertaMensagem: servico.alerta_mensagem ?? "",
      servico_origem_id:
        servico.servico_origem_id != null ? String(servico.servico_origem_id) : "",
      prazoInicioDias:
        servico.prazo_inicio_dias != null ? String(servico.prazo_inicio_dias) : "",
      prazoFimDias:
        servico.prazo_fim_dias != null ? String(servico.prazo_fim_dias) : "",
      ehManutencao: Boolean(servico.eh_manutencao),
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

    // Toda manutenção precisa de um serviço-origem vinculado (ver dropdown
    // sem opção vazia no form) — sem isso o preço/manutenção sugerida não
    // tem base pra calcular em cima.
    if (form.ehManutencao && form.servico_origem_id === "") {
      return {
        erro:
          "Toda manutenção precisa estar vinculada a um serviço. Se você quer um serviço avulso, crie como um serviço comum em vez de uma manutenção.",
      };
    }

    const servicoOrigemId =
      form.servico_origem_id === "" ? null : Number(form.servico_origem_id);

    // Faixa de dias (prazo_inicio_dias/prazo_fim_dias) só existe numa
    // manutenção (eh_manutencao true); no serviço original os dois ficam
    // sempre null. Ambos opcionais: "A partir de" em branco = manutenção vale
    // desde o início do prazo; "Até" em branco = sem limite superior.
    let prazoInicioDias = null;
    let prazoFimDias = null;
    if (form.ehManutencao) {
      if (form.prazoInicioDias.trim() !== "") {
        const valor = Number(form.prazoInicioDias);
        if (!Number.isInteger(valor) || valor < 0) {
          return { erro: "Informe 'A partir de quantos dias' como um número inteiro válido." };
        }
        prazoInicioDias = valor;
      }
      if (form.prazoFimDias.trim() !== "") {
        const valor = Number(form.prazoFimDias);
        if (!Number.isInteger(valor) || valor < 0) {
          return { erro: "Informe 'Até quantos dias' como um número inteiro válido." };
        }
        prazoFimDias = valor;
      }
      if (prazoInicioDias != null && prazoFimDias != null && prazoFimDias < prazoInicioDias) {
        return {
          erro: "'Até quantos dias' deve ser maior ou igual a 'A partir de quantos dias'.",
        };
      }
    }

    return {
      payload: {
        nome,
        preco_centavos: centavos,
        duracao_min: duracao,
<// Agrupamento pro acordeão: categorias na ordem de exibição, e o grupo
  // sintético "Sem categoria" — serviços sem categoria_id, ou apontando pra
  // uma categoria que não existe mais (manutenção incluída, pelo mesmo
  // categoria_id herdado do serviço-base). Cada um só aparece se tiver
  // algum serviço.
        ocultar_preco: form.ocultarPreco,
        ocultar_duracao: form.ocultarDuracao,
        // Caixa desmarcada ou texto em branco -> null (nunca salva alerta
        // "vazio mas marcado").
        alerta_mensagem:
          form.adicionarAlerta && form.alertaMensagem.trim()
            ? form.alertaMensagem.trim()
            : null,
        servico_origem_id: servicoOrigemId,
        prazo_inicio_dias: prazoInicioDias,
        prazo_fim_dias: prazoFimDias,
        eh_manutencao: form.ehManutencao,
      },
    };
  }

  // Próximo `ordem` dentro do grupo de uma categoria (null incluso — "sem
  // categoria" também é um grupo isolado): maior ordem do grupo + 1, ou 1 se
  // o grupo estiver vazio. Usado ao criar um serviço, ou ao mudar sua
  // categoria na edição (o serviço vai pro fim do novo grupo).
  function proximaOrdemNoGrupo(categoriaId) {
    const grupo = servicos.filter((s) => s.categoria_id === categoriaId);
    return grupo.reduce((max, s) => Math.max(max, s.ordem ?? 0), 0) + 1;
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

    // Conflito de faixa: só faz sentido checar quando a manutenção tem algum
    // dos dois campos preenchidos (sem nenhum, não há faixa pra sobrepor).
    // Compara contra as outras manutenções ativas do MESMO servico_origem_id
    // (excluindo o próprio registro em edição) que também têm faixa
    // preenchida — as que não têm (prazo_fim_dias null) usam só o campo
    // legado prazo_manutencao_dias e ficam de fora dessa checagem, senão toda
    // manutenção legada colidiria com qualquer faixa nova. null vira 0 (sem
    // piso) de um lado e "sem teto" (Infinity) do outro, conforme o pedido.
    if (payload.eh_manutencao && (payload.prazo_inicio_dias != null || payload.prazo_fim_dias != null)) {
      const idAtual = editando === "novo" ? null : editando.id;
      const novaFaixa = {
        inicio: payload.prazo_inicio_dias ?? 0,
        fim: payload.prazo_fim_dias ?? Infinity,
      };
      const conflito = servicos.find(
        (s) =>
          s.eh_manutencao &&
          s.ativo &&
          s.id !== idAtual &&
          s.servico_origem_id === payload.servico_origem_id &&
          s.prazo_fim_dias != null &&
          novaFaixa.inicio <= (s.prazo_fim_dias ?? Infinity) &&
          (s.prazo_inicio_dias ?? 0) <= novaFaixa.fim
      );
      if (conflito) {
        setConflitoManutencao({ nome: conflito.nome, faixa: faixaManutencao(conflito) });
        return;
      }
    }

    setSalvando(true);
    setErroForm("");

    // Manutenção herda a categoria do serviço vinculado (servico_origem_id),
    // buscada agora — no momento de salvar — pra não depender do que estava
    // em memória nem do formulário (que não tem campo de categoria pra
    // manutenção). Sem vínculo, fica sem categoria.
    if (payload.eh_manutencao) {
      if (payload.servico_origem_id != null) {
        const { data: origem, error: erroOrigem } = await supabase
          .from("servicos")
          .select("categoria_id")
          .eq("id", payload.servico_origem_id)
          .single();
        if (erroOrigem) {
          setSalvando(false);
          setErroForm(erroOrigem.message);
          return;
        }
        payload.categoria_id = origem.categoria_id;
      } else {
        payload.categoria_id = null;
      }
    }

    if (editando === "novo") {
      // Cria já ativo, particionado pelo estabelecimento resolvido, e vai pro
      // fim do grupo de ordem da categoria escolhida (ou do grupo "sem
      // categoria").
      const { data, error } = await supabase
        .from("servicos")
        .insert({
          ...payload,
          ativo: true,
          estabelecimento_id: estabelecimento.id,
          ordem: proximaOrdemNoGrupo(payload.categoria_id),
        })
        .select(
          "id, nome, duracao_min, preco_centavos, ativo, oculto, categoria_id, ordem, ocultar_preco, ocultar_duracao, alerta_mensagem, servico_origem_id, prazo_manutencao_dias, eh_manutencao, prazo_inicio_dias, prazo_fim_dias"
        )
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

      // Insere local e reordena (por categoria_id, ordem).
      setServicos((atuais) => ordenar([...atuais, data]));
      fecharForm();
      return;
    }

    // Edição: atualiza o serviço existente. Se a categoria mudou, o serviço
    // vai pro fim do grupo de ordem da categoria nova — ele nunca deve reter
    // uma `ordem` que fazia sentido só no grupo antigo.
    const categoriaMudou = payload.categoria_id !== editando.categoria_id;
    const payloadFinal = categoriaMudou
      ? { ...payload, ordem: proximaOrdemNoGrupo(payload.categoria_id) }
      : payload;

    const { error } = await supabase
      .from("servicos")
      .update(payloadFinal)
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
      s.id === editando.id ? { ...s, ...payloadFinal } : s
    )));
    fecharForm();
  }

  // Soft delete: marca ativo=false (nunca DELETE físico aqui — ver
  // handleExcluirPermanente pra isso). Roda só depois do "Confirmar
  // desativação" no modal.
  async function handleDesativar(servico) {
    const { error } = await supabase
      .from("servicos")
      .update({ ativo: false })
      .eq("id", servico.id);

    if (error) {
      setErro(`Não foi possível desativar o serviço: ${error.message}`);
      setServicoParaDesativar(null);
      return;
    }

    setErro("");
    setServicos((atuais) => ordenar(atualizarAtivo(atuais, servico.id, false)));
    setServicoParaDesativar(null);
  }

  // DELETE físico, disparado só a partir da seção "Serviços desativados".
  // Antes de apagar, confere se algum agendamento referencia o serviço: se
  // sim, o DELETE quebraria a FK — nesse caso não tenta apagar (o serviço já
  // está inativo) e em vez disso marca oculto=true, que tira o serviço de
  // qualquer listagem do admin (ver servicosAtivos/servicosInativos/etc.)
  // sem apagar o registro, preservando os agendamentos antigos que o
  // referenciam.
  async function handleExcluirPermanente(servico) {
    setExcluindoPermanente(true);
    setErroExcluirPermanente("");

    const { data: vinculo, error: erroVinculo } = await supabase
      .from("agendamentos")
      .select("id")
      .eq("servico_id", servico.id)
      .limit(1);

    if (erroVinculo) {
      setExcluindoPermanente(false);
      setErroExcluirPermanente(erroVinculo.message);
      return;
    }

    if ((vinculo ?? []).length > 0) {
      const { error: erroOcultar } = await supabase
        .from("servicos")
        .update({ oculto: true })
        .eq("id", servico.id);

      setExcluindoPermanente(false);
      if (erroOcultar) {
        setErroExcluirPermanente(erroOcultar.message);
        return;
      }

      setServicos((atuais) =>
        atuais.map((s) => (s.id === servico.id ? { ...s, oculto: true } : s))
      );
      setServicoParaExcluirPermanente(null);
      return;
    }

    const { error: erroDelete } = await supabase
      .from("servicos")
      .delete()
      .eq("id", servico.id);

    setExcluindoPermanente(false);
    if (erroDelete) {
      setErroExcluirPermanente(erroDelete.message);
      return;
    }

    setServicos((atuais) => atuais.filter((s) => s.id !== servico.id));
    setServicoParaExcluirPermanente(null);
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

  // Move o serviço uma posição pra cima (-1) ou baixo (+1) trocando `ordem`
  // com o vizinho DENTRO DO MESMO categoria_id — nunca atravessa grupos.
  // Mesma técnica de swap usada em moverCategoria.
  async function mover(servico, direcao) {
    const grupo = grupoDaCategoria(servicos, servico);
    const i = grupo.findIndex((s) => s.id === servico.id);
    const j = i + direcao;
    if (j < 0 || j >= grupo.length) return;
    const vizinho = grupo[j];

    setReordenando(true);
    setErroReordenar("");
    const { error: erro1 } = await supabase
      .from("servicos")
      .update({ ordem: vizinho.ordem })
      .eq("id", servico.id);
    const { error: erro2 } = await supabase
      .from("servicos")
      .update({ ordem: servico.ordem })
      .eq("id", vizinho.id);

    setReordenando(false);
    if (erro1 || erro2) {
      setErroReordenar((erro1 || erro2).message);
      return;
    }
    setServicos((atuais) =>
      ordenar(
        atuais.map((s) => {
          if (s.id === servico.id) return { ...s, ordem: vizinho.ordem };
          if (s.id === vizinho.id) return { ...s, ordem: servico.ordem };
          return s;
        })
      )
    );
  }

  // Abre/fecha um grupo do acordeão (categoria ou o sentinel SEM_CATEGORIA) —
  // só um aberto por vez, mesmo padrão do acordeão de /agendar.
  function alternarGrupo(chave) {
    setGrupoAberto((atual) => (atual === chave ? null : chave));
  }

  async function criarCategoria(e) {
    e.preventDefault();
    const nome = novoNomeCategoria.trim();
    if (!nome) return;

    setSalvandoCategoria(true);
    setErroCriarCategoria("");
    // Nova categoria vai pro fim da ordem (maior `ordem` atual + 1).
    const proximaOrdem = categorias.reduce((max, c) => Math.max(max, c.ordem), -1) + 1;
    const { data, error } = await supabase
      .from("categorias_servico")
      .insert({ estabelecimento_id: estabelecimento.id, nome, ordem: proximaOrdem })
      .select("id, nome, ordem")
      .single();

    setSalvandoCategoria(false);
    if (error) {
      setErroCriarCategoria(error.message);
      return;
    }
    setCategorias((atuais) => ordenarCategorias([...atuais, data]));
    setNovoNomeCategoria("");
    setCriandoCategoriaAberto(false);
  }

  function abrirRenomearCategoria(categoria) {
    setCategoriaEditandoId(categoria.id);
    setNomeEdicaoCategoria(categoria.nome);
    setErroAcaoCategoria("");
  }

  async function salvarRenomeCategoria(categoria) {
    const nome = nomeEdicaoCategoria.trim();
    if (!nome) return;
    if (nome === categoria.nome) {
      setCategoriaEditandoId(null);
      return;
    }

    setOcupadoCategoria(true);
    setErroAcaoCategoria("");
    const { error } = await supabase
      .from("categorias_servico")
      .update({ nome })
      .eq("id", categoria.id);

    setOcupadoCategoria(false);
    if (error) {
      setErroAcaoCategoria(error.message);
      return;
    }
    setCategorias((atuais) =>
      ordenarCategorias(atuais.map((c) => (c.id === categoria.id ? { ...c, nome } : c)))
    );
    setCategoriaEditandoId(null);
  }

  // Move a categoria uma posição pra cima (-1) ou baixo (+1) trocando `ordem`
  // com a vizinha. O grupo "Sem categoria" nunca entra aqui — não tem `ordem`
  // própria, fica sempre fixo no fim da lista.
  async function moverCategoria(categoria, direcao) {
    const ordenadas = ordenarCategorias(categorias);
    const i = ordenadas.findIndex((c) => c.id === categoria.id);
    const j = i + direcao;
    if (j < 0 || j >= ordenadas.length) return;
    const vizinha = ordenadas[j];

    setOcupadoCategoria(true);
    setErroAcaoCategoria("");
    const { error: erro1 } = await supabase
      .from("categorias_servico")
      .update({ ordem: vizinha.ordem })
      .eq("id", categoria.id);
    const { error: erro2 } = await supabase
      .from("categorias_servico")
      .update({ ordem: categoria.ordem })
      .eq("id", vizinha.id);

    setOcupadoCategoria(false);
    if (erro1 || erro2) {
      setErroAcaoCategoria((erro1 || erro2).message);
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

  // Apaga a categoria (FK on delete set null: os serviços dela apenas ficam
  // sem categoria — nunca são apagados). Atualiza a lista local de serviços
  // pra refletir o categoria_id null sem precisar de refetch.
  async function apagarCategoria(categoria) {
    setOcupadoCategoria(true);
    setErroAcaoCategoria("");
    const { error } = await supabase
      .from("categorias_servico")
      .delete()
      .eq("id", categoria.id);

    setOcupadoCategoria(false);
    if (error) {
      setErroAcaoCategoria(error.message);
      setCategoriaParaExcluir(null);
      return;
    }
    setCategorias((atuais) => atuais.filter((c) => c.id !== categoria.id));
    setServicos((atuais) =>
      ordenar(
        atuais.map((s) => (s.categoria_id === categoria.id ? { ...s, categoria_id: null } : s))
      )
    );
    if (grupoAberto === categoria.id) setGrupoAberto(null);
    setCategoriaParaExcluir(null);
  }

  // Abre/fecha a seção "Perguntas" de um serviço. Na primeira abertura (sem
  // cache ainda) dispara o carregamento.
  function alternarPerguntas(servico) {
    const abrindo = !perguntasAberto[servico.id];
    setPerguntasAberto((atual) => ({ ...atual, [servico.id]: abrindo }));
    if (abrindo && !perguntasPorServico[servico.id]) {
      carregarPerguntas(servico.id);
    }
  }

  // Busca as perguntas do serviço e, em seguida, as opções de todas elas
  // (duas queries simples, combinadas aqui — mesmo estilo do resto do
  // arquivo, sem select aninhado).
  async function carregarPerguntas(servicoId) {
    setPerguntasPorServico((atual) => ({
      ...atual,
      [servicoId]: { perguntas: atual[servicoId]?.perguntas ?? [], carregando: true, erro: "" },
    }));

    const { data: perguntas, error: erroPerguntas } = await supabase
      .from("servico_perguntas")
      .select("id, texto, tipo, ordem")
      .eq("servico_id", servicoId)
      .order("ordem", { ascending: true });

    if (erroPerguntas) {
      setPerguntasPorServico((atual) => ({
        ...atual,
        [servicoId]: { perguntas: [], carregando: false, erro: erroPerguntas.message },
      }));
      return;
    }

    const idsPerguntas = perguntas.map((p) => p.id);
    let opcoesPorPergunta = {};
    if (idsPerguntas.length > 0) {
      const { data: opcoes, error: erroOpcoes } = await supabase
        .from("servico_pergunta_opcoes")
        .select("id, pergunta_id, label, ajuste_preco_centavos, ordem")
        .in("pergunta_id", idsPerguntas)
        .order("ordem", { ascending: true });

      if (erroOpcoes) {
        setPerguntasPorServico((atual) => ({
          ...atual,
          [servicoId]: { perguntas: [], carregando: false, erro: erroOpcoes.message },
        }));
        return;
      }

      opcoesPorPergunta = (opcoes ?? []).reduce((acc, op) => {
        (acc[op.pergunta_id] ??= []).push(op);
        return acc;
      }, {});
    }

    setPerguntasPorServico((atual) => ({
      ...atual,
      [servicoId]: {
        perguntas: perguntas.map((p) => ({ ...p, opcoes: opcoesPorPergunta[p.id] ?? [] })),
        carregando: false,
        erro: "",
      },
    }));
  }

  function abrirNovaPergunta(servicoId) {
    setFormPergunta(FORM_PERGUNTA_INICIAL);
    setErroFormPergunta("");
    setPerguntaEditando({ servicoId, id: null });
  }

  function abrirEditarPergunta(servicoId, pergunta) {
    setFormPergunta({
      texto: pergunta.texto,
      tipo: pergunta.tipo,
      opcoes:
        pergunta.tipo === "texto_livre"
          ? []
          : pergunta.opcoes.map((op) => ({
              id: op.id,
              label: op.label,
              preco: centavosParaReais(op.ajuste_preco_centavos),
            })),
    });
    setErroFormPergunta("");
    setPerguntaEditando({ servicoId, id: pergunta.id });
  }

  function fecharFormPergunta() {
    setPerguntaEditando(null);
    setFormPergunta(FORM_PERGUNTA_INICIAL);
    setErroFormPergunta("");
  }

  // Troca de tipo dentro do form: reseta as opções pro formato do novo tipo
  // (sim/não fixas, uma opção em branco pra múltipla escolha, nenhuma pra
  // texto livre).
  function handleTipoPerguntaChange(e) {
    const tipo = e.target.value;
    setFormPergunta((atual) => ({
      ...atual,
      tipo,
      opcoes:
        tipo === "sim_nao"
          ? opcoesSimNaoIniciais()
          : tipo === "multipla_escolha"
            ? [{ id: null, label: "", preco: centavosParaReais(0) }]
            : [],
    }));
  }

  function alterarLabelOpcao(indice, valor) {
    setFormPergunta((atual) => ({
      ...atual,
      opcoes: atual.opcoes.map((op, i) => (i === indice ? { ...op, label: valor } : op)),
    }));
  }

  function alterarPrecoOpcao(indice, valor) {
    setFormPergunta((atual) => ({
      ...atual,
      opcoes: atual.opcoes.map((op, i) => (i === indice ? { ...op, preco: valor } : op)),
    }));
  }

  function adicionarOpcao() {
    setFormPergunta((atual) => ({
      ...atual,
      opcoes: [...atual.opcoes, { id: null, label: "", preco: centavosParaReais(0) }],
    }));
  }

  function removerOpcao(indice) {
    setFormPergunta((atual) => ({
      ...atual,
      opcoes: atual.opcoes.filter((_, i) => i !== indice),
    }));
  }

  // Valida o form de pergunta e devolve o payload pronto pro banco, ou uma
  // string de erro. Múltipla escolha exige ao menos uma opção com label;
  // sim/não sempre grava as duas opções fixas.
  function validarFormPergunta() {
    const texto = formPergunta.texto.trim();
    if (!texto) return { erro: "Informe o texto da pergunta." };

    if (formPergunta.tipo === "texto_livre") {
      return { texto, tipo: formPergunta.tipo, opcoesPayload: [] };
    }

    const opcoesComLabel =
      formPergunta.tipo === "multipla_escolha"
        ? formPergunta.opcoes
            .map((op) => ({ ...op, label: op.label.trim() }))
            .filter((op) => op.label !== "")
        : formPergunta.opcoes;

    if (formPergunta.tipo === "multipla_escolha" && opcoesComLabel.length === 0) {
      return { erro: "Adicione ao menos uma opção." };
    }

    const opcoesPayload = [];
    for (const op of opcoesComLabel) {
      const centavos = reaisParaCentavos(op.preco);
      if (Number.isNaN(centavos)) {
        return { erro: `Ajuste de preço inválido em "${op.label}".` };
      }
      opcoesPayload.push({ id: op.id, label: op.label, ajuste_preco_centavos: centavos });
    }

    return { texto, tipo: formPergunta.tipo, opcoesPayload };
  }

  // Regrava as opções da pergunta: apaga as do pergunta_id e insere as
  // atuais ("substitui tudo" — mesma estratégia de salvarVinculos). Devolve
  // as opções gravadas (com id gerado) pra atualizar o cache local sem
  // refetch, e o erro do Supabase ou null.
  async function salvarOpcoesPergunta(perguntaId, opcoesPayload) {
    const { error: erroDelete } = await supabase
      .from("servico_pergunta_opcoes")
      .delete()
      .eq("pergunta_id", perguntaId);
    if (erroDelete) return { opcoes: [], error: erroDelete };

    if (opcoesPayload.length === 0) return { opcoes: [], error: null };

    const linhas = opcoesPayload.map((op, indice) => ({
      pergunta_id: perguntaId,
      label: op.label,
      ajuste_preco_centavos: op.ajuste_preco_centavos,
      ordem: indice + 1,
    }));

    const { data, error: erroInsert } = await supabase
      .from("servico_pergunta_opcoes")
      .insert(linhas)
      .select("id, pergunta_id, label, ajuste_preco_centavos, ordem");

    return { opcoes: data ?? [], error: erroInsert ?? null };
  }

  async function handleSalvarPergunta(e, servicoId) {
    e.preventDefault();

    const resultado = validarFormPergunta();
    if (resultado.erro) {
      setErroFormPergunta(resultado.erro);
      return;
    }
    const { texto, tipo, opcoesPayload } = resultado;

    setSalvandoPergunta(true);
    setErroFormPergunta("");

    const editandoId = perguntaEditando.id;

    if (editandoId == null) {
      const perguntasAtuais = perguntasPorServico[servicoId]?.perguntas ?? [];
      const ordem = perguntasAtuais.reduce((max, p) => Math.max(max, p.ordem ?? 0), 0) + 1;

      const { data: novaPergunta, error: erroPergunta } = await supabase
        .from("servico_perguntas")
        .insert({ servico_id: servicoId, texto, tipo, ordem })
        .select("id, texto, tipo, ordem")
        .single();

      if (erroPergunta) {
        setSalvandoPergunta(false);
        setErroFormPergunta(erroPergunta.message);
        return;
      }

      const { opcoes, error: erroOpcoes } = await salvarOpcoesPergunta(
        novaPergunta.id,
        opcoesPayload
      );
      setSalvandoPergunta(false);
      if (erroOpcoes) {
        setErroFormPergunta(`Pergunta criada, mas as opções falharam: ${erroOpcoes.message}`);
        return;
      }

      setPerguntasPorServico((atual) => ({
        ...atual,
        [servicoId]: {
          perguntas: [...perguntasAtuais, { ...novaPergunta, opcoes }].sort(
            (a, b) => a.ordem - b.ordem
          ),
          carregando: false,
          erro: "",
        },
      }));
      fecharFormPergunta();
      return;
    }

    const { error: erroPergunta } = await supabase
      .from("servico_perguntas")
      .update({ texto, tipo })
      .eq("id", editandoId);

    if (erroPergunta) {
      setSalvandoPergunta(false);
      setErroFormPergunta(erroPergunta.message);
      return;
    }

    const { opcoes, error: erroOpcoes } = await salvarOpcoesPergunta(editandoId, opcoesPayload);
    setSalvandoPergunta(false);
    if (erroOpcoes) {
      setErroFormPergunta(`Pergunta salva, mas as opções falharam: ${erroOpcoes.message}`);
      return;
    }

    setPerguntasPorServico((atual) => ({
      ...atual,
      [servicoId]: {
        perguntas: (atual[servicoId]?.perguntas ?? []).map((p) =>
          p.id === editandoId ? { ...p, texto, tipo, opcoes } : p
        ),
        carregando: false,
        erro: "",
      },
    }));
    fecharFormPergunta();
  }

  // Exclui a pergunta (o ON DELETE CASCADE do banco cuida das opções
  // vinculadas). Roda só depois do "Confirmar exclusão" no modal.
  async function handleExcluirPergunta() {
    if (!perguntaParaExcluir) return;
    const { servicoId, pergunta } = perguntaParaExcluir;

    const { error } = await supabase.from("servico_perguntas").delete().eq("id", pergunta.id);

    if (error) {
      setErroExcluirPergunta(error.message);
      return;
    }

    setPerguntasPorServico((atual) => ({
      ...atual,
      [servicoId]: {
        ...atual[servicoId],
        perguntas: (atual[servicoId]?.perguntas ?? []).filter((p) => p.id !== pergunta.id),
      },
    }));
    setErroExcluirPergunta("");
    setPerguntaParaExcluir(null);
  }

  // Card de um serviço ATIVO dentro do corpo de um grupo do acordeão. As
  // setinhas trocam `ordem` só com o vizinho do MESMO grupo (ver mover()).
  // Serviços inativos não passam por aqui — ver renderServicoDesativado.
  function renderServicoItem(servico) {
    const grupo = grupoDaCategoria(servicos, servico);
    const indiceNoGrupo = grupo.findIndex((s) => s.id === servico.id);
    return (
      <li
        key={servico.id}
        className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border transition"
      >
        <div className="flex items-start gap-3">
          <div className="flex shrink-0 flex-col pt-0.5">
            <button
              type="button"
              onClick={() => mover(servico, -1)}
              disabled={reordenando || indiceNoGrupo === 0}
              aria-label="Mover para cima"
              className="px-2 py-1 text-2xl leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => mover(servico, 1)}
              disabled={reordenando || indiceNoGrupo === grupo.length - 1}
              aria-label="Mover para baixo"
              className="px-2 py-1 text-2xl leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
            >
              ▼
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="line-clamp-2 font-medium text-heading">
                  {servico.nome}
                </p>
                <p className="mt-0.5 text-sm text-body">
                  {formatarPreco(servico.preco_centavos)} · {servico.duracao_min} min
                </p>
                {servico.eh_manutencao && faixaManutencao(servico) && (
                  <p className="mt-0.5 text-xs text-body">{faixaManutencao(servico)}</p>
                )}
              </div>

              <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-100">
                Ativo
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => abrirEdicao(servico)}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => setServicoParaDesativar(servico)}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
              >
                Desativar
              </button>
              {/* Só em serviços "originais" (eh_manutencao false). Aparece
                  mesmo que o serviço já tenha uma ou mais manutenções
                  vinculadas — a trava de unicidade foi removida no banco. */}
              {!servico.eh_manutencao && (
                <button
                  type="button"
                  onClick={() => abrirCriarManutencao(servico)}
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-primary ring-1 ring-primary/40 transition hover:bg-primary/5"
                >
                  + Criar manutenção
                </button>
              )}
              <button
                type="button"
                onClick={() => alternarPerguntas(servico)}
                aria-expanded={Boolean(perguntasAberto[servico.id])}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-50"
              >
                Perguntas {perguntasAberto[servico.id] ? "▲" : "▼"}
              </button>
            </div>

            {perguntasAberto[servico.id] && renderSecaoPerguntas(servico)}
          </div>
        </div>
      </li>
    );
  }

  // Card de um serviço INATIVO na seção retrátil "Serviços desativados": só
  // "Reativar" (volta ativo=true) e "Excluir permanentemente" (ver
  // handleExcluirPermanente) — sem setinhas de ordem, já que a lista aqui é
  // uma listagem plana, fora do acordeão de categorias.
  function renderServicoDesativado(servico) {
    return (
      <li
        key={servico.id}
        className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-border"
      >
        <p className="line-clamp-2 font-medium text-heading">{servico.nome}</p>
        <p className="mt-0.5 text-sm text-body">
          {formatarPreco(servico.preco_centavos)} · {servico.duracao_min} min
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => handleReativar(servico)}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
          >
            Reativar
          </button>
          <button
            type="button"
            onClick={() => setServicoParaExcluirPermanente(servico)}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
          >
            Excluir permanentemente
          </button>
        </div>
      </li>
    );
  }

  // Seção expansível "Perguntas" de um card de serviço: lista as perguntas
  // já cadastradas (com suas opções) e o botão/form de criar uma nova.
  function renderSecaoPerguntas(servico) {
    const estado = perguntasPorServico[servico.id];
    const formAqui = perguntaEditando && perguntaEditando.servicoId === servico.id;

    return (
      <div className="mt-4 border-t border-border pt-4">
        {estado?.carregando ? (
          <p className="rounded-lg bg-surface px-3 py-3 text-center text-sm text-body ring-1 ring-border">
            Carregando perguntas...
          </p>
        ) : estado?.erro ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
            {estado.erro}
          </p>
        ) : (
          <>
            {(estado?.perguntas ?? []).length === 0 ? (
              <p className="rounded-lg bg-surface px-3 py-3 text-center text-sm text-body ring-1 ring-border">
                Nenhuma pergunta cadastrada.
              </p>
            ) : (
              <ul className="space-y-2">
                {estado.perguntas.map((pergunta) => renderItemPergunta(servico, pergunta))}
              </ul>
            )}

            {formAqui ? (
              renderFormPergunta(servico)
            ) : (
              <button
                type="button"
                onClick={() => abrirNovaPergunta(servico.id)}
                className="mt-3 inline-flex items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-primary ring-1 ring-primary/40 transition hover:bg-primary/5"
              >
                + Nova pergunta
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  // Uma pergunta já cadastrada, com suas opções (se houver) e ações de
  // editar/excluir.
  function renderItemPergunta(servico, pergunta) {
    return (
      <li key={pergunta.id} className="rounded-xl bg-surface p-3 ring-1 ring-border">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-heading">{pergunta.texto}</p>
            <p className="mt-0.5 text-xs text-body">{rotuloTipoPergunta(pergunta.tipo)}</p>
            {pergunta.opcoes.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {pergunta.opcoes.map((opcao) => (
                  <li key={opcao.id} className="text-xs text-body">
                    {opcao.label}
                    {opcao.ajuste_preco_centavos !== 0 && (
                      <span className="ml-1 text-heading">
                        {opcao.ajuste_preco_centavos > 0 ? "+" : ""}
                        {formatarPreco(opcao.ajuste_preco_centavos)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => abrirEditarPergunta(servico.id, pergunta)}
              className="rounded-lg bg-card px-2.5 py-1.5 text-xs font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => setPerguntaParaExcluir({ servicoId: servico.id, pergunta })}
              className="rounded-lg bg-card px-2.5 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
            >
              Excluir
            </button>
          </div>
        </div>
      </li>
    );
  }

  // Form inline de criar/editar pergunta. Opções mudam de acordo com
  // `formPergunta.tipo` (ver handleTipoPerguntaChange).
  function renderFormPergunta(servico) {
    return (
      <form
        onSubmit={(e) => handleSalvarPergunta(e, servico.id)}
        className="mt-3 space-y-3 rounded-xl bg-surface p-4 ring-1 ring-border"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-body">Pergunta</label>
          <input
            type="text"
            value={formPergunta.texto}
            onChange={(e) =>
              setFormPergunta((atual) => ({ ...atual, texto: e.target.value }))
            }
            placeholder="Ex.: Você tem alergia a algum produto?"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-body">Tipo de resposta</label>
          <select
            value={formPergunta.tipo}
            onChange={handleTipoPerguntaChange}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            <option value="sim_nao">Sim ou não</option>
            <option value="multipla_escolha">Múltipla escolha</option>
            <option value="texto_livre">Texto livre</option>
          </select>
        </div>

        {formPergunta.tipo === "sim_nao" && (
          <div className="space-y-2">
            <span className="block text-sm font-medium text-body">Ajuste de preço (R$)</span>
            {formPergunta.opcoes.map((opcao, indice) => (
              <div key={opcao.label} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-sm text-heading">{opcao.label}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={opcao.preco}
                  onChange={(e) => alterarPrecoOpcao(indice, e.target.value)}
                  placeholder="0,00"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>
            ))}
          </div>
        )}

        {formPergunta.tipo === "multipla_escolha" && (
          <div className="space-y-2">
            <span className="block text-sm font-medium text-body">Opções</span>
            {formPergunta.opcoes.map((opcao, indice) => (
              <div key={indice} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opcao.label}
                  onChange={(e) => alterarLabelOpcao(indice, e.target.value)}
                  placeholder="Opção"
                  className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={opcao.preco}
                  onChange={(e) => alterarPrecoOpcao(indice, e.target.value)}
                  placeholder="0,00"
                  className="w-24 shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
                <button
                  type="button"
                  onClick={() => removerOpcao(indice)}
                  aria-label="Remover opção"
                  className="shrink-0 rounded-lg bg-card px-2.5 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={adicionarOpcao}
              className="inline-flex items-center justify-center rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-primary/40 transition hover:bg-primary/5"
            >
              + Opção
            </button>
          </div>
        )}

        {erroFormPergunta && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
            {erroFormPergunta}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={salvandoPergunta}
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvandoPergunta ? "Salvando..." : "Salvar"}
          </button>
          <button
            type="button"
            onClick={fecharFormPergunta}
            className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
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

{/* Categoria (opcional). Não existe pra manutenção — ela herda a
              categoria_id do serviço vinculado (servico_origem_id) na hora
              de salvar. "Sem categoria" grava categoria_id null. */}
          {!form.ehManutencao && (
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
          )}
  const idsCategorias = new Set(categorias.map((c) => c.id));
  const servicosSemCategoria = servicos.filter(
    (s) =>
      s.ativo &&
      !s.oculto &&
      (s.categoria_id == null || !idsCategorias.has(s.categoria_id))
  );
  const servicosAtivos = servicos.filter((s) => s.ativo && !s.oculto);
  // Seção "Serviços desativados": listagem plana (sem agrupar por categoria)
  // dos serviços com ativo=false, manutenção incluída — sem tratamento
  // separado (ver renderServicoDesativado). oculto=true (exclusão
  // permanente bloqueada por FK) nunca aparece aqui nem entra no contador.
  const servicosInativos = servicos.filter((s) => !s.ativo && !s.oculto);

  return (
    <>
      {/* Cabeçalho da aba + ações de criar. Somem enquanto o formulário está
          aberto pra não competir com ele. "Nova categoria" fica acima de
          "Novo serviço" — hierarquia visual (categoria é o nível "pai"). */}
      {!editando && (
        <div className="mb-4 space-y-3">
          <p className="text-sm text-body">
            {servicosAtivos.length} serviço{servicosAtivos.length === 1 ? "" : "s"}
          </p>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setCriandoCategoriaAberto((v) => !v);
                setErroCriarCategoria("");
                setNovoNomeCategoria("");
              }}
              className="inline-flex items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-primary ring-1 ring-primary/40 transition hover:bg-primary/5"
            >
              Nova categoria
            </button>
            <button
              type="button"
              onClick={abrirNovo}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
            >
              Novo serviço
            </button>
          </div>

          {criandoCategoriaAberto && (
            <form
              onSubmit={criarCategoria}
              className="flex gap-2 rounded-xl bg-surface p-3 ring-1 ring-border"
            >
              <input
                type="text"
                value={novoNomeCategoria}
                onChange={(e) => setNovoNomeCategoria(e.target.value)}
                placeholder="Nova categoria (ex.: Cabelo)"
                className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
              <button
                type="submit"
                disabled={salvandoCategoria || !novoNomeCategoria.trim()}
                className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvandoCategoria ? "..." : "Adicionar"}
              </button>
              <button
                type="button"
                onClick={() => setCriandoCategoriaAberto(false)}
                className="shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </form>
          )}

          {erroCriarCategoria && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erroCriarCategoria}
            </p>
          )}
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
            {form.ehManutencao
              ? editando === "novo"
                ? "Nova manutenção"
                : "Editar manutenção"
              : editando === "novo"
                ? "Novo serviço"
                : "Editar serviço"}
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

{/* Categoria (opcional). Não existe pra manutenção — ela herda a
              categoria_id do serviço vinculado (servico_origem_id) na hora
              de salvar. "Sem categoria" grava categoria_id null. */}
          {!form.ehManutencao && (
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
          )}
          {/* Serviço vinculado: obrigatório numa manutenção (eh_manutencao
              true) — ver checagem em validarForm. Lista os serviços
              "originais" ativos do estabelecimento — um mesmo serviço
              original pode ter várias manutenções vinculadas (a trava de
              unicidade foi removida no banco). Sem opção vazia: se o valor
              não bater com nenhum serviço (ex.: manutenção legada sem
              vínculo), o select aparece sem seleção, forçando a dona a
              escolher antes de salvar. */}
          {form.ehManutencao && (
            <div>
              <label
                htmlFor="servico_origem_id"
                className="mb-1 block text-sm font-medium text-body"
              >
                Serviço vinculado
              </label>
              <select
                id="servico_origem_id"
                name="servico_origem_id"
                value={form.servico_origem_id}
                onChange={handleChange}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              >
                {servicos
                  .filter((s) => s.ativo && !s.eh_manutencao)
                  .map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.nome}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Faixa de dias em que essa manutenção vale (opcional): "A partir
              de" em branco = vale desde o início do prazo; "Até" em branco =
              sem limite superior. Só existe numa manutenção. */}
          {form.ehManutencao && (
            <div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label
                    htmlFor="prazoInicioDias"
                    className="mb-1 block text-sm font-medium text-body"
                  >
                    A partir de quantos dias
                  </label>
                  <input
                    id="prazoInicioDias"
                    name="prazoInicioDias"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    value={form.prazoInicioDias}
                    onChange={handleChange}
                    placeholder="Ex.: 20"
                    className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                <div className="flex-1">
                  <label
                    htmlFor="prazoFimDias"
                    className="mb-1 block text-sm font-medium text-body"
                  >
                    Até quantos dias
                  </label>
                  <input
                    id="prazoFimDias"
                    name="prazoFimDias"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    value={form.prazoFimDias}
                    onChange={handleChange}
                    placeholder="Ex.: 30"
                    className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-body">
                Deixe &quot;A partir de&quot; em branco se essa manutenção vale desde o
                início do prazo.
              </p>
            </div>
          )}

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

          {/* Ocultar preço/duração na exibição pública (ver renderBotaoServico
              em FormularioAgendamento) — o serviço continua com os valores
              reais no banco, só não aparece pro cliente. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2 text-sm text-body">
              <input
                type="checkbox"
                name="ocultarPreco"
                checked={form.ocultarPreco}
                onChange={handleCheckbox}
                className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
              />
              Ocultar preço
            </label>
            <label className="flex items-center gap-2 text-sm text-body">
              <input
                type="checkbox"
                name="ocultarDuracao"
                checked={form.ocultarDuracao}
                onChange={handleCheckbox}
                className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
              />
              Ocultar duração
            </label>
          </div>

          {/* Alerta exibido ao cliente ao escolher este serviço no /agendar
              (ver bloco de alerta em FormularioAgendamento). Desmarcar some
              com a textarea E limpa o texto (grava null ao salvar). */}
          <div>
            <label className="flex items-center gap-2 text-sm text-body">
              <input
                type="checkbox"
                name="adicionarAlerta"
                checked={form.adicionarAlerta}
                onChange={handleToggleAlerta}
                className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
              />
              Adicionar alerta
            </label>
            {form.adicionarAlerta && (
              <textarea
                name="alertaMensagem"
                value={form.alertaMensagem}
                onChange={handleChange}
                rows={3}
                placeholder="Ex.: Traga uma foto de referência do corte desejado."
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            )}
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

      {/* Acordeão único: cada categoria é um cabeçalho retrátil (mesmo padrão
          visual/interativo do /agendar) com os serviços dela dentro; o grupo
          "Sem categoria" sempre por último. Some enquanto o formulário está
          aberto pra manter o foco numa coisa só (mobile). */}
      {!editando && (
        <>
          {erroAcaoCategoria && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erroAcaoCategoria}
            </p>
          )}
          {erroReordenar && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erroReordenar}
            </p>
          )}

          {carregandoCategorias ? (
            <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
              Carregando categorias...
            </p>
          ) : erroCategorias ? (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
              {erroCategorias}
            </p>
          ) : categorias.length === 0 && servicosAtivos.length === 0 ? (
            <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
              Nenhum serviço cadastrado.
            </p>
          ) : (
            <div className="space-y-3">
              {categoriasOrdenadas.map((categoria, indice) => {
                const servicosDaCategoria = servicos.filter(
                  (s) => s.categoria_id === categoria.id && s.ativo && !s.oculto
                );
                const aberta = grupoAberto === categoria.id;
                const renomeando = categoriaEditandoId === categoria.id;

                return (
                  <div
                    key={categoria.id}
                    className="rounded-2xl bg-card shadow-sm ring-1 ring-border"
                  >
                    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      {/* Nome em linha própria e largura total no mobile — a
                          linha abaixo (setas + badge + botões) não sobra
                          espaço suficiente pro nome quando tudo fica lado a
                          lado. A partir de sm: o nome volta a integrar a
                          mesma linha (ver span "hidden sm:inline" abaixo). */}
                      {!renomeando && (
                        <span className="w-full min-w-0 line-clamp-2 font-semibold text-heading sm:hidden">
                          {categoria.nome}
                        </span>
                      )}

                      <div className="flex items-center gap-2 sm:min-w-0 sm:flex-1">
                        <div className="flex shrink-0 flex-col">
                          <button
                            type="button"
                            onClick={() => moverCategoria(categoria, -1)}
                            disabled={ocupadoCategoria || indice === 0}
                            aria-label="Mover categoria para cima"
                            className="px-2 py-1 text-2xl leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => moverCategoria(categoria, 1)}
                            disabled={ocupadoCategoria || indice === categoriasOrdenadas.length - 1}
                            aria-label="Mover categoria para baixo"
                            className="px-2 py-1 text-2xl leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ▼
                          </button>
                        </div>

                        {renomeando ? (
                          <>
                            <input
                              type="text"
                              value={nomeEdicaoCategoria}
                              onChange={(e) => setNomeEdicaoCategoria(e.target.value)}
                              className="min-w-0 flex-1 rounded-lg border border-border px-2 py-1.5 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                            />
                            <button
                              type="button"
                              onClick={() => salvarRenomeCategoria(categoria)}
                              disabled={ocupadoCategoria || !nomeEdicaoCategoria.trim()}
                              className="shrink-0 rounded-lg bg-green-50 px-2.5 py-1.5 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={() => setCategoriaEditandoId(null)}
                              className="shrink-0 rounded-lg bg-card px-2.5 py-1.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => alternarGrupo(categoria.id)}
                              aria-expanded={aberta}
                              className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1 text-left"
                            >
                              <span className="hidden min-w-0 line-clamp-2 font-semibold text-heading sm:inline">
                                {categoria.nome}
                              </span>
                              <span className="flex shrink-0 items-center gap-1 text-xs text-body">
                                {servicosDaCategoria.length} serviço
                                {servicosDaCategoria.length === 1 ? "" : "s"}
                                <span aria-hidden="true">{aberta ? "▲" : "▼"}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => abrirRenomearCategoria(categoria)}
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
                      </div>
                    </div>

                    {aberta && (
                      <div className="border-t border-border p-4">
                        {servicosDaCategoria.length === 0 ? (
                          <p className="rounded-lg bg-surface px-3 py-3 text-center text-sm text-body ring-1 ring-border">
                            Nenhum serviço nesta categoria.
                          </p>
                        ) : (
                          <ul className="space-y-3">
                            {servicosDaCategoria.map((s) => renderServicoItem(s))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {servicosSemCategoria.length > 0 && (
                <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
                  <button
                    type="button"
                    onClick={() => alternarGrupo(SEM_CATEGORIA)}
                    aria-expanded={grupoAberto === SEM_CATEGORIA}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                  >
                    <span className="font-semibold text-heading">Sem categoria</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-body">
                      {servicosSemCategoria.length} serviço
                      {servicosSemCategoria.length === 1 ? "" : "s"}
                      <span aria-hidden="true">
                        {grupoAberto === SEM_CATEGORIA ? "▲" : "▼"}
                      </span>
                    </span>
                  </button>

                  {grupoAberto === SEM_CATEGORIA && (
                    <div className="border-t border-border p-4">
                      <ul className="space-y-3">
                        {servicosSemCategoria.map((s) => renderServicoItem(s))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Seção retrátil, fechada por padrão, com os serviços ativo=false
              — cada um só com "Reativar" e "Excluir permanentemente" (ver
              renderServicoDesativado). Fica fora do bloco acima de propósito:
              deve aparecer mesmo quando não há categoria/serviço ativo pra
              montar o acordeão principal. */}
          {servicosInativos.length > 0 && (
            <div className="mt-3 rounded-2xl bg-card shadow-sm ring-1 ring-border">
              <button
                type="button"
                onClick={() => setSecaoDesativadosAberta((v) => !v)}
                aria-expanded={secaoDesativadosAberta}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <span className="font-semibold text-heading">
                  Serviços desativados ({servicosInativos.length})
                </span>
                <span aria-hidden="true" className="shrink-0 text-xs text-body">
                  {secaoDesativadosAberta ? "▲" : "▼"}
                </span>
              </button>

              {secaoDesativadosAberta && (
                <div className="border-t border-border p-4">
                  <ul className="space-y-3">
                    {servicosInativos.map((s) => renderServicoDesativado(s))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Aviso de conflito de faixa de dias entre manutenções do mesmo
          servico_origem_id (ver checagem em handleSalvar). Só fecha, não
          salva nada — o usuário precisa ajustar o prazo e tentar de novo. */}
      {conflitoManutencao && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-conflito-manutencao"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setConflitoManutencao(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-conflito-manutencao"
              className="text-lg font-semibold text-heading"
            >
              Prazo em conflito
            </h2>
            <p className="mt-2 text-sm text-body">
              Esse prazo conflita com a manutenção{" "}
              <span className="font-medium text-heading">
                &apos;{conflitoManutencao.nome}&apos;
              </span>
              , que já cobre de {conflitoManutencao.faixa}. Ajuste o prazo
              antes de salvar.
            </p>

            <div className="mt-6">
              <button
                type="button"
                onClick={() => setConflitoManutencao(null)}
                className="w-full rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação do soft delete. Deixa claro que o histórico é
          preservado (o serviço só fica inativo). */}
      {servicoParaDesativar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-desativar-servico"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setServicoParaDesativar(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-desativar-servico"
              className="text-lg font-semibold text-heading"
            >
              Desativar serviço
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja desativar{" "}
              <span className="font-medium text-heading">
                {servicoParaDesativar.nome}
              </span>
              ? Ele deixará de aparecer para novos agendamentos, mas os
              agendamentos antigos são preservados.
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => handleDesativar(servicoParaDesativar)}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Confirmar desativação
              </button>
              <button
                type="button"
                onClick={() => setServicoParaDesativar(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação da exclusão PERMANENTE (DELETE físico), a partir
          da seção "Serviços desativados". Se houver agendamentos vinculados,
          handleExcluirPermanente não apaga de fato (evita erro de FK) e
          fecha o modal em silêncio — sem expor esse detalhe técnico aqui. */}
      {servicoParaExcluirPermanente && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-excluir-permanente-servico"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setServicoParaExcluirPermanente(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-excluir-permanente-servico"
              className="text-lg font-semibold text-heading"
            >
              Excluir permanentemente
            </h2>
            <p className="mt-2 text-sm text-body">
              Deseja excluir esse serviço permanentemente? Essa ação não pode
              ser desfeita.
            </p>

            {erroExcluirPermanente && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroExcluirPermanente}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => handleExcluirPermanente(servicoParaExcluirPermanente)}
                disabled={excluindoPermanente}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {excluindoPermanente ? "Excluindo..." : "Confirmar exclusão"}
              </button>
              <button
                type="button"
                onClick={() => setServicoParaExcluirPermanente(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de exclusão de categoria. Deixa claro que os serviços só
          ficam sem categoria (não são apagados). */}
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
                onClick={() => apagarCategoria(categoriaParaExcluir)}
                disabled={ocupadoCategoria}
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

      {/* Confirmação de exclusão de pergunta. As opções vinculadas somem
          junto (ON DELETE CASCADE no banco). */}
      {perguntaParaExcluir && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-excluir-pergunta"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setPerguntaParaExcluir(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="titulo-excluir-pergunta" className="text-lg font-semibold text-heading">
              Excluir pergunta
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja excluir{" "}
              <span className="font-medium text-heading">
                {perguntaParaExcluir.pergunta.texto}
              </span>
              ? As opções vinculadas também serão excluídas.
            </p>

            {erroExcluirPergunta && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroExcluirPergunta}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={handleExcluirPergunta}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Confirmar exclusão
              </button>
              <button
                type="button"
                onClick={() => setPerguntaParaExcluir(null)}
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

// Reordena a lista pela mesma chave da query (categoria_id, ordem — "sem
// categoria" primeiro). Usado após inserts/updates locais pra manter a ordem
// consistente sem refetch. `nome` só entra como desempate (ordem já é única
// dentro do grupo, mas cobre o caso raro de dado legado sem ordem definida).
function ordenar(lista) {
  return [...lista].sort((a, b) => {
    if (a.categoria_id !== b.categoria_id) {
      if (a.categoria_id == null) return -1;
      if (b.categoria_id == null) return 1;
      return a.categoria_id - b.categoria_id;
    }
    if (a.ordem !== b.ordem) return (a.ordem ?? 0) - (b.ordem ?? 0);
    return a.nome.localeCompare(b.nome);
  });
}

// Serviços do mesmo grupo VISUAL de `servico` (mesmo categoria_id, null
// incluso), na ordem já vigente em `lista` — usado pra achar o vizinho de
// cima/baixo e desenhar as setinhas, mantendo consistência com o
// agrupamento exibido no acordeão.
function grupoDaCategoria(lista, servico) {
  return lista.filter((s) => s.categoria_id === servico.categoria_id);
}

// Patch imutável do campo `ativo` de um serviço na lista.
function atualizarAtivo(lista, id, ativo) {
  return lista.map((s) => (s.id === id ? { ...s, ativo } : s));
}

// Ordena as categorias pela sequência de exibição (ordem asc, depois nome).
// Usado após inserts/updates locais pra manter a ordem consistente sem refetch.
function ordenarCategorias(lista) {
  return [...lista].sort((a, b) => {
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return a.nome.localeCompare(b.nome);
  });
}


