"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { calcularVagasPorHorario } from "@/lib/disponibilidade";
import { buscarTema } from "@/lib/temas";
import {
  calcularPrecoManutencao,
  buscarVencimentoManutencao,
} from "@/lib/manutencaoSugerida";

// Wizard de agendamento COMPARTILHADO entre o fluxo público (/agendar, cria
// "pendente") e a aba Agendar do /admin (cria "confirmado"). Toda a lógica de
// serviços, geração de slots, ocupados, validação e insert vive AQUI — os
// consumidores só fornecem a diferença via props (status do insert, rótulo do
// botão, o que fazer no sucesso) e o layout ao redor (Hero, header, tela de
// confirmação). NÃO duplicar a lógica de slots/ocupados em outro lugar.

const ESTADO_INICIAL = {
  nome: "",
  telefone: "",
  data: "",
};

// Ordem das etapas do wizard. Usada pelo indicador de progresso e pela
// navegação "Voltar" (cada etapa volta para a anterior nesta sequência).
const ETAPAS = [
  { id: "servico", rotulo: "Serviço" },
  { id: "data", rotulo: "Data" },
  { id: "dados", rotulo: "Dados" },
];

const DIAS_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

// "YYYY-MM-DD" de hoje em horário local — usado como mínimo do date picker.
function dataDeHoje() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// "HH:MM" da hora atual em horário local — usado pra esconder, na data de
// hoje, os slots que já passaram. Zero-padded de tamanho fixo, igual aos
// slots gerados, pra que a comparação de string ("HH:MM" <= "HH:MM") bata.
function horaDeAgora() {
  const agora = new Date();
  const hora = String(agora.getHours()).padStart(2, "0");
  const min = String(agora.getMinutes()).padStart(2, "0");
  return `${hora}:${min}`;
}

// Date -> "YYYY-MM-DD" em horário LOCAL (a mesma chave usada nas queries e na
// comparação com `hoje`). Montado componente-a-componente pra não sofrer o
// deslocamento de fuso de toISOString() (que converte pra UTC).
function formatarISO(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Cabeçalho do calendário: iniciais dos dias no padrão Date.getDay()
// (0=domingo … 6=sábado).
const DIAS_SEMANA_CURTO = ["D", "S", "T", "Q", "Q", "S", "S"];

// "YYYY-MM-DD" -> "dd/mm · dia da semana". Parse manual pra evitar o
// deslocamento de fuso que new Date("YYYY-MM-DD") sofre (vira UTC). Exportado
// pra tela de confirmação do consumidor reaproveitar a mesma formatação.
export function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")} · ${DIAS_SEMANA[d.getDay()]}`;
}

// preco_centavos (ex.: 3500) -> "R$ 35,00".
export function formatarPreco(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Botão de um serviço na etapa "Serviço". Extraído porque é renderizado nos dois
// lugares da lista agrupada (serviços sem categoria + dentro de cada acordeão);
// o visual é o mesmo que antes.
function BotaoServico({ servico, selecionado, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(servico)}
      aria-pressed={selecionado}
      className={[
        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left ring-1 transition",
        selecionado
          ? "bg-primary text-white ring-primary"
          : "bg-card text-body ring-border hover:border-primary hover:ring-primary",
      ].join(" ")}
    >
      <span className="min-w-0">
        <span className="block font-medium">{servico.nome}</span>
        <span
          className={[
            "block text-sm",
            selecionado ? "text-on-primary/90" : "text-body",
          ].join(" ")}
        >
          {servico.duracao_min} min
        </span>
      </span>

      {servico.preco_centavos != null && (
        <span className="shrink-0 font-medium">
          {formatarPreco(servico.preco_centavos)}
        </span>
      )}
    </button>
  );
}

// Iniciais do nome para o avatar do card de profissional (ex.: "João Silva" ->
// "JS"). Usa só a primeira e a última palavra, em maiúsculas.
function iniciais(nome) {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

// Encaixe automático (toggle DESLIGADO): entre os profissionais livres no
// horário, escolhe o MENOS ocupado no dia. Conta os agendamentos ativos (status
// <> 'cancelado') de cada candidato na data; empate resolve pelo menor id, pra
// ser determinístico. Se a consulta falhar, cai no primeiro candidato — a
// exclusion constraint do banco ainda protege contra sobreposição real.
async function escolherMenosOcupado(estabelecimentoId, data, candidatos) {
  const contagem = new Map(candidatos.map((id) => [id, 0]));

  const { data: reservas, error } = await supabase
    .from("agendamentos")
    .select("profissional_id")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("data", data)
    .neq("status", "cancelado");

  if (!error) {
    for (const r of reservas ?? []) {
      if (contagem.has(r.profissional_id)) {
        contagem.set(r.profissional_id, contagem.get(r.profissional_id) + 1);
      }
    }
  }

  return [...contagem.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
}

// Calendário mensal próprio para a etapa Data. O <input type="date"> nativo não
// permite cinzar dias específicos por dia da semana, então montamos a grade à
// mão. Um dia nasce DESABILITADO (cinza, não clicável) quando é passado (< min)
// ou quando o seu dia da semana não está em `diasSemanaAtivos` — o conjunto de
// dias em que há profissional elegível trabalhando (calculado por quem chama).
//
// Props:
//   mes              – Date no primeiro dia do mês exibido.
//   min              – "YYYY-MM-DD" mínimo (hoje); datas anteriores ficam cinza.
//   diasSemanaAtivos – Set<number> de dias da semana (0–6) com atendimento.
//   selecionado      – "YYYY-MM-DD" atualmente escolhido (destaca a célula).
//   onSelecionar     – recebe o "YYYY-MM-DD" do dia clicado (só dias válidos).
//   onPrev/onNext    – navegação de mês. podeVoltar trava o passado.
//   vencimentoManutencao – Date (meia-noite local) do vencimento da manutenção
//                   selecionada, ou null. Quando presente, só INFORMA (não
//                   bloqueia): dias até e incluindo o vencimento ganham um
//                   fundo verde sutil, dias após ganham laranja. Um dia
//                   desabilitado (cinza, sem profissional) mantém prioridade
//                   visual sobre essas cores.
function CalendarioDias({
  mes,
  min,
  diasSemanaAtivos,
  selecionado,
  onSelecionar,
  onPrev,
  onNext,
  podeVoltar,
  vencimentoManutencao,
}) {
  const ano = mes.getFullYear();
  const mesIdx = mes.getMonth();
  const primeiroDiaSemana = new Date(ano, mesIdx, 1).getDay();
  const diasNoMes = new Date(ano, mesIdx + 1, 0).getDate();

  // Células: brancos para alinhar o dia 1 ao seu dia da semana, depois 1..N.
  const celulas = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);

  const rotuloMes = mes.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-border">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          disabled={!podeVoltar}
          aria-label="Mês anterior"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <span className="text-sm font-semibold capitalize text-heading">
          {rotuloMes}
        </span>

        <button
          type="button"
          onClick={onNext}
          aria-label="Próximo mês"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-body ring-1 ring-border transition hover:bg-surface"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
        {DIAS_SEMANA_CURTO.map((n, i) => (
          <span key={i} className="py-1">
            {n}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {celulas.map((d, i) => {
          if (d === null) return <span key={`vazio-${i}`} />;

          const date = new Date(ano, mesIdx, d);
          const iso = formatarISO(date);
          const passado = iso < min;
          const fechado = !diasSemanaAtivos.has(date.getDay());
          const desabilitado = passado || fechado;
          const sel = iso === selecionado;
          const dentroDoPrazo =
            vencimentoManutencao != null && date <= vencimentoManutencao;
          const foraDoPrazo =
            vencimentoManutencao != null && date > vencimentoManutencao;

          return (
            <button
              key={iso}
              type="button"
              disabled={desabilitado}
              aria-disabled={desabilitado}
              aria-pressed={sel}
              onClick={() => onSelecionar(iso)}
              className={[
                "flex h-9 items-center justify-center rounded-lg text-sm transition",
                desabilitado
                  ? "cursor-not-allowed text-muted/40"
                  : sel
                  ? "bg-primary font-semibold text-white ring-1 ring-primary"
                  : dentroDoPrazo
                  ? "bg-green-50 text-body ring-1 ring-green-200 hover:border-primary hover:ring-primary"
                  : foraDoPrazo
                  ? "bg-orange-50 text-body ring-1 ring-orange-200 hover:border-primary hover:ring-primary"
                  : "text-body ring-1 ring-border hover:border-primary hover:ring-primary",
              ].join(" ")}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Props:
//   estabelecimento – salão resolvido pelo slug do path ({ id, nome, whatsapp }). O
//                   consumidor só monta o formulário DEPOIS de resolvê-lo, então
//                   aqui ele é sempre não-nulo. Particiona serviços, ocupados e
//                   o insert por estabelecimento_id.
//   status        – status gravado no insert. Omitido (undefined) => mantém o
//                   default do banco ("pendente"), comportamento do público.
//                   O /admin passa "confirmado".
//   rotuloSubmit  – texto do botão de envio (default "Confirmar agendamento").
//   onSucesso     – callback após insert OK, recebe { form, servico, horario }.
//                   O consumidor decide o que mostrar/recarregar; remontar este
//                   componente (via prop key) zera o formulário pro próximo.
//   forcarEscolhaProfissional – liga o seletor de profissional INDEPENDENTE do
//                   toggle escolha_profissional do salão. Usado no /admin, onde o
//                   dono sempre escolhe o profissional ao marcar. No público fica
//                   false, então lá o modo continua vindo só do banco.
//   clienteInicial – { id, nome, telefone } de um cliente já identificado antes
//                   do formulário (ex.: IdentificacaoCliente no público). Quando
//                   presente, pré-preenche nome/telefone e a etapa "dados" troca
//                   os inputs por um resumo de confirmação — o insert continua
//                   lendo form.nome/form.telefone normalmente. Omitido (o /admin
//                   não passa), a etapa pede nome/WhatsApp como sempre.
//   clienteEhNovo – true quando o cliente identificado acabou de se cadastrar
//                   agora (veio do CadastroCliente, não de um número já
//                   conhecido). Alimenta precisaSinal (sinal_regra === 'novos').
//                   Default false — o /admin não passa.
//   nomeProfissionalContato – mesmo nome exibido no botão fixo ContatoDono
//                   (menor id ativo, ou "a equipe"). Usado só no texto do
//                   bloco do sinal; buscado uma vez em app/[salon]/page.js e
//                   repassado aqui pra não duplicar a query.
//   servicoInicial – linha de `servicos` (mesmo formato da query de serviços
//                   abaixo) já escolhida ANTES do wizard abrir — ex.: o card de
//                   sugestão de manutenção do PainelCliente. Pula a etapa
//                   "servico" e cai direto em "data". Omitido (o normal), a
//                   etapa "servico" funciona como sempre.
export default function FormularioAgendamento({
  estabelecimento,
  status,
  rotuloSubmit = "Confirmar agendamento",
  onSucesso,
  forcarEscolhaProfissional = false,
  clienteInicial = null,
  clienteEhNovo = false,
  nomeProfissionalContato = "a equipe",
  servicoInicial = null,
}) {
  const [form, setForm] = useState(() => ({
    ...ESTADO_INICIAL,
    nome: clienteInicial?.nome ?? ESTADO_INICIAL.nome,
    telefone: clienteInicial?.telefone ?? ESTADO_INICIAL.telefone,
  }));
  const [horarioSelecionado, setHorarioSelecionado] = useState("");

  // Id da reserva criada ANTECIPADAMENTE (fluxo público, sem `status`): assim
  // que a cliente toca num horário, já inserimos a linha em "aguardando_sinal"
  // ou "pendente" pra travar a vaga enquanto ela preenche nome/WhatsApp. O
  // submit final vira um UPDATE dessa linha em vez de um novo insert. Fluxo
  // /admin (com `status`) nunca usa isso — segue com o insert único de sempre.
  const [agendamentoId, setAgendamentoId] = useState(null);

  // Etapa atual do wizard. Controla só a RENDERIZAÇÃO — a lógica de dados
  // (form, ocupados, validações) permanece a mesma de quando era página única.
  const [etapa, setEtapa] = useState("servico");

  const [servicos, setServicos] = useState([]);
  const [servicoSelecionado, setServicoSelecionado] = useState(servicoInicial);
  // Enquanto true, ainda não decidimos se dá pra pular a etapa "servico" pro
  // servicoInicial — depende da config escolha_profissional, que só chega
  // depois do fetch em `carregar` (ver efeito abaixo). Sem servicoInicial,
  // nasce false e nunca entra em jogo.
  const [servicoInicialPendente, setServicoInicialPendente] = useState(
    Boolean(servicoInicial)
  );
  // Serviço com alerta_mensagem que o cliente acabou de tocar, aguardando
  // confirmação no modal (ver selecionarServico/confirmarAlerta/cancelarAlerta).
  // A seleção de fato só acontece se o modal for confirmado.
  const [alertaPendente, setAlertaPendente] = useState(null);
  // Preço a exibir/cobrar quando servicoSelecionado é uma manutenção — null
  // enquanto não se aplica (serviço normal) ou ainda calculando (ver efeito
  // abaixo, que chama calcularPrecoManutencao assim que serviço + telefone da
  // cliente estão disponíveis). { centavos, valorCheio } quando pronto.
  const [precoManutencao, setPrecoManutencao] = useState(null);
  // Vencimento (Date à meia-noite local) da manutenção selecionada, pra
  // colorir o calendário da etapa "Data" — ver buscarVencimentoManutencao e o
  // efeito abaixo. null enquanto não se aplica (serviço normal) ou sem
  // atendimento de referência (cliente nova pro serviço de origem).
  const [vencimentoManutencao, setVencimentoManutencao] = useState(null);
  const [carregandoServicos, setCarregandoServicos] = useState(true);
  const [erroServicos, setErroServicos] = useState("");

// Categorias do salão (categorias_servico), na ordem de exibição (`ordem`).
  // Usadas só para agrupar a lista de serviços em acordeões. `categoriaAberta`
  // guarda o id da categoria expandida (só uma por vez); null = todas fechadas.

  // Perguntas do serviço selecionado (servico_perguntas + suas
  // servico_pergunta_opcoes), buscadas em confirmarSelecaoServico. Vazio ->
  // popup não abre e o fluxo segue direto (ver avancarAposServico).
  const [perguntasServico, setPerguntasServico] = useState([]);
  const [modalPerguntasAberto, setModalPerguntasAberto] = useState(false);
  // Respostas do cliente no popup, por pergunta_id: { opcaoId } pra
  // sim_nao/multipla_escolha, { textoLivre } pra texto_livre. Alimentam tanto
  // a validação (confirmarModalPerguntas) quanto o cálculo de ajuste de preço
  // (ver calcularAjustePerguntas) e a gravação em agendamento_respostas.
  const [respostasPerguntas, setRespostasPerguntas] = useState({});
  const [erroModalPerguntas, setErroModalPerguntas] = useState("");
  const [categorias, setCategorias] = useState([]);
  const [categoriaAberta, setCategoriaAberta] = useState(null);

  // Mapa horário -> [profissional_id livres], vindo de calcularVagasPorHorario.
  const [vagas, setVagas] = useState({});
  const [carregandoSlots, setCarregandoSlots] = useState(false);
  const [erroSlots, setErroSlots] = useState("");

  // Preferência do salão: cliente escolhe o profissional (true) ou o sistema
  // encaixa automaticamente (false). Lida do banco junto com os serviços.
  const [escolhaProfissional, setEscolhaProfissional] = useState(false);

  // Flag EFETIVO usado por toda a lógica de modo: o admin força o seletor
  // (forcarEscolhaProfissional), senão vale o toggle do salão. O state acima
  // guarda só o valor cru do banco; daqui pra baixo tudo lê `escolherProfissional`.
  const escolherProfissional = forcarEscolhaProfissional || escolhaProfissional;

  // Resolve o pulo de etapa do servicoInicial assim que a config
  // escolha_profissional carrega (carregandoServicos vira false). Sem exigir
  // profissional, vai direto pra "data" — igual confirmarSelecaoServico faz
  // pra qualquer serviço no encaixe automático. Exigindo, fica em "servico"
  // (a lista de serviços não atrapalha: com servicoSelecionado já preenchido,
  // os cards de profissional já aparecem logo abaixo dela). Ajuste de estado
  // durante a renderização (não um efeito — dispara só na transição
  // true -> false, comparando com o valor da renderização anterior).
  const [carregandoServicosAnterior, setCarregandoServicosAnterior] = useState(
    carregandoServicos
  );
  if (carregandoServicos !== carregandoServicosAnterior) {
    setCarregandoServicosAnterior(carregandoServicos);
    if (servicoInicialPendente && !carregandoServicos) {
      if (!escolherProfissional) setEtapa("data");
      setServicoInicialPendente(false);
    }
  }

  // Profissionais ATIVOS que atendem o serviço escolhido, cada um já com seus
  // dias de trabalho (horarios_trabalho.dia_semana) embutidos — carregados nos
  // dois modos: no "cliente escolhe" alimentam os cards, e sempre alimentam os
  // dias disponíveis do calendário. `profissionalSelecionado` só é usado no
  // fluxo "cliente escolhe".
  const [profissionaisDoServico, setProfissionaisDoServico] = useState([]);
  const [profissionalSelecionado, setProfissionalSelecionado] = useState(null);
  const [carregandoProfissionais, setCarregandoProfissionais] = useState(false);

  // Refs para rolar suavemente até o bloco que surge após cada escolha, pra ele
  // não passar despercebido abaixo da dobra (salões com muitos serviços). Vale
  // no público e no /admin, já que o componente é compartilhado.
  const profissionalRef = useRef(null);
  const dataRef = useRef(null);

  // scrollIntoView só depois do render que monta o bloco alvo: rAF garante que
  // o elemento (e a ref) já existem no DOM.
  function rolarPara(ref) {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // Mês exibido no calendário da etapa Data (sempre no dia 1 do mês).
  const [mesVisivel, setMesVisivel] = useState(() => {
    const agora = new Date();
    return new Date(agora.getFullYear(), agora.getMonth(), 1);
  });

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  // Sinal de reserva: regra do salão decide se é exigido (todos, só novos
  // clientes, ou nunca). O cliente declara (não comprovante) que já pagou via
  // Pix antes de liberar o botão de confirmar.
  const precisaSinal =
    estabelecimento.sinal_regra === "todos" ||
    (estabelecimento.sinal_regra === "novos" && clienteEhNovo);
  const [sinalDeclarado, setSinalDeclarado] = useState(false);
  const [chavePixCopiada, setChavePixCopiada] = useState(false);

  async function copiarChavePix() {
    try {
      await navigator.clipboard.writeText(estabelecimento.sinal_chave_pix ?? "");
      setChavePixCopiada(true);
      setTimeout(() => setChavePixCopiada(false), 2000);
    } catch {
      // Clipboard indisponível (permissão negada, contexto não seguro etc.):
      // a chave já está visível na tela pra copiar manualmente.
    }
  }

  // Ao montar, busca em paralelo os serviços ativos (ordenados por
  // categoria_id, ordem — mesmo critério configurado na aba Serviços do
  // admin, via as setinhas de reordenação) e a preferência escolha_profissional
  // do salão. Resolver os dois JUNTOS garante que o modo (cliente escolhe x
  // encaixe automático) já é conhecido antes de o cliente conseguir tocar num
  // serviço. Se a config falhar, mantém o default false (encaixe automático).
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const [resServicos, resConfig, resCategorias] = await Promise.all([
        supabase
          .from("servicos")
          .select(
            "id, nome, duracao_min, preco_centavos, categoria_id, ocultar_preco, ocultar_duracao, alerta_mensagem, servico_origem_id"
          )
          .eq("estabelecimento_id", estabelecimento.id)
          .eq("ativo", true)
          .order("categoria_id", { ascending: true, nullsFirst: true })
          .order("ordem", { ascending: true }),
        supabase
          .from("estabelecimentos")
          .select("escolha_profissional")
          .eq("id", estabelecimento.id)
          .single(),
        supabase
          .from("categorias_servico")
          .select("id, nome, ordem")
          .eq("estabelecimento_id", estabelecimento.id)
          .order("ordem", { ascending: true })
          .order("nome", { ascending: true }),
      ]);

      if (!ativo) return;

      if (resServicos.error) {
        setErroServicos(resServicos.error.message);
      } else {
        setServicos(resServicos.data ?? []);
      }
      // Categorias são só para agrupar a UI; se falharem, os serviços caem todos
      // no bloco "sem categoria" (nenhum grupo casa), sem quebrar a etapa.
      setCategorias(resCategorias.error ? [] : resCategorias.data ?? []);
      setEscolhaProfissional(Boolean(resConfig.data?.escolha_profissional));
      // Sem categorias cadastradas (ou erro na consulta), a lista de serviços
      // simplesmente não agrupa — não impede a etapa de funcionar.
      setCategorias(resCategorias.error ? [] : resCategorias.data ?? []);
      setCarregandoServicos(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Ao escolher um serviço, carrega os profissionais ATIVOS que o atendem, cada
  // um com seus dias de trabalho embutidos — horarios_trabalho.dia_semana (modo
  // 'janela') OU horarios_fixos.dia_semana (modo 'fixo'; ver diasSemanaAtivos,
  // que escolhe a fonte certa por profissional). Roda nos DOIS modos: alimenta
  // os cards (quando o cliente escolhe) e sempre os dias disponíveis do
  // calendário. Sem serviço, zera a lista.
  useEffect(() => {
    let ativo = true;

    async function carregarProfissionais() {
      if (!servicoSelecionado) {
        setProfissionaisDoServico([]);
        return;
      }

      setCarregandoProfissionais(true);

      const { data, error } = await supabase
        .from("servico_profissional")
        .select(
          "profissionais!inner(id, nome, ativo, estabelecimento_id, modo_horario, horarios_trabalho(dia_semana), horarios_fixos(dia_semana))"
        )
        .eq("servico_id", servicoSelecionado.id)
        .eq("profissionais.ativo", true)
        .eq("profissionais.estabelecimento_id", estabelecimento.id);

      if (!ativo) return;

      const lista = error
        ? []
        : (data ?? [])
            .map((v) => v.profissionais)
            .filter(Boolean)
            .sort((a, b) => a.nome.localeCompare(b.nome));
      setProfissionaisDoServico(lista);
      setCarregandoProfissionais(false);
    }

    carregarProfissionais();
    return () => {
      ativo = false;
    };
  }, [servicoSelecionado, estabelecimento.id]);

  // Recalcula o preço de exibição/cobrança quando servicoSelecionado é uma
  // manutenção (ver calcularPrecoManutencao). Precisa do telefone da cliente,
  // que já vem pronto em clienteInicial no fluxo público (identificado ANTES
  // do wizard) mas só chega em form.telefone na etapa "dados" do /admin — daí
  // o efeito reagir aos dois. Serviço normal (sem servico_origem_id) nunca
  // dispara a busca e mantém precoManutencao null — o reset pra null ao TROCAR
  // de serviço mora em confirmarSelecaoServico (efeito só faz a busca, não
  // limpa estado nele mesmo — mesmo padrão do efeito de vagas acima).
  useEffect(() => {
    const telefoneDigitos = (clienteInicial?.telefone ?? form.telefone).replace(
      /\D/g,
      ""
    );

    if (servicoSelecionado?.servico_origem_id == null || telefoneDigitos.length < 10) {
      return;
    }

    let ativo = true;
    calcularPrecoManutencao(
      estabelecimento.id,
      telefoneDigitos,
      servicoSelecionado,
      form.data
    ).then((resultado) => {
      if (ativo) setPrecoManutencao(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [
    servicoSelecionado,
    clienteInicial?.telefone,
    form.telefone,
    form.data,
    estabelecimento.id,
  ]);

  // Busca o vencimento pra colorir o calendário (ver CalendarioDias) quando
  // servicoSelecionado é uma manutenção — mesmo gate de telefone do efeito
  // acima, mas SEM depender de form.data (o vencimento não muda conforme a
  // data escolhida no wizard, só o preço). Reset ao trocar de serviço mora em
  // confirmarSelecaoServico, mesmo padrão do efeito de preço.
  useEffect(() => {
    const telefoneDigitos = (clienteInicial?.telefone ?? form.telefone).replace(
      /\D/g,
      ""
    );

    if (servicoSelecionado?.servico_origem_id == null || telefoneDigitos.length < 10) {
      return;
    }

    let ativo = true;
    buscarVencimentoManutencao(
      estabelecimento.id,
      telefoneDigitos,
      servicoSelecionado
    ).then((resultado) => {
      if (ativo) setVencimentoManutencao(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [
    servicoSelecionado,
    clienteInicial?.telefone,
    form.telefone,
    estabelecimento.id,
  ]);

  const [hoje] = useState(dataDeHoje);

  // Agrupamento da lista de serviços da etapa "servico": soltos no topo os
  // sem categoria (ou apontando pra uma categoria que não existe mais), depois
  // uma seção por categoria (na ordem vinda do banco) só com quem tem >=1
  // serviço ativo. Serviços de manutenção (servico_origem_id preenchido)
  // entram pela própria categoria_id igual a qualquer outro serviço — ficam
  // lado a lado com o serviço de origem no mesmo acordeão.
  const idsCategorias = new Set(categorias.map((c) => c.id));
  const servicosSemCategoria = servicos.filter(
    (s) => s.categoria_id == null || !idsCategorias.has(s.categoria_id)
  );
  const categoriasComServicos = categorias
    .map((c) => ({
      ...c,
      servicos: servicos.filter((s) => s.categoria_id === c.id),
    }))
    .filter((c) => c.servicos.length > 0);

  // Abre/fecha uma categoria no acordeão — só uma aberta por vez.
  function alternarCategoria(id) {
    setCategoriaAberta((atual) => (atual === id ? null : id));
  }

  // Botão de serviço reaproveitado tanto pelos soltos (sem categoria) quanto
  // pelos agrupados dentro de cada categoria aberta.
  function renderBotaoServico(servico) {
    const selecionado = servicoSelecionado?.id === servico.id;
    // Tema (laysla) selecionado: fundo é um TOM CLARO derivado de
    // var(--color-primary) (não mais preenchimento sólido) — texto continua
    // escuro (var(--color-heading)), não branco. A cor em si já vem do
    // wrapper raiz (app/[salon]/page.js); aqui só decidimos SE aplica o tom
    // claro (`tema` presente) em vez do preenchimento sólido padrão.
    const temaSelecionado = tema && selecionado;

    return (
      <button
        key={servico.id}
        type="button"
        onClick={() => selecionarServico(servico)}
        aria-pressed={selecionado}
        className={[
          "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left ring-1 transition",
          selecionado
            ? tema
              ? ""
              : "bg-primary text-white ring-primary"
            : "bg-card text-body ring-border hover:border-primary hover:ring-primary",
        ].join(" ")}
        style={
          temaSelecionado
            ? {
                backgroundColor: "color-mix(in srgb, var(--color-primary) 12%, white)",
                color: "var(--color-heading)",
                "--tw-ring-color": "var(--color-primary)",
              }
            : undefined
        }
      >
        <span className="min-w-0">
          <span className="block font-medium">{servico.nome}</span>
          {!servico.ocultar_duracao && (
            <span
              className={[
                "block text-sm",
                temaSelecionado ? "" : selecionado ? "text-on-primary/90" : "text-body",
              ].join(" ")}
            >
              {servico.duracao_min} min
            </span>
          )}
        </span>

        {servico.preco_centavos > 0 && !servico.ocultar_preco && (
          <span className="shrink-0 font-medium">
            {formatarPreco(servico.preco_centavos)}
          </span>
        )}
      </button>
    );
  }

  // Dias da semana (0–6) com atendimento para o serviço escolhido. No fluxo
  // "cliente escolhe", só conta o profissional selecionado; no encaixe
  // automático, a UNIÃO dos dias de todos os profissionais elegíveis. Cada
  // profissional contribui pela fonte do SEU modo — horarios_trabalho (janela)
  // ou horarios_fixos (fixo) — senão um profissional 'fixo' (sem linha em
  // horarios_trabalho, que só existe pro modo janela) some do calendário
  // inteiro antes mesmo de uma data ser escolhida. Alimenta o calendário: dia
  // da semana fora desse conjunto nasce cinza/desabilitado.
  const diasSemanaAtivos = (() => {
    const fonte = escolherProfissional
      ? profissionaisDoServico.filter((p) => p.id === profissionalSelecionado?.id)
      : profissionaisDoServico;

    const set = new Set();
    fonte.forEach((p) => {
      const linhasDia =
        p.modo_horario === "fixo" ? p.horarios_fixos : p.horarios_trabalho;
      (linhasDia ?? []).forEach((h) => set.add(h.dia_semana));
    });
    return set;
  })();

  // Navegação do calendário: não deixa recuar antes do mês atual.
  const agoraMes = new Date();
  const podeVoltarMes =
    mesVisivel.getFullYear() > agoraMes.getFullYear() ||
    (mesVisivel.getFullYear() === agoraMes.getFullYear() &&
      mesVisivel.getMonth() > agoraMes.getMonth());

  function mesAnterior() {
    setMesVisivel((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  function proximoMes() {
    setMesVisivel((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  // Cancela a reserva antecipada do fluxo público (ver `agendamentoId` acima):
  // marca a linha como "cancelado" pra não bloquear o horário e zera o id. Não
  // faz nada se não houver reserva antecipada em aberto.
  async function cancelarReservaProvisoria() {
    if (!agendamentoId) return;
    await supabase
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("id", agendamentoId);
    setAgendamentoId(null);
  }

  // Seleção de dia no calendário: grava a data e invalida o horário anterior
  // (o efeito de vagas recarrega a grade do novo dia). Se já havia uma reserva
  // antecipada pro horário anterior, cancela antes de trocar de data.
  async function selecionarData(iso) {
    await cancelarReservaProvisoria();
    setForm((anterior) => ({ ...anterior, data: iso }));
    setHorarioSelecionado("");
  }

  // Horários oferecidos = chaves do mapa de vagas. No fluxo "cliente escolhe",
  // filtra só os horários em que o profissional selecionado está livre; no
  // encaixe automático basta existir >=1 profissional livre (a chave existe).
  const horariosBase = Object.keys(vagas)
    .filter((h) =>
      escolherProfissional
        ? profissionalSelecionado != null &&
          vagas[h].includes(profissionalSelecionado.id)
        : true
    )
    .sort();

  // Na data de hoje, esconde o que já passou (comparação por string "HH:MM").
  // Data futura: nada é filtrado.
  const horariosVisiveis =
    form.data === hoje
      ? horariosBase.filter((h) => h > horaDeAgora())
      : horariosBase;

  // Mantém `vagas` (mapa horário -> profissionais livres) sincronizado com a
  // data/serviço selecionados. A flag `ativo` cancela corridas entre datas e
  // evita setState após desmontar. Precisa de serviço escolhido (a duração dele
  // define a grade), o que ambos os fluxos já garantem antes da etapa de data.
  useEffect(() => {
    if (!form.data || !servicoSelecionado) return;
    let ativo = true;

    async function sincronizar() {
      setErroSlots("");
      setCarregandoSlots(true);

      try {
        const mapa = await calcularVagasPorHorario({
          estabelecimentoId: estabelecimento.id,
          servicoId: servicoSelecionado.id,
          data: form.data,
        });
        if (!ativo) return;
        setVagas(mapa);
      } catch (e) {
        if (!ativo) return;
        setErroSlots(e.message ?? String(e));
        setVagas({});
      } finally {
        if (ativo) setCarregandoSlots(false);
      }
    }

    sincronizar();
    return () => {
      ativo = false;
    };
  }, [form.data, servicoSelecionado, estabelecimento.id]);

  // Só os campos de texto (nome, WhatsApp) usam este handler agora — a data é
  // escolhida pelo calendário (selecionarData).
  function handleChange(e) {
    const { name, value } = e.target;
    setForm((anterior) => ({ ...anterior, [name]: value }));
  }

  // Toque num serviço com alerta_mensagem: NÃO seleciona ainda — abre o modal
  // (ver JSX) e espera a confirmação. Sem alerta, segue direto pra seleção de
  // fato (mesmo comportamento de sempre).
  function selecionarServico(servico) {
    if (servico.alerta_mensagem) {
      setAlertaPendente(servico);
      return;
    }
    confirmarSelecaoServico(servico);
  }

  // Seleção de fato de um serviço: muda a duração/grade e a lista de
  // profissionais, então o horário e o profissional escolhidos podem não
  // valer mais — limpamos os dois. Também busca as perguntas vinculadas ao
  // serviço (servico_perguntas); havendo alguma, abre o popup ANTES de
  // avançar (ver avancarAposServico, chamado só depois de confirmarModalPerguntas
  // quando há perguntas, ou direto daqui quando não há).
  async function confirmarSelecaoServico(servico) {
    setServicoSelecionado(servico);
    setHorarioSelecionado("");
    setProfissionalSelecionado(null);
    // Preço e vencimento da manutenção anterior (se houver) não valem mais
    // pro novo serviço — os efeitos acima recalculam do zero quando o novo
    // for manutenção.
    setPrecoManutencao(null);
    setVencimentoManutencao(null);
    // A troca muda os dias/horários válidos: zera a data pra não ficar uma
    // seleção antiga num dia que virou indisponível.
    setForm((anterior) => ({ ...anterior, data: "" }));
setRespostasPerguntas({});
    setErroModalPerguntas("");
    const { data, error } = await supabase
      .from("servico_perguntas")
      .select(
        "id, texto, tipo, ordem, servico_pergunta_opcoes(id, label, ajuste_preco_centavos, ordem)"
      )
      .eq("servico_id", servico.id)
      .order("ordem", { ascending: true })
      .order("ordem", { ascending: true, referencedTable: "servico_pergunta_opcoes" });

    // RLS bloqueando a leitura pro público equivale, aqui, a "sem perguntas":
    // o fluxo segue igual a hoje em vez de travar no popup.
    const perguntas = error ? [] : (data ?? []);
    setPerguntasServico(perguntas);

    if (perguntas.length > 0) {
      setModalPerguntasAberto(true);
      return;
    }
    avancarAposServico();
  }

  // Avanço pós-seleção de serviço: no encaixe automático (toggle off) vai
  // direto pra data; no fluxo "cliente escolhe" fica na etapa de serviço pra
  // escolher o profissional (os cards aparecem logo abaixo), rolando até o
  // elemento certo em cada caso. Extraído de confirmarSelecaoServico pra ser
  // reaproveitado depois do popup de perguntas (ver confirmarModalPerguntas).
  function avancarAposServico() {
    if (!escolherProfissional) {
      setEtapa("data");
      rolarPara(dataRef);
    } else {
      // O seletor de profissional aparece logo abaixo dos serviços: rola até ele.
      rolarPara(profissionalRef);
    }
  }

  // Modal do alerta — "Continuar": confirma a seleção (como se tivesse
  // acabado de tocar no serviço, sem o alerta no caminho).
  function confirmarAlerta() {
    confirmarSelecaoServico(alertaPendente);
    setAlertaPendente(null);
  }

  // Modal do alerta — "Voltar": fecha sem selecionar nada, deixando o cliente
  // escolher outro serviço.
  function cancelarAlerta() {
    setAlertaPendente(null);
  }

  // Registra a resposta de uma pergunta sim_nao/multipla_escolha (opção
  // escolhida) ou texto_livre (texto digitado) — ver popup de perguntas no
  // JSX. Substitui qualquer resposta anterior da mesma pergunta.
  function responderOpcao(perguntaId, opcaoId) {
    setRespostasPerguntas((atual) => ({ ...atual, [perguntaId]: { opcaoId } }));
    setErroModalPerguntas("");
  }

  function responderTexto(perguntaId, valor) {
    setRespostasPerguntas((atual) => ({ ...atual, [perguntaId]: { textoLivre: valor } }));
    setErroModalPerguntas("");
  }

  // Popup de perguntas — "Voltar": fecha sem confirmar e desfaz a seleção do
  // serviço (mesmo espírito do "Voltar" do alerta: o cliente pode escolher
  // outro serviço em vez de responder).
  function cancelarModalPerguntas() {
    setModalPerguntasAberto(false);
    setPerguntasServico([]);
    setRespostasPerguntas({});
    setErroModalPerguntas("");
    setServicoSelecionado(null);
  }

  // Popup de perguntas — "Continuar": só avança se TODAS as perguntas tiverem
  // resposta (opção marcada, ou texto livre não-vazio).
  function confirmarModalPerguntas() {
    for (const pergunta of perguntasServico) {
      const resposta = respostasPerguntas[pergunta.id];
      const respondida =
        pergunta.tipo === "texto_livre"
          ? Boolean(resposta?.textoLivre?.trim())
          : resposta?.opcaoId != null;
      if (!respondida) {
        setErroModalPerguntas("Responda todas as perguntas para continuar.");
        return;
      }
    }
    setErroModalPerguntas("");
    setModalPerguntasAberto(false);
    avancarAposServico();
  }

  // Soma os ajustes de preço (ajuste_preco_centavos) das opções escolhidas —
  // texto_livre nunca ajusta preço. Devolve o total e a lista de itens com
  // ajuste != 0, pra exibição transparente na etapa "Dados" (ver JSX).
  function calcularAjustePerguntas() {
    let centavos = 0;
    const itens = [];
    for (const pergunta of perguntasServico) {
      const resposta = respostasPerguntas[pergunta.id];
      if (resposta?.opcaoId == null) continue;
      const opcao = (pergunta.servico_pergunta_opcoes ?? []).find(
        (o) => o.id === resposta.opcaoId
      );
      if (opcao && opcao.ajuste_preco_centavos !== 0) {
        centavos += opcao.ajuste_preco_centavos;
        itens.push({ label: opcao.label, centavos: opcao.ajuste_preco_centavos });
      }
    }
    return { centavos, itens };
  }

  // Monta as linhas prontas pra inserir em agendamento_respostas (uma por
  // pergunta respondida) — null quando a pergunta ficou sem resposta (não
  // deveria acontecer, confirmarModalPerguntas já valida antes de fechar).
  function linhasRespostasPerguntas(agendamentoId) {
    return perguntasServico
      .map((pergunta) => {
        const resposta = respostasPerguntas[pergunta.id];
        if (!resposta) return null;
        if (pergunta.tipo === "texto_livre") {
          const texto = resposta.textoLivre?.trim();
          if (!texto) return null;
          return {
            agendamento_id: agendamentoId,
            pergunta_id: pergunta.id,
            opcao_id: null,
            texto_livre: texto,
          };
        }
        if (resposta.opcaoId == null) return null;
        return {
          agendamento_id: agendamentoId,
          pergunta_id: pergunta.id,
          opcao_id: resposta.opcaoId,
          texto_livre: null,
        };
      })
      .filter(Boolean);
  }

  // Grava as respostas do popup junto com o agendamento recém-criado.
  // Melhor esforço: agendamento_respostas é uma tabela nova (ver SQL sugerido
  // na conversa) — se a gravação falhar (tabela ainda não existe, RLS etc.),
  // não bloqueia nem desfaz o agendamento já confirmado, só perde esse
  // detalhe complementar.
  async function salvarRespostasPerguntas(agendamentoId) {
    const linhas = linhasRespostasPerguntas(agendamentoId);
    if (linhas.length === 0) return;
    const { error } = await supabase.from("agendamento_respostas").insert(linhas);
    if (error) {
      console.error("Não foi possível salvar as respostas das perguntas:", error.message);
    }
  }

  // Fluxo "cliente escolhe": escolher o profissional conclui a etapa de serviço
  // e leva à de data, onde o calendário e a grade já refletem só a agenda dele.
  function selecionarProfissional(profissional) {
    setProfissionalSelecionado(profissional);
    setHorarioSelecionado("");
    // Cada profissional trabalha em dias diferentes: zera a data ao trocar.
    setForm((anterior) => ({ ...anterior, data: "" }));
    setEtapa("data");
    // Escolher o profissional revela a etapa de data (calendário) abaixo: rola até ela.
    rolarPara(dataRef);
  }

  // Volta para a etapa anterior preservando o que já foi escolhido —
  // não limpa serviço, data nem horário. Se havia uma reserva antecipada
  // (fluxo público) pro horário atual, cancela antes de voltar.
  async function voltarEtapa() {
    await cancelarReservaProvisoria();
    const indice = ETAPAS.findIndex((e) => e.id === etapa);
    if (indice > 0) setEtapa(ETAPAS[indice - 1].id);
  }

  // Clique num horário na etapa "data". Fluxo /admin (`status` fornecido):
  // só marca o horário e avança, o insert único acontece no submit — igual
  // sempre foi. Fluxo público (`status` omitido): já insere a reserva agora
  // ("aguardando_sinal" ou "pendente") pra travar a vaga enquanto a cliente
  // preenche a etapa de dados; o submit final vira um UPDATE dessa linha.
  async function selecionarHorario(slot) {
    setHorarioSelecionado(slot);

    if (status) {
      setEtapa("dados");
      return;
    }

    setErro("");

    let profissionalId;
    if (escolherProfissional) {
      profissionalId = profissionalSelecionado.id;
    } else {
      const livres = vagas[slot] ?? [];
      if (livres.length === 0) {
        setErro("Esse horário acabou de ser reservado. Escolha outro.");
        setHorarioSelecionado("");
        return;
      }
      profissionalId = await escolherMenosOcupado(
        estabelecimento.id,
        form.data,
        livres
      );
    }

    const { data, error } = await supabase
      .from("agendamentos")
      .insert({
        nome_cliente: form.nome,
        telefone: form.telefone,
        data: form.data,
        horario: slot,
        servico_id: servicoSelecionado.id,
        duracao_min: servicoSelecionado.duracao_min,
        estabelecimento_id: estabelecimento.id,
        profissional_id: profissionalId,
        status: precisaSinal ? "aguardando_sinal" : "pendente",
        finalizado: false,
      })
      .select()
      .single();

    if (error) {
      // 23P01 = violação da exclusion constraint agendamentos_sem_sobreposicao:
      // outra reserva sobrepõe esse intervalo — alguém ocupou primeiro.
      const ehHorarioOcupado =
        error.code === "23P01" ||
        /agendamentos_sem_sobreposicao|exclusion constraint/i.test(
          error.message ?? ""
        );

      if (ehHorarioOcupado) {
        setErro("Esse horário acabou de ser reservado. Escolha outro.");
        setHorarioSelecionado("");
        try {
          const mapa = await calcularVagasPorHorario({
            estabelecimentoId: estabelecimento.id,
            servicoId: servicoSelecionado.id,
            data: form.data,
          });
          setVagas(mapa);
        } catch {
          setVagas({});
        }
        return;
      }

      setErro(error.message);
      return;
    }

    setAgendamentoId(data.id);
    await salvarRespostasPerguntas(data.id);
    setEtapa("dados");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");

    if (!form.nome || !form.telefone || !form.data) {
      setErro("Preencha nome, WhatsApp e data para continuar.");
      return;
    }

    // Validação leve: pelo menos 10 dígitos (DDD + número) após limpar a máscara.
    if (form.telefone.replace(/\D/g, "").length < 10) {
      setErro("Informe um WhatsApp válido com DDD.");
      return;
    }

    if (!servicoSelecionado) {
      setErro("Selecione um serviço.");
      return;
    }

    if (!horarioSelecionado) {
      setErro("Selecione um horário disponível.");
      return;
    }

    // No fluxo "cliente escolhe", o profissional é obrigatório.
    if (escolherProfissional && !profissionalSelecionado) {
      setErro("Selecione um profissional.");
      return;
    }

    if (precisaSinal && !sinalDeclarado) {
      setErro("Confirme o pagamento do sinal para continuar.");
      return;
    }

    setEnviando(true);

    // Fluxo público (`status` omitido) com reserva já criada em
    // selecionarHorario: o profissional já foi decidido lá, então o submit
    // vira um UPDATE dessa linha em vez de um novo insert.
    const usaReservaExistente = !status && agendamentoId;

    let error;
    if (usaReservaExistente) {
      ({ error } = await supabase
        .from("agendamentos")
        .update({
          sinal_declarado_pago: precisaSinal ? sinalDeclarado : false,
          status: "pendente",
          finalizado: true,
        })
        .eq("id", agendamentoId));
    } else {
      // Quem fica com a reserva: o escolhido pelo cliente, ou — no encaixe
      // automático — o menos ocupado entre os livres neste horário.
      let profissionalId;
      if (escolherProfissional) {
        profissionalId = profissionalSelecionado.id;
      } else {
        const livres = vagas[horarioSelecionado] ?? [];
        if (livres.length === 0) {
          setEnviando(false);
          setErro("Esse horário acabou de ser reservado. Escolha outro.");
          setHorarioSelecionado("");
          return;
        }
        profissionalId = await escolherMenosOcupado(
          estabelecimento.id,
          form.data,
          livres
        );
      }

      // Payload base idêntico ao do público. `status` só entra quando o
      // consumidor o fornece (admin => "confirmado"); omitido, o banco aplica
      // o default "pendente" — comportamento do /agendar público inalterado.
      const payload = {
        nome_cliente: form.nome,
        telefone: form.telefone,
        data: form.data,
        horario: horarioSelecionado,
        servico_id: servicoSelecionado.id,
        duracao_min: servicoSelecionado.duracao_min,
        estabelecimento_id: estabelecimento.id,
        profissional_id: profissionalId,
        sinal_declarado_pago: precisaSinal ? sinalDeclarado : false,
        finalizado: true,
      };
      if (status) payload.status = status;
      const resultadoInsert = await supabase
        .from("agendamentos")
        .insert(payload)
        .select("id")
        .single();
      error = resultadoInsert.error;
      if (!error) {
        await salvarRespostasPerguntas(resultadoInsert.data.id);
      }
    }

    setEnviando(false);

    if (error) {
      // 23P01 = violação da exclusion constraint agendamentos_sem_sobreposicao:
      // outra reserva sobrepõe esse intervalo — alguém ocupou primeiro.
      const ehHorarioOcupado =
        error.code === "23P01" ||
        /agendamentos_sem_sobreposicao|exclusion constraint/i.test(
          error.message ?? ""
        );

      if (ehHorarioOcupado) {
        setErro("Esse horário acabou de ser reservado. Escolha outro.");
        setHorarioSelecionado("");
        // Recarrega as vagas pra refletir quem ainda está livre neste dia.
        try {
          const mapa = await calcularVagasPorHorario({
            estabelecimentoId: estabelecimento.id,
            servicoId: servicoSelecionado.id,
            data: form.data,
          });
          setVagas(mapa);
        } catch {
          setVagas({});
        }
        return;
      }

      // Outros erros: mostra a mensagem real do Supabase.
      setErro(error.message);
      return;
    }

    // Sucesso: entrega o resumo ao consumidor (tela de confirmação no público,
    // refetch + reset no admin). Não tocamos no layout ao redor daqui.
    onSucesso?.({
      form,
      servico: servicoSelecionado,
      horario: horarioSelecionado,
      // Só faz sentido expor quando foi o cliente quem escolheu; no encaixe
      // automático o profissional é decidido nos bastidores.
      profissional: escolherProfissional ? profissionalSelecionado : null,
    });
  }

  // Tema por salão (lib/temas.js) — mesmo gate do Hero (tema cadastrado).
  // As cores comuns (botão, bordas, indicador de passo, calendário) NÃO são
  // lidas daqui: elas vêm de --color-primary/--color-heading/--color-border/
  // --color-body/--color-muted, sobrescritas UMA VEZ no wrapper raiz de
  // app/[salon]/page.js — este componente só usa `tema` para os dois
  // tratamentos que não são um simples swap de cor (fundo CLARO do
  // serviço/categoria selecionada, ver renderBotaoServico e o acordeão).
  const temaBruto = buscarTema(estabelecimento?.slug);
  const tema = temaBruto?.personalizado ? temaBruto : null;

  // Ajuste de preço das respostas do popup de perguntas (ver
  // calcularAjustePerguntas) somado ao preço base do serviço — o preço da
  // manutenção quando aplicável, senão o preco_centavos normal. Alimenta o
  // box de transparência na etapa "Dados" (ver JSX).
  const { centavos: ajusteCentavosPerguntas, itens: itensAjustePerguntas } =
    calcularAjustePerguntas();
  const precoBaseCentavos =
    servicoSelecionado?.servico_origem_id != null && precoManutencao
      ? precoManutencao.centavos
      : (servicoSelecionado?.preco_centavos ?? 0);

  return (
    <>
      {/* Indicador de progresso do wizard. Etapa atual destacada, etapas
          concluídas marcadas com check, etapas futuras neutras. */}
      <ol className="mb-6 flex items-center gap-2">
        {ETAPAS.map((passo, i) => {
          const indiceAtual = ETAPAS.findIndex((p) => p.id === etapa);
          const concluida = i < indiceAtual;
          const atual = i === indiceAtual;

          return (
            <li
              key={passo.id}
              className="flex flex-1 flex-col items-center gap-1.5"
            >
              <span
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ring-1 transition",
                  atual
                    ? "bg-primary text-white ring-primary"
                    : concluida
                    ? "bg-green-100 text-green-700 ring-green-200"
                    : "bg-card text-body ring-border",
                ].join(" ")}
                aria-current={atual ? "step" : undefined}
              >
                {concluida ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-4 w-4"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={[
                  "text-xs font-medium",
                  atual
                    ? "text-heading"
                    : concluida
                    ? "text-green-700"
                    : "text-body",
                ].join(" ")}
              >
                {passo.rotulo}
              </span>
            </li>
          );
        })}
      </ol>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border"
      >
        {/* Etapa 1 — Serviço: alimenta a duração usada na geração de slots. */}
        {etapa === "servico" && (
          <div>
            <span className="mb-1 block text-sm font-medium text-body">
              Serviço
            </span>

            {carregandoServicos && (
              <p className="text-sm text-body">Carregando serviços...</p>
            )}

            {!carregandoServicos && erroServicos && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroServicos}
              </p>
            )}

            {!carregandoServicos && !erroServicos && servicos.length === 0 && (
              <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                Nenhum serviço disponível no momento.
              </p>
            )}


            {!carregandoServicos &&
              !erroServicos &&
              (servicosSemCategoria.length > 0 ||
                categoriasComServicos.length > 0) && (
                <div className="space-y-2">
                  {servicosSemCategoria.map((servico) =>
                    renderBotaoServico(servico)
                  )}

                  {categoriasComServicos.map((categoria) => {
                    const aberta = categoriaAberta === categoria.id;

                    return (
                      <div
                        key={categoria.id}
                        className="rounded-lg ring-1 ring-border"
                      >
                        <button
                          type="button"
                          onClick={() => alternarCategoria(categoria.id)}
                          aria-expanded={aberta}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left font-medium text-heading transition hover:bg-surface"
                          style={
                            tema && aberta
                              ? {
                                  backgroundColor:
                                    "color-mix(in srgb, var(--color-primary) 12%, white)",
                                  color: "var(--color-heading)",
                                }
                              : undefined
                          }
                        >
                          {categoria.nome}
                          <span aria-hidden="true">{aberta ? "▲" : "▼"}</span>
                        </button>

                        {aberta && (
                          <div className="space-y-2 border-t border-border p-2">
                            {categoria.servicos.map((servico) =>
                              renderBotaoServico(servico)
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

            {/* Fluxo "cliente escolhe": depois de um serviço, mostra os cards
                de profissional (mais elaborados que os quadrados do admin).
                Escolher um leva à etapa de data. */}
            {escolherProfissional && servicoSelecionado && (
              <div ref={profissionalRef} className="mt-6">
                <span className="mb-1 block text-sm font-medium text-body">
                  Profissional
                </span>

                {profissionaisDoServico.length === 0 ? (
                  <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                    Nenhum profissional disponível para este serviço.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {profissionaisDoServico.map((prof) => {
                      const selecionado =
                        profissionalSelecionado?.id === prof.id;

                      return (
                        <button
                          key={prof.id}
                          type="button"
                          onClick={() => selecionarProfissional(prof)}
                          aria-pressed={selecionado}
                          className={[
                            "flex items-center gap-3 rounded-xl px-4 py-3 text-left ring-1 transition",
                            selecionado
                              ? "bg-primary text-white ring-primary shadow-sm"
                              : "bg-card text-body ring-border hover:border-primary hover:ring-primary hover:shadow-sm",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                              selecionado
                                ? "bg-white/20 text-white"
                                : "bg-surface text-heading ring-1 ring-border",
                            ].join(" ")}
                            aria-hidden="true"
                          >
                            {iniciais(prof.nome)}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">
                              {prof.nome}
                            </span>
                            <span
                              className={[
                                "block text-xs",
                                selecionado ? "text-on-primary/80" : "text-muted",
                              ].join(" ")}
                            >
                              Toque para escolher
                            </span>
                          </span>

                          {selecionado && (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                              className="h-5 w-5 shrink-0"
                            >
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Etapa 2 — Data: calendário próprio (dias sem atendimento nascem
            cinza/não clicáveis) e, depois de escolhida a data, a grade de
            horários. */}
        {etapa === "data" && (
          <>
            <div ref={dataRef}>
              <span className="mb-1 block text-sm font-medium text-body">
                Data
              </span>

              {carregandoProfissionais ? (
                <p className="text-sm text-body">
                  Carregando disponibilidade...
                </p>
              ) : diasSemanaAtivos.size === 0 ? (
                <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                  {escolherProfissional
                    ? "Este profissional não tem dias de atendimento."
                    : "Nenhum profissional atende este serviço no momento."}
                </p>
              ) : (
                <CalendarioDias
                  mes={mesVisivel}
                  min={hoje}
                  diasSemanaAtivos={diasSemanaAtivos}
                  selecionado={form.data}
                  onSelecionar={selecionarData}
                  onPrev={mesAnterior}
                  onNext={proximoMes}
                  podeVoltar={podeVoltarMes}
                  vencimentoManutencao={vencimentoManutencao}
                />
              )}
            </div>

            {servicoSelecionado && form.data && (
              <div>
                <span className="mb-1 block text-sm font-medium text-body">
                  Horário
                  {escolherProfissional && profissionalSelecionado && (
                    <span className="font-normal text-muted">
                      {" · "}
                      {profissionalSelecionado.nome}
                    </span>
                  )}
                </span>

                {carregandoSlots && (
                  <p className="text-sm text-body">Carregando horários...</p>
                )}

                {!carregandoSlots && erroSlots && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                    {erroSlots}
                  </p>
                )}

                {/* Sem nenhuma vaga no dia: ninguém trabalha, ou tudo já foi
                    reservado (a grade só lista horários com >=1 livre). */}
                {!carregandoSlots && !erroSlots && horariosBase.length === 0 && (
                  <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                    Nenhum horário disponível neste dia.
                  </p>
                )}

                {/* Havia vaga, mas tudo já passou: só ocorre quando a data é
                    hoje e a hora atual ultrapassou o último horário. */}
                {!carregandoSlots &&
                  !erroSlots &&
                  horariosBase.length > 0 &&
                  horariosVisiveis.length === 0 && (
                    <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                      Não há mais horários disponíveis para hoje.
                    </p>
                  )}

                {!carregandoSlots && !erroSlots && horariosVisiveis.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {horariosVisiveis.map((slot) => {
                      // A grade só contém horários com pelo menos um
                      // profissional livre (no fluxo "cliente escolhe", livre
                      // para o selecionado), então nenhum botão fica travado.
                      const selecionado = horarioSelecionado === slot;

                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => selecionarHorario(slot)}
                          aria-pressed={selecionado}
                          className={[
                            "rounded-lg px-2 py-2 text-sm font-medium ring-1 transition",
                            selecionado
                              ? "bg-primary text-white ring-primary"
                              : "bg-card text-body ring-border hover:border-primary hover:ring-primary",
                          ].join(" ")}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={voltarEtapa}
              className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Voltar
            </button>
          </>
        )}

        {/* Etapa 3 — Dados: nome, WhatsApp e confirmação. Com clienteInicial
            (já identificado antes do wizard), os inputs somem e viram um
            resumo — os valores já estão em form.nome/form.telefone. */}
        {etapa === "dados" && (
          <>
            {clienteInicial ? (
              <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                Agendando para{" "}
                <span className="font-medium text-heading">{form.nome}</span>.
              </p>
            ) : (
              <>
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
                    required
                    placeholder="Seu nome"
                    className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>

                <div>
                  <label htmlFor="telefone" className="mb-1 block text-sm font-medium text-body">
                    WhatsApp
                  </label>
                  <input
                    id="telefone"
                    name="telefone"
                    type="tel"
                    inputMode="tel"
                    value={form.telefone}
                    onChange={handleChange}
                    required
                    placeholder="(24) 99999-9999"
                    className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
              </>
            )}

            {/* Preço da manutenção selecionada (ver efeito acima que chama
                calcularPrecoManutencao). Só aparece pra manutenções — serviços
                normais não têm precoManutencao setado. Quando valorCheio é
                true, o destaque âmbar deixa claro que NÃO é o valor normal da
                manutenção (evita parecer erro de cobrança). */}
            {servicoSelecionado?.servico_origem_id != null && precoManutencao && (
              <div
                className={
                  precoManutencao.valorCheio
                    ? "rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200"
                    : "rounded-lg bg-surface px-3 py-2"
                }
              >
                <p
                  className={
                    precoManutencao.valorCheio
                      ? "text-sm font-medium text-amber-800"
                      : "text-sm text-body"
                  }
                >
                  {precoManutencao.valorCheio
                    ? `Valor cheio do serviço: ${formatarPreco(precoManutencao.centavos)}`
                    : `Valor da manutenção: ${formatarPreco(precoManutencao.centavos)}`}
                </p>
                {precoManutencao.valorCheio && (
                  <p className="mt-1 text-xs text-amber-800">
                    Sua última manutenção já passou do prazo, por isso o valor
                    cobrado é o do serviço completo, não o de manutenção.
                  </p>
                )}
              </div>
            )}

            {/* Valor final com os ajustes das respostas do popup de perguntas
                (ver calcularAjustePerguntas) — só aparece havendo algum ajuste
                != 0, com transparência sobre o que compõe o total. Respeita
                ocultar_preco: o dono escondeu o preço deste serviço do
                público, então o total também fica escondido. */}
            {!servicoSelecionado?.ocultar_preco && itensAjustePerguntas.length > 0 && (
              <div className="rounded-lg bg-surface px-3 py-2">
                <p className="text-sm font-medium text-heading">
                  Valor total: {formatarPreco(precoBaseCentavos + ajusteCentavosPerguntas)}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {itensAjustePerguntas.map((item, i) => (
                    <li key={i} className="text-xs text-body">
                      {item.label} ({item.centavos > 0 ? "+" : ""}
                      {formatarPreco(item.centavos)})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {precisaSinal && (
              <div className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <div>
                  <p className="text-base font-medium text-amber-800">
                    {`Este agendamento exige um sinal de ${formatarPreco(estabelecimento.sinal_valor_centavos)} via Pix para confirmar a reserva.`}
                  </p>
                  <p className="mt-1 text-base font-medium text-amber-800">
                    {`Aperte o botão verde "Falar com ${nomeProfissionalContato}" e envie o comprovante do Pix.`}
                  </p>
                  <p className="mt-1 text-base font-medium text-amber-800">
                    O profissional irá confirmar seu agendamento.
                  </p>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 ring-1 ring-border">
                  <span className="min-w-0 flex-1 truncate text-sm text-heading">
                    {estabelecimento.sinal_chave_pix}
                  </span>
                  <button
                    type="button"
                    onClick={copiarChavePix}
                    className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover"
                  >
                    {chavePixCopiada ? "Copiado!" : "Copiar chave"}
                  </button>
                </div>

                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    checked={sinalDeclarado}
                    onChange={(e) => setSinalDeclarado(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30"
                  />
                  Já realizei o pagamento do sinal via Pix
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={enviando || (precisaSinal && !sinalDeclarado)}
              className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? "Enviando..." : rotuloSubmit}
            </button>

            <button
              type="button"
              onClick={voltarEtapa}
              className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Voltar
            </button>

            {erro && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erro}
              </p>
            )}
          </>
        )}
      </form>

      {/* Alerta do serviço tocado (ver GerenciarServicos): trava o wizard
          antes de avançar pra profissional/data. Continuar confirma a
          seleção; Voltar fecha sem selecionar nada. */}
      {alertaPendente && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-alerta-servico"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={cancelarAlerta}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 h-6 w-6 shrink-0 text-amber-600"
              >
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
              <div>
                <h2
                  id="titulo-alerta-servico"
                  className="text-lg font-semibold text-heading"
                >
                  Atenção
                </h2>
                <p className="mt-2 text-sm text-body">
                  {alertaPendente.alerta_mensagem}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={confirmarAlerta}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={cancelarAlerta}
                className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup de perguntas do serviço (servico_perguntas), aberto logo após
          a seleção (ver confirmarSelecaoServico) quando o serviço tem alguma
          cadastrada. Reaproveita o padrão visual dos modais acima (mesmo
          overlay, mesmo card, mesmo par Continuar/Voltar); "Continuar" só
          fecha com todas as perguntas respondidas (ver confirmarModalPerguntas). */}
      {modalPerguntasAberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-modal-perguntas"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={cancelarModalPerguntas}
        >
          <div
            className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sem cabeçalho visível (só as perguntas) — o h2 fica só pra
                acessibilidade, dando nome ao dialog via aria-labelledby. */}
            <h2 id="titulo-modal-perguntas" className="sr-only">
              Perguntas do serviço
            </h2>

            <div className="space-y-5">
              {perguntasServico.map((pergunta) => (
                <div key={pergunta.id}>
                  <p className="mb-2 text-sm font-medium text-heading">{pergunta.texto}</p>

                  {pergunta.tipo === "texto_livre" ? (
                    <textarea
                      value={respostasPerguntas[pergunta.id]?.textoLivre ?? ""}
                      onChange={(e) => responderTexto(pergunta.id, e.target.value)}
                      rows={2}
                      placeholder="Digite sua resposta"
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(pergunta.servico_pergunta_opcoes ?? []).map((opcao) => {
                        const selecionada =
                          respostasPerguntas[pergunta.id]?.opcaoId === opcao.id;
                        return (
                          <button
                            key={opcao.id}
                            type="button"
                            onClick={() => responderOpcao(pergunta.id, opcao.id)}
                            aria-pressed={selecionada}
                            className={[
                              "rounded-lg px-3 py-2 text-sm font-medium ring-1 transition",
                              selecionada
                                ? "bg-primary text-white ring-primary"
                                : "bg-card text-body ring-border hover:border-primary hover:ring-primary",
                            ].join(" ")}
                          >
                            {opcao.label}
                            {opcao.ajuste_preco_centavos !== 0 && (
                              <span
                                className={
                                  selecionada ? "ml-1 text-on-primary/80" : "ml-1 text-muted"
                                }
                              >
                                {opcao.ajuste_preco_centavos > 0 ? " (+" : " ("}
                                {formatarPreco(opcao.ajuste_preco_centavos)})
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {erroModalPerguntas && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroModalPerguntas}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={confirmarModalPerguntas}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={cancelarModalPerguntas}
                className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
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
