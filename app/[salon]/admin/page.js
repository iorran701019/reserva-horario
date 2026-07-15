"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { buscarEstabelecimento } from "@/lib/estabelecimento";
import { buscarPerfil } from "@/lib/perfil";
import { buscarTema } from "@/lib/temas";
import {
  linkWhatsApp,
  MENSAGEM_LEMBRETE,
  MENSAGEM_CONTATO,
  MENSAGEM_CANCELAMENTO,
} from "@/lib/whatsapp";
import { classificarAgendamento, fimDoAtendimento } from "@/lib/particao";
import { profissionaisLivresNoHorario } from "@/lib/disponibilidade";
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
} from "lucide-react";
import Hero from "@/components/Hero";
import PainelCalendario from "./PainelCalendario";
import GerenciarServicos from "./GerenciarServicos";
import GerenciarProfissionais from "./GerenciarProfissionais";
import GerenciarClientes from "@/components/GerenciarClientes";
import ConfiguracoesSalao from "./ConfiguracoesSalao";
import FormularioAgendamento from "@/components/FormularioAgendamento";

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
function classesStatus(status) {
  const mapa = {
    confirmado: "bg-green-50 text-green-700 ring-green-100",
    pendente: "bg-amber-50 text-amber-700 ring-amber-100",
    cancelado: "bg-red-50 text-red-700 ring-red-100",
  };
  return mapa[status] ?? "bg-surface text-body ring-border";
}

// Categoria de exibição de um item arquivado (aba Histórico). O status ORIGINAL
// não muda no banco — isto é só rótulo derivado. Dentro do histórico, todo item
// não-cancelado já tem o fim no passado (ver classificarAgendamento), então o
// status basta pra escolher a categoria:
//   confirmado -> "concluido" (atendido)
//   cancelado  -> "cancelado"
//   pendente (ou desconhecido) -> "caducado" (passou sem confirmar)
function rotuloHistorico(item) {
  if (item.status === "cancelado") return "cancelado";
  if (item.status === "confirmado") return "concluido";
  return "caducado";
}

// Texto + cores do badge por categoria do histórico. Concluído em verde
// apagado, caducado (exibido como "Vencido") neutro/cinza, cancelado em
// vermelho apagado. A chave `caducado` é interna (vem de rotuloHistorico /
// lib/particao) — só o rótulo exibido muda.
const HISTORICO_META = {
  concluido: { rotulo: "Concluído", classe: "bg-green-50 text-green-600 ring-green-100" },
  caducado: { rotulo: "Vencido", classe: "bg-surface text-body ring-border" },
  cancelado: { rotulo: "Cancelado", classe: "bg-red-50 text-red-500 ring-red-100" },
};

// Ícone do WhatsApp. Herda a cor do texto (fill="currentColor") e o tamanho
// via className, então serve tanto pro botão verde quanto pro vermelho.
function IconeWhatsApp({ className = "h-4 w-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24.044 12.045.044 5.463.044.102 5.404.1 11.986c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.582 0 11.943-5.361 11.945-11.945a11.86 11.86 0 00-3.418-8.4" />
    </svg>
  );
}

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
];

// Filtros da aba Histórico (client-side, por categoria de rotuloHistorico).
// "todos" não filtra. Os ids batem com as categorias de HISTORICO_META.
const FILTROS_HISTORICO = [
  { id: "todos", rotulo: "Todos" },
  { id: "concluido", rotulo: "Concluído" },
  { id: "caducado", rotulo: "Vencido" },
  { id: "cancelado", rotulo: "Cancelado" },
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
    .select("id, nome_cliente, telefone, data, horario, status, created_at, lembrete_enviado_em, observacao, servico_id, servico_livre, profissional_id, servicos(nome, duracao_min, preco_centavos), profissionais(nome)")
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

export default function AdminPage() {
  const router = useRouter();

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

  const [agendamentos, setAgendamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Aba-pai do topo (ver ABAS_PAI): "pendentes" (inbox), "painel" (calendário),
  // "historico" e "agendar". A partição é derivada (lib/particao), sem status novo.
  const [viewPai, setViewPai] = useState("pendentes");

  // Drawer lateral de navegação (mobile-first): substitui a antiga barra de abas
  // fixa. `true` = aberto. Selecionar uma aba troca `viewPai` e fecha o drawer.
  const [drawerAberto, setDrawerAberto] = useState(false);

  // Agendamento aguardando confirmação de cancelamento (controla o modal).
  // null = nenhum modal aberto.
  const [agendamentoParaCancelar, setAgendamentoParaCancelar] = useState(null);

  // Agendamento confirmado selecionado no Painel (controla o modal de detalhe/
  // ações). Guardamos o id; os dados vivos saem de `agendamentos` no render,
  // pra refletir na hora o patch do lembrete. null = modal fechado.
  const [idSelecionado, setIdSelecionado] = useState(null);

  // Edição da observação no modal de detalhe. `idEditandoObservacao` guarda o id
  // cujo textarea está aberto — atrelar ao id (e não a um booleano) faz o
  // textarea recolher sozinho ao fechar o modal ou trocar de agendamento.
  // `rascunhoObservacao` é o texto sendo digitado.
  const [idEditandoObservacao, setIdEditandoObservacao] = useState(null);
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
  const [agendarKey, setAgendarKey] = useState(0);
  const [avisoAgendar, setAvisoAgendar] = useState("");

  // Preferência do salão (tabela estabelecimentos). Só quando DESLIGADA (o dono
  // encaixa) faz sentido oferecer a troca de profissional nos cards — com ela
  // ligada, respeita-se a escolha do cliente e a opção nem aparece.
  const [escolhaProfissional, setEscolhaProfissional] = useState(false);

  // Troca de profissional: `agendamentoParaTrocar` arma o modal; a lista de
  // profissionais LIVRES no horário (que atendem o serviço) é carregada sob
  // demanda por lib/disponibilidade. null = modal fechado.
  const [agendamentoParaTrocar, setAgendamentoParaTrocar] = useState(null);
  const [profissionaisTroca, setProfissionaisTroca] = useState([]);
  const [carregandoTroca, setCarregandoTroca] = useState(false);
  const [erroTroca, setErroTroca] = useState("");

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
    if (!error) setAgendamentos(dados);
  }

  // Botão A: grava o status 'confirmado' no banco e, se der certo, abre o
  // WhatsApp com a mensagem de confirmação. Em caso de erro não abre o
  // WhatsApp (não anuncia confirmação que não foi gravada).
  async function handleConfirmar(agendamento) {
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

    abrirWhatsApp(
      agendamento.telefone,
      `Olá ${agendamento.nome_cliente}! Seu agendamento de ${
        agendamento.servicos?.nome ?? "serviço"
      } no dia ${formatarData(
        agendamento.data
      )} às ${formatarHorario(agendamento.horario)} está confirmado. Será um prazer lhe atender! ✅`
    );
  }

  // Botão B: só roda DEPOIS que o dono confirma no modal. Grava o status
  // 'cancelado' no banco e, se der certo, abre o WhatsApp com a mensagem de
  // cancelamento. Em caso de erro não abre o WhatsApp.
  async function handleCancelar(agendamento) {
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

    // Base da URL: a env pública (inlinada no build) quando definida; senão a
    // origem real do navegador — nunca "undefined" e sem domínio hardcoded.
    // O link de reagendamento é <base>/<slug>, a rota do cliente pós-migração.
    // Usa o slug do salão RESOLVIDO (não o do path): pro 'dono' o salão real vem
    // do perfil e pode diferir do slug da URL, e é ele que dono/cliente devem ver.
    const base = process.env.NEXT_PUBLIC_URL_BASE || window.location.origin;
    abrirWhatsApp(
      agendamento.telefone,
      MENSAGEM_CANCELAMENTO(agendamento, base, estabelecimento.slug)
    );
    setAgendamentoParaCancelar(null);
  }

  // Botão Lembrete/Reenviar do modal de detalhe. PRIMEIRO abre o WhatsApp de
  // forma SÍNCRONA no clique (window.open fora do gesto do usuário é bloqueado
  // como pop-up). SÓ DEPOIS persiste o envio em lembrete_enviado_em e patcha o
  // estado local pelo MESMO atualizarItemLocal dos outros handlers — o modal
  // (dados vivos) reflete na hora e o botão vira "Reenviar lembrete".
  async function handleEnviarLembrete(item) {
    abrirWhatsApp(item.telefone, MENSAGEM_LEMBRETE(item));

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

  // Zera a confirmação da anotação ao abrir/fechar/trocar o modal de detalhe
  // (o textarea já recolhe sozinho por `idEditandoObservacao` estar atrelado ao
  // id) — a mensagem "Anotação salva." não vaza entre agendamentos.
  useEffect(() => {
    setObservacaoOk(false);
  }, [idSelecionado]);

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
  const agora = new Date();
  const inbox = agendamentos.filter(
    (item) => classificarAgendamento(item, agora) === "inbox"
  );

  // Histórico (aba "Histórico"): tudo arquivado — cancelados, pendentes
  // caducados e confirmados concluídos. Ordenado do mais recente pro mais
  // antigo (data+horário desc); a query vem asc, então invertemos a chave.
  const historico = agendamentos
    .filter((item) => classificarAgendamento(item, agora) === "historico")
    .sort((a, b) => {
      const chaveA = `${a.data ?? ""} ${a.horario ?? ""}`;
      const chaveB = `${b.data ?? ""} ${b.horario ?? ""}`;
      return chaveB.localeCompare(chaveA);
    });

  // Contagem por categoria (Concluído/Vencido/Cancelado) + "todos", pros
  // contadores do filtro.
  const contagensHistorico = { concluido: 0, caducado: 0, cancelado: 0, todos: historico.length };
  for (const item of historico) {
    contagensHistorico[rotuloHistorico(item)] += 1;
  }

  // Lista visível: aplica o filtro client-side (todos = sem filtro).
  const historicoVisivel =
    filtroHistorico === "todos"
      ? historico
      : historico.filter((item) => rotuloHistorico(item) === filtroHistorico);

  // Item do modal de detalhe, sempre lido VIVO de `agendamentos` pelo id — assim
  // o patch do lembrete (atualizarItemLocal) aparece sem reabrir o modal.
  const selecionado =
    idSelecionado != null
      ? agendamentos.find((item) => item.id === idSelecionado) ?? null
      : null;

  // Aba ativa (ABAS_PAI) pro título do header. Fallback pra primeira aba se o
  // id sair de sincronia por algum motivo.
  const abaAtiva = ABAS_PAI.find((aba) => aba.id === viewPai) ?? ABAS_PAI[0];

  // Tema por salão (lib/temas.js) — MESMO mecanismo do fluxo público (ver
  // app/[salon]/page.js): sobrescreve as custom properties que todo botão/
  // borda/texto secundário do admin já lê via classe Tailwind. A aba ativa do
  // drawer (mais abaixo) usa text-heading/ring-border, então herda o tema
  // automaticamente — nenhuma classe precisa mudar. Sem tema.marca, nada é
  // sobrescrito e o admin de qualquer outro salão continua idêntico.
  const tema = buscarTema(estabelecimento.slug);
  const temaAtivo = tema?.marca ? tema : null;
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
        {/* Título da seção ativa (a barra de abas virou drawer). O ícone espelha
            o da aba correspondente no drawer. */}
        <div className="mb-4 flex items-center gap-2 text-heading">
          <abaAtiva.Icone className="h-5 w-5 shrink-0 text-body" />
          <h2 className="text-base font-semibold">{abaAtiva.rotulo}</h2>
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
          inbox.length === 0 ? (
            <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
              Nenhum agendamento pendente.
            </p>
          ) : (
            <ul className="space-y-3">
              {inbox.map((item) => (
                <li
                  key={item.id}
                  // Todo item do inbox precisa de ação: destaque âmbar fixo.
                  className="rounded-2xl bg-amber-50/60 p-4 shadow-sm ring-1 ring-amber-300 transition"
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
                      {item.status ?? "—"}
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
                    {item.profissional_nome && (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span className="text-body">Profissional</span>
                        <span className="min-w-0 break-words font-medium">
                          {item.profissional_nome}
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirmar(item)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
                    >
                      <IconeWhatsApp />
                      Confirmar agendamento
                    </button>

                    <button
                      type="button"
                      onClick={() => setAgendamentoParaCancelar(item)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                    >
                      <IconeWhatsApp />
                      Cancelar agendamento
                    </button>

                    {/* Troca de profissional só com o toggle DESLIGADO (o dono
                        encaixa); ligado, respeita a escolha do cliente. */}
                    {!escolhaProfissional && (
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
              ))}
            </ul>
          )
        )}

        {/* Painel: calendário FullCalendar derivado dos agendamentos já
            carregados (pendentes/confirmados). Foco em uso mobile. */}
        {!carregando && !erro && viewPai === "painel" && (
          <PainelCalendario
            agendamentos={agendamentos}
            onSelecionarConfirmado={(item) => setIdSelecionado(item.id)}
            estabelecimentoId={estabelecimento.id}
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

            {historicoVisivel.length === 0 ? (
              <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
                Nenhum agendamento no histórico.
              </p>
            ) : (
              <ul className="space-y-3">
                {historicoVisivel.map((item) => {
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

                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() =>
                            abrirWhatsApp(item.telefone, MENSAGEM_CONTATO(item))
                          }
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
                        >
                          <IconeWhatsApp />
                          Entrar em contato
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

        {/* Agendar: o admin cria direto como "confirmado". Reaproveita o wizard
            do /agendar (FormularioAgendamento). Ao concluir, refaz o fetch pro
            novo confirmado aparecer no Painel; o WhatsApp é opcional (lembrete
            depois, pelo modal do Painel) — nada é forçado aqui. */}
        {!carregando && !erro && viewPai === "agendar" && (
          <div className="mx-auto w-full max-w-md">
            {avisoAgendar && (
              <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 ring-1 ring-green-100">
                {avisoAgendar}
              </p>
            )}

            <FormularioAgendamento
              key={agendarKey}
              estabelecimento={estabelecimento}
              status="confirmado"
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
                // Remonta o formulário limpo pro próximo cadastro.
                setAgendarKey((k) => k + 1);
                await recarregarAgendamentos();
              }}
            />
          </div>
        )}

        {/* Serviços: CRUD dos serviços do salão (tabela `servicos`), sempre
            particionado pelo estabelecimento resolvido. "Excluir" é soft delete
            (ativo=false) pra preservar o histórico de agendamentos antigos. */}
        {!carregando && !erro && viewPai === "servicos" && (
          <GerenciarServicos estabelecimento={estabelecimento} />
        )}

        {/* Profissionais: config do salão (escolha_profissional) no topo, depois
            o CRUD dos profissionais (tabela `profissionais`) + grade de horários
            (tabela `horarios_trabalho`), particionado pelo estabelecimento
            resolvido. "Desativar" é soft delete (ativo=false). */}
        {!carregando && !erro && viewPai === "profissionais" && (
          <>
            <ConfiguracoesSalao estabelecimento={estabelecimento} />
            <GerenciarProfissionais estabelecimento={estabelecimento} />
          </>
        )}

        {/* Clientes: consulta somente-leitura da tabela `clientes`, com busca
            por nome e detalhe do relacionamento (próximo agendamento, último
            atendimento, anamnese), particionado pelo estabelecimento resolvido. */}
        {!carregando && !erro && viewPai === "clientes" && (
          <GerenciarClientes estabelecimento={estabelecimento} />
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
              const Icone = aba.Icone;
              return (
                <button
                  key={aba.id}
                  type="button"
                  onClick={() => {
                    setViewPai(aba.id);
                    setDrawerAberto(false);
                  }}
                  aria-current={ativa ? "page" : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition ${
                    ativa
                      ? "bg-surface text-heading ring-1 ring-border"
                      : "text-body hover:bg-surface hover:text-heading"
                  }`}
                >
                  <Icone className="h-5 w-5 shrink-0" />
                  {aba.rotulo}
                </button>
              );
            })}
          </nav>

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
                {selecionado.status ?? "—"}
              </span>
            </div>

            {/* Dados do cliente + serviço + horários. dl simples (rótulo/valor). */}
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-body">Cliente</dt>
                <dd className="text-right font-medium text-heading">
                  {selecionado.nome_cliente}
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
                dois modais. */}
            <div className="mt-4 flex flex-col gap-2">
              {/* Trocar profissional só com o toggle DESLIGADO. Fecha este modal
                  e abre o de troca (sem empilhar). */}
              {!escolhaProfissional && (
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
              <button
                type="button"
                onClick={() => {
                  setIdSelecionado(null);
                  setAgendamentoParaCancelar(selecionado);
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
              >
                <IconeWhatsApp />
                Cancelar agendamento
              </button>
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
                onClick={() => handleCancelar(agendamentoParaCancelar)}
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
    </main>
  );
}
