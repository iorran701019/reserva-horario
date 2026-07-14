"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { calcularVagasPorHorario } from "@/lib/disponibilidade";

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
function CalendarioDias({
  mes,
  min,
  diasSemanaAtivos,
  selecionado,
  onSelecionar,
  onPrev,
  onNext,
  podeVoltar,
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
export default function FormularioAgendamento({
  estabelecimento,
  status,
  rotuloSubmit = "Confirmar agendamento",
  onSucesso,
  forcarEscolhaProfissional = false,
  clienteInicial = null,
  clienteEhNovo = false,
  nomeProfissionalContato = "a equipe",
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
  const [servicoSelecionado, setServicoSelecionado] = useState(null);
  const [carregandoServicos, setCarregandoServicos] = useState(true);
  const [erroServicos, setErroServicos] = useState("");

  // Categorias de serviço do salão, pra agrupar a lista da etapa "servico" em
  // acordeão. `categoriaAberta` guarda o id da única categoria expandida por
  // vez (null = todas fechadas).
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

  // Profissionais ATIVOS que atendem o serviço escolhido, cada um já com seus
  // dias de trabalho (horarios_trabalho.dia_semana) embutidos — carregados nos
  // dois modos: no "cliente escolhe" alimentam os cards, e sempre alimentam os
  // dias disponíveis do calendário. `profissionalSelecionado` só é usado no
  // fluxo "cliente escolhe".
  const [profissionaisDoServico, setProfissionaisDoServico] = useState([]);
  const [profissionalSelecionado, setProfissionalSelecionado] = useState(null);
  const [carregandoProfissionais, setCarregandoProfissionais] = useState(false);

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
          .select("id, nome, duracao_min, preco_centavos, categoria_id")
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
  // um com seus dias de trabalho embutidos (horarios_trabalho.dia_semana). Roda
  // nos DOIS modos: alimenta os cards (quando o cliente escolhe) e sempre os
  // dias disponíveis do calendário. Sem serviço, zera a lista.
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
          "profissionais!inner(id, nome, ativo, estabelecimento_id, horarios_trabalho(dia_semana))"
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

  const [hoje] = useState(dataDeHoje);

  // Agrupamento da lista de serviços da etapa "servico": soltos no topo os
  // sem categoria (ou apontando pra uma categoria que não existe mais), depois
  // uma seção por categoria (na ordem vinda do banco) só com quem tem >=1
  // serviço ativo.
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

    return (
      <button
        key={servico.id}
        type="button"
        onClick={() => selecionarServico(servico)}
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

  // Dias da semana (0–6) com atendimento para o serviço escolhido. No fluxo
  // "cliente escolhe", só conta o profissional selecionado; no encaixe
  // automático, a UNIÃO dos dias de todos os profissionais elegíveis. Alimenta
  // o calendário: dia da semana fora desse conjunto nasce cinza/desabilitado.
  const diasSemanaAtivos = (() => {
    const fonte = escolherProfissional
      ? profissionaisDoServico.filter((p) => p.id === profissionalSelecionado?.id)
      : profissionaisDoServico;

    const set = new Set();
    fonte.forEach((p) =>
      (p.horarios_trabalho ?? []).forEach((h) => set.add(h.dia_semana))
    );
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

  // Trocar de serviço muda a duração/grade e a lista de profissionais: o
  // horário e o profissional escolhidos podem não valer mais, então limpamos.
  // No encaixe automático (toggle off), avança direto para a data. No fluxo
  // "cliente escolhe", fica na etapa de serviço pra o cliente escolher o
  // profissional (os cards aparecem logo abaixo).
  function selecionarServico(servico) {
    setServicoSelecionado(servico);
    setHorarioSelecionado("");
    setProfissionalSelecionado(null);
    // A troca muda os dias/horários válidos: zera a data pra não ficar uma
    // seleção antiga num dia que virou indisponível.
    setForm((anterior) => ({ ...anterior, data: "" }));
    if (!escolherProfissional) setEtapa("data");
  }

  // Fluxo "cliente escolhe": escolher o profissional conclui a etapa de serviço
  // e leva à de data, onde o calendário e a grade já refletem só a agenda dele.
  function selecionarProfissional(profissional) {
    setProfissionalSelecionado(profissional);
    setHorarioSelecionado("");
    // Cada profissional trabalha em dias diferentes: zera a data ao trocar.
    setForm((anterior) => ({ ...anterior, data: "" }));
    setEtapa("data");
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
      };
      if (status) payload.status = status;
      ({ error } = await supabase.from("agendamentos").insert(payload));
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
              <div className="mt-6">
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
            <div>
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
    </>
  );
}
