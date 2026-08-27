"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { buscarEstabelecimento } from "@/lib/estabelecimento";
import { buscarPerfil } from "@/lib/perfil";
import { buscarTema } from "@/lib/temas";
import {
  linkWhatsApp,
  linkWhatsAppSemMensagem,
  MENSAGEM_LEMBRETE,
  MENSAGEM_CONTATO,
  MENSAGEM_CANCELAMENTO,
  MENSAGEM_CONFIRMACAO,
  MENSAGEM_FORA_DA_JANELA,
  MENSAGEM_ALTERACAO_DATA,
} from "@/lib/whatsapp";
import {
  classificarAgendamento,
  fimDoAtendimento,
  rotuloHistorico,
  ordenarHistoricoPorStatus,
} from "@/lib/particao";
import { useNavegacaoMes } from "@/lib/useNavegacaoMes";
import { calcularVagasPorHorario, profissionaisLivresNoHorario } from "@/lib/disponibilidade";
import { dentroDaJanelaAgendamento, diasRestantesJanela } from "@/lib/janelaAgendamento";
import { buscarRespostasPorAgendamento } from "@/lib/agendamentoRespostas";
import { verificarFidelidadeClientes, buscarProgressoFidelidade } from "@/lib/fidelidade";
import LinkComprovantePix from "@/components/LinkComprovantePix";
import {
  Menu,
  X,
  Inbox,
  Calendar,
  History,
  CalendarPlus,
  Scissors,
  Users,
  UserRound,
  LogOut,
  NotebookPen,
  Settings,
  Ban,
  Archive,
  AlertCircle,
  Gift,
  ChevronRight,
  Check,
  MessageCircleOff,
  Clock,
} from "lucide-react";
import BadgeFidelidade from "@/components/BadgeFidelidade";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import ModalClientePendente from "@/components/ModalClientePendente";
import Hero from "@/components/Hero";
import PainelCalendario from "./PainelCalendario";
import GerenciarServicos from "./GerenciarServicos";
import GerenciarProfissionais from "./GerenciarProfissionais";
import GerenciarClientes from "@/components/GerenciarClientes";
import ConfiguracoesSalao from "./ConfiguracoesSalao";
import FormularioAgendamento, { CalendarioDias } from "@/components/FormularioAgendamento";
import IdentificacaoClienteAdmin from "@/components/IdentificacaoClienteAdmin";
import AtivarNotificacoes from "@/components/AtivarNotificacoes";
import ModalVincularCliente from "@/components/ModalVincularCliente";
import NavegacaoMes from "@/components/NavegacaoMes";

// URL do login do salão, carregando o destino pretendido em ?next= pra reentrar
// no MESMO salão após autenticar. Com o slug agora no PATH, tanto o login quanto
// o destino ficam sob /[salon]/admin. Ex.: salon="barbearia" →
// /barbearia/admin/login?next=%2Fbarbearia%2Fadmin.
function urlLogin(salon) {
  const destino = `/${salon}/admin`;
  return `/${salon}/admin/login?next=${encodeURIComponent(destino)}`;
}

// Formata "2026-06-25" como "25/06". Mantém simples; sem libs de data.
function formatarData(data) {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

// Formata "2026-06-25" como "25/06/2026" — usado no banner/popup da janela de
// agendamento, onde o ano importa (diferente de formatarData acima).
function formatarDataComAno(data) {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

// "YYYY-MM-DD" de hoje em horário LOCAL — usado só pra chave do localStorage
// do popup diário da janela de agendamento (ver useEffect mais abaixo).
// Componente-a-componente, nunca toISOString (UTC, pode voltar um dia).
function hojeISOLocal() {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Formata "14:30:00" (time do Postgres) como "14:30".
function formatarHorario(horario) {
  if (!horario) return "—";
  return horario.slice(0, 5);
}

// Hora "HH:MM" em horário LOCAL a partir de um Date (ex.: o FIM do atendimento).
function formatarHoraLocal(d) {
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${hora}:${min}`;
}

// preco_centavos (ex.: 3500) -> "R$ 35,00". Mesma convenção do /agendar.
function formatarPreco(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// timestamptz do Postgres (lembrete_enviado_em) -> "DD/MM HH:MM" em horário
// LOCAL (componentes do Date, nunca UTC).
function formatarEnviadoEm(timestamp) {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes} ${formatarHoraLocal(d)}`;
}

// Cores do badge de status. Cai num cinza neutro pra status desconhecido.
// aguardando_sinal usa um âmbar MAIS forte que o de pendente: são estados
// vizinhos (os dois caem na aba Pendentes) e a dona precisa distinguir num
// relance "esperando o Pix" de "esperando eu confirmar".
function classesStatus(status) {
  const mapa = {
    confirmado: "bg-green-50 text-green-700 ring-green-100",
    pendente: "bg-amber-50 text-amber-700 ring-amber-100",
    aguardando_sinal: "bg-amber-200 text-amber-900 ring-amber-400",
    cancelado: "bg-red-50 text-red-700 ring-red-100",
  };
  return mapa[status] ?? "bg-surface text-body ring-border";
}

// Texto do badge de status. Só existe porque o status cru "aguardando_sinal"
// ficaria com underline na tela; o resto já é legível como veio do banco.
function rotuloStatus(status) {
  if (!status) return "—";
  return status === "aguardando_sinal" ? "Aguardando sinal" : status;
}

// Badge "Expira em Xh" da aba Pendentes (ver inbox mais abaixo): só aparece
// nos 48h antes do fim da reserva provisória, pra não poluir a UI logo na
// criação. Limite separado (18h) decide a cor de alerta (azul -> vermelho).
const LIMITE_BADGE_EXPIRA_HORAS = 48;
const LIMITE_BADGE_EXPIRA_VERMELHO_HORAS = 18;

// Horas restantes até a reserva provisória do item expirar
// (created_at + estabelecimentos.reserva_provisoria_expira_horas), ou null se
// o salão não configurou expiração (coluna nula) — nesse caso nenhum badge
// deve aparecer. Valor CRU (sem arredondar, pode ser negativo se já passou do
// prazo): quem renderiza decide o corte de exibição (LIMITE_BADGE_EXPIRA_HORAS)
// e o arredondamento pro texto; a ordenação do inbox usa o valor cru direto.
// Função PURA — não muda nada no banco nem tira o item do inbox (a reserva
// provisória hoje só afeta este contador visual, nada mais).
function horasRestantesReserva(item, estabelecimento, agora) {
  const expiraHoras = estabelecimento?.reserva_provisoria_expira_horas;
  if (expiraHoras == null || !item.created_at) return null;

  const horasDesdeCriacao = (agora - new Date(item.created_at)) / (1000 * 60 * 60);
  return Number(expiraHoras) - horasDesdeCriacao;
}

// Texto + cores do badge por categoria do histórico (rotuloHistorico, ver
// lib/particao — fonte única da categorização, compartilhada com
// GerenciarClientes.js). Concluído em verde
// apagado, cancelado em vermelho apagado, caducado (exibido como "Vencido")
// e expirado no mesmo neutro/cinza (evita confundir "expirado" com
// "cancelado", já que os dois têm o mesmo vermelho). A chave `caducado` é
// interna (vem de rotuloHistorico / lib/particao) — só o rótulo exibido
// muda. "expirado" tem o mesmo status cru "cancelado" no banco (ver
// agendamentos.expirado_automaticamente), só muda a razão exibida.
const HISTORICO_META = {
  concluido: { rotulo: "Concluído", classe: "bg-green-50 text-green-600 ring-green-100" },
  caducado: { rotulo: "Vencido", classe: "bg-surface text-body ring-border" },
  cancelado: { rotulo: "Cancelado", classe: "bg-red-50 text-red-500 ring-red-100" },
  expirado: { rotulo: "Expirado", classe: "bg-surface text-body ring-border" },
};

// Ação "Arquivar", comum a qualquer tipo de pendência: marca resolvido=true
// (ver handleArquivarPendencia) e some o card. Fábrica pra não repetir o
// objeto em cada entrada de TIPOS_PENDENCIA.
function acaoArquivarPendencia(item, arquivar) {
  return {
    id: "arquivar",
    rotulo: "Arquivar",
    Icone: Archive,
    classe: "bg-card text-body ring-1 ring-border hover:bg-surface",
    onClick: () => arquivar(item.id),
  };
}

// Config por `tipo` de pendencias_admin: ícone/cor do card + as ações
// (botões) daquele tipo. Adicionar um tipo novo é só uma entrada nova aqui —
// a renderização (ver aba "Pendentes" abaixo) não muda. `acoes` recebe o item
// e o objeto `ctx` ({ arquivar }) com os handlers compartilhados.
const TIPOS_PENDENCIA = {
  cancelamento_cliente: {
    Icone: Ban,
    corCard: "bg-red-50/60 ring-red-300",
    corIcone: "text-red-600",
    acoes: (item, ctx) => [
      {
        id: "mensagem",
        rotulo: "Enviar mensagem",
        Icone: IconeWhatsApp,
        classe: "bg-green-50 text-green-700 ring-1 ring-green-100 hover:bg-green-100",
        onClick: () =>
          window.open(
            linkWhatsAppSemMensagem(item.agendamentos?.telefone),
            "_blank",
            "noopener,noreferrer"
          ),
      },
      acaoArquivarPendencia(item, ctx.arquivar),
    ],
  },
  fidelidade_disponivel: {
    Icone: Gift,
    corCard: "bg-purple-50/60 ring-purple-300",
    corIcone: "text-purple-600",
    acoes: (item, ctx) => [
      {
        id: "mensagem",
        rotulo: "Enviar mensagem",
        Icone: IconeWhatsApp,
        classe: "bg-green-50 text-green-700 ring-1 ring-green-100 hover:bg-green-100",
        onClick: () =>
          window.open(
            linkWhatsAppSemMensagem(item.clientes?.whatsapp),
            "_blank",
            "noopener,noreferrer"
          ),
      },
      {
        id: "brinde",
        rotulo: "Marcar brinde concedido",
        Icone: Gift,
        classe: "bg-card text-body ring-1 ring-border hover:bg-surface",
        onClick: () => ctx.marcarBrinde(item),
      },
    ],
  },
};

// Tipo desconhecido (nenhuma entrada em TIPOS_PENDENCIA ainda): card neutro
// com só a ação de arquivar, pra um tipo novo no banco nunca ficar sem UI.
const TIPO_PENDENCIA_PADRAO = {
  Icone: AlertCircle,
  corCard: "bg-blue-50/60 ring-blue-300",
  corIcone: "text-blue-600",
  acoes: (item, ctx) => [acaoArquivarPendencia(item, ctx.arquivar)],
};

// Abas-pai do topo, partição DERIVADA (lib/particao) — nenhum status novo no
// banco. "Pendentes" é o inbox (pendentes futuros que precisam de ação);
// "Painel" mostra o calendário; "Histórico" e "Agendar" entram em breve.
const ABAS_PAI = [
  { id: "pendentes", rotulo: "Pendentes", Icone: Inbox },
  { id: "painel", rotulo: "Painel", Icone: Calendar },
  { id: "historico", rotulo: "Histórico", Icone: History },
  { id: "agendar", rotulo: "Agendar", Icone: CalendarPlus },
  { id: "servicos", rotulo: "Serviços", Icone: Scissors },
  { id: "profissionais", rotulo: "Profissionais", Icone: Users },
  { id: "clientes", rotulo: "Clientes", Icone: UserRound },
  { id: "regras", rotulo: "Regras de negócio", Icone: Settings },
];

// Filtros da aba Histórico (client-side, por categoria de rotuloHistorico).
// "todos" não filtra. Os ids batem com as categorias de HISTORICO_META.
const FILTROS_HISTORICO = [
  { id: "todos", rotulo: "Todos" },
  { id: "concluido", rotulo: "Concluído" },
  { id: "caducado", rotulo: "Vencido" },
  { id: "cancelado", rotulo: "Cancelado" },
  { id: "expirado", rotulo: "Expirado" },
];

// Abre a conversa do WhatsApp do cliente em nova aba, com a mensagem pronta.
// noopener,noreferrer replicam o rel="noopener noreferrer" de um <a target=_blank>.
function abrirWhatsApp(telefone, mensagem) {
  window.open(linkWhatsApp(telefone, mensagem), "_blank", "noopener,noreferrer");
}

// Helper PURO (sem setState): lê todos os agendamentos do estabelecimento,
// próximos primeiro (data e depois horário). Devolve sempre { dados, error }
// pra quem chama decidir o que fazer com o estado. Fonte única da query no
// arquivo. `estabelecimentoId` particiona por salão (slug do path); o resto do
// pipeline (classificarAgendamento, inbox, histórico, Painel) só recebe os
// dados já filtrados.
async function buscarAgendamentos(estabelecimentoId) {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("id, nome_cliente, telefone, data, horario, status, finalizado, created_at, lembrete_enviado_em, observacao, servico_id, servico_livre, profissional_id, expirado_automaticamente, sinal_declarado_pago, comprovante_pix_url, comprovante_pix_enviado_em, servicos(nome, duracao_min, preco_centavos), profissionais(nome)")
    .eq("estabelecimento_id", estabelecimentoId)
    .order("data", { ascending: true })
    .order("horario", { ascending: true });

  // Eleva a duração do serviço ao topo do item (item.duracao_min), preservando
  // o objeto servicos aninhado (usado em nome do serviço, calendário etc.).
  // Assim classificarAgendamento (lib/particao) lê item.duracao_min direto.
  // Também eleva o nome do profissional (join por profissional_id); null quando
  // o agendamento não tem profissional atribuído (reservas antigas).
  const dados = (data ?? []).map((item) => ({
    ...item,
    duracao_min: item.servicos?.duracao_min ?? null,
    profissional_nome: item.profissionais?.nome ?? null,
  }));

  return { dados, error };
}

// Helper PURO (sem setState): lê as pendências administrativas em aberto
// (pendencias_admin.resolvido = false) do estabelecimento, mais recentes
// primeiro. `agendamentos(telefone)` é o join pelo agendamento_id vinculado
// (ver sql/pendencias_admin.sql) — resolve o telefone pra ação "Enviar
// mensagem" das pendências presas a um agendamento (cancelamento_cliente) sem
// uma segunda query. `clientes(whatsapp)` é o mesmo, mas pelo cliente_id (ver
// sql/pendencias_admin_cliente.sql) — usado pelas que não têm agendamento
// (fidelidade_disponivel).
async function buscarPendenciasAdmin(estabelecimentoId) {
  const { data, error } = await supabase
    .from("pendencias_admin")
    .select(
      "id, tipo, titulo, descricao, agendamento_id, cliente_id, created_at, agendamentos(telefone), clientes(whatsapp)"
    )
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("resolvido", false)
    .order("created_at", { ascending: false });

  return { dados: data ?? [], error };
}

export default function AdminPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Slug do salão no path (/[salon]/admin). Fonte única do tenant: alimenta a
  // resolução do estabelecimento e a montagem das URLs de login/redirect.
  const { salon } = useParams();

  // Estado da sessão: null = ainda verificando; false = sem login; true = logado.
  // Enquanto for null não renderizamos a lista (evita "piscar" o conteúdo).
  const [autenticado, setAutenticado] = useState(null);

  // Estabelecimento resolvido pelo slug do path (seletor de teste, não
  // isolamento de segurança nesta fase — Iorran é o único admin). undefined =
  // resolvendo; null = slug inexistente/inativo; objeto = encontrado. Particiona
  // o fetch de agendamentos e o insert da aba Agendar por estabelecimento_id.
  const [estabelecimento, setEstabelecimento] = useState(undefined);

  // Autenticado, mas sem linha em perfis (conta órfã): não há salão a resolver.
  // Troca todo o conteúdo pela tela "Conta sem salão vinculado".
  const [semPerfil, setSemPerfil] = useState(false);

  // Papel do perfil logado (ver efeito de resolução de estabelecimento
  // abaixo) — hoje só usado pra decidir se o link "Painel global" aparece no
  // drawer (ver seção do rodapé). null = ainda não resolvido ou sem perfil.
  const [papelUsuario, setPapelUsuario] = useState(null);

  const [agendamentos, setAgendamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Pendências administrativas (tabela pendencias_admin) em aberto — hoje só
  // cancelamentos feitos pela cliente (ver TIPOS_PENDENCIA). Renderizadas como
  // cards à parte na aba "Pendentes", junto dos agendamentos com status
  // 'pendente'.
  const [pendenciasAdmin, setPendenciasAdmin] = useState([]);

  // Respostas do popup de perguntas (ver FormularioAgendamento), por
  // agendamento_id — Map<id, string[]> já formatado (lib/agendamentoRespostas),
  // buscado em bulk junto com `agendamentos` (mesmo id list). Agendamento sem
  // nenhuma entrada aqui (serviço sem perguntas) não mostra a linha extra.
  const [respostasPorAgendamento, setRespostasPorAgendamento] = useState(new Map());

  // Aba-pai do topo (ver ABAS_PAI): "pendentes" (inbox), "painel" (calendário),
  // "historico" e "agendar". A partição é derivada (lib/particao), sem status novo.
  // Inicializa a partir da query string (?aba=) pra sobreviver a refresh.
  const [viewPai, setViewPai] = useState(searchParams.get("aba") || "pendentes");

  // Mantém viewPai em sincronia com a URL quando ela muda por fora do onClick
  // das abas (botão voltar/avançar do navegador, ou back gesture no Android).
  useEffect(() => {
    const abaNaUrl = searchParams.get("aba") || "pendentes";
    setViewPai((atual) => (atual === abaNaUrl ? atual : abaNaUrl));
  }, [searchParams]);

  // Drawer lateral de navegação (mobile-first): substitui a antiga barra de abas
  // fixa. `true` = aberto. Selecionar uma aba troca `viewPai` e fecha o drawer.
  const [drawerAberto, setDrawerAberto] = useState(false);

  // Popup diário de aviso da janela de agendamento (abaixo de 30 dias
  // restantes — ver useEffect mais abaixo). "Já mostrei hoje" é controlado
  // via localStorage (chave por estabelecimento + data), sem coluna nova.
  const [popupJanelaAberto, setPopupJanelaAberto] = useState(false);

  // true logo após clicar no banner "Agenda aberta até": sinaliza pro
  // ConfiguracoesSalao (montado a seguir, quando viewPai vira "regras") abrir
  // o bloco "Janela de agendamento" já expandido e rolar até ele. Consumida
  // uma vez (ver onFocarBlocoJanelaConsumido) — não é "sticky".
  const [focarJanelaAgendamento, setFocarJanelaAgendamento] = useState(false);

  // Incrementado a cada clique em "Cadastrar novo profissional" (aba Regras
  // de negócio): sinaliza pra GerenciarProfissionais (montada só quando
  // viewPai vira "profissionais") abrir o wizard de criação remotamente.
  // Contador em vez de boolean pra disparar de novo mesmo se o valor "true"
  // já tivesse sido consumido antes do usuário trocar de aba.
  const [gatilhoNovoProfissional, setGatilhoNovoProfissional] = useState(0);

  function irParaCadastroProfissional() {
    setViewPai("profissionais");
    setGatilhoNovoProfissional((t) => t + 1);
  }

  // Id do agendamento pendente clicado no bloco cinza da view Dia do Painel
  // (ver PainelCalendario -> onSelecionarPendente): sinaliza pra aba
  // Pendentes rolar até o card certo e destacá-lo por alguns segundos. Mesma
  // ideia de focarJanelaAgendamento, mas carrega o id do alvo em vez de um
  // boolean, já que aqui a lista tem N itens (não um bloco fixo). Some
  // sozinho (ver useEffect abaixo) — não precisa de "consumido" explícito
  // porque não há componente filho separado pra notificar de volta.
  const [pendenteEmDestaqueId, setPendenteEmDestaqueId] = useState(null);

  // Refs dos <li> da lista de Pendentes (inbox), indexados por item.id — alvo
  // do scrollIntoView acima. Mapa (não array) porque a lista é dinâmica e
  // alguns itens desmontam (some da inbox ao confirmar/cancelar).
  const refsPendentes = useRef(new Map());

  // Rola até o card e liga o destaque quando pendenteEmDestaqueId muda. O
  // setTimeout de 80ms espera o commit da troca de aba (setViewPai +
  // setPendenteEmDestaqueId chegam juntos no mesmo clique) refletir no DOM
  // antes de medir a posição — mesmo motivo do temporizador equivalente em
  // ConfiguracoesSalao (blocoJanelaRef). O destaque desliga sozinho depois de
  // ~1.8s; se o item não existir na lista (ex.: pendente não finalizado,
  // nunca aparece em Pendentes — ver comentário de `inbox` abaixo), o
  // optional chaining só pula o scroll, sem quebrar nada.
  useEffect(() => {
    if (pendenteEmDestaqueId == null) return;
    const paraRolar = setTimeout(() => {
      refsPendentes.current
        .get(pendenteEmDestaqueId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const paraLimpar = setTimeout(() => setPendenteEmDestaqueId(null), 1800);
    return () => {
      clearTimeout(paraRolar);
      clearTimeout(paraLimpar);
    };
  }, [pendenteEmDestaqueId]);

  // Agendamento aguardando confirmação de cancelamento (controla o modal).
  // null = nenhum modal aberto.
  const [agendamentoParaCancelar, setAgendamentoParaCancelar] = useState(null);
  // Se o "Confirmar cancelamento" do modal acima deve notificar o cliente via
  // WhatsApp. false só quando o modal foi aberto pela zona pequena (sem
  // notificar) do botão dividido em Pendentes; sempre true nos outros casos.
  const [notificarAoCancelar, setNotificarAoCancelar] = useState(true);

  // Agendamento aguardando confirmação da zona pequena de "Confirmar" (sem
  // notificar). Mesmo padrão de agendamentoParaCancelar: null = modal
  // fechado. A zona grande de Confirmar (com WhatsApp) não passa por aqui —
  // continua executando handleConfirmar direto, sem popup.
  const [agendamentoParaConfirmar, setAgendamentoParaConfirmar] = useState(null);

  // Agendamento fora da janela de agendamento (estabelecimento.
  // janela_agendamento_fim) que handleConfirmar interceptou antes do UPDATE
  // — ver dentroDaJanelaAgendamento. { agendamento, notificar } enquanto o
  // popup "Confirmar mesmo assim?" está aberto; null = fechado. `notificar`
  // preserva a escolha original (zona grande ou zona pequena "sem notificar")
  // pra aplicar depois que a dona decidir no popup.
  const [confirmacaoForaDaJanela, setConfirmacaoForaDaJanela] = useState(null);

  // Agendamento confirmado selecionado no Painel (controla o modal de detalhe/
  // ações). Guardamos o id; os dados vivos saem de `agendamentos` no render,
  // pra refletir na hora o patch do lembrete. null = modal fechado.
  const [idSelecionado, setIdSelecionado] = useState(null);

  // Agendamento importado sem cliente vinculado (bloco âmbar do Painel,
  // telefone null) selecionado pra vincular. Guardamos o id, mesmo padrão de
  // idSelecionado — dados vivos saem de `agendamentos`. null = modal fechado.
  const [idParaVincular, setIdParaVincular] = useState(null);

  // Edição da observação no modal de detalhe. `idEditandoObservacao` guarda o id
  // cujo textarea está aberto — atrelar ao id (e não a um booleano) faz o
  // textarea recolher sozinho ao fechar o modal ou trocar de agendamento.
  // `rascunhoObservacao` é o texto sendo digitado.
  const [idEditandoObservacao, setIdEditandoObservacao] = useState(null);

  // Progresso do programa de fidelidade (ver lib/fidelidade.js) da cliente do
  // modal de detalhe. Diferente de GerenciarClientes/PainelCliente, o
  // agendamento aqui só traz `telefone` (não há cliente_id em `agendamentos`),
  // então resolve o id na tabela `clientes` antes de buscar o progresso. null
  // = programa desligado, cliente sem cadastro ou nada a mostrar.
  const [progressoFidelidadeModal, setProgressoFidelidadeModal] = useState(null);
  const [rascunhoObservacao, setRascunhoObservacao] = useState("");

  // Feedback do salvamento da anotação: `salvandoObservacao` mostra "Salvando..."
  // e trava o botão enquanto grava; `observacaoOk` exibe a confirmação curta
  // após sucesso. Ambos são reiniciados ao abrir/fechar/trocar o modal.
  const [salvandoObservacao, setSalvandoObservacao] = useState(false);
  const [observacaoOk, setObservacaoOk] = useState(false);

// Mesma lógica acima, espelhada para a anotação do Histórico.
  const [idAnotHistorico, setIdAnotHistorico] = useState(null);
  const [rascunhoAnotHistorico, setRascunhoAnotHistorico] = useState("");
  const [salvandoAnotHistorico, setSalvandoAnotHistorico] = useState(false);
  const [okAnotHistorico, setOkAnotHistorico] = useState(null);
  // Filtro ativo da aba Histórico (ver FILTROS_HISTORICO). "todos" = sem filtro.
  const [filtroHistorico, setFiltroHistorico] = useState("todos");

  // Aba Agendar: `agendarKey` remonta o FormularioAgendamento pra zerá-lo após
  // criar; `avisoAgendar` mostra a confirmação inline do último cadastro.
  // É estado de componente puro (sem URL/localStorage) — como o AdminPage
  // nunca desmonta ao trocar de aba (viewPai só troca o que é renderizado),
  // o aviso ficava preso até a próxima criação. Some sozinho após alguns
  // segundos e também ao sair da aba (ver handler de troca de aba abaixo).
  const [agendarKey, setAgendarKey] = useState(0);
  const [avisoAgendar, setAvisoAgendar] = useState("");
  // Cliente resolvido pelo pré-passo IdentificacaoClienteAdmin (busca por
  // nome, ver componente) — null = ainda não passou pela identificação,
  // então mostra o pré-passo em vez do FormularioAgendamento. Vira
  // clienteInicial do wizard assim que preenchido; zerado ao concluir um
  // agendamento (próximo cadastro recomeça do zero) e ao sair da aba.
  const [clienteParaAgendar, setClienteParaAgendar] = useState(null);

  // Cliente do atalho "Novo agendamento" (aba Histórico) que TEM pendente,
  // segurando o modal de aviso antes de abrir o wizard — mesmo papel que
  // `clientePendente` tem dentro do IdentificacaoClienteAdmin, só que pro
  // caminho que PULA o pré-passo. null = sem modal.
  const [clientePendenteParaAgendar, setClientePendenteParaAgendar] = useState(null);

  // Abre a aba Agendar já com a cliente escolhida (pula o pré-passo de busca
  // por nome). Extraído porque agora tem dois disparos: o clique direto no
  // "Novo agendamento" (cliente sem pendência) e o "Agendar mesmo assim" do
  // modal de pendência.
  function irParaAgendarCom(cliente) {
    setClienteParaAgendar(cliente);
    setAvisoAgendar("");
    setViewPai("agendar");
    router.push(`${pathname}?aba=agendar`, { scroll: false });
  }

  // Mesmo atalho acima, mas passando antes pelo aviso de cliente com
  // pendente: pular o pré-passo pula junto o gate que o
  // IdentificacaoClienteAdmin faz, então ele é refeito aqui (ver
  // temPendenteNoInbox). Usado pelos DOIS caminhos que pulam o pré-passo —
  // o "Novo agendamento" da aba Histórico e o "Agendar" da ficha do cliente
  // (aba Clientes, via prop onAgendarPara) — pra que os dois compartilhem o
  // MESMO ModalClientePendente lá embaixo, sem duplicar estado nem modal.
  function agendarComGateDePendencia(cliente) {
    if (temPendenteNoInbox(cliente.telefone)) {
      setClientePendenteParaAgendar(cliente);
      return;
    }

    irParaAgendarCom(cliente);
  }

  useEffect(() => {
    if (!avisoAgendar) return;
    const id = setTimeout(() => setAvisoAgendar(""), 5500);
    return () => clearTimeout(id);
  }, [avisoAgendar]);

  // Preferência do salão (tabela estabelecimentos). Só quando DESLIGADA (o dono
  // encaixa) faz sentido oferecer a troca de profissional nos cards — com ela
  // ligada, respeita-se a escolha do cliente e a opção nem aparece.
  const [escolhaProfissional, setEscolhaProfissional] = useState(false);

  // Contagem de profissionais ATIVOS do salão — com 1 só não há pra quem
  // trocar, então "Trocar profissional" também some (ver efeito abaixo).
  const [qtdProfissionaisAtivos, setQtdProfissionaisAtivos] = useState(null);

  // Troca de profissional: `agendamentoParaTrocar` arma o modal; a lista de
  // profissionais LIVRES no horário (que atendem o serviço) é carregada sob
  // demanda por lib/disponibilidade. null = modal fechado.
  const [agendamentoParaTrocar, setAgendamentoParaTrocar] = useState(null);
  const [profissionaisTroca, setProfissionaisTroca] = useState([]);
  const [carregandoTroca, setCarregandoTroca] = useState(false);
  const [erroTroca, setErroTroca] = useState("");

  // Alterar data (seção "Fora da janela de agendamento"): troca só data/
  // horário de um agendamento já existente — mesmo cliente/serviço/
  // profissional. `agendamentoParaAlterarData` arma o modal (null = fechado).
  // diasSemanaAtivos vem do PRÓPRIO profissional do agendamento (fixo, não
  // muda aqui) — ver efeito abaixo. horarios vem de calcularVagasPorHorario
  // com excluirAgendamentoId, pra essa mesma reserva não aparecer ocupando o
  // profissional no dia/horário ATUAL dela (ver lib/disponibilidade.js).
  const [agendamentoParaAlterarData, setAgendamentoParaAlterarData] = useState(null);
  // Botão dividido, mesmo padrão de notificarAoCancelar: zona grande arma
  // true (handleAlterarData abre o WhatsApp com MENSAGEM_ALTERACAO_DATA
  // depois do UPDATE), zona pequena arma false (só grava, sem notificar). O
  // próprio modal de escolher data cumpre o papel de "tem certeza" — sem
  // popup extra como o de agendamentoParaConfirmar.
  const [notificarAoAlterarData, setNotificarAoAlterarData] = useState(true);
  const [mesVisivelAlterarData, setMesVisivelAlterarData] = useState(() => new Date());
  const [dataAlterarData, setDataAlterarData] = useState("");
  const [horarioAlterarData, setHorarioAlterarData] = useState("");
  const [diasSemanaAtivosAlterarData, setDiasSemanaAtivosAlterarData] = useState(new Set());
  const [carregandoDiasAlterarData, setCarregandoDiasAlterarData] = useState(false);
  const [horariosAlterarData, setHorariosAlterarData] = useState([]);
  const [carregandoHorariosAlterarData, setCarregandoHorariosAlterarData] = useState(false);
  const [salvandoAlterarData, setSalvandoAlterarData] = useState(false);
  const [erroAlterarData, setErroAlterarData] = useState("");

  // Aplica um patch a um único item no estado local (evita refazer o fetch
  // inteiro). Caminho único de "refresh" otimista usado pelos handlers.
  function atualizarItemLocal(id, patch) {
    setAgendamentos((atuais) =>
      atuais.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  // Reflete o novo status no estado local. O badge e o destaque âmbar mudam
  // automaticamente quando o status deixa de ser 'pendente'.
  function atualizarStatusLocal(id, status) {
    atualizarItemLocal(id, { status });
  }

  // Refaz o fetch completo e substitui a lista. Usado após criar um agendamento
  // na aba Agendar — a linha nova não existe no estado local, então um patch
  // otimista não basta; recarregamos pelo mesmo helper único de query.
  async function recarregarAgendamentos() {
    const { dados, error } = await buscarAgendamentos(estabelecimento.id);
    if (!error) {
      setAgendamentos(dados);
      setRespostasPorAgendamento(
        await buscarRespostasPorAgendamento(dados.map((item) => item.id))
      );
    }
  }

  // Botão A: gatekeeper. Fora da janela de agendamento (estabelecimento.
  // janela_agendamento_fim, ver dentroDaJanelaAgendamento), abre o popup
  // "Confirmar mesmo assim?" (ver confirmacaoForaDaJanela) e adia a gravação
  // até a dona decidir — nunca confirma fora da janela sem essa checagem
  // consciente. Dentro da janela, delega direto pra executarConfirmacao.
  async function handleConfirmar(agendamento, notificar = true) {
    if (!dentroDaJanelaAgendamento(agendamento.data, estabelecimento)) {
      setConfirmacaoForaDaJanela({ agendamento, notificar });
      return;
    }
    await executarConfirmacao(agendamento, notificar);
  }

  // Grava o status 'confirmado' no banco e, se der certo, abre o WhatsApp com
  // a mensagem de confirmação. Em caso de erro não abre o WhatsApp (não
  // anuncia confirmação que não foi gravada). `notificar=false` (zona pequena
  // do botão dividido) pula só o redirecionamento pro WhatsApp, sem duplicar
  // a gravação do status. Chamado direto por handleConfirmar quando dentro da
  // janela, ou pelo popup de confirmacaoForaDaJanela quando a dona confirma
  // mesmo assim.
  async function executarConfirmacao(agendamento, notificar) {
    const { error } = await supabase
      .from("agendamentos")
      .update({ status: "confirmado" })
      .eq("id", agendamento.id);

    if (error) {
      setErro(`Não foi possível confirmar o agendamento: ${error.message}`);
      return;
    }

    setErro("");
    atualizarStatusLocal(agendamento.id, "confirmado");

    if (notificar) {
      abrirWhatsApp(
        agendamento.telefone,
        MENSAGEM_CONFIRMACAO(agendamento, estabelecimento.msg_confirmacao)
      );
    }
  }

  // Botão B: só roda DEPOIS que o dono confirma no modal. Grava o status
  // 'cancelado' no banco e, se der certo, abre o WhatsApp com a mensagem de
  // cancelamento. Em caso de erro não abre o WhatsApp. `notificar=false`
  // (zona pequena do botão dividido, ver notificarAoCancelar) pula só o
  // redirecionamento pro WhatsApp — o modal de confirmação continua rodando
  // normalmente antes de chegar aqui.
  async function handleCancelar(agendamento, notificar = true) {
    const { error } = await supabase
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("id", agendamento.id);

    if (error) {
      setErro(`Não foi possível cancelar o agendamento: ${error.message}`);
      setAgendamentoParaCancelar(null);
      return;
    }

    setErro("");
    atualizarStatusLocal(agendamento.id, "cancelado");

    if (notificar) {
      // Base da URL: a env pública (inlinada no build) quando definida; senão a
      // origem real do navegador — nunca "undefined" e sem domínio hardcoded.
      // O link de reagendamento é <base>/<slug>, a rota do cliente pós-migração.
      // Usa o slug do salão RESOLVIDO (não o do path): pro 'dono' o salão real vem
      // do perfil e pode diferir do slug da URL, e é ele que dono/cliente devem ver.
      const base = process.env.NEXT_PUBLIC_URL_BASE || window.location.origin;
      abrirWhatsApp(
        agendamento.telefone,
        MENSAGEM_CANCELAMENTO(
          agendamento,
          base,
          estabelecimento.slug,
          estabelecimento.msg_cancelamento
        )
      );
    }
    setAgendamentoParaCancelar(null);
  }

  // Botão Lembrete/Reenviar do modal de detalhe. PRIMEIRO abre o WhatsApp de
  // forma SÍNCRONA no clique (window.open fora do gesto do usuário é bloqueado
  // como pop-up). SÓ DEPOIS persiste o envio em lembrete_enviado_em e patcha o
  // estado local pelo MESMO atualizarItemLocal dos outros handlers — o modal
  // (dados vivos) reflete na hora e o botão vira "Reenviar lembrete".
  async function handleEnviarLembrete(item) {
    abrirWhatsApp(item.telefone, MENSAGEM_LEMBRETE(item, estabelecimento.msg_lembrete));

    const lembrete_enviado_em = new Date().toISOString();
    const { error } = await supabase
      .from("agendamentos")
      .update({ lembrete_enviado_em })
      .eq("id", item.id);

    if (error) {
      setErro(`Não foi possível registrar o envio do lembrete: ${error.message}`);
      return;
    }

    setErro("");
    atualizarItemLocal(item.id, { lembrete_enviado_em });
  }

  // Salva a observação do agendamento. Mesma mecânica do lembrete: grava no
  // banco e patcha o estado local pelo MESMO atualizarItemLocal — o modal (dados
  // vivos) reflete o texto na hora. Texto vazio vira null (limpa a observação).
  async function handleSalvarObservacao(id, texto) {
    const observacao = texto || null;
    setSalvandoObservacao(true);
    setObservacaoOk(false);
    const { error } = await supabase
      .from("agendamentos")
      .update({ observacao })
      .eq("id", id);
    setSalvandoObservacao(false);

    if (error) {
      setErro(`Não foi possível salvar a observação: ${error.message}`);
      return false;
    }

    setErro("");
    atualizarItemLocal(id, { observacao });
    setObservacaoOk(true);
    return true;
  }

  // Salva a anotação de um atendimento do HISTÓRICO. Espelha
  // handleSalvarObservacao (update em `observacao` + patch local via
  // atualizarItemLocal), mas com estado/feedback próprios dos cards do histórico
  // — sem tocar no modal do Painel. Texto vazio vira null (limpa a anotação).
  async function handleSalvarAnotHistorico(id, texto) {
    const observacao = texto || null;
    setSalvandoAnotHistorico(true);
    setOkAnotHistorico(null);
    const { error } = await supabase
      .from("agendamentos")
      .update({ observacao })
      .eq("id", id);
    setSalvandoAnotHistorico(false);

    if (error) {
      setErro(`Não foi possível salvar a anotação: ${error.message}`);
      return;
    }

    setErro("");
    atualizarItemLocal(id, { observacao });
    setIdAnotHistorico(null);
    setOkAnotHistorico(id);
  }

  // Troca o profissional do agendamento. Grava profissional_id no banco e patcha
  // o estado local (nome incluso) pelo MESMO atualizarItemLocal — card/modal
  // refletem na hora. Mantém o cadeado anti-sobreposição: 23P01 = outra reserva
  // pegou o profissional nesse horário no meio do caminho.
  async function handleTrocarProfissional(agendamento, profissional) {
    setErroTroca("");

    const { error } = await supabase
      .from("agendamentos")
      .update({ profissional_id: profissional.id })
      .eq("id", agendamento.id);

    if (error) {
      const ehOcupado =
        error.code === "23P01" ||
        /agendamentos_sem_sobreposicao|exclusion constraint/i.test(
          error.message ?? ""
        );
      setErroTroca(
        ehOcupado
          ? "Esse profissional acabou de ficar ocupado nesse horário. Escolha outro."
          : error.message
      );
      return;
    }

    atualizarItemLocal(agendamento.id, {
      profissional_id: profissional.id,
      profissional_nome: profissional.nome,
    });
    setAgendamentoParaTrocar(null);
  }

  // Alterar data/horário de um agendamento já existente (seção "Fora da
  // janela de agendamento"), mantendo cliente/serviço/profissional. Grava só
  // { data, horario } — `periodo` (coluna GERADA, base da exclusion
  // constraint) recalcula sozinho no Postgres, não é escrito daqui. Mesmo
  // cadeado anti-sobreposição de handleTrocarProfissional: 23P01 = outra
  // reserva ocupou esse profissional nesse horário no meio do caminho. Nesse
  // caso o modal continua aberto (não fecha, não desarma
  // agendamentoParaAlterarData) — só limpa o horário escolhido e força um
  // refetch da grade (versaoAlterarData) pra já refletir quem ainda está
  // livre, mesmo padrão de "recarrega as vagas" do wizard público.
  // Depois do UPDATE bem-sucedido, `notificarAoAlterarData` (zona grande vs.
  // zona pequena do botão dividido, ver JSX) decide se abre o WhatsApp com
  // MENSAGEM_ALTERACAO_DATA — mesmo padrão de `notificar` em
  // executarConfirmacao/handleCancelar. A mensagem usa a NOVA data/horario
  // (dataAlterarData/horarioAlterarData), não agendamentoParaAlterarData.data
  // (que ainda é a data ANTIGA nesse ponto).
  async function handleAlterarData() {
    if (!agendamentoParaAlterarData || !dataAlterarData || !horarioAlterarData) return;

    setSalvandoAlterarData(true);
    setErroAlterarData("");

    const { error } = await supabase
      .from("agendamentos")
      .update({ data: dataAlterarData, horario: horarioAlterarData })
      .eq("id", agendamentoParaAlterarData.id);

    setSalvandoAlterarData(false);

    if (error) {
      const ehOcupado =
        error.code === "23P01" ||
        /agendamentos_sem_sobreposicao|exclusion constraint/i.test(error.message ?? "");
      setErroAlterarData(
        ehOcupado ? "Esse horário já está ocupado. Escolha outro." : error.message
      );
      if (ehOcupado) {
        setHorarioAlterarData("");
        setVersaoAlterarData((v) => v + 1);
      }
      return;
    }

    atualizarItemLocal(agendamentoParaAlterarData.id, {
      data: dataAlterarData,
      horario: horarioAlterarData,
    });

    if (notificarAoAlterarData) {
      abrirWhatsApp(
        agendamentoParaAlterarData.telefone,
        MENSAGEM_ALTERACAO_DATA(
          { ...agendamentoParaAlterarData, data: dataAlterarData, horario: horarioAlterarData },
          estabelecimento.msg_alteracao_data
        )
      );
    }

    setAgendamentoParaAlterarData(null);
  }

  // Arquiva uma pendência administrativa (botão "Arquivar" de qualquer tipo em
  // TIPOS_PENDENCIA): grava resolvido=true e, só se der certo, some o card da
  // tela — sem precisar recarregar a página nem refazer o fetch inteiro.
  async function handleArquivarPendencia(id) {
    const { error } = await supabase
      .from("pendencias_admin")
      .update({ resolvido: true })
      .eq("id", id);

    if (error) {
      setErro(`Não foi possível arquivar a pendência: ${error.message}`);
      return;
    }

    setErro("");
    setPendenciasAdmin((atuais) => atuais.filter((item) => item.id !== id));
  }

  // Ação "Marcar brinde concedido" do card fidelidade_disponivel (ver
  // TIPOS_PENDENCIA): grava o resgate em fidelidade_resgates — zera a
  // contagem da cliente pra próxima fidelidade, já que
  // verificarFidelidadeClientes (lib/fidelidade.js) conta só a partir do
  // último resgate — e, se der certo, arquiva a pendência pelo MESMO caminho
  // de handleArquivarPendencia (sem repetir o update+patch local aqui).
  async function handleMarcarBrindeConcedido(item) {
    const { error } = await supabase
      .from("fidelidade_resgates")
      .insert({ cliente_id: item.cliente_id, estabelecimento_id: estabelecimento.id });

    if (error) {
      setErro(`Não foi possível registrar o resgate: ${error.message}`);
      return;
    }

    await handleArquivarPendencia(item.id);
  }

  // Verifica a sessão ao montar e fica ouvindo mudanças (login/logout em
  // outra aba também caem aqui). Sem sessão → manda pro login do MESMO salão
  // (slug no path, via urlLogin(salon)).
  useEffect(() => {
    let ativo = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!ativo) return;
      if (!session) {
        setAutenticado(false);
        router.replace(urlLogin(salon));
        return;
      }
      setAutenticado(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (!ativo) return;
      if (!session) {
        setAutenticado(false);
        router.replace(urlLogin(salon));
        return;
      }
      setAutenticado(true);
    });

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, [router, salon]);

  // Resolve o estabelecimento a partir do PERFIL do usuário autenticado (não
  // mais direto pelo slug do path). Espera a sessão confirmada porque a query
  // de perfis filtra por auth.uid(). Conforme o papel:
  //   - sem perfil → conta órfã: marca semPerfil (tela de erro).
  //   - 'dono'     → preso ao próprio salão: usa o estabelecimento do perfil e
  //                  IGNORA o slug do path.
  //   - 'global' (ou outro papel admin) → mantém o comportamento atual: resolve
  //                  pelo slug do path, permitindo navegar entre salões. (No path
  //                  routing sempre há um slug, então não existe mais o default
  //                  'valeria' da época do ?salon=.)
  useEffect(() => {
    if (autenticado !== true) return;
    let ativo = true;

    (async () => {
      const perfil = await buscarPerfil();
      if (!ativo) return;

      if (!perfil) {
        setSemPerfil(true);
        return;
      }

      setSemPerfil(false);
      setPapelUsuario(perfil?.papel ?? null);

      if (perfil.papel === "dono") {
        setEstabelecimento(perfil.estabelecimento ?? null);
        return;
      }

      const estab = await buscarEstabelecimento(salon);
      if (ativo) setEstabelecimento(estab);
    })();

    return () => {
      ativo = false;
    };
  }, [autenticado, salon]);

  // Popup diário da janela de agendamento: dispara uma vez, quando o
  // estabelecimento resolve e faltam menos de 30 dias pro fim da janela
  // configurada (ver diasRestantesJanela). "Já mostrei hoje" via localStorage
  // — chave por estabelecimento + data de hoje, sem precisar de coluna nova
  // nem de zerar nada à meia-noite (a chave de ontem simplesmente nunca mais
  // bate). Sem estabelecimento.janela_agendamento_fim (salão não configurou
  // ainda), não há o que avisar.
  useEffect(() => {
    if (!estabelecimento?.id || !estabelecimento?.janela_agendamento_fim) return;

    const dias = diasRestantesJanela(estabelecimento.janela_agendamento_fim);
    if (dias == null || dias >= 30) return;

    const chave = `janela_popup_mostrado_${estabelecimento.id}_${hojeISOLocal()}`;
    if (window.localStorage.getItem(chave)) return;

    window.localStorage.setItem(chave, "1");
    setPopupJanelaAberto(true);
  }, [estabelecimento]);

  // Zera a confirmação da anotação ao abrir/fechar/trocar o modal de detalhe
  // (o textarea já recolhe sozinho por `idEditandoObservacao` estar atrelado ao
  // id) — a mensagem "Anotação salva." não vaza entre agendamentos.
  useEffect(() => {
    setObservacaoOk(false);
  }, [idSelecionado]);

  // Progresso de fidelidade do modal de detalhe (ver estado acima). Resolve o
  // cliente pelo telefone do agendamento selecionado, já que `agendamentos`
  // não traz cliente_id.
  useEffect(() => {
    let ativo = true;

    if (idSelecionado == null || !estabelecimento?.fidelidade_ativa) {
      setProgressoFidelidadeModal(null);
      return;
    }

    const item = agendamentos.find((a) => a.id === idSelecionado);
    if (!item?.telefone) {
      setProgressoFidelidadeModal(null);
      return;
    }

    (async () => {
      const { data: cliente } = await supabase
        .from("clientes")
        .select("id")
        .eq("estabelecimento_id", estabelecimento.id)
        .eq("whatsapp", item.telefone)
        .maybeSingle();

      if (!ativo) return;
      if (!cliente) {
        setProgressoFidelidadeModal(null);
        return;
      }

      const progresso = await buscarProgressoFidelidade(cliente.id, estabelecimento);
      if (ativo) setProgressoFidelidadeModal(progresso);
    })();

    return () => {
      ativo = false;
    };
  }, [idSelecionado, agendamentos, estabelecimento]);

  // Fecha o drawer com Esc (só enquanto aberto). Complementa o backdrop e o
  // botão X — teclado e mouse fecham do mesmo jeito.
  useEffect(() => {
    if (!drawerAberto) return;
    const aoTeclar = (e) => {
      if (e.key === "Escape") setDrawerAberto(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [drawerAberto]);

  async function handleSair() {
    await supabase.auth.signOut();
    // Preserva o salão RESOLVIDO (slug do estabelecimento em uso; fallback pro
    // slug do path enquanto não resolveu) no next= pra reentrar no mesmo salão
    // após relogar.
    router.replace(urlLogin(estabelecimento?.slug ?? salon));
  }

  // Carga inicial (com indicador) + refresh automático a cada 60s. A função
  // async fica DENTRO do efeito (padrão idiomático): os setState vivem aqui,
  // ao redor do helper puro buscarAgendamentos, e a flag `ativo` evita setState
  // após desmontar.
  //   silencioso=false (carga inicial): mostra o "Carregando..." e estoura erro
  //     na tela se falhar.
  //   silencioso=true (refresh de fundo): não toca em `carregando` nem em `erro`,
  //     pra não desmontar a lista nem atrapalhar o dono no meio de uma ação;
  //     uma falha de rede só é ignorada até o próximo ciclo.
  useEffect(() => {
    // Só busca depois de ter sessão ativa E o estabelecimento resolvido —
    // ambos alimentam a query (estabelecimento.id particiona por salão).
    if (autenticado !== true || !estabelecimento) return;
    let ativo = true;

    async function carregar(silencioso) {
      const { dados, error } = await buscarAgendamentos(estabelecimento.id);

      if (!ativo) return;

      if (!silencioso) setCarregando(false);

      if (error) {
        // Mostra a mensagem real do Supabase para facilitar o diagnóstico.
        // Num refresh de fundo, não estoura erro pra não cobrir a lista.
        if (!silencioso) setErro(error.message);
        return;
      }

      if (!silencioso) setErro("");
      setAgendamentos(dados);

      const respostas = await buscarRespostasPorAgendamento(
        dados.map((item) => item.id)
      );
      if (ativo) setRespostasPorAgendamento(respostas);

      // Roda ANTES de buscar as pendências: cria as novas de fidelidade (se
      // houver) a tempo de já aparecerem nesta mesma carga.
      await verificarFidelidadeClientes(estabelecimento.id);
      if (!ativo) return;

      const { dados: dadosPendencias } = await buscarPendenciasAdmin(
        estabelecimento.id
      );
      if (ativo) setPendenciasAdmin(dadosPendencias);
    }

    // `carregando` já começa true, então a carga inicial mostra o indicador.
    carregar(false);

    // Intervalo do refresh configurável por env (em produção/piloto 60000; na
    // apresentação 5000). Fallback pra 60000 se ausente ou inválido.
    const intervaloMs = Number(process.env.NEXT_PUBLIC_REFRESH_MS) || 60000;
    const intervalo = setInterval(() => carregar(true), intervaloMs);

    // Limpa o timer ao desmontar (ou ao perder a sessão) — sem timer vazado.
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, [autenticado, estabelecimento]);

  // Lê a preferência escolha_profissional do salão (decide se a troca de
  // profissional aparece nos cards). Uma linha, ao resolver o estabelecimento.
  useEffect(() => {
    if (!estabelecimento?.id) return;
    let ativo = true;

    (async () => {
      const { data } = await supabase
        .from("estabelecimentos")
        .select("escolha_profissional")
        .eq("id", estabelecimento.id)
        .single();
      if (ativo) setEscolhaProfissional(Boolean(data?.escolha_profissional));
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimento]);

  // Conta os profissionais ATIVOS do salão (decide se "Trocar profissional"
  // aparece nos cards/modal — mesmo padrão de ConfiguracoesSalao.js).
  useEffect(() => {
    if (!estabelecimento?.id) return;
    let ativo = true;

    (async () => {
      const { count, error } = await supabase
        .from("profissionais")
        .select("id", { count: "exact", head: true })
        .eq("estabelecimento_id", estabelecimento.id)
        .eq("ativo", true);
      if (ativo && !error) setQtdProfissionaisAtivos(count ?? 0);
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimento]);

  // Ao armar a troca, carrega os profissionais LIVRES no horário do agendamento
  // (que atendem o serviço), reaproveitando lib/disponibilidade. O profissional
  // atual já sai de fora (a própria reserva o ocupa), mas filtramos por garantia.
  useEffect(() => {
    if (!agendamentoParaTrocar) return;
    let ativo = true;

    (async () => {
      setCarregandoTroca(true);
      setErroTroca("");
      setProfissionaisTroca([]);
      try {
        const livres = await profissionaisLivresNoHorario({
          estabelecimentoId: estabelecimento.id,
          servicoId: agendamentoParaTrocar.servico_id,
          data: agendamentoParaTrocar.data,
          horario: agendamentoParaTrocar.horario,
        });
        if (!ativo) return;
        setProfissionaisTroca(
          livres.filter((p) => p.id !== agendamentoParaTrocar.profissional_id)
        );
      } catch (e) {
        if (ativo) setErroTroca(e.message ?? String(e));
      } finally {
        if (ativo) setCarregandoTroca(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [agendamentoParaTrocar, estabelecimento]);

  // Ao armar "Alterar data", zera a seleção (mês volta pro atual, sem dia/
  // horário escolhidos) e busca os dias de atendimento do profissional FIXO
  // do agendamento — mesma fonte por modo (horarios_trabalho no modo
  // 'janela', horarios_fixos no modo 'fixo') que diasSemanaAtivos calcula
  // dentro do wizard (ver FormularioAgendamento), só que aqui é sempre UM
  // profissional só, não uma união de vários.
  useEffect(() => {
    if (!agendamentoParaAlterarData) return;
    let ativo = true;

    setMesVisivelAlterarData(new Date());
    setDataAlterarData("");
    setHorarioAlterarData("");
    setErroAlterarData("");
    setDiasSemanaAtivosAlterarData(new Set());

    (async () => {
      setCarregandoDiasAlterarData(true);
      const { data, error } = await supabase
        .from("profissionais")
        .select("modo_horario, horarios_trabalho(dia_semana), horarios_fixos(dia_semana)")
        .eq("id", agendamentoParaAlterarData.profissional_id)
        .single();
      if (!ativo) return;
      if (!error && data) {
        const linhasDia =
          data.modo_horario === "fixo" ? data.horarios_fixos : data.horarios_trabalho;
        setDiasSemanaAtivosAlterarData(new Set((linhasDia ?? []).map((h) => h.dia_semana)));
      }
      setCarregandoDiasAlterarData(false);
    })();

    return () => {
      ativo = false;
    };
  }, [agendamentoParaAlterarData]);

  // Ao escolher um dia no calendário, busca a grade de vagas do dia (mesma
  // lib/disponibilidade do wizard) e filtra só os horários em que o
  // profissional DESTE agendamento está livre — excluirAgendamentoId tira a
  // própria reserva da checagem de ocupados, senão o profissional apareceria
  // ocupado no horário ATUAL dela mesma (útil quando a dona só quer trocar o
  // horário dentro do mesmo dia). `versaoAlterarData` força um refetch depois
  // de um 23P01 (ver handleAlterarData), sem precisar trocar de dia.
  const [versaoAlterarData, setVersaoAlterarData] = useState(0);
  useEffect(() => {
    if (!agendamentoParaAlterarData || !dataAlterarData) {
      setHorariosAlterarData([]);
      return;
    }
    let ativo = true;

    (async () => {
      setCarregandoHorariosAlterarData(true);
      try {
        const vagas = await calcularVagasPorHorario({
          estabelecimentoId: estabelecimento.id,
          servicoId: agendamentoParaAlterarData.servico_id,
          data: dataAlterarData,
          excluirAgendamentoId: agendamentoParaAlterarData.id,
        });
        if (!ativo) return;
        const livres = Object.keys(vagas)
          .filter((h) => vagas[h].includes(agendamentoParaAlterarData.profissional_id))
          .sort();
        setHorariosAlterarData(livres);
      } catch (e) {
        if (ativo) setErroAlterarData(e.message ?? String(e));
      } finally {
        if (ativo) setCarregandoHorariosAlterarData(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [agendamentoParaAlterarData, dataAlterarData, estabelecimento, versaoAlterarData]);

  // Um único `agora` pra classificar tudo no render (inbox, fora da janela,
  // histórico).
  const agora = new Date();

  // Histórico (aba "Histórico"): tudo arquivado — cancelados, pendentes
  // caducados e confirmados concluídos. Ordenado do mais recente pro mais
  // antigo (data+horário desc); a query vem asc, então invertemos a chave.
  // Calculado ANTES dos guards de carregamento/sem-perfil abaixo (mesmo com
  // `agendamentos` ainda vazio) porque alimenta o hook useNavegacaoTrimestre
  // logo em seguida — hook precisa rodar sempre na mesma ordem entre renders
  // (Rules of Hooks), não pode ficar atrás de um `return` condicional.
  const historico = agendamentos
    .filter((item) => classificarAgendamento(item, agora) === "historico" && item.telefone)
    .sort((a, b) => {
      const chaveA = `${a.data ?? ""} ${a.horario ?? ""}`;
      const chaveB = `${b.data ?? ""} ${b.horario ?? ""}`;
      return chaveB.localeCompare(chaveA);
    });

  // Contagem por categoria (Concluído/Vencido/Cancelado) + "todos", pros
  // contadores do filtro.
  const contagensHistorico = {
    concluido: 0,
    caducado: 0,
    cancelado: 0,
    expirado: 0,
    todos: historico.length,
  };
  for (const item of historico) {
    contagensHistorico[rotuloHistorico(item)] += 1;
  }

  // Lista visível: aplica o filtro client-side (todos = sem filtro), depois
  // reordena por status (Expirado, Cancelado, Concluído/Vencido — ver
  // ordenarHistoricoPorStatus) preservando a ordem cronológica dentro de
  // cada grupo.
  const historicoVisivel = ordenarHistoricoPorStatus(
    filtroHistorico === "todos"
      ? historico
      : historico.filter((item) => rotuloHistorico(item) === filtroHistorico)
  );

  // Navegação por trimestre da aba Histórico (ver lib/useNavegacaoTrimestre):
  // abre no trimestre corrente, "<"/">" só andam entre trimestres com dado
  // (considerando o filtro de categoria acima), mesmo componente/hook
  // reaproveitado na ficha do cliente (GerenciarClientes.js).
  const navTrimestreHistorico = useNavegacaoMes(historicoVisivel);

  // Autenticado, mas sem perfil vinculado (conta órfã): não há salão a resolver.
  // Vem ANTES do guard de carregamento — nesse caso `estabelecimento` continua
  // undefined, então checar aqui evita ficar preso no "Carregando...".
  if (semPerfil) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h1 className="text-2xl font-bold text-heading">
            Conta sem salão vinculado
          </h1>
          <p className="mt-2 text-sm text-body">Contate o suporte.</p>
        </div>
      </main>
    );
  }

  // Enquanto verifica a sessão (ou já sabemos que não há), ou enquanto o
  // estabelecimento ainda está resolvendo, não renderiza a lista — o redirect
  // pro login cuida do resto. (estabelecimento === undefined = resolvendo; o
  // render principal abaixo lê estabelecimento.nome, então precisa do objeto.)
  if (autenticado !== true || estabelecimento === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  // Slug do path inexistente ou salão inativo: sem estabelecimento não há o que
  // listar nem onde gravar. (undefined = ainda resolvendo cai no fluxo normal,
  // com o "Carregando agendamentos..." enquanto o fetch espera.)
  if (estabelecimento === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h1 className="text-2xl font-bold text-heading">Salão não encontrado</h1>
          <p className="mt-2 text-sm text-body">
            Verifique o link e tente novamente.
          </p>
        </div>
      </main>
    );
  }

  // Inbox (aba "Pendentes"): partição DERIVADA, calculada por
  // classificarAgendamento. São os pendentes ainda no futuro — pendentes que já
  // caducaram caem em "historico" e somem daqui. `agendamentos` já vem ordenado
  // por data asc + horário asc da query, então o inbox sai cronológico
  // (mais próximo primeiro). Um único `agora` para classificar tudo no render.
  // item.finalizado exclui reserva antecipada abandonada no meio do wizard
  // (ver FormularioAgendamento): sem isso ela apareceria como pendência real
  // pra dona agir, mesmo nunca tendo sido de fato concluída pela cliente.
  // item.telefone exclui evento importado do Google Calendar ainda sem
  // cliente vinculado (ver POST em app/api/google-calendar/importar/route.js)
  // — sem ficha real, não faz sentido aparecer como pendência/histórico de
  // cliente; ele já ocupa o horário e aparece no Painel (que NÃO filtra),
  // com o botão "Vincular cliente" pra sair desse estado.
  const inbox = agendamentos
    .filter(
      (item) => classificarAgendamento(item, agora) === "inbox" && item.finalizado && item.telefone
    )
    // Itens com contador ativo (<=48h pra expirar a reserva) primeiro, mais
    // próximos de expirar no topo; os demais mantêm a ordem cronológica de
    // sempre (sort é estável, então "não mexe" nesse grupo, ver
    // horasRestantesReserva).
    .sort((a, b) => {
      const restA = horasRestantesReserva(a, estabelecimento, agora);
      const restB = horasRestantesReserva(b, estabelecimento, agora);
      const ativoA = restA != null && restA <= LIMITE_BADGE_EXPIRA_HORAS;
      const ativoB = restB != null && restB <= LIMITE_BADGE_EXPIRA_HORAS;
      if (ativoA && ativoB) return restA - restB;
      if (ativoA !== ativoB) return ativoA ? -1 : 1;
      return 0;
    });

  // Mesmo `inbox` acima, agrupado por cliente pra render (a aba mostra os
  // cards de uma mesma pessoa juntos, numa moldura só). NÃO reordena nada:
  // Map preserva ordem de inserção, então o grupo entra na lista geral na
  // posição do seu PRIMEIRO membro no inbox já ordenado — que é justamente o
  // mais prioritário —, e dentro do grupo os itens saem na mesma ordem
  // relativa, ou seja pela MESMA regra (horasRestantesReserva +
  // LIMITE_BADGE_EXPIRA_HORAS). Sem segundo sort: o critério de prioridade
  // continua existindo em um lugar só, e qualquer mudança nele se propaga
  // sozinha pros dois níveis.
  // A chave do Map é o telefone normalizado (só dígitos) pra unir a mesma
  // cliente gravada com formatações diferentes em agendamentos distintos; o
  // `telefone` do grupo guarda o valor ORIGINAL do primeiro item, porque a
  // tela continua exibindo exatamente o que está no banco, sem reformatar.
  const inboxAgrupado = [];
  {
    const porTelefone = new Map();
    for (const item of inbox) {
      const chave = String(item.telefone).replace(/\D/g, "");
      const grupo = porTelefone.get(chave);
      if (grupo) grupo.itens.push(item);
      else {
        const novo = { telefone: item.telefone, nome: item.nome_cliente, itens: [item] };
        porTelefone.set(chave, novo);
        inboxAgrupado.push(novo);
      }
    }
  }

  // Essa cliente (por telefone) tem item no inbox? Fonte da checagem do
  // atalho "Novo agendamento" do Histórico — lê o `inbox` ACIMA em vez de
  // repetir buscarPendentesPorTelefones: aqui a lista inteira já está em
  // memória, então a regra não é só "a mesma", é literalmente a mesma array
  // que a aba Pendentes renderiza (zero query, zero chance de divergir). O
  // IdentificacaoClienteAdmin não tem esse luxo — lá o componente não conhece
  // os agendamentos, e a checagem vai pro banco.
  function temPendenteNoInbox(telefone) {
    return !!telefone && inbox.some((item) => item.telefone === telefone);
  }

  // "Ir para pendentes" dos modais de cliente com pendência (busca por nome e
  // atalho do Histórico): troca de aba e reaproveita o MESMO destaque
  // temporário do clique no bloco cinza do Painel (pendenteEmDestaqueId +
  // refsPendentes + o useEffect que rola e limpa), resolvendo o telefone pro
  // id do primeiro pendente da cliente — a lista já vem cronológica, então é
  // o mais próximo. Sem item correspondente (corrida rara: a pendência foi
  // confirmada em outra aba entre o selo e o clique) só troca de aba, sem
  // destaque.
  function irParaPendentesDoTelefone(telefone) {
    const alvo = inbox.find((item) => item.telefone === telefone);

    setViewPai("pendentes");
    setDrawerAberto(false);
    router.push(`${pathname}?aba=pendentes`, { scroll: false });

    if (alvo) setPendenteEmDestaqueId(alvo.id);
  }

  // Seção "Fora da janela de agendamento" (aba Pendentes): DERIVADA, mesmo
  // padrão de `inbox`/`historico` — nenhum status novo, nenhuma query extra.
  // data além de estabelecimentos.janela_agendamento_fim (ver
  // dentroDaJanelaAgendamento), só pendente/aguardando_sinal — confirmado
  // fora da janela já passou pelo popup "Confirmar mesmo assim?" (ver
  // handleConfirmar/confirmacaoForaDaJanela) e continua normalmente no
  // Painel, sem aviso; não faz sentido pedir ação de novo aqui. Mesmos guards
  // de finalizado/telefone do inbox, pra não misturar reserva abandonada ou
  // evento importado sem cliente. Ordenado por data+horário asc (mais
  // próximo primeiro).
  const foraDaJanela = agendamentos
    .filter(
      (item) =>
        item.finalizado &&
        item.telefone &&
        (item.status === "pendente" || item.status === "aguardando_sinal") &&
        !dentroDaJanelaAgendamento(item.data, estabelecimento)
    )
    .sort((a, b) => {
      const chaveA = `${a.data ?? ""} ${a.horario ?? ""}`;
      const chaveB = `${b.data ?? ""} ${b.horario ?? ""}`;
      return chaveA.localeCompare(chaveB);
    });

  // Item do modal de detalhe, sempre lido VIVO de `agendamentos` pelo id — assim
  // o patch do lembrete (atualizarItemLocal) aparece sem reabrir o modal.
  const selecionado =
    idSelecionado != null
      ? agendamentos.find((item) => item.id === idSelecionado) ?? null
      : null;

  // Item vivo do modal de vínculo, mesmo padrão de `selecionado` acima.
  const paraVincular =
    idParaVincular != null
      ? agendamentos.find((item) => item.id === idParaVincular) ?? null
      : null;

  // Aba ativa (ABAS_PAI) pro título do header. Fallback pra primeira aba se o
  // id sair de sincronia por algum motivo.
  const abaAtiva = ABAS_PAI.find((aba) => aba.id === viewPai) ?? ABAS_PAI[0];

  // Rótulo da aba "Profissionais" muda pra "Horários" quando o salão tem 0 ou
  // 1 profissional ativo (não há "profissionais" pra gerenciar, só a agenda
  // dele) — mesmo critério de qtdProfissionaisAtivos usado em "Trocar
  // profissional". null (ainda carregando) mantém o rótulo padrão.
  function rotuloAba(aba) {
    if (aba.id !== "profissionais") return aba.rotulo;
    return qtdProfissionaisAtivos != null && qtdProfissionaisAtivos <= 1
      ? "Horários"
      : "Profissionais";
  }

  // Ícone da aba "Profissionais" acompanha o mesmo critério do rótulo acima
  // (0 ou 1 profissional ativo = tela vira "Horários", sem lista pra
  // gerenciar) — Clock no lugar de Users nesse caso.
  function iconeAba(aba) {
    if (aba.id === "profissionais" && qtdProfissionaisAtivos != null && qtdProfissionaisAtivos <= 1) {
      return Clock;
    }
    return aba.Icone;
  }
  // Só escolhe entre ícones já existentes (Clock ou aba.Icone), nunca cria
  // componente novo — falso positivo do react-hooks/static-components (o
  // mesmo padrão dentro do .map() do drawer, logo abaixo, não é sinalizado).
  const IconeAbaAtiva = iconeAba(abaAtiva);

  // Navegação do calendário do modal "Alterar data": não deixa recuar antes
  // do mês atual — mesma regra de podeVoltarMes em FormularioAgendamento.
  const agoraMesAlterarData = new Date();
  const podeVoltarMesAlterarData =
    mesVisivelAlterarData.getFullYear() > agoraMesAlterarData.getFullYear() ||
    (mesVisivelAlterarData.getFullYear() === agoraMesAlterarData.getFullYear() &&
      mesVisivelAlterarData.getMonth() > agoraMesAlterarData.getMonth());

  // Tema por salão (lib/temas.js) — MESMO mecanismo do fluxo público (ver
  // app/[salon]/page.js): sobrescreve as custom properties que todo botão/
  // borda/texto secundário do admin já lê via classe Tailwind. A aba ativa do
  // drawer (mais abaixo) usa text-heading/ring-border, então herda o tema
  // automaticamente — nenhuma classe precisa mudar. Sem tema.personalizado,
  // nada é sobrescrito e o admin de qualquer outro salão continua idêntico.
  const tema = buscarTema(estabelecimento.slug);
  const temaAtivo = tema?.personalizado ? tema : null;
  const estiloTemaRaiz = temaAtivo
    ? {
        "--color-primary": temaAtivo.botao,
        "--color-primary-hover": temaAtivo.botaoHover,
        "--color-heading": temaAtivo.textoPrincipal,
        "--color-border": temaAtivo.bordaHeader,
        "--color-body": temaAtivo.textoSecundario,
        "--color-muted": temaAtivo.textoSecundario,
        "--color-surface": temaAtivo.bgBody,
        "--color-card": temaAtivo.bgHeader,
      }
    : undefined;

  return (
    <main className="min-h-screen bg-surface" style={estiloTemaRaiz}>
      {/* Hero banner no topo do admin, maior por absorver a navegação. Nome do
          salão centralizado; a foto de fundo é condicional por slug
          (valeria/junior usam foto; barbearia mantém o degradê) — ver Hero.js.
          O hambúrguer NÃO fica no Hero: é um botão fixo (abaixo), pra descolar
          do banner e seguir visível durante o scroll. */}
      <Hero nome={estabelecimento.nome} slug={estabelecimento.slug} />

      {/* Hambúrguer FIXO no canto superior direito. Em scroll=0 cai sobre o
          canto do Hero (mesma posição visual de antes); ao rolar, "descola" do
          banner e continua na tela. O fundo escuro translúcido + blur garante
          contraste tanto sobre a foto quanto sobre o conteúdo claro depois do
          scroll. z-40: acima do conteúdo, abaixo do drawer/modais (z-50). */}
      <button
        type="button"
        onClick={() => setDrawerAberto(true)}
        aria-label="Abrir menu"
        aria-expanded={drawerAberto}
        className="fixed right-3 top-3 z-40 rounded-lg bg-black/40 p-2 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-black/55 sm:right-4 sm:top-4"
      >
        <Menu className="h-7 w-7" />
      </button>

      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        {/* Banner da janela de agendamento: só na aba Painel (viewPai ===
            "painel", ver ABAS_PAI) — nas outras abas (Profissionais, Regras
            de negócio, etc.) ele só poluía a tela sem contexto. O popup
            diário (abaixo de 30 dias restantes, ver useEffect/
            popupJanelaAberto) NÃO é afetado por essa condição: continua
            disparando em qualquer aba, independente daqui. Clique navega
            direto pro bloco "Janela de agendamento" em Regras de negócio, já
            aberto e rolado até ele (ver focarJanelaAgendamento +
            ConfiguracoesSalao). Visual de botão de verdade (sombra, anel
            grosso, fonte maior/negrito) — precisa ser óbvio que é clicável,
            não só um detalhe no canto. Verde/confortável (>=30 dias) vs
            vermelho (<30, já existia). Sem
            estabelecimento.janela_agendamento_fim (salão não configurou
            ainda), não aparece nada. */}
        {viewPai === "painel" && estabelecimento.janela_agendamento_fim && (
          <button
            type="button"
            onClick={() => {
              setViewPai("regras");
              setFocarJanelaAgendamento(true);
              setDrawerAberto(false);
            }}
            className={`mb-4 flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left shadow-md ring-2 transition hover:shadow-lg ${
              diasRestantesJanela(estabelecimento.janela_agendamento_fim) < 30
                ? "bg-red-50 text-red-700 ring-red-300 hover:bg-red-100"
                : "bg-green-50 text-green-700 ring-green-300 hover:bg-green-100"
            }`}
          >
            <span className="text-base font-bold leading-snug sm:text-lg">
              Agenda aberta até{" "}
              {formatarDataComAno(estabelecimento.janela_agendamento_fim)}
            </span>
            <ChevronRight aria-hidden="true" className="h-6 w-6 shrink-0" />
          </button>
        )}

        {/* Título da seção ativa (a barra de abas virou drawer). O ícone espelha
            o da aba correspondente no drawer. */}
        <div className="mb-4 flex items-center gap-2 text-heading">
          {/* eslint-disable-next-line react-hooks/static-components -- IconeAbaAtiva só escolhe entre ícones já existentes, nunca cria um novo */}
          <IconeAbaAtiva className="h-5 w-5 shrink-0 text-body" />
          <h2 className="text-base font-semibold">{rotuloAba(abaAtiva)}</h2>
        </div>

        {carregando && (
          <p className="rounded-lg bg-card px-4 py-3 text-sm text-body shadow-sm ring-1 ring-border">
            Carregando agendamentos...
          </p>
        )}

        {!carregando && erro && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
            {erro}
          </p>
        )}

        {/* Pendentes (inbox): só os itens classificados como "inbox" — pendentes
            ainda no futuro. Pendentes que já passaram caem em "historico" e
            somem daqui. Confirmar/Cancelar usam os MESMOS handlers de sempre
            (incl. o modal); o refresh derivado faz o item sair do inbox sozinho. */}
        {!carregando && !erro && viewPai === "pendentes" && (
          inbox.length === 0 && pendenciasAdmin.length === 0 && foraDaJanela.length === 0 ? (
            <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
              Nenhuma pendência.
            </p>
          ) : (
            <>
            {(inbox.length > 0 || pendenciasAdmin.length > 0) && (
            <ul className="space-y-3">
              {/* Pendências administrativas (tabela pendencias_admin, ex.:
                  cancelamento pela cliente) — cards visualmente distintos dos
                  agendamentos pendentes abaixo (ver TIPOS_PENDENCIA). */}
              {pendenciasAdmin.map((item) => {
                const config = TIPOS_PENDENCIA[item.tipo] ?? TIPO_PENDENCIA_PADRAO;
                const acoes = config.acoes(item, {
                  arquivar: handleArquivarPendencia,
                  marcarBrinde: handleMarcarBrindeConcedido,
                });
                return (
                  <li
                    key={`pendencia-${item.id}`}
                    className={`rounded-2xl p-4 shadow-sm ring-1 transition ${config.corCard}`}
                  >
                    <div className="flex items-start gap-3">
                      <config.Icone
                        className={`h-5 w-5 shrink-0 ${config.corIcone}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-heading">
                          {item.titulo}
                        </p>
                        {item.descricao && (
                          <p className="mt-0.5 text-sm text-body">
                            {item.descricao}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      {acoes.map((acao) => (
                        <button
                          key={acao.id}
                          type="button"
                          onClick={acao.onClick}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${acao.classe}`}
                        >
                          <acao.Icone className="h-4 w-4" />
                          {acao.rotulo}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}

              {inboxAgrupado.map((grupo) => {
                // Cliente com 2+ pendentes: nome e telefone sobem pra etiqueta
                // do grupo (uma vez só, no topo do bloco), então repeti-los em
                // cada card seria eco puro. Card solto continua exibindo os
                // dois normalmente, porque ali não há etiqueta acima.
                const emGrupo = grupo.itens.length > 1;

                const cards = grupo.itens.map((item) => {
                // Outros agendamentos CONFIRMADOS do MESMO telefone, ainda no
                // futuro (exclui o próprio item) — pequeno relatório inline
                // pra dona ver de cara se a cliente já tem outro horário
                // confirmado, sem precisar abrir modal. `agora` e
                // `agendamentos` (lista completa, já carregada) vêm do escopo
                // do render acima; fimDoAtendimento é o mesmo critério de
                // "futuro" usado por classificarAgendamento (lib/particao).
                const outrosAgendamentos = agendamentos.filter(
                  (a) =>
                    a.id !== item.id &&
                    a.telefone === item.telefone &&
                    a.status === "confirmado" &&
                    fimDoAtendimento(a) >= agora
                );

                // Contador "Expira em Xh" (ver horasRestantesReserva acima):
                // null enquanto o salão não configurou expiração, ou fora da
                // janela de 48h. mostrarBadgeExpira controla só a exibição; o
                // valor cru (não arredondado) decide a cor.
                const horasRestantes = horasRestantesReserva(item, estabelecimento, agora);
                const mostrarBadgeExpira =
                  horasRestantes != null && horasRestantes <= LIMITE_BADGE_EXPIRA_HORAS;

                return (
                <li
                  key={item.id}
                  id={`pendente-${item.id}`}
                  ref={(el) => {
                    if (el) refsPendentes.current.set(item.id, el);
                    else refsPendentes.current.delete(item.id);
                  }}
                  // Todo item do inbox precisa de ação: destaque âmbar fixo.
                  // Destaque temporário azul por cima (ver
                  // pendenteEmDestaqueId + PainelCalendario/onSelecionarPendente):
                  // chegada vinda do clique no bloco "Pendente" da view Dia.
                  className={`rounded-2xl bg-amber-50/60 p-4 shadow-sm ring-1 ring-amber-300 transition ${
                    pendenteEmDestaqueId === item.id
                      ? "ring-4 ring-blue-500"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {!emGrupo && (
                      <div className="min-w-0">
                        <p className="truncate font-medium text-heading">
                          {item.nome_cliente}
                        </p>
                        <p className="mt-0.5 text-sm text-body">{item.telefone}</p>
                      </div>
                    )}

                    {/* ml-auto segura os badges na direita também quando o
                        bloco de nome/telefone acima não renderiza (em grupo):
                        sem ele, justify-between com um filho só jogaria os
                        badges pra esquerda. */}
                    <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${classesStatus(
                          item.status
                        )}`}
                      >
                        {rotuloStatus(item.status)}
                      </span>
                      {mostrarBadgeExpira && (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                            horasRestantes <= LIMITE_BADGE_EXPIRA_VERMELHO_HORAS
                              ? "bg-red-50 text-red-600 ring-red-100"
                              : "bg-blue-50 text-blue-700 ring-blue-100"
                          }`}
                        >
                          Expira em {Math.max(0, Math.round(horasRestantes))}h
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-body">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className="text-body">Data</span>
                      <span className="font-medium">{formatarData(item.data)}</span>
                    </span>
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className="text-body">Horário</span>
                      <span className="font-medium">
                        {formatarHorario(item.horario)}
                      </span>
                    </span>
                    {/* Serviço pode ter nome longo: no mobile empilha (rótulo em
                        cima, valor embaixo) e ocupa a linha inteira; a partir de
                        sm volta a ficar lado a lado. min-w-0 + break-words deixam
                        o nome quebrar dentro do card em vez de estourar a borda. */}
                    <span className="flex min-w-0 basis-full flex-col items-start gap-0.5 sm:basis-auto sm:flex-row sm:items-center sm:gap-1.5">
                      <span className="text-body">Serviço</span>
                      <span className="min-w-0 break-words font-medium">
                        {item.servicos?.nome ?? "—"}
                      </span>
                    </span>
                    {/* Com 0 ou 1 profissional ativo o salão é a própria dona:
                        dizer "Profissional: Fulana" em todo card é ruído, já
                        que não há outra opção possível. Mesmo critério de
                        rotuloAba/iconeAba (a aba vira "Horários"). null =
                        ainda carregando a contagem, mantém o comportamento
                        padrão de mostrar. */}
                    {item.profissional_nome &&
                      !(qtdProfissionaisAtivos != null && qtdProfissionaisAtivos <= 1) && (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span className="text-body">Profissional</span>
                        <span className="min-w-0 break-words font-medium">
                          {item.profissional_nome}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Respostas do popup de perguntas do serviço (ver
                      lib/agendamentoRespostas), quando houver. */}
                  {(respostasPorAgendamento.get(item.id) ?? []).length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {respostasPorAgendamento.get(item.id).map((texto, i) => (
                        <li key={i} className="text-xs text-body">
                          {texto}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Comprovante do Pix anexado pela cliente na tela de
                      confirmação de sinal (ver BlocoConfirmacaoPix). Bucket
                      privado: o que está na coluna é o CAMINHO, e a signed
                      url só é gerada quando a dona clica. Some sozinho quando
                      não há comprovante — a maioria dos pendentes. */}
                  <LinkComprovantePix
                    caminho={item.comprovante_pix_url}
                    enviadoEm={item.comprovante_pix_enviado_em}
                    formatarEnviadoEm={formatarEnviadoEm}
                  />

                  {/* Declarou o pagamento SEM anexar arquivo. Os dois gestos do
                      BlocoConfirmacaoPix — marcar "Enviei o comprovante pelo
                      WhatsApp" e subir o arquivo — gravam sinal_declarado_pago
                      igual, então é a AUSÊNCIA do caminho que separa um do
                      outro. Mutuamente exclusiva com o bloco acima, que só
                      renderiza HAVENDO caminho: nunca aparecem os dois.
                      Tom neutro de propósito — é a palavra da cliente, não um
                      comprovante conferido, e não deve ler como confirmação. */}
                  {item.sinal_declarado_pago && !item.comprovante_pix_url && (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-body ring-1 ring-border">
                      <IconeWhatsApp className="h-3.5 w-3.5" />
                      Comprovante declarado pelo WhatsApp
                    </p>
                  )}

                  {/* Relatório inline: outros agendamentos CONFIRMADOS do
                      mesmo telefone, ainda no futuro. Só data+horário, sem
                      abrir modal — some sozinho quando não há nenhum, pra não
                      poluir o card na maioria dos casos. */}
                  {outrosAgendamentos.length > 0 && (
                    <div className="mt-3 rounded-lg bg-amber-100/60 px-3 py-2 text-xs text-body">
                      <p className="font-bold text-heading">
                        Agendamentos confirmados
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {outrosAgendamentos.map((outro) => (
                          <li key={outro.id}>
                            {formatarData(outro.data)} às{" "}
                            {formatarHorario(outro.horario)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-2">
                    {/* Botão dividido em duas zonas: a maior (texto+ícone)
                        mantém o comportamento de sempre (update + WhatsApp);
                        a menor (só ícones, ~64px pra área de toque no mobile)
                        abre um popup de confirmação e, se aceito, faz o mesmo
                        update mas pula o redirecionamento pro WhatsApp. Mesma
                        cor de fundo dos dois lados — só uma borda fina (mesma
                        cor do ring já usado no botão) separa as zonas, sem
                        criar elemento/cor novos. */}
                    <div className="flex items-stretch overflow-hidden rounded-lg bg-green-50 ring-1 ring-green-100">
                      <button
                        type="button"
                        onClick={() => handleConfirmar(item)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-green-700 transition hover:bg-green-100"
                      >
                        <IconeWhatsApp />
                        Confirmar agendamento
                      </button>
                      <button
                        type="button"
                        onClick={() => setAgendamentoParaConfirmar(item)}
                        aria-label="Confirmar sem notificar cliente"
                        title="Confirmar sem notificar cliente"
                        className="inline-flex w-16 shrink-0 items-center justify-center gap-1 border-l border-green-100 text-green-700 transition hover:bg-green-100"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                        <MessageCircleOff className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="flex items-stretch overflow-hidden rounded-lg bg-card ring-1 ring-red-200">
                      <button
                        type="button"
                        onClick={() => {
                          setAgendamentoParaCancelar(item);
                          setNotificarAoCancelar(true);
                        }}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                      >
                        <IconeWhatsApp />
                        Cancelar agendamento
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAgendamentoParaCancelar(item);
                          setNotificarAoCancelar(false);
                        }}
                        aria-label="Cancelar sem notificar cliente"
                        title="Cancelar sem notificar cliente"
                        className="inline-flex w-16 shrink-0 items-center justify-center gap-1 border-l border-red-200 text-red-600 transition hover:bg-red-50"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        <MessageCircleOff className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    {/* Contato livre (sem mensagem pré-preenchida), mesmo
                        padrão dos cards de pendência administrativa acima
                        (TIPOS_PENDENCIA) — diferente do "Entrar em contato"
                        do Histórico, que reaproveita msg_reativacao (texto
                        pensado pra cliente SEM agendamento ativo, não se
                        aplica aqui). Sem telefone (não deveria ocorrer no
                        inbox, que já filtra por item.telefone, mas fica
                        defensivo) o botão fica desabilitado com tooltip. */}
                    <button
                      type="button"
                      onClick={() =>
                        window.open(
                          linkWhatsAppSemMensagem(item.telefone),
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                      disabled={!item.telefone}
                      title={!item.telefone ? "Telefone não cadastrado" : undefined}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-50"
                    >
                      <IconeWhatsApp />
                      Entrar em contato
                    </button>

                    {/* Troca de profissional só com o toggle DESLIGADO (o dono
                        encaixa); ligado, respeita a escolha do cliente. E só
                        com 2+ profissionais ativos — com 1 só não há pra quem
                        trocar. */}
                    {!escolhaProfissional && qtdProfissionaisAtivos > 1 && (
                      <button
                        type="button"
                        onClick={() => setAgendamentoParaTrocar(item)}
                        className="inline-flex items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                      >
                        Trocar profissional
                      </button>
                    )}
                  </div>
                </li>
                );
                });

                // Cliente com um pendente só (a maioria): o card vai solto na
                // lista, exatamente como sempre foi. A moldura só existe pra
                // desambiguar 2+ cards da mesma pessoa, então aqui ela seria
                // ruído.
                if (grupo.itens.length === 1) return cards;

                // 2+ pendentes da mesma cliente: uma bandeja neutra em volta do
                // conjunto, com nome + telefone como etiqueta. bg-stone-200 de
                // propósito: bg-surface é literalmente a cor do <body> (ver
                // --surface em globals.css), então a bandeja sumia contra a
                // página. O cinza é mais escuro que os dois lados e fica fora
                // da família do amber, então os cards continuam sendo a única
                // coisa colorida — a bandeja só agrupa.
                return (
                  <li
                    key={grupo.telefone}
                    className="overflow-hidden rounded-2xl bg-stone-200 shadow-sm ring-1 ring-border"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5">
                      <p className="min-w-0 break-words text-sm font-semibold text-heading">
                        {grupo.nome}
                      </p>
                      <p className="text-xs text-body">{grupo.telefone}</p>
                      <span className="ml-auto shrink-0 text-xs text-body">
                        {grupo.itens.length} pendentes
                      </span>
                    </div>
                    <ul className="space-y-3 p-3">{cards}</ul>
                  </li>
                );
              })}
            </ul>
            )}

            {/* Fora da janela de agendamento: consulta adicional (data além
                de estabelecimentos.janela_agendamento_fim, status <>
                cancelado), derivada de `agendamentos` já carregado — NÃO
                altera nenhum status. Reaproveita os mesmos botões
                Confirmar/Cancelar (dividido, popup "confirmar/cancelar sem
                notificar?") do inbox acima; sem "Trocar profissional", que
                não faz sentido aqui. "Alterar data" (modal próprio, ver mais
                abaixo) e "Entrar em contato" (mesmo padrão abrirWhatsApp do
                Histórico) são as duas alternativas ao cancelamento.
                Automaticamente reversível: se a dona aumentar a janela
                depois, OU se "Alterar data" mover o item pra dentro da
                janela, ele sai sozinho daqui — nenhuma lógica extra, é só o
                mesmo filtro reagindo ao novo valor de
                estabelecimento.janela_agendamento_fim / item.data. */}
            {foraDaJanela.length > 0 && (
              <div className={inbox.length > 0 || pendenciasAdmin.length > 0 ? "mt-6" : ""}>
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-heading">
                  <AlertCircle className="h-4 w-4 text-blue-600" />
                  Fora da janela de agendamento
                </h3>
                <ul className="space-y-3">
                  {foraDaJanela.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-2xl bg-blue-50/60 p-4 shadow-sm ring-1 ring-blue-200 transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-heading">
                            {item.nome_cliente}
                          </p>
                          <p className="mt-0.5 text-sm text-body">{item.telefone}</p>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${classesStatus(
                            item.status
                          )}`}
                        >
                          {rotuloStatus(item.status)}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-body">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="text-body">Data</span>
                          <span className="font-medium">{formatarData(item.data)}</span>
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="text-body">Horário</span>
                          <span className="font-medium">
                            {formatarHorario(item.horario)}
                          </span>
                        </span>
                        <span className="flex min-w-0 basis-full flex-col items-start gap-0.5 sm:basis-auto sm:flex-row sm:items-center sm:gap-1.5">
                          <span className="text-body">Serviço</span>
                          <span className="min-w-0 break-words font-medium">
                            {item.servicos?.nome ?? "—"}
                          </span>
                        </span>
                        {item.profissional_nome && (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <span className="text-body">Profissional</span>
                            <span className="min-w-0 break-words font-medium">
                              {item.profissional_nome}
                            </span>
                          </span>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {/* Confirmar, dividido no mesmo padrão do inbox
                            normal (ver acima): a zona maior chama
                            handleConfirmar direto (que já checa
                            dentroDaJanelaAgendamento e abre o popup
                            "Confirmar mesmo assim?" quando necessário — faz
                            sentido aqui já que este card É o caso fora da
                            janela); a menor abre o popup "Confirmar sem
                            notificar?" já existente. */}
                        <div className="flex items-stretch overflow-hidden rounded-lg bg-green-50 ring-1 ring-green-100">
                          <button
                            type="button"
                            onClick={() => handleConfirmar(item)}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-green-700 transition hover:bg-green-100"
                          >
                            <IconeWhatsApp />
                            Confirmar agendamento
                          </button>
                          <button
                            type="button"
                            onClick={() => setAgendamentoParaConfirmar(item)}
                            aria-label="Confirmar sem notificar cliente"
                            title="Confirmar sem notificar cliente"
                            className="inline-flex w-16 shrink-0 items-center justify-center gap-1 border-l border-green-100 text-green-700 transition hover:bg-green-100"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            <MessageCircleOff className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>

                        {/* Cancelar, dividido no mesmo padrão do inbox
                            normal (ver acima): reaproveita o mesmo modal de
                            cancelamento, só variando notificarAoCancelar. */}
                        <div className="flex items-stretch overflow-hidden rounded-lg bg-card ring-1 ring-red-200">
                          <button
                            type="button"
                            onClick={() => {
                              setAgendamentoParaCancelar(item);
                              setNotificarAoCancelar(true);
                            }}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                          >
                            <IconeWhatsApp />
                            Cancelar agendamento
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAgendamentoParaCancelar(item);
                              setNotificarAoCancelar(false);
                            }}
                            aria-label="Cancelar sem notificar cliente"
                            title="Cancelar sem notificar cliente"
                            className="inline-flex w-16 shrink-0 items-center justify-center gap-1 border-l border-red-200 text-red-600 transition hover:bg-red-50"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                            <MessageCircleOff className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                        {/* Botão dividido em duas zonas, mesmo padrão de
                            Confirmar/Cancelar (ver acima): a maior mantém o
                            comportamento de sempre (update + WhatsApp com
                            MENSAGEM_ALTERACAO_DATA); a menor arma
                            notificarAoAlterarData=false e faz o mesmo update
                            sem notificar. O modal de escolher data (mais
                            abaixo) é o mesmo pros dois — sem popup extra de
                            confirmação, já que escolher a nova data e clicar
                            em "Confirmar nova data" já é o gesto deliberado. */}
                        <div className="flex items-stretch overflow-hidden rounded-lg bg-card ring-1 ring-border">
                          <button
                            type="button"
                            onClick={() => {
                              setAgendamentoParaAlterarData(item);
                              setNotificarAoAlterarData(true);
                            }}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-heading transition hover:bg-surface"
                          >
                            <Calendar className="h-4 w-4" />
                            Alterar data
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAgendamentoParaAlterarData(item);
                              setNotificarAoAlterarData(false);
                            }}
                            aria-label="Alterar data sem notificar cliente"
                            title="Alterar data sem notificar cliente"
                            className="inline-flex w-16 shrink-0 items-center justify-center gap-1 border-l border-border text-heading transition hover:bg-surface"
                          >
                            <Calendar className="h-4 w-4" aria-hidden="true" />
                            <MessageCircleOff className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            abrirWhatsApp(
                              item.telefone,
                              MENSAGEM_FORA_DA_JANELA(
                                item,
                                estabelecimento.janela_agendamento_fim,
                                estabelecimento.msg_fora_da_janela
                              )
                            )
                          }
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
                        >
                          <IconeWhatsApp />
                          Entrar em contato
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            </>
          )
        )}

        {/* Painel: calendário FullCalendar derivado dos agendamentos já
            carregados (pendentes/confirmados). Foco em uso mobile. */}
        {!carregando && !erro && viewPai === "painel" && (
          <PainelCalendario
            agendamentos={agendamentos}
            onSelecionarConfirmado={(item) => setIdSelecionado(item.id)}
            onSelecionarPendente={(item) => {
              setViewPai("pendentes");
              setPendenteEmDestaqueId(item.id);
              setDrawerAberto(false);
            }}
            onVincularCliente={(item) => setIdParaVincular(item.id)}
            estabelecimentoId={estabelecimento.id}
            dataInicial={searchParams.get("data")}
          />
        )}

        {/* Histórico: tudo arquivado (classificarAgendamento === "historico"),
            mais recente primeiro. Filtro por categoria + ação de reativação.
            É lista (não calendário) — clique aqui NÃO abre o modal do Painel. */}
        {!carregando && !erro && viewPai === "historico" && (
          <>
            {/* Filtro por categoria como <select> (lista suspensa): cabe na
                largura do mobile sem scroll horizontal. O contador de cada
                categoria vai no próprio texto da opção. "todos" não filtra. */}
            <div className="mb-4">
              <label htmlFor="filtro-historico" className="sr-only">
                Filtrar histórico
              </label>
              <select
                id="filtro-historico"
                value={filtroHistorico}
                onChange={(e) => setFiltroHistorico(e.target.value)}
                className="w-full rounded-lg bg-card px-3 py-2 text-sm font-medium text-heading shadow-sm ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-border"
              >
                {FILTROS_HISTORICO.map((filtro) => (
                  <option key={filtro.id} value={filtro.id}>
                    {filtro.rotulo} ({contagensHistorico[filtro.id]})
                  </option>
                ))}
              </select>
            </div>

            <NavegacaoMes
              rotulo={navTrimestreHistorico.rotulo}
              temAnterior={navTrimestreHistorico.temAnterior}
              temProximo={navTrimestreHistorico.temProximo}
              noAtual={navTrimestreHistorico.noAtual}
              onAnterior={navTrimestreHistorico.irParaAnterior}
              onProximo={navTrimestreHistorico.irParaProximo}
              onVoltarAtual={navTrimestreHistorico.voltarParaAtual}
            />

            {navTrimestreHistorico.itensDoMes.length === 0 ? (
              <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
                Nenhum agendamento no histórico neste mês.
              </p>
            ) : (
              <ul className="space-y-3">
                {navTrimestreHistorico.itensDoMes.map((item) => {
                  const meta = HISTORICO_META[rotuloHistorico(item)];
                  return (
                    <li
                      key={item.id}
                      className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-heading">
                            {item.nome_cliente}
                          </p>
                          <p className="mt-0.5 text-sm text-body">
                            {item.telefone}
                          </p>
                        </div>

                        {/* Rótulo derivado (Concluído/Vencido/Cancelado). O
                            status cru no banco NÃO muda. */}
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${meta.classe}`}
                        >
                          {meta.rotulo}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-body">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="text-body">Data</span>
                          <span className="font-medium">
                            {formatarData(item.data)}
                          </span>
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="text-body">Horário</span>
                          <span className="font-medium">
                            {formatarHorario(item.horario)}
                          </span>
                        </span>
                        {/* Serviço pode ter nome longo: no mobile empilha (rótulo
                            em cima, valor embaixo) e ocupa a linha inteira; a
                            partir de sm volta a ficar lado a lado. min-w-0 +
                            break-words deixam o nome quebrar dentro do card em
                            vez de estourar a borda. (Mesma correção dos cards de
                            Pendentes.) */}
                        <span className="flex min-w-0 basis-full flex-col items-start gap-0.5 sm:basis-auto sm:flex-row sm:items-center sm:gap-1.5">
                          <span className="text-body">Serviço</span>
                          <span className="min-w-0 break-words font-medium">
                            {item.servicos?.nome ?? "—"}
                          </span>
                        </span>
                        {item.profissional_nome && (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <span className="text-body">Profissional</span>
                            <span className="min-w-0 break-words font-medium">
                              {item.profissional_nome}
                            </span>
                          </span>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            abrirWhatsApp(
                              item.telefone,
                              MENSAGEM_CONTATO(item, estabelecimento.msg_reativacao)
                            )
                          }
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
                        >
                          <IconeWhatsApp />
                          Entrar em contato
                        </button>

                        {/* Atalho pra reagendar sem repetir a busca por nome:
                            preenche clienteParaAgendar direto (mesmo formato
                            de IdentificacaoClienteAdmin.onIdentificado, ver
                            aba Agendar abaixo) e troca de aba — pula o
                            pré-passo. `id: null` porque `agendamentos` não
                            guarda cliente_id (ver progressoFidelidadeModal
                            acima); inofensivo, FormularioAgendamento só lê
                            .nome/.telefone de clienteInicial. Não pré-preenche
                            serviço/profissional — reagendamento é do zero.
                            Pular o pré-passo pularia junto o aviso de cliente
                            com pendente, então o gate vem junto no atalho (ver
                            agendarComGateDePendencia) — mesmo modal, mesmas 3
                            ações. */}
                        <button
                          type="button"
                          onClick={() =>
                            agendarComGateDePendencia({
                              id: null,
                              nome: item.nome_cliente,
                              telefone: item.telefone,
                            })
                          }
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                        >
                          <CalendarPlus className="h-4 w-4" />
                          Novo agendamento
                        </button>
                      </div>

                      {/* Anotação do atendimento (agendamentos.observacao). Só no
                          Histórico — o dono registra o que foi feito. Com nota:
                          preview curto + "Ver/editar anotação"; sem nota só o
                          botão "Anotação". Clique abre o textarea inline; Salvar
                          persiste e reflete no card (atualizarItemLocal). */}
                      <div className="mt-3 border-t border-border pt-3">
                        {okAnotHistorico === item.id && (
                          <p className="mb-2 text-xs font-medium text-green-700">
                            Anotação salva.
                          </p>
                        )}

                        {idAnotHistorico === item.id ? (
                          <div className="flex flex-col gap-2">
                            <textarea
                              value={rascunhoAnotHistorico}
                              onChange={(e) =>
                                setRascunhoAnotHistorico(e.target.value)
                              }
                              maxLength={280}
                              rows={3}
                              placeholder="Ex: tintura usada, produtos, preferências do cliente..."
                              className="w-full resize-none break-words rounded-lg bg-card px-3 py-2 text-sm text-heading ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs text-muted">
                                {rascunhoAnotHistorico.length}/280
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setIdAnotHistorico(null)}
                                  className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  disabled={salvandoAnotHistorico}
                                  onClick={() =>
                                    handleSalvarAnotHistorico(
                                      item.id,
                                      rascunhoAnotHistorico.trim()
                                    )
                                  }
                                  className="inline-flex items-center justify-center rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100 disabled:opacity-60"
                                >
                                  {salvandoAnotHistorico ? "Salvando..." : "Salvar"}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            {item.observacao && (
                              <p className="mb-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-body">
                                {item.observacao}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setOkAnotHistorico(null);
                                setRascunhoAnotHistorico(item.observacao ?? "");
                                setIdAnotHistorico(item.id);
                              }}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                            >
                              <NotebookPen className="h-4 w-4" />
                              {item.observacao ? "Ver/editar anotação" : "Anotação"}
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {/* Agendar: o admin cria direto como "confirmado". Antes do wizard
            (FormularioAgendamento, reaproveitado do /agendar), passa por
            IdentificacaoClienteAdmin — busca o cliente por NOME (a dona sabe
            o nome de quem está atendendo, diferente do público que busca por
            WhatsApp) e, se não achar, cadastra (nome + WhatsApp obrigatório)
            antes de liberar o wizard. Sem isso, agendamentos criados aqui
            nunca tinham uma linha correspondente em `clientes`. Ao concluir,
            refaz o fetch pro novo confirmado aparecer no Painel. */}
        {!carregando && !erro && viewPai === "agendar" && (
          <div className="mx-auto w-full max-w-md">
            {avisoAgendar && (
              <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 ring-1 ring-green-100">
                {avisoAgendar}
              </p>
            )}

            {!clienteParaAgendar ? (
              <IdentificacaoClienteAdmin
                key={agendarKey}
                estabelecimentoId={estabelecimento.id}
                onIdentificado={setClienteParaAgendar}
                onIrParaPendentes={irParaPendentesDoTelefone}
              />
            ) : (
              <>
                <div className="mb-4 flex flex-col items-center gap-1.5 text-center">
                  <p className="text-sm text-body">
                    Agendando para{" "}
                    <span className="font-semibold text-headline">
                      {clienteParaAgendar.nome}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setClienteParaAgendar(null)}
                    className="rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-base font-semibold text-primary transition hover:bg-primary/20"
                  >
                    Trocar cliente
                  </button>
                </div>

                <FormularioAgendamento
                  key={`${agendarKey}-wizard`}
                  estabelecimento={estabelecimento}
                  status="confirmado"
                  clienteInicial={clienteParaAgendar}
                  rotuloSubmit="Criar agendamento confirmado"
                  // No admin o dono SEMPRE escolhe o profissional ao marcar,
                  // independente do toggle escolha_profissional do salão.
                  forcarEscolhaProfissional
                  onSucesso={async ({ form, horario }) => {
                    setAvisoAgendar(
                      `Agendamento de ${form.nome} criado para ${formatarData(
                        form.data
                      )} às ${horario}.`
                    );
                    // Remonta a identificação + o formulário limpos pro
                    // próximo cadastro.
                    setClienteParaAgendar(null);
                    setAgendarKey((k) => k + 1);
                    await recarregarAgendamentos();
                  }}
                />
              </>
            )}
          </div>
        )}

        {/* Serviços: CRUD dos serviços do salão (tabela `servicos`), sempre
            particionado pelo estabelecimento resolvido. "Excluir" é soft delete
            (ativo=false) pra preservar o histórico de agendamentos antigos. */}
        {!carregando && !erro && viewPai === "servicos" && (
          <GerenciarServicos estabelecimento={estabelecimento} />
        )}

        {/* Profissionais: CRUD dos profissionais (tabela `profissionais`) +
            grade de horários (tabela `horarios_trabalho`), particionado pelo
            estabelecimento resolvido. "Desativar" é soft delete (ativo=false). */}
        {!carregando && !erro && viewPai === "profissionais" && (
          <GerenciarProfissionais
            estabelecimento={estabelecimento}
            qtdProfissionaisAtivos={qtdProfissionaisAtivos}
            gatilhoNovoProfissional={gatilhoNovoProfissional}
          />
        )}

        {/* Clientes: consulta somente-leitura da tabela `clientes`, com busca
            por nome e detalhe do relacionamento (próximo agendamento, último
            atendimento, anamnese), particionado pelo estabelecimento resolvido. */}
        {!carregando && !erro && viewPai === "clientes" && (
          <GerenciarClientes
            estabelecimento={estabelecimento}
            // "Agendar" da ficha do cliente: mesmo atalho do "Novo
            // agendamento" do Histórico (pula o pré-passo de busca por nome e
            // passa pelo aviso de pendente), só que aqui o cliente vem da
            // tabela `clientes`, então leva o id REAL — ver DetalheCliente.
            onAgendarPara={agendarComGateDePendencia}
          />
        )}

        {/* Regras de negócio: config do salão (escolha_profissional, sinal/Pix
            e prazo de vencimento da manutenção), particionado pelo
            estabelecimento resolvido. */}
        {!carregando && !erro && viewPai === "regras" && (
          <ConfiguracoesSalao
            estabelecimento={estabelecimento}
            // `estabelecimento` (state deste componente) só é buscado uma vez
            // no mount — ConfiguracoesSalao lê/grava sua PRÓPRIA cópia dos
            // campos (ver comentário no topo daquele arquivo). Sem este patch,
            // o banner/popup da janela de agendamento (que leem
            // estabelecimento.janela_agendamento_fim aqui) e o calendário da
            // aba Agendar (que recebe este MESMO objeto) ficariam presos no
            // valor antigo até um reload da página.
            onJanelaAgendamentoFimAtualizada={(novaData) =>
              setEstabelecimento((atual) =>
                atual ? { ...atual, janela_agendamento_fim: novaData } : atual
              )
            }
            // Mesmo patch que onJanelaAgendamentoFimAtualizada, mas para as
            // mensagens de WhatsApp editáveis (ver MENSAGENS_WHATSAPP_CONFIG em
            // lib/whatsapp.js): sem isto, handleCancelar/handleConfirmar etc.
            // (que leem estabelecimento.msg_* deste state) continuariam usando
            // o texto salvo no mount até um reload da página, mesmo já com o
            // texto novo gravado no banco (ver salvarMensagem em
            // ConfiguracoesSalao.js).
            onMensagemAtualizada={(coluna, valor) =>
              setEstabelecimento((atual) => (atual ? { ...atual, [coluna]: valor } : atual))
            }
            focarBlocoJanela={focarJanelaAgendamento}
            onFocarBlocoJanelaConsumido={() => setFocarJanelaAgendamento(false)}
            onCadastrarProfissional={irParaCadastroProfissional}
          />
        )}
      </div>

      {/* Drawer lateral de navegação. Sempre montado pra permitir a transição
          suave: quando fechado, o painel desliza pra fora (translate-x-full) e o
          overlay fica invisível + pointer-events-none (não bloqueia cliques).
          O backdrop usa blur no conteúdo por trás e fecha ao toque; o botão X e
          a tecla Esc também fecham. Selecionar uma aba troca a view e fecha. */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          drawerAberto ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!drawerAberto}
      >
        <div
          className="absolute inset-0 bg-primary/30 backdrop-blur-sm"
          onClick={() => setDrawerAberto(false)}
        />

        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação"
          className={`absolute inset-y-0 right-0 flex w-72 max-w-[80%] transform flex-col bg-card shadow-xl ring-1 ring-border transition-transform duration-300 ${
            drawerAberto ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-4">
            <span className="font-display text-lg font-semibold text-heading">
              Menu
            </span>
            <button
              type="button"
              onClick={() => setDrawerAberto(false)}
              aria-label="Fechar menu"
              className="rounded-lg p-2 text-heading transition hover:bg-surface"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-2">
            {ABAS_PAI.map((aba) => {
              const ativa = viewPai === aba.id;
              const Icone = iconeAba(aba);
              return (
                <button
                  key={aba.id}
                  type="button"
                  onClick={() => {
                    setViewPai(aba.id);
                    setDrawerAberto(false);
                    setAvisoAgendar("");
                    setClienteParaAgendar(null);
                    router.push(`${pathname}?aba=${aba.id}`, { scroll: false });
                  }}
                  aria-current={ativa ? "page" : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition ${
                    ativa
                      ? "bg-surface text-heading ring-1 ring-border"
                      : "text-body hover:bg-surface hover:text-heading"
                  }`}
                >
                  <Icone className="h-5 w-5 shrink-0" />
                  {rotuloAba(aba)}
                </button>
              );
            })}
          </nav>

          {/* Item fixo, visível em qualquer aba (ver componente). */}
          <AtivarNotificacoes estabelecimento={estabelecimento} />

          {/* Link fixo pro /painel-global, fora do sistema de abas (ver
              ABAS_PAI) — só aparece pra quem tem papel 'global' no perfil. */}
          {papelUsuario === "global" && (
            <div className="border-t border-border p-2">
              <Link
                href="/painel-global"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-body hover:bg-surface"
              >
                <Settings className="h-4 w-4" />
                Painel global
              </Link>
            </div>
          )}

          {/* "Sair" mora no drawer (saiu do header). */}
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={handleSair}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
            >
              <LogOut className="h-5 w-5 shrink-0" />
              Sair
            </button>
          </div>
        </aside>
      </div>

      {/* Modal de detalhe do confirmado (clique no Painel). Dados + ações de
          agenda. Lê o item VIVO (`selecionado`); some se o id sair da lista. */}
      {selecionado && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-detalhe"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setIdSelecionado(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="titulo-detalhe"
                className="text-lg font-semibold text-heading"
              >
                Detalhes do agendamento
              </h2>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${classesStatus(
                  selecionado.status
                )}`}
              >
                {rotuloStatus(selecionado.status)}
              </span>
            </div>

            {/* Dados do cliente + serviço + horários. dl simples (rótulo/valor). */}
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-body">Cliente</dt>
                <dd className="flex items-center justify-end gap-2 text-right font-medium text-heading">
                  {selecionado.nome_cliente}
                  {progressoFidelidadeModal && (
                    <BadgeFidelidade
                      variante="chip"
                      atual={progressoFidelidadeModal.atual}
                      meta={progressoFidelidadeModal.meta}
                    />
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-body">Telefone</dt>
                <dd className="text-right font-medium text-heading">
                  {selecionado.telefone}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-body">Serviço</dt>
                <dd className="text-right font-medium text-heading">
                  {selecionado.servicos?.nome ?? selecionado.servico_livre ?? "—"}
                  {selecionado.servicos?.duracao_min != null && (
                    <> · {selecionado.servicos.duracao_min} min</>
                  )}
                  {selecionado.servicos?.preco_centavos != null && (
                    <> · {formatarPreco(selecionado.servicos.preco_centavos)}</>
                  )}
                </dd>
              </div>
              {/* Respostas do popup de perguntas do serviço (ver
                  lib/agendamentoRespostas), quando houver. */}
              {(respostasPorAgendamento.get(selecionado.id) ?? []).length > 0 && (
                <ul className="space-y-0.5">
                  {respostasPorAgendamento.get(selecionado.id).map((texto, i) => (
                    <li key={i} className="text-right text-xs text-body">
                      {texto}
                    </li>
                  ))}
                </ul>
              )}
              {selecionado.profissional_nome && (
                <div className="flex justify-between gap-3">
                  <dt className="text-body">Profissional</dt>
                  <dd className="text-right font-medium text-heading">
                    {selecionado.profissional_nome}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-body">Data</dt>
                <dd className="text-right font-medium text-heading">
                  {formatarData(selecionado.data)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-body">Horário</dt>
                <dd className="text-right font-medium text-heading">
                  {formatarHorario(selecionado.horario)} –{" "}
                  {formatarHoraLocal(fimDoAtendimento(selecionado))}
                </dd>
              </div>
            </dl>

            {/* Bloco de agenda: estado do lembrete + ação (enviar/reenviar). */}
            <div className="mt-5 border-t border-border pt-4">
              {selecionado.lembrete_enviado_em && (
                <p className="mb-2 text-xs text-muted">
                  Lembrete enviado em{" "}
                  {formatarEnviadoEm(selecionado.lembrete_enviado_em)}
                </p>
              )}
              <button
                type="button"
                onClick={() => handleEnviarLembrete(selecionado)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
              >
                <IconeWhatsApp />
                {selecionado.lembrete_enviado_em
                  ? "Reenviar lembrete"
                  : "Enviar lembrete"}
              </button>
            </div>

            {/* Anotação: texto livre persistido em `observacao` (só do lado
                admin). Sem edição: mostra o texto (ou o botão de adicionar);
                editando: textarea com contador travado em 280 + Salvar. Salvar
                vazio limpa (vira null). */}
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium text-heading">Anotação</p>

              {observacaoOk && (
                <p className="mb-2 text-xs font-medium text-green-700">
                  Anotação salva.
                </p>
              )}

              {idEditandoObservacao === selecionado.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={rascunhoObservacao}
                    onChange={(e) => setRascunhoObservacao(e.target.value)}
                    maxLength={280}
                    rows={3}
                    placeholder="Ex: tintura usada, preferências do cliente..."
                    className="w-full resize-none break-words rounded-lg bg-card px-3 py-2 text-sm text-heading ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted">
                      {rascunhoObservacao.length}/280
                    </span>
                    <button
                      type="button"
                      disabled={salvandoObservacao}
                      onClick={async () => {
                        const ok = await handleSalvarObservacao(
                          selecionado.id,
                          rascunhoObservacao.trim()
                        );
                        if (ok) setIdEditandoObservacao(null);
                      }}
                      className="inline-flex items-center justify-center rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100 disabled:opacity-60"
                    >
                      {salvandoObservacao ? "Salvando..." : "Salvar anotação"}
                    </button>
                  </div>
                </div>
              ) : selecionado.observacao ? (
                <div className="flex flex-col gap-2">
                  <p className="whitespace-pre-wrap break-words text-sm text-body">
                    {selecionado.observacao}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setObservacaoOk(false);
                      setRascunhoObservacao(selecionado.observacao);
                      setIdEditandoObservacao(selecionado.id);
                    }}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                  >
                    Editar anotação
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setObservacaoOk(false);
                    setRascunhoObservacao("");
                    setIdEditandoObservacao(selecionado.id);
                  }}
                  className="inline-flex w-full items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                >
                  Adicionar anotação
                </button>
              )}
            </div>

            {/* Cancelar: FECHA este modal e abre o fluxo de cancelamento
                existente (modal de confirmação → handleCancelar). Sem empilhar
                dois modais. Dividido no mesmo padrão do inbox de Pendentes e
                de Fora da janela (ver acima): reaproveita o mesmo modal de
                cancelamento, só variando notificarAoCancelar. */}
            <div className="mt-4 flex flex-col gap-2">
              {/* Trocar profissional só com o toggle DESLIGADO e 2+
                  profissionais ativos. Fecha este modal e abre o de troca
                  (sem empilhar). */}
              {!escolhaProfissional && qtdProfissionaisAtivos > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setIdSelecionado(null);
                    setAgendamentoParaTrocar(selecionado);
                  }}
                  className="inline-flex items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                >
                  Trocar profissional
                </button>
              )}
              <div className="flex items-stretch overflow-hidden rounded-lg bg-card ring-1 ring-red-200">
                <button
                  type="button"
                  onClick={() => {
                    setIdSelecionado(null);
                    setAgendamentoParaCancelar(selecionado);
                    setNotificarAoCancelar(true);
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                >
                  <IconeWhatsApp />
                  Cancelar agendamento
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIdSelecionado(null);
                    setAgendamentoParaCancelar(selecionado);
                    setNotificarAoCancelar(false);
                  }}
                  aria-label="Cancelar sem notificar cliente"
                  title="Cancelar sem notificar cliente"
                  className="inline-flex w-16 shrink-0 items-center justify-center gap-1 border-l border-red-200 text-red-600 transition hover:bg-red-50"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <MessageCircleOff className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIdSelecionado(null)}
                className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação do cancelamento. Só aparece quando há um
          agendamento "armado"; "Voltar" fecha sem efeito colateral. */}
      {agendamentoParaCancelar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-cancelar"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setAgendamentoParaCancelar(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-cancelar"
              className="text-lg font-semibold text-heading"
            >
              Cancelar agendamento
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja cancelar o agendamento de{" "}
              <span className="font-medium text-heading">
                {agendamentoParaCancelar.nome_cliente}
              </span>
              ?
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() =>
                  handleCancelar(agendamentoParaCancelar, notificarAoCancelar)
                }
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                <IconeWhatsApp />
                Confirmar cancelamento
              </button>
              <button
                type="button"
                onClick={() => setAgendamentoParaCancelar(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup leve da zona pequena de "Confirmar" (sem notificar) — mesmo
          estilo visual do modal de cancelamento acima, sem o texto extra do
          nome do cliente (aqui é só uma pergunta direta sim/não). A zona
          grande de Confirmar não passa por aqui — continua direta. */}
      {agendamentoParaConfirmar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-confirmar"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setAgendamentoParaConfirmar(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-confirmar"
              className="text-lg font-semibold text-heading"
            >
              Confirmar agendamento
            </h2>
            <p className="mt-2 text-sm text-body">
              Confirmar agendamento sem notificar o cliente?
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => {
                  handleConfirmar(agendamentoParaConfirmar, false);
                  setAgendamentoParaConfirmar(null);
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-700"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setAgendamentoParaConfirmar(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso de cliente com pendente para os atalhos que pulam o pré-passo:
          "Novo agendamento" (Histórico) e "Agendar" (ficha do cliente, aba
          Clientes) — os dois chegam aqui por agendarComGateDePendencia, então
          é um modal só. O MESMO modal aparece dentro do
          IdentificacaoClienteAdmin pro caminho da busca por nome — só o estado
          que o abre é local a cada um, já que os dois caminhos nunca estão na
          tela ao mesmo tempo. */}
      <ModalClientePendente
        cliente={clientePendenteParaAgendar}
        onIrParaPendentes={() => {
          const { telefone } = clientePendenteParaAgendar;
          setClientePendenteParaAgendar(null);
          irParaPendentesDoTelefone(telefone);
        }}
        onAgendarMesmoAssim={() => {
          const cliente = clientePendenteParaAgendar;
          setClientePendenteParaAgendar(null);
          irParaAgendarCom(cliente);
        }}
        onCancelar={() => setClientePendenteParaAgendar(null)}
      />

      {/* Popup "fora da janela": intercepta handleConfirmar quando o
          agendamento cai além de estabelecimentos.janela_agendamento_fim
          (ver dentroDaJanelaAgendamento) — mesmo padrão visual do modal de
          confirmação acima. Cancelar só fecha o popup, sem gravar nada;
          Confirmar chama executarConfirmacao com o `notificar` original. */}
      {confirmacaoForaDaJanela && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-fora-da-janela"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setConfirmacaoForaDaJanela(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-fora-da-janela"
              className="text-lg font-semibold text-heading"
            >
              Fora da janela de agendamento
            </h2>
            <p className="mt-2 text-sm text-body">
              Esse agendamento está fora da janela de agendamento do seu
              calendário. Deseja confirmar mesmo assim?
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => {
                  const { agendamento, notificar } = confirmacaoForaDaJanela;
                  setConfirmacaoForaDaJanela(null);
                  executarConfirmacao(agendamento, notificar);
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-700"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setConfirmacaoForaDaJanela(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de troca de profissional. Lista só quem atende o serviço E está
          LIVRE no horário (lib/disponibilidade). Clicar num profissional grava
          na hora (handleTrocarProfissional) e fecha. Só é acessível com o toggle
          escolha_profissional desligado (a abertura já é gated nos cards). */}
      {agendamentoParaTrocar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-trocar"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setAgendamentoParaTrocar(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="titulo-trocar" className="text-lg font-semibold text-heading">
              Trocar profissional
            </h2>
            <p className="mt-1 text-sm text-body">
              {formatarData(agendamentoParaTrocar.data)} às{" "}
              {formatarHorario(agendamentoParaTrocar.horario)}
              {agendamentoParaTrocar.servicos?.nome && (
                <> · {agendamentoParaTrocar.servicos.nome}</>
              )}
            </p>
            <p className="mt-1 text-xs text-muted">
              Atual: {agendamentoParaTrocar.profissional_nome ?? "—"}
            </p>

            <div className="mt-4">
              {carregandoTroca ? (
                <p className="text-sm text-body">Carregando disponíveis...</p>
              ) : erroTroca ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                  {erroTroca}
                </p>
              ) : profissionaisTroca.length === 0 ? (
                <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                  Nenhum outro profissional livre neste horário.
                </p>
              ) : (
                <ul className="space-y-2">
                  {profissionaisTroca.map((prof) => (
                    <li key={prof.id}>
                      <button
                        type="button"
                        onClick={() =>
                          handleTrocarProfissional(agendamentoParaTrocar, prof)
                        }
                        className="w-full rounded-lg bg-card px-3 py-2 text-left text-sm font-medium text-heading ring-1 ring-border transition hover:border-primary hover:ring-primary"
                      >
                        {prof.nome}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              onClick={() => setAgendamentoParaTrocar(null)}
              className="mt-4 w-full rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {/* Modal "Alterar data" (seção "Fora da janela de agendamento"): troca
          só data/horário, mantendo cliente/serviço/profissional. Reaproveita
          CalendarioDias (exportado de FormularioAgendamento.js) pro
          calendário — a janela de agendamento já bloqueia dias fora dela
          automaticamente, via dentroDaJanelaAgendamento dentro do próprio
          CalendarioDias. A grade de horários é uma réplica inline da mesma
          grade do wizard (sem extrair componente ainda, só esse um uso).
          Mesmo modal serve as duas zonas do botão dividido (ver
          notificarAoAlterarData) — sem popup extra de "tem certeza", já
          escolher a data e clicar em "Confirmar nova data" é o gesto. */}
      {agendamentoParaAlterarData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-alterar-data"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setAgendamentoParaAlterarData(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="titulo-alterar-data" className="text-lg font-semibold text-heading">
              Alterar data
            </h2>
            <p className="mt-1 text-sm text-body">
              Atual: {formatarData(agendamentoParaAlterarData.data)} às{" "}
              {formatarHorario(agendamentoParaAlterarData.horario)}
              {agendamentoParaAlterarData.servicos?.nome && (
                <> · {agendamentoParaAlterarData.servicos.nome}</>
              )}
            </p>
            <p className="mt-1 text-xs text-muted">
              Profissional: {agendamentoParaAlterarData.profissional_nome ?? "—"}
            </p>

            <div className="mt-4">
              <span className="mb-1 block text-sm font-medium text-body">
                Nova data
              </span>
              {carregandoDiasAlterarData ? (
                <p className="text-sm text-body">Carregando disponibilidade...</p>
              ) : (
                <CalendarioDias
                  mes={mesVisivelAlterarData}
                  min={hojeISOLocal()}
                  diasSemanaAtivos={diasSemanaAtivosAlterarData}
                  selecionado={dataAlterarData}
                  onSelecionar={(iso) => {
                    setDataAlterarData(iso);
                    setHorarioAlterarData("");
                    setErroAlterarData("");
                  }}
                  onPrev={() =>
                    setMesVisivelAlterarData(
                      (m) => new Date(m.getFullYear(), m.getMonth() - 1, 1)
                    )
                  }
                  onNext={() =>
                    setMesVisivelAlterarData(
                      (m) => new Date(m.getFullYear(), m.getMonth() + 1, 1)
                    )
                  }
                  podeVoltar={podeVoltarMesAlterarData}
                  estabelecimento={estabelecimento}
                  // Este modal é sempre admin — modo livre sempre ligado (ver
                  // CalendarioDias/modoLivre em FormularioAgendamento.js). A
                  // grade de horários abaixo NÃO foi estendida (fora do
                  // escopo pedido): dias fora da janela/expediente ficam
                  // clicáveis aqui, mas ainda podem mostrar "nenhum horário
                  // disponível" até essa segunda parte ser implementada.
                  modoLivre
                />
              )}
            </div>

            {dataAlterarData && (
              <div className="mt-4">
                <span className="mb-1 block text-sm font-medium text-body">
                  Horário
                </span>
                {carregandoHorariosAlterarData ? (
                  <p className="text-sm text-body">Carregando horários...</p>
                ) : horariosAlterarData.length === 0 ? (
                  <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                    Nenhum horário disponível neste dia.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {horariosAlterarData.map((slot) => {
                      const sel = horarioAlterarData === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setHorarioAlterarData(slot)}
                          disabled={salvandoAlterarData}
                          aria-pressed={sel}
                          className={[
                            "rounded-lg px-2 py-2 text-sm font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-60",
                            sel
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

            {erroAlterarData && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroAlterarData}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={handleAlterarData}
                disabled={!dataAlterarData || !horarioAlterarData || salvandoAlterarData}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvandoAlterarData ? "Salvando..." : "Confirmar nova data"}
              </button>
              <button
                type="button"
                onClick={() => setAgendamentoParaAlterarData(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal "Vincular cliente" (bloco âmbar do Painel — evento importado
          do Google Calendar ainda sem telefone). Ao confirmar, patcha o
          estado local pelo MESMO atualizarItemLocal dos outros handlers — o
          bloco no Painel vira verde e o modal de detalhe/ações passa a
          funcionar normalmente na próxima seleção. */}
      <ModalVincularCliente
        agendamento={paraVincular}
        estabelecimentoId={estabelecimento.id}
        onFechar={() => setIdParaVincular(null)}
        onVinculado={(patch) => {
          atualizarItemLocal(paraVincular.id, patch);
          setIdParaVincular(null);
        }}
      />

      {/* Popup diário da janela de agendamento (ver useEffect que abre
          popupJanelaAberto) — abaixo de 30 dias restantes, uma vez por dia. */}
      {popupJanelaAberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-popup-janela"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setPopupJanelaAberto(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-popup-janela"
              className="text-lg font-semibold text-heading"
            >
              Sua agenda está perto do fim
            </h2>
            <p className="mt-2 text-sm text-body">
              A agenda está aberta só até{" "}
              <span className="font-medium text-heading">
                {formatarDataComAno(estabelecimento.janela_agendamento_fim)}
              </span>
              . Configure uma nova data em Regras de negócio pra continuar
              recebendo agendamentos.
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => {
                  setPopupJanelaAberto(false);
                  setViewPai("regras");
                }}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
              >
                Ir para Regras de negócio
              </button>
              <button
                type="button"
                onClick={() => setPopupJanelaAberto(false)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
