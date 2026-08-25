"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MessageCircleOff } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { calcularVagasPorHorario, filtrarPorAntecedenciaMinima } from "@/lib/disponibilidade";
import { buscarTema } from "@/lib/temas";
import PopupRegrasAgendamento from "@/components/PopupRegrasAgendamento";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import {
  calcularPrecoManutencao,
  buscarVencimentoManutencao,
} from "@/lib/manutencaoSugerida";
import { lerFatia, salvarFatia, limparFatia } from "@/lib/persistenciaAgendamento";
import { useVoltarFisico } from "@/lib/voltarFisico";
import { dentroDaJanelaAgendamento } from "@/lib/janelaAgendamento";
import { linkWhatsApp, MENSAGEM_CONFIRMACAO } from "@/lib/whatsapp";
import { normalizarWhatsapp, validarWhatsapp } from "@/lib/whatsappValidacao";

// Wizard de agendamento COMPARTILHADO entre o fluxo público (/agendar, cria
// "pendente"/"aguardando_sinal") e a aba Agendar do /admin (cria
// "confirmado"). Toda a lógica de serviços, geração de slots, ocupados,
// validação e insert vive AQUI — os consumidores só fornecem a diferença via
// props (status do insert, rótulo do botão, o que fazer no sucesso) e o
// layout ao redor (Hero, header, tela de confirmação). NÃO duplicar a lógica
// de slots/ocupados em outro lugar.
//
// Momento do INSERT difere entre os dois: /admin grava no submit final
// ("Confirmar"), como sempre. O público grava mais cedo, ao ENTRAR na etapa
// "dados" (ver selecionarHorario) — pra não perder a reserva se a cliente
// sumir pra pagar o sinal via Pix e nunca voltar a esta tela. O submit final
// do público só faz UPDATE (declarar sinal pago) ou nada. Ver reservaId/
// reservaChave, mais abaixo, pro controle de quando reaproveitar/cancelar.

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

// Rótulos pt-BR dos `motivo` que calcularVagasPorHorario/filtrarPorAntecedenciaMinima
// anotam no formato enriquecido (contexto='admin') — usado só pelo tooltip da
// grade do modo livre (ver gradeAdmin/ROTULOS_MOTIVO_BLOQUEIO no JSX).
const ROTULOS_MOTIVO_BLOQUEIO = {
  excecao_ausencia: "ausência cadastrada",
  fora_do_modo: "fora do expediente/modo configurado",
  antecedencia: "fora da antecedência mínima do salão",
};

// "YYYY-MM-DD" de hoje em horário local — usado como mínimo do date picker.
function dataDeHoje() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// ADMIN (modoLivre): true quando `data` é HOJE e `horario` ("HH:MM") já
// começou em relação ao relógio do navegador. Usado só pra ESCONDER esses
// slots da grade do dia inteiro (gradeAdmin) — puro filtro visual, diferente
// do motivo 'antecedencia' (que continua marcando "bloqueado" mas visível,
// já que faz parte do que o modo livre existe pra contornar). Dias que não
// são hoje sempre retornam false — a grade deles continua completa desde
// 00:00 (ver gradeAdmin).
function horarioJaPassouHoje(data, horario) {
  if (data !== dataDeHoje()) return false;
  const agora = new Date();
  const [h, m] = horario.split(":").map(Number);
  const alvo = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), h, m);
  return alvo.getTime() < agora.getTime();
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

// Revalida (data, horario) contra a antecedência mínima do salão no relógio
// do SERVIDOR (rota /api/agendamentos/validar-antecedencia), chamada logo
// antes de QUALQUER insert em `agendamentos` (ver selecionarHorario e o ramo
// /admin de finalizarAgendamento) — o filtro em horariosVisiveis já usa o
// mesmo cálculo, mas com o relógio do NAVEGADOR, que dá pra manipular. Falha
// de rede conta como bloqueado: mais seguro que deixar passar sem checar.
async function validarAntecedenciaNoServidor({ estabelecimentoId, data, horario }) {
  try {
    const resposta = await fetch("/api/agendamentos/validar-antecedencia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estabelecimentoId, data, horario }),
    });
    if (!resposta.ok) return false;
    const resultado = await resposta.json();
    return resultado.permitido === true;
  } catch {
    return false;
  }
}

// Perguntas vinculadas a um serviço (servico_perguntas + suas opções) — usada
// por confirmarSelecaoServico (toque no serviço) E pela restauração de sessão
// (ver pendenteRestaurarRef mais abaixo), que precisa recarregar as perguntas
// do serviço restaurado sem reabrir o popup. RLS bloqueando a leitura pro
// público equivale, aqui, a "sem perguntas" — o fluxo segue normalmente.
// O embed de servico_pergunta_opcoes precisa do hint de FK explícito: desde
// que opcao_gatilho_id (pergunta condicional) passou a referenciar
// servico_pergunta_opcoes(id), existem DUAS relações entre as duas tabelas, e
// o PostgREST rejeita o embed ambíguo (PGRST201) sem o hint — o que fazia essa
// busca falhar (silenciosamente, como "sem perguntas") pra qualquer serviço.
async function buscarPerguntasServico(servicoId) {
  const { data, error } = await supabase
    .from("servico_perguntas")
    .select(
      "id, texto, tipo, ordem, pergunta_pai_id, opcao_gatilho_id, servico_pergunta_opcoes!servico_pergunta_opcoes_pergunta_id_fkey(id, label, ajuste_preco_centavos, ajuste_duracao_min, aplicar_duracao_na_agenda, ordem)"
    )
    .eq("servico_id", servicoId)
    .order("ordem", { ascending: true })
    .order("ordem", { ascending: true, referencedTable: "servico_pergunta_opcoes" });

  return error ? [] : (data ?? []);
}

// Pergunta condicional (filha, ver GerenciarServicos): só deve aparecer e ser
// exigida quando a mãe (pergunta_pai_id) já foi respondida com a opção
// gatilho (opcao_gatilho_id) certa. pergunta_pai_id nulo = pergunta raiz,
// sempre visível — comportamento idêntico ao de antes da pergunta condicional
// existir. Função pura (recebe `respostas` em vez de fechar sobre o state)
// pra ser reaproveitada em todos os pontos que percorrem perguntasServico.
function perguntaDeveAparecer(pergunta, respostas) {
  if (pergunta.pergunta_pai_id == null) return true;
  return respostas[pergunta.pergunta_pai_id]?.opcaoId === pergunta.opcao_gatilho_id;
}

// Calendário mensal próprio para a etapa Data. O <input type="date"> nativo não
// permite cinzar dias específicos por dia da semana, então montamos a grade à
// mão. Um dia nasce DESABILITADO (cinza, não clicável) quando é passado (< min),
// quando o seu dia da semana não está em `diasSemanaAtivos` — o conjunto de
// dias em que há profissional elegível trabalhando (calculado por quem chama)
// — ou quando está além de estabelecimentos.janela_agendamento_fim (ver
// dentroDaJanelaAgendamento em lib/janelaAgendamento.js, a MESMA checagem
// usada em lib/disponibilidade.js pro fluxo público e o /admin nunca divergirem).
//
// Props:
//   mes              – Date no primeiro dia do mês exibido.
//   min              – "YYYY-MM-DD" mínimo (hoje); datas anteriores ficam cinza.
//   diasSemanaAtivos – Set<number> de dias da semana (0–6) com atendimento.
//   selecionado      – "YYYY-MM-DD" atualmente escolhido (destaca a célula).
//   onSelecionar     – recebe o "YYYY-MM-DD" do dia clicado (só dias válidos).
//   onPrev/onNext    – navegação de mês. podeVoltar trava o passado.
//   estabelecimento  – salão atual, lido só por janela_agendamento_fim (ver
//                   dentroDaJanelaAgendamento acima).
//   vencimentoManutencao – Date (meia-noite local) do vencimento da manutenção
//                   selecionada, ou null. Quando presente, só INFORMA (não
//                   bloqueia): dias até e incluindo o vencimento ganham um
//                   fundo verde sutil, dias após ganham laranja. Um dia
//                   desabilitado (cinza, sem profissional) mantém prioridade
//                   visual sobre essas cores.
//   modoLivre        – true no /admin (ver FormularioAgendamento): `fechado` e
//                   `foraDaJanela` deixam de desabilitar o dia — a dona pode
//                   escolher qualquer dia, mesmo sem profissional elegível ou
//                   além da janela de agendamento. `passado` continua
//                   bloqueando SEMPRE, nos dois modos (não dá pra agendar num
//                   dia que já passou). Um dia que só ficou clicável por
//                   causa do modoLivre ganha uma marcação visual distinta
//                   (borda tracejada + selo) — nunca a mesma paleta
//                   verde/laranja do vencimento de manutenção, pra não
//                   misturar as duas informações.
// Exportado pra ser reaproveitado fora do wizard (ver modal "Alterar data"
// da seção "Fora da janela de agendamento" em app/[salon]/admin/page.js) —
// componente puro, tudo vem por props, nenhuma dependência do resto do
// FormularioAgendamento.
export function CalendarioDias({
  mes,
  min,
  diasSemanaAtivos,
  selecionado,
  onSelecionar,
  onPrev,
  onNext,
  podeVoltar,
  estabelecimento,
  vencimentoManutencao,
  modoLivre = false,
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
          const foraDaJanela = !dentroDaJanelaAgendamento(iso, estabelecimento);
          // No modo livre, `fechado`/`foraDaJanela` deixam de desabilitar —
          // só continuam existindo pra saber quando aplicar o selo (abaixo).
          // `passado` nunca é dispensado, nos dois modos.
          const desabilitado = passado || (!modoLivre && (fechado || foraDaJanela));
          // Dia que só está clicável PORQUE está em modo livre (normalmente
          // seria cinza) — ganha o selo/borda tracejada distintos.
          const liberado = modoLivre && !desabilitado && (fechado || foraDaJanela);
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
              title={liberado ? "Fora das regras normais de agendamento — modo livre do admin" : undefined}
              onClick={() => onSelecionar(iso)}
              className={[
                "relative flex h-9 items-center justify-center rounded-lg text-sm transition",
                desabilitado
                  ? "cursor-not-allowed text-muted/40"
                  : sel
                  ? "bg-primary font-semibold text-white ring-1 ring-primary"
                  : dentroDoPrazo
                  ? "bg-green-50 text-body ring-1 ring-green-200 hover:border-primary hover:ring-primary"
                  : foraDoPrazo
                  ? "bg-orange-50 text-body ring-1 ring-orange-200 hover:border-primary hover:ring-primary"
                  : "text-body ring-1 ring-border hover:border-primary hover:ring-primary",
                liberado && !sel ? "border-2 border-dashed border-violet-300" : "",
              ].join(" ")}
            >
              {d}
              {liberado && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-violet-500"
                />
              )}
            </button>
          );
        })}
      </div>

      {modoLivre && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-violet-500" />
          Fora das regras normais de agendamento (modo livre)
        </p>
      )}
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
//                   do formulário (público: IdentificacaoCliente, busca por
//                   WhatsApp; admin: IdentificacaoClienteAdmin, busca por
//                   nome — ver app/[salon]/admin/page.js). Sempre presente nos
//                   dois consumidores atuais — pré-preenche nome/telefone e a
//                   etapa "dados" troca os inputs por um resumo de
//                   confirmação; o insert continua lendo form.nome/
//                   form.telefone normalmente. Omitido, a etapa pede
//                   nome/WhatsApp como formulário livre (sem consumidor atual).
//   clienteEhNovo – true quando o cliente identificado acabou de se cadastrar
//                   agora (veio do CadastroCliente, não de um número já
//                   conhecido). Alimenta precisaSinal (sinal_regra === 'novos'),
//                   que só se aplica ao público — o /admin não passa (nem
//                   precisaria: precisaSinal é sempre false com `status`).
//   nomeProfissionalContato – mesmo nome exibido no botão fixo ContatoDono
//                   (menor id ativo, ou "a equipe"). Usado só no texto do
//                   bloco do sinal; buscado uma vez em app/[salon]/page.js e
//                   repassado aqui pra não duplicar a query.
//   servicoInicial – linha de `servicos` (mesmo formato da query de serviços
//                   abaixo) já escolhida ANTES do wizard abrir — ex.: o card de
//                   sugestão de manutenção do PainelCliente. Pula a etapa
//                   "servico" e cai direto em "data". Omitido (o normal), a
//                   etapa "servico" funciona como sempre.
//   onVoltarInicio – só fluxo público (ignorado com `status`). Chamado em vez
//                   de voltarEtapa ao sair da etapa "dados" (voltar físico —
//                   o botão em tela some aqui, ver JSX): a reserva já foi
//                   gravada de verdade ao entrar em "dados" (ver
//                   selecionarHorario), então não pode mais reabrir "data" e
//                   arriscar cancelar/trocar essa reserva. Quem chama decide
//                   o que "início do fluxo" significa (app/[salon]/page.js
//                   volta pra tela de telefone) — este componente só cede o
//                   controle, sem cancelar nem tocar na reserva.
//   onVoltarAntes  – só fluxo público (ignorado com `status`). Botão físico
//                   "voltar" na etapa "servico" (a primeira etapa "exposta"
//                   do wizard): diferente de onVoltarInicio (início absoluto
//                   do fluxo), aqui é "um passo atrás" — quem chama decide o
//                   que isso significa (app/[salon]/page.js volta pro
//                   PainelCliente ou pra Identificação, dependendo de qual
//                   dos dois veio antes). Gateado por !servicoInicialPendente
//                   (ver useVoltarFisico abaixo) pra não armar durante o
//                   pulo automático de "servico" pra "data" (servicoInicial).
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
  onVoltarInicio = null,
  onVoltarAntes = null,
}) {
  const [form, setForm] = useState(() => ({
    ...ESTADO_INICIAL,
    nome: clienteInicial?.nome ?? ESTADO_INICIAL.nome,
    telefone: clienteInicial?.telefone ?? ESTADO_INICIAL.telefone,
  }));
  const [horarioSelecionado, setHorarioSelecionado] = useState("");

  // --- Restauração de sessão (sessionStorage) -----------------------------
  // Sobrevive a um reload real da página (ex.: o navegador do WhatsApp
  // recarrega a aba ao voltar de segundo plano no celular). SÓ no fluxo
  // público (sem `status` — o /admin nunca lê nem grava aqui) e só quando
  // `servicoInicial` não veio de um clique fresco (ex.: sugestão de
  // manutenção do PainelCliente), que sempre vence sobre um rascunho velho.
  // Guarda o retalho bruto lido uma única vez no mount; é um ref (não
  // state) porque só serve de entrada pros efeitos abaixo — mudar seu valor
  // não deve, por si só, re-renderizar nada. Cada campo é aplicado e
  // "consumido" (setado pra null) conforme os dados dos quais depende
  // terminam de carregar — NUNCA reaparece como selecionado sem antes ser
  // revalidado contra o banco.
  const pendenteRestaurarRef = useRef(
    status || servicoInicial
      ? null
      : lerFatia(estabelecimento.slug, "agendamento")
  );
  // Aviso mostrado quando o horário restaurado da sessão anterior não está
  // mais disponível (outra reserva ocupou o horário enquanto a página estava
  // "fora") — ver o 3º efeito de restauração, mais abaixo.
  const [avisoHorarioIndisponivel, setAvisoHorarioIndisponivel] = useState(false);

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
  // Serviço de manutenção (eh_manutencao=true) que o cliente acabou de tocar
  // no acordeão, aguardando confirmação de que já fez o serviço de origem
  // antes (ver selecionarServico). Intercepta ANTES do alerta_mensagem.
  const [manutencaoPendente, setManutencaoPendente] = useState(null);
  // Mensagem de erro ao clicar "Sim, em outro salão" sem a dona ter
  // configurado o serviço de manutenção externa (ver
  // confirmarManutencaoOutroSalao) — some sozinha depois de alguns segundos
  // (ver efeito abaixo).
  const [erroManutencaoExterna, setErroManutencaoExterna] = useState("");
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
  // Pra qual `data` o `vagas` atual corresponde — usado só pela restauração
  // de sessão abaixo, pra saber com segurança quando `vagas` já reflete o dia
  // restaurado (e não mais o de uma sincronização anterior/em andamento).
  const [vagasData, setVagasData] = useState("");

  // Preferência do salão: cliente escolhe o profissional (true) ou o sistema
  // encaixa automaticamente (false). Lida do banco junto com os serviços.
  const [escolhaProfissional, setEscolhaProfissional] = useState(false);

  // Profissionais ATIVOS que atendem o serviço escolhido, cada um já com seus
  // dias de trabalho (horarios_trabalho.dia_semana) embutidos — carregados nos
  // dois modos: no "cliente escolhe" alimentam os cards, e sempre alimentam os
  // dias disponíveis do calendário. `profissionalSelecionado` só é usado no
  // fluxo "cliente escolhe". Declarados aqui, antes de `escolherProfissional`,
  // porque a flag efetiva abaixo depende da contagem.
  const [profissionaisDoServico, setProfissionaisDoServico] = useState([]);
  const [profissionalSelecionado, setProfissionalSelecionado] = useState(null);
  const [carregandoProfissionais, setCarregandoProfissionais] = useState(false);

  // Refs para rolar suavemente até o bloco que surge após cada escolha, pra ele
  // não passar despercebido abaixo da dobra (salões com muitos serviços). Vale
  // no público e no /admin, já que o componente é compartilhado. Declaradas
  // aqui (antes dos blocos de decisão de etapa abaixo, que já usam rolarPara).
  const profissionalRef = useRef(null);
  const dataRef = useRef(null);

  // scrollIntoView só depois do render que monta o bloco alvo: rAF garante que
  // o elemento (e a ref) já existem no DOM.
  function rolarPara(ref) {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // Flag EFETIVO usado por toda a lógica de modo: o admin força o seletor
  // (forcarEscolhaProfissional), senão vale o toggle do salão — e só faz
  // sentido com 2+ profissionais atendendo o serviço; com 1 só (ou 0, ainda
  // carregando), o sistema já encaixa nele automaticamente sem perguntar. O
  // state acima guarda só o valor cru do banco; daqui pra baixo tudo lê
  // `escolherProfissional` (cards, dias disponíveis, horários, validação e
  // submit). ATENÇÃO: como depende de `profissionaisDoServico` (carregado sob
  // demanda por serviço — ver efeito mais abaixo), ele só é confiável quando
  // `carregandoProfissionais` for false pro serviço ATUAL; os dois blocos de
  // decisão de etapa logo abaixo (`decisaoEtapaPendente`) existem só pra
  // adiar a decisão até esse momento, em vez de usar um valor ainda do
  // serviço anterior (ou do estado inicial vazio).
  const escolherProfissional =
    (forcarEscolhaProfissional || escolhaProfissional) &&
    profissionaisDoServico.length > 1;

  // Pulo(s) de etapa que dependem de `escolherProfissional` mas podem ser
  // disparados enquanto `profissionaisDoServico` ainda carrega pro serviço
  // atual (logo antes de `escolherProfissional` refletir a contagem certa):
  // o do servicoInicial (assim que a config carrega) e o de avancarAposServico
  // (assim que um serviço é tocado/confirmado). 'inicial' não rola a tela
  // (mesmo comportamento de sempre); 'avancar' rola pro bloco certo. null =
  // nada pendente.
  const [decisaoEtapaPendente, setDecisaoEtapaPendente] = useState(null);

  // Resolve o pulo de etapa do servicoInicial assim que a config
  // escolha_profissional carrega (carregandoServicos vira false). Sem exigir
  // profissional, vai direto pra "data" — igual confirmarSelecaoServico faz
  // pra qualquer serviço no encaixe automático. Exigindo, fica em "servico"
  // (a lista de serviços não atrapalha: com servicoSelecionado já preenchido,
  // os cards de profissional já aparecem logo abaixo dela). Ajuste de estado
  // durante a renderização (não um efeito — dispara só na transição
  // true -> false, comparando com o valor da renderização anterior). Se
  // profissionaisDoServico ainda estiver carregando nesse instante, adia a
  // decisão via `decisaoEtapaPendente` (ver bloco seguinte).
  const [carregandoServicosAnterior, setCarregandoServicosAnterior] = useState(
    carregandoServicos
  );
  if (carregandoServicos !== carregandoServicosAnterior) {
    setCarregandoServicosAnterior(carregandoServicos);
    if (servicoInicialPendente && !carregandoServicos) {
      setDecisaoEtapaPendente("inicial");
      setServicoInicialPendente(false);
    }
  }

  // Resolve uma decisão de etapa adiada (ver acima e avancarAposServico) assim
  // que profissionaisDoServico está carregado pro serviço atual —
  // `escolherProfissional` só é confiável a partir daqui. Precisa ser um
  // efeito (não ajuste durante a renderização, como o bloco acima): rolarPara
  // acessa refs, e refs só podem ser lidas fora do render. Reavalia sempre que
  // qualquer uma das três dependências muda, então nunca usa valores obsoletos
  // (diferente de avancarAposServico, chamada de dentro de uma closure
  // assíncrona presa aos valores de QUANDO O SERVIÇO FOI TOCADO).
  useEffect(() => {
    if (!decisaoEtapaPendente || carregandoProfissionais) return;
    const rolar = decisaoEtapaPendente === "avancar";
    if (!escolherProfissional) {
      setEtapa("data");
      if (rolar) rolarPara(dataRef);
    } else if (rolar) {
      rolarPara(profissionalRef);
    }
    setDecisaoEtapaPendente(null);
  }, [decisaoEtapaPendente, carregandoProfissionais, escolherProfissional]);

  // Some sozinha depois de alguns segundos (ver confirmarManutencaoOutroSalao).
  useEffect(() => {
    if (!erroManutencaoExterna) return;
    const t = setTimeout(() => setErroManutencaoExterna(""), 4000);
    return () => clearTimeout(t);
  }, [erroManutencaoExterna]);

  // Mês exibido no calendário da etapa Data (sempre no dia 1 do mês).
  const [mesVisivel, setMesVisivel] = useState(() => {
    const agora = new Date();
    return new Date(agora.getFullYear(), agora.getMonth(), 1);
  });

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  // Erro de FORMATO (validarWhatsapp) do campo WhatsApp livre da etapa
  // "dados", em tempo real (onBlur) — mesmo padrão de ModalAlterarWhatsapp.js
  // e ModalVincularCliente.js. Só se aplica quando o campo é editável (sem
  // clienteInicial); com clienteInicial o valor já veio validado no cadastro
  // e nem existe input pra este erro aparecer embaixo.
  const [erroFormatoTelefone, setErroFormatoTelefone] = useState("");

  // Modo livre: só o /admin (status truthy) — a dona pode escolher qualquer
  // dia/horário, mesmo os que as regras de negócio normalmente bloqueiam
  // (fora da janela de agendamento, fora do expediente, em cima de uma
  // ausência...). A ÚNICA coisa que nunca é liberada, nos dois modos, é
  // colisão real com um agendamento já confirmado (ver calcularVagasPorHorario,
  // contexto='admin', em lib/disponibilidade.js). Mesmo gate de `status` que
  // já distingue admin/público no resto do componente — não é um toggle
  // separado.
  const modoLivre = Boolean(status);

  // Sinal de reserva: regra do salão decide se é exigido (todos, só novos
  // clientes, ou nunca). O cliente declara (não comprovante) que já pagou via
  // Pix antes de liberar o botão de confirmar. SÓ no público — o admin
  // (status truthy) já sabe se cobrou o cliente por fora e nunca deve ver
  // essa etapa, independente de sinal_regra (ver IdentificacaoClienteAdmin,
  // que resolve o cliente ANTES do wizard no /admin).
  const precisaSinal =
    !status &&
    (estabelecimento.sinal_regra === "todos" ||
      (estabelecimento.sinal_regra === "novos" &&
        clienteEhNovo &&
        !servicoSelecionado?.eh_manutencao));
  const [sinalDeclarado, setSinalDeclarado] = useState(false);
  const [chavePixCopiada, setChavePixCopiada] = useState(false);

  // Reserva gravada ao ENTRAR na etapa "dados" (só fluxo público, ver
  // selecionarHorario) — id da linha em `agendamentos` e a "chave" da seleção
  // que a originou (serviço+data+horário+profissional). Ao reentrar em
  // "dados" com a MESMA chave, reaproveita em vez de gravar de novo; com uma
  // chave diferente (voltou e escolheu outra coisa), cancela esta antes de
  // criar a próxima — nunca duas linhas ativas da mesma tentativa. O submit
  // final (finalizarAgendamento) só faz UPDATE nesta linha, nunca INSERT.
  const [reservaId, setReservaId] = useState(null);
  const [reservaChave, setReservaChave] = useState(null);
  // Enquanto true, a gravação/cancelamento acima está em andamento — trava os
  // botões de horário pra evitar duplo clique.
  const [criandoReserva, setCriandoReserva] = useState(false);

  // Regras do agendamento (estabelecimento.aviso_regras_agendamento,
  // configurado no admin): popup bloqueante no fluxo público, mostrado uma
  // vez por sessão de agendamento na etapa final de confirmação, sempre —
  // com ou sem sinal a pagar (ver handleSubmit/confirmarAvisoRegras e
  // PopupRegrasAgendamento no JSX abaixo).
  const [avisoRegrasConfirmado, setAvisoRegrasConfirmado] = useState(false);
  const [mostrarPopupAvisoRegras, setMostrarPopupAvisoRegras] = useState(false);

  // Botão dividido "Confirmar agendamento" — só existe no /admin (`status`
  // truthy, ver JSX). Zona pequena pula o WhatsApp de confirmação (mesmo
  // padrão da aba Pendentes, ver app/[salon]/admin/page.js); este popup é o
  // "tem certeza" antes de criar sem notificar.
  const [popupConfirmarSemNotificarAberto, setPopupConfirmarSemNotificarAberto] =
    useState(false);

  // Fora da janela de agendamento (admin, modoLivre): o calendário só
  // sinaliza visualmente (borda tracejada, ver `liberado` no calendário
  // acima) — este popup vira o momento de decisão consciente antes do
  // insert final (ver finalizarAgendamento/confirmarForaDaJanela).
  // notificarForaDaJanela preserva o `notificar` da submissão original (zona
  // grande ou "sem notificar") pra reaplicar depois que a dona confirmar.
  const [mostrarPopupForaDaJanela, setMostrarPopupForaDaJanela] = useState(false);
  const [notificarForaDaJanela, setNotificarForaDaJanela] = useState(true);

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
            "id, nome, duracao_min, preco_centavos, categoria_id, ocultar_preco, ocultar_duracao, alerta_mensagem, servico_origem_id, eh_manutencao"
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

  // ADMIN (modoLivre): gate mínimo pro calendário aparecer — precisa existir
  // ALGUÉM pra assumir a reserva (o selecionado, ou pelo menos 1 elegível no
  // encaixe automático). Sem isso, nem o modo livre ajuda (não há profissional
  // pra atribuir). Fora do modo livre, o gate continua sendo diasSemanaAtivos
  // vazio (comportamento de sempre).
  const semProfissionalParaAgendar = escolherProfissional
    ? profissionalSelecionado == null
    : profissionaisDoServico.length === 0;

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

  // Seleção de dia no calendário: grava a data e invalida o horário anterior
  // (o efeito de vagas recarrega a grade do novo dia).
  function selecionarData(iso) {
    setForm((anterior) => ({ ...anterior, data: iso }));
    setHorarioSelecionado("");
    setAvisoHorarioIndisponivel(false);
  }

  // Horários oferecidos = chaves do mapa de vagas. No fluxo "cliente escolhe",
  // filtra só os horários em que o profissional selecionado está livre; no
  // encaixe automático basta existir >=1 profissional livre (a chave existe).
  // `horariosBase` NÃO passa pela antecedência mínima — só existe pra
  // distinguir, na mensagem da UI, "não tem vaga nenhuma" de "tinha vaga, mas
  // nada respeita mais a antecedência" (ver JSX da etapa "data"). SÓ público
  // — no admin (modoLivre), `vagas` vem no formato enriquecido de
  // calcularVagasPorHorario(contexto:'admin') e é lido por `gradeAdmin`, logo
  // abaixo, não por este bloco.
  const horariosBase = modoLivre
    ? []
    : Object.keys(vagas)
        .filter((h) =>
          escolherProfissional
            ? profissionalSelecionado != null &&
              vagas[h].includes(profissionalSelecionado.id)
            : true
        )
        .sort();

  // Remove os horários que ferem a antecedência mínima do salão ou o corte do
  // dia seguinte (ver filtrarPorAntecedenciaMinima em lib/disponibilidade.js)
  // — aplicado em QUALQUER data, não só hoje: com antecedência configurada,
  // um dia inteiro pode ficar sem horários mesmo sendo amanhã ou depois. Sem
  // antecedência configurada, o resultado ainda esconde horários já passados
  // de hoje (mesmo efeito do antigo filtro por horaDeAgora()). Client-side
  // só: é filtro de UX, não a proteção real (ver validarAntecedenciaNoServidor).
  const vagasDentroDaAntecedencia = modoLivre
    ? {}
    : filtrarPorAntecedenciaMinima(vagas, form.data, estabelecimento);
  const horariosVisiveis = modoLivre
    ? []
    : horariosBase.filter((h) => vagasDentroDaAntecedencia[h] != null);

  // ADMIN (modoLivre): classifica CADA horário do mapa enriquecido (já cobre
  // o dia inteiro, ver calcularVagasPorHorario contexto='admin') pro
  // profissional relevante — o selecionado (fluxo "cliente escolhe", sempre
  // ligado no /admin com 2+ profissionais elegíveis) ou o único elegível (0
  // ou 1 profissional, encaixe automático). "livre" = respeitaria as regras
  // normais; "bloqueado" = só aparece por causa do modo livre (motivo
  // anotado, vem da API); ausente = sobreposição real com um agendamento já
  // confirmado — nunca aparece, em nenhum dos dois. Sem profissional
  // escolhido ainda (fluxo "cliente escolhe" recém chegou na data), fica []
  // — mesmo comportamento do público esperando a seleção.
  const vagasAdminComAntecedencia = modoLivre
    ? filtrarPorAntecedenciaMinima(vagas, form.data, estabelecimento, "admin")
    : {};
  const idProfissionalAlvoAdmin = escolherProfissional
    ? profissionalSelecionado?.id ?? null
    : null;
  const gradeAdmin =
    modoLivre && !(escolherProfissional && idProfissionalAlvoAdmin == null)
      ? Object.keys(vagasAdminComAntecedencia)
          .sort()
          .map((horario) => {
            const entrada = vagasAdminComAntecedencia[horario];
            if (idProfissionalAlvoAdmin != null) {
              if (entrada.livres.includes(idProfissionalAlvoAdmin)) {
                return { horario, status: "livre" };
              }
              const bloqueio = entrada.bloqueados.find(
                (b) => b.profissionalId === idProfissionalAlvoAdmin
              );
              return bloqueio ? { horario, status: "bloqueado", motivo: bloqueio.motivo } : null;
            }
            if (entrada.livres.length > 0) return { horario, status: "livre" };
            if (entrada.bloqueados.length > 0) {
              return { horario, status: "bloqueado", motivo: entrada.bloqueados[0].motivo };
            }
            return null;
          })
          .filter(Boolean)
          .filter(({ horario }) => !horarioJaPassouHoje(form.data, horario))
      : [];

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
          // Já tenho uma reserva própria (insert antecipado, ver
          // selecionarHorario) pra esta tentativa: não deixa ela mesma
          // aparecer como "ocupada" — senão, ao voltar pra "data", o próprio
          // horário escolhido sumiria da grade.
          excluirAgendamentoId: reservaId,
          contexto: modoLivre ? "admin" : "publico",
          // Duração efetiva (base + ajustes de duração das perguntas já
          // respondidas, ver calcularAjusteDuracao): as respostas já estão
          // fechadas neste ponto do fluxo (popup de perguntas roda antes da
          // etapa "data"), então a grade de vagas reflete o tempo real que
          // este agendamento vai ocupar.
          duracaoMinOverride: duracaoEfetivaServico(),
        });
        if (!ativo) return;
        setVagas(mapa);
      } catch (e) {
        if (!ativo) return;
        setErroSlots(e.message ?? String(e));
        setVagas({});
      } finally {
        if (ativo) {
          setCarregandoSlots(false);
          // Marca pra qual data o `vagas` ATUAL corresponde — ver comentário
          // em `vagasData` e no efeito de restauração de horário abaixo.
          setVagasData(form.data);
        }
      }
    }

    sincronizar();
    return () => {
      ativo = false;
    };
    // duracaoEfetivaServico não entra: depende de servicoSelecionado +
    // perguntasServico + respostasPerguntas, já listados abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.data,
    servicoSelecionado,
    estabelecimento.id,
    reservaId,
    modoLivre,
    perguntasServico,
    respostasPerguntas,
  ]);

  // 1) Restaura o SERVIÇO só depois que a lista de serviços ATIVOS carrega —
  // um id salvo que não está mais nela (desativado/excluído nesse meio-tempo)
  // é descartado, sem nada mais a restaurar por cima dele. Recarrega também
  // as perguntas do serviço (mesma consulta do toque manual), pra que o
  // ajuste de preço e a gravação em agendamento_respostas no submit final
  // continuem enxergando as respostas restauradas (ver efeito 2 abaixo).
  useEffect(() => {
    const pendente = pendenteRestaurarRef.current;
    if (!pendente || carregandoServicos) return;

    const servico = servicos.find((s) => s.id === pendente.servicoId) ?? null;
    if (!servico) {
      pendenteRestaurarRef.current = null;
      return;
    }

    let ativo = true;
    (async () => {
      setServicoSelecionado(servico);
      const perguntas = await buscarPerguntasServico(servico.id);
      if (!ativo) return;
      setPerguntasServico(perguntas);
      setRespostasPerguntas(pendente.respostasPerguntas ?? {});
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregandoServicos]);

  // 2) Restaura o PROFISSIONAL (só no fluxo "cliente escolhe") + a DATA, só
  // depois que profissionaisDoServico carrega pro serviço restaurado acima —
  // `escolherProfissional` só é confiável a partir daqui (mesmo motivo do
  // `decisaoEtapaPendente` mais acima, que resolve o mesmo tipo de corrida
  // pro fluxo de servicoInicial). Sem profissional válido/ativo no modo
  // "cliente escolhe", fica na etapa "servico" (cards visíveis) pra escolher
  // de novo — não avança pra data sem profissional.
  useEffect(() => {
    const pendente = pendenteRestaurarRef.current;
    if (!pendente || !servicoSelecionado || carregandoProfissionais) return;

    let profissionalRestaurado = null;
    if (pendente.profissionalId != null) {
      profissionalRestaurado =
        profissionaisDoServico.find((p) => p.id === pendente.profissionalId) ??
        null;
      if (profissionalRestaurado) setProfissionalSelecionado(profissionalRestaurado);
    }

    if (escolherProfissional && !profissionalRestaurado) {
      pendenteRestaurarRef.current = null;
      return;
    }

    if (pendente.data) {
      setForm((anterior) => ({ ...anterior, data: pendente.data }));
      setEtapa("data");
      // Reserva já gravada nesta sessão anterior (insert antecipado): rehidrata
      // ANTES do efeito de vagas rodar pra `form.data`, pra ele já excluir esta
      // linha da checagem de ocupados (ver excluirAgendamentoId acima). O
      // efeito 3, mais abaixo, só confirma que o horário segue livre e reidrata
      // a etapa — nunca grava de novo.
      if (pendente.reservaId != null && pendente.horario) {
        setReservaId(pendente.reservaId);
        setReservaChave({
          servicoId: servicoSelecionado.id,
          data: pendente.data,
          horario: pendente.horario,
          profissionalId: escolherProfissional ? profissionalRestaurado?.id ?? null : null,
        });
      }
      // pendenteRestaurarRef segue vivo: falta o horário, resolvido no
      // efeito 3 assim que a grade desse dia terminar de carregar.
    } else {
      setEtapa("data");
      pendenteRestaurarRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregandoProfissionais, escolherProfissional]);

  // 3) Restaura o HORÁRIO só depois que a grade (vagas) da data restaurada
  // termina de carregar — `vagasData === form.data` garante que `vagas` já
  // corresponde ao dia certo (não ao anterior, nem a uma sincronização ainda
  // em andamento; ver comentário no efeito de sincronização acima).
  // `horariosVisiveis` já filtra tanto quem ocupou o horário nesse meio-tempo
  // quanto (pro fluxo "cliente escolhe") a agenda do profissional restaurado
  // no efeito 2 — é a MESMA verificação de disponibilidade real usada pra
  // exibir a grade pra qualquer cliente, não uma checagem à parte.
  useEffect(() => {
    const pendente = pendenteRestaurarRef.current;
    if (!pendente?.data || form.data !== pendente.data || vagasData !== form.data) {
      return;
    }

    if (pendente.horario && horariosVisiveis.includes(pendente.horario)) {
      if (pendente.reservaId != null) {
        // Reserva já rehidratada no efeito 2 (reservaId/reservaChave) e
        // revalidada como livre acima — só reidrata a etapa, sem gravar de novo.
        setHorarioSelecionado(pendente.horario);
        setEtapa("dados");
      } else {
        // Sessão perdida entre o clique no horário e a gravação terminar
        // (raro): recria do zero, reaproveitando a mesma função da seleção
        // manual — mesmo tratamento de erro/23P01 de sempre.
        selecionarHorario(pendente.horario);
      }
    } else if (pendente.horario) {
      setAvisoHorarioIndisponivel(true);
      // Horário restaurado não está mais livre: se havia uma reserva própria
      // pra ele, ela ficou órfã (ex.: outro processo assumiu o profissional
      // nesse meio-tempo) — cancela e descarta a referência.
      if (pendente.reservaId != null) {
        supabase
          .from("agendamentos")
          .update({ status: "cancelado" })
          .eq("id", pendente.reservaId)
          .then(() => {});
      }
      setReservaId(null);
      setReservaChave(null);
    }
    pendenteRestaurarRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vagasData, form.data]);

  // Grava a fatia "agendamento" a cada mudança relevante — só no público
  // (nunca inclui `sinalDeclarado`: é só um checkbox de intenção antes do
  // submit final, nunca deve ser restaurado como confirmado).
  useEffect(() => {
    if (status) return;
    salvarFatia(estabelecimento.slug, "agendamento", {
      servicoId: servicoSelecionado?.id ?? null,
      profissionalId: profissionalSelecionado?.id ?? null,
      data: form.data,
      horario: horarioSelecionado,
      respostasPerguntas,
      // Id da reserva já gravada (insert antecipado ao entrar em "dados") —
      // ver reservaId/reservaChave e selecionarHorario. Permite ao efeito de
      // restauração reidratá-la em vez de gravar de novo (ver efeitos 2 e 3
      // de restauração acima).
      reservaId,
    });
  }, [
    status,
    estabelecimento.slug,
    servicoSelecionado,
    profissionalSelecionado,
    form.data,
    horarioSelecionado,
    respostasPerguntas,
    reservaId,
  ]);

  // Só os campos de texto (nome, WhatsApp) usam este handler agora — a data é
  // escolhida pelo calendário (selecionarData).
  function handleChange(e) {
    const { name, value } = e.target;
    setForm((anterior) => ({ ...anterior, [name]: value }));
    if (name === "telefone") setErroFormatoTelefone("");
  }

  // onBlur do campo WhatsApp livre da etapa "dados" (ver JSX) — mesmo padrão
  // de ModalAlterarWhatsapp.js/ModalVincularCliente.js.
  function handleBlurTelefone() {
    if (!form.telefone.trim()) return;
    const validacao = validarWhatsapp(form.telefone);
    setErroFormatoTelefone(validacao.valido ? "" : validacao.erro);
  }

  // Toque num serviço de manutenção (eh_manutencao=true): NÃO seleciona ainda
  // — abre o popup (ver JSX) perguntando se a cliente já fez o serviço de
  // origem antes, intercepta ANTES do alerta_mensagem. Sem isso, segue pra
  // checagem de alerta_mensagem e, sem alerta, direto pra seleção de fato
  // (mesmo comportamento de sempre).
  function selecionarServico(servico) {
    if (servico.eh_manutencao) {
      setManutencaoPendente(servico);
      return;
    }
    if (servico.alerta_mensagem) {
      setAlertaPendente(servico);
      return;
    }
    confirmarSelecaoServico(servico);
  }

  // Popup de manutenção — "Sim, fiz aqui": segue o fluxo normal de
  // manutenção, isenção de sinal continua valendo (ver precisaSinal).
  function confirmarManutencao() {
    confirmarSelecaoServico(manutencaoPendente);
    setManutencaoPendente(null);
  }

  // Popup de manutenção — "Sim, em outro salão": troca pelo serviço
  // configurado em estabelecimento.servico_manutencao_externa_id (mesma lista
  // `servicos` já carregada, que inclui todos os ativos) — eh_manutencao=false
  // nesse serviço, então o sinal passa a ser exigido normalmente (ver
  // precisaSinal). Se a dona ainda não configurou esse serviço (ou ele foi
  // desativado), só fecha o popup e mostra um erro, sem selecionar nada.
  function confirmarManutencaoOutroSalao() {
    const servicoExterno = servicos.find(
      (s) => s.id === estabelecimento.servico_manutencao_externa_id
    );
    setManutencaoPendente(null);
    if (!servicoExterno) {
      setErroManutencaoExterna(
        "O salão ainda não configurou o serviço de manutenção externa."
      );
      return;
    }
    confirmarSelecaoServico(servicoExterno);
  }

  // Popup de manutenção — "Não, quero o serviço completo": troca pelo serviço
  // de origem (mesma lista já carregada pro acordeão). Se o serviço de
  // origem não estiver mais nela (ex: foi desativado), só fecha o popup e
  // deixa a cliente de volta no acordeão, sem selecionar nada.
  function recusarManutencao() {
    const servicoOrigem = servicos.find(
      (s) => s.id === manutencaoPendente.servico_origem_id
    );
    setManutencaoPendente(null);
    if (servicoOrigem) confirmarSelecaoServico(servicoOrigem);
  }

  // Popup de manutenção — clique no overlay: fecha sem selecionar nada.
  function cancelarManutencao() {
    setManutencaoPendente(null);
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
    // Seleção manual de um novo serviço cancela qualquer restauração de
    // sessão ainda pendente (ver pendenteRestaurarRef) — a escolha fresca da
    // cliente sempre vence sobre um rascunho antigo.
    pendenteRestaurarRef.current = null;
    const perguntas = await buscarPerguntasServico(servico.id);
    setPerguntasServico(perguntas);

    if (perguntas.length > 0) {
      setModalPerguntasAberto(true);
      return;
    }
    avancarAposServico();
  }

  // Avanço pós-seleção de serviço: no encaixe automático (toggle off, ou só 1
  // profissional pro serviço) vai direto pra data; no fluxo "cliente escolhe"
  // fica na etapa de serviço pra escolher o profissional (os cards aparecem
  // logo abaixo), rolando até o elemento certo em cada caso. Extraído de
  // confirmarSelecaoServico pra ser reaproveitado depois do popup de perguntas
  // (ver confirmarModalPerguntas). Só marca a decisão como pendente — nunca
  // decide aqui dentro: quando chamada a partir de confirmarSelecaoServico
  // (depois do await das perguntas), esta função é uma closure presa aos
  // valores de QUANDO O SERVIÇO FOI TOCADO, que já podem estar obsoletos
  // (profissionaisDoServico do novo serviço pode ainda estar carregando, ou
  // já ter carregado, nesse meio-tempo). O bloco de `decisaoEtapaPendente`
  // acima resolve com os valores frescos assim que renderizar.
  function avancarAposServico() {
    setDecisaoEtapaPendente("avancar");
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

  // Popup de perguntas — "Continuar": só avança se TODAS as perguntas
  // VISÍVEIS (ver perguntaDeveAparecer) tiverem resposta (opção marcada, ou
  // texto livre não-vazio). Pergunta filha escondida (mãe ainda não
  // respondida com a opção gatilho) nunca trava o avanço.
  function confirmarModalPerguntas() {
    for (const pergunta of perguntasServico) {
      if (!perguntaDeveAparecer(pergunta, respostasPerguntas)) continue;
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
  // ajuste != 0, pra exibição transparente na etapa "Dados" (ver JSX). Pula
  // pergunta filha escondida (ver perguntaDeveAparecer) — se a cliente
  // respondeu a filha e DEPOIS trocou a resposta da mãe (escondendo a
  // filha de novo), essa resposta presa em respostasPerguntas não deve
  // mais contar.
  function calcularAjustePerguntas() {
    let centavos = 0;
    const itens = [];
    for (const pergunta of perguntasServico) {
      if (!perguntaDeveAparecer(pergunta, respostasPerguntas)) continue;
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

  // Soma os ajustes de duração (ajuste_duracao_min) das opções escolhidas —
  // só entram as que têm aplicar_duracao_na_agenda=true (a dona pode desligar
  // por opção sem perder o valor cadastrado, ver GerenciarServicos). Somada à
  // duração base do serviço, forma a duração EFETIVA usada tanto pra calcular
  // vagas (calcularVagasPorHorario) quanto pra gravar em agendamentos.duracao_min.
  function calcularAjusteDuracao() {
    let minutos = 0;
    for (const pergunta of perguntasServico) {
      if (!perguntaDeveAparecer(pergunta, respostasPerguntas)) continue;
      const resposta = respostasPerguntas[pergunta.id];
      if (resposta?.opcaoId == null) continue;
      const opcao = (pergunta.servico_pergunta_opcoes ?? []).find(
        (o) => o.id === resposta.opcaoId
      );
      if (opcao?.aplicar_duracao_na_agenda && opcao.ajuste_duracao_min) {
        minutos += opcao.ajuste_duracao_min;
      }
    }
    return minutos;
  }

  // Duração efetiva do serviço selecionado: base + calcularAjusteDuracao(),
  // com piso de 5 min — um ajuste negativo grande o bastante pra zerar ou
  // passar a duração base não deve virar um agendamento sem duração real (nem
  // travar o fluxo por isso, só nunca gravar um valor sem sentido no banco).
  // servicoSelecionado pode ainda não existir quando chamada (guarda-se antes,
  // nos call sites).
  function duracaoEfetivaServico() {
    const DURACAO_MINIMA_MIN = 5;
    return Math.max(
      servicoSelecionado.duracao_min + calcularAjusteDuracao(),
      DURACAO_MINIMA_MIN
    );
  }

  // Monta as linhas prontas pra inserir em agendamento_respostas (uma por
  // pergunta respondida) — null quando a pergunta ficou sem resposta (não
  // deveria acontecer, confirmarModalPerguntas já valida antes de fechar) ou
  // quando é uma filha escondida (ver perguntaDeveAparecer) com uma resposta
  // presa de antes da mãe mudar.
  function linhasRespostasPerguntas(agendamentoId) {
    return perguntasServico
      .map((pergunta) => {
        if (!perguntaDeveAparecer(pergunta, respostasPerguntas)) return null;
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
  // não limpa serviço, data nem horário.
  function voltarEtapa() {
    const indice = ETAPAS.findIndex((e) => e.id === etapa);
    if (indice > 0) setEtapa(ETAPAS[indice - 1].id);
  }

  // Saída da etapa "dados": só no fluxo público (!status), com
  // onVoltarInicio recebido do consumidor (ver comentário da prop acima), a
  // reserva já gravada ao entrar aqui não pode mais ser reaberta via
  // voltarEtapa (isso reabriria "data" e trocaria/cancelaria a reserva ao
  // escolher outro horário). O /admin (status truthy) nunca recebe
  // onVoltarInicio, então mantém voltarEtapa como sempre.
  const fecharDados = !status && onVoltarInicio ? onVoltarInicio : voltarEtapa;

  // Botão físico "voltar" (Android/iOS) nas etapas "servico", "data" e
  // "dados": chama o mesmo callback do botão em tela (voltarEtapa/
  // fecharDados) ou, pra "servico", o bubbling recebido do consumidor
  // (onVoltarAntes), em vez de deixar o navegador sair da página.
  //
  // "data" fica de fora enquanto uma restauração de sessão com horário
  // pendente ainda está em andamento (ver efeitos 2/3 de restauração acima):
  // nesse caminho, "data" é só uma etapa de PASSAGEM — o efeito 2 já grava
  // etapa "data" antes mesmo de saber se o horário salvo ainda está livre, e
  // o efeito 3 avança pra "dados" assim que a grade termina de carregar. Sem
  // esse gate, cada reload com um horário já escolhido armaria o listener
  // físico nessa etapa de passagem, deixando uma entrada de histórico órfã
  // (nunca consumida) assim que "dados" assume — e essa entrada engoliria em
  // silêncio um toque físico de voltar mais tarde, sem nenhuma mudança
  // visível na tela.
  //
  // "servico" (lote 2) tem o MESMO tipo de risco de etapa de passagem, por
  // DOIS caminhos independentes — os dois precisam gatear:
  // 1) servicoInicial (sugestão de manutenção do PainelCliente):
  //    servicoInicialPendente fica true até a decisão de pular direto pra
  //    "data" resolver (ver decisaoEtapaPendente acima).
  // 2) Restauração de sessão (pendenteRestaurarRef, ver efeitos 1/2 acima):
  //    com um servicoId salvo, "servico" também é só passagem até o efeito 2
  //    decidir pular pra "data" — mesmo raciocínio de restaurandoParaDados,
  //    um degrau antes.
  //    IMPORTANTE: pendenteRestaurarRef é uma REF (não state) — mutá-la
  //    (`= null`) não dispara re-render sozinha, então gatear direto nela
  //    (`Boolean(pendenteRestaurarRef.current)`) pode ficar presa num valor
  //    velho indefinidamente (sem re-render, o gate nunca reavalia). Em vez
  //    disso, usamos os dois ESTADOS reais que já orbitam esse mesmo
  //    processo — carregandoServicos (efeito 1 só decide algo depois que
  //    vira false) e carregandoProfissionais (fica true enquanto
  //    servicoSelecionado, setado pela restauração, ainda carrega seus
  //    profissionais — é exatamente esse recarregar que alimenta o efeito 2,
  //    quem de fato decide pular ou não). Os dois já são setState de verdade
  //    em todos os pontos relevantes, então sempre trazem um re-render fresco.
  // Só faz sentido no público (!status) e só quando o consumidor passou
  // onVoltarAntes (o /admin nunca passa).
  //
  // Cada chamada retorna `voltarFisico*`: é ELA (não voltarEtapa/fecharDados
  // direto) que os botões "Voltar" em tela devem chamar — ver
  // lib/voltarFisico.js pro motivo (resolve pra window.history.back(),
  // deixando o popstate resultante disparar a mesma transição, sem deixar a
  // entrada empurrada órfã no histórico real). "servico" não tem botão
  // "Voltar" em tela (nunca teve) — só o físico.
  const restaurandoParaDados = pendenteRestaurarRef.current?.horario != null;
  const voltarFisicoServico = useVoltarFisico(
    onVoltarAntes,
    !status &&
      Boolean(onVoltarAntes) &&
      etapa === "servico" &&
      !servicoInicialPendente &&
      !carregandoServicos &&
      !carregandoProfissionais,
    "servico"
  );
  const voltarFisicoData = useVoltarFisico(voltarEtapa, etapa === "data" && !restaurandoParaDados, "data");
  const voltarFisicoDados = useVoltarFisico(fecharDados, etapa === "dados", "dados");

  // Duas seleções (serviço+data+horário+profissional) apontam pro mesmo
  // agendamento? Usado só pra decidir, ao reentrar em "dados", se reaproveita
  // a reserva já gravada ou se precisa cancelar e criar outra (ver
  // selecionarHorario).
  function mesmaChaveReserva(a, b) {
    return (
      !!a &&
      !!b &&
      a.servicoId === b.servicoId &&
      a.data === b.data &&
      a.horario === b.horario &&
      a.profissionalId === b.profissionalId
    );
  }

  // Clique num horário na etapa "data".
  //
  // /admin (status truthy): comportamento de sempre — só marca o horário e
  // avança pra "dados"; o insert continua acontecendo no submit final, em
  // finalizarAgendamento.
  //
  // Público (!status): a reserva é gravada AGORA, ao entrar em "dados" — não
  // mais no clique de "Confirmar agendamento" (ver decisão registrada na
  // conversa: cliente pode sumir pra pagar o Pix e nunca mais voltar). Sempre
  // finalizado:true, então nunca depende do cron pra aparecer no painel.
  // Reentrando em "dados" com a MESMA seleção de antes (ex.: Voltar sem
  // trocar nada), reaproveita a reserva já gravada; com uma seleção
  // diferente, cancela a anterior antes de criar a nova — nunca duas linhas
  // ativas da mesma tentativa. finalizarAgendamento, no submit final, só faz
  // UPDATE nesta linha (nunca INSERT).
  async function selecionarHorario(slot) {
    setAvisoHorarioIndisponivel(false);

    if (status) {
      setHorarioSelecionado(slot);
      setEtapa("dados");
      return;
    }

    if (criandoReserva) return;

    setHorarioSelecionado(slot);
    setErro("");

    const chaveAtual = {
      servicoId: servicoSelecionado.id,
      data: form.data,
      horario: slot,
      profissionalId: escolherProfissional ? profissionalSelecionado?.id ?? null : null,
    };

    // Mesma seleção de uma reserva já gravada: reaproveita sem gravar de novo.
    if (reservaId != null && mesmaChaveReserva(reservaChave, chaveAtual)) {
      setEtapa("dados");
      return;
    }

    setCriandoReserva(true);

    // Revalida no servidor ANTES de mexer em qualquer reserva existente —
    // se rejeitado, a reserva anterior (se houver) continua intacta (ver
    // validarAntecedenciaNoServidor).
    const antecedenciaOk = await validarAntecedenciaNoServidor({
      estabelecimentoId: estabelecimento.id,
      data: form.data,
      horario: slot,
    });
    if (!antecedenciaOk) {
      setCriandoReserva(false);
      setErro("Esse horário não respeita mais a antecedência mínima do salão. Escolha outro.");
      setHorarioSelecionado("");
      return;
    }

    // Havia uma reserva de uma tentativa anterior (outro serviço/data/horário
    // escolhido depois de um "Voltar"): cancela ANTES de criar a nova.
    if (reservaId != null) {
      await supabase.from("agendamentos").update({ status: "cancelado" }).eq("id", reservaId);
    }

    // Quem fica com a reserva: o escolhido pelo cliente, ou — no encaixe
    // automático — o menos ocupado entre os livres neste horário. A reserva
    // anterior (se houver) já foi cancelada acima, então não se conta mais.
    let profissionalId = chaveAtual.profissionalId;
    if (!escolherProfissional) {
      const livres = vagas[slot] ?? [];
      if (livres.length === 0) {
        setCriandoReserva(false);
        setErro("Esse horário acabou de ser reservado. Escolha outro.");
        setHorarioSelecionado("");
        setReservaId(null);
        setReservaChave(null);
        return;
      }
      profissionalId = await escolherMenosOcupado(estabelecimento.id, form.data, livres);
    }

    const payload = {
      nome_cliente: form.nome,
      telefone: normalizarWhatsapp(form.telefone),
      data: form.data,
      horario: slot,
      servico_id: servicoSelecionado.id,
      duracao_min: duracaoEfetivaServico(),
      estabelecimento_id: estabelecimento.id,
      profissional_id: profissionalId,
      status: precisaSinal ? "aguardando_sinal" : "pendente",
      sinal_declarado_pago: false,
      finalizado: true,
    };
    const { data, error } = await supabase
      .from("agendamentos")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      setCriandoReserva(false);
      setReservaId(null);
      setReservaChave(null);

      // 23P01 = violação da exclusion constraint agendamentos_sem_sobreposicao:
      // outra reserva sobrepõe esse intervalo — alguém ocupou primeiro.
      // Tratado JÁ AQUI (ao entrar na etapa), não mais só no submit final.
      const ehHorarioOcupado =
        error.code === "23P01" ||
        /agendamentos_sem_sobreposicao|exclusion constraint/i.test(error.message ?? "");

      if (ehHorarioOcupado) {
        setErro("Esse horário acabou de ser reservado. Escolha outro.");
        setHorarioSelecionado("");
        // Recarrega as vagas pra refletir quem ainda está livre neste dia.
        try {
          const mapa = await calcularVagasPorHorario({
            estabelecimentoId: estabelecimento.id,
            servicoId: servicoSelecionado.id,
            data: form.data,
            duracaoMinOverride: duracaoEfetivaServico(),
          });
          setVagas(mapa);
        } catch {
          setVagas({});
        }
        return;
      }

      setErro(error.message);
      setHorarioSelecionado("");
      return;
    }

    await salvarRespostasPerguntas(data.id);

    setReservaId(data.id);
    setReservaChave(chaveAtual);
    setCriandoReserva(false);
    setEtapa("dados");
  }

  // Validações comuns aos dois caminhos de envio (zona grande via submit do
  // form, zona pequena "sem notificar" via botão avulso — só existe com
  // `status`, ver JSX). Devolve false e já seta `erro` no primeiro problema
  // encontrado; quem chama só decide o que fazer a seguir.
  function validarCamposObrigatorios() {
    if (!form.nome || !form.telefone || !form.data) {
      setErro("Preencha nome, WhatsApp e data para continuar.");
      return false;
    }

    // Sem clienteInicial (único caminho onde o campo é de fato editável, ver
    // JSX da etapa "dados"): validação estrita de formato (DDD + 9 dígitos),
    // a mesma de lib/whatsappValidacao.js. Com clienteInicial, o valor já
    // veio validado no cadastro original — mantém só a checagem leve de
    // sempre, pra não travar os dois fluxos que hoje dependem dele
    // pré-preenchido (ver comentário de clienteInicial acima).
    if (!clienteInicial) {
      const validacaoTelefone = validarWhatsapp(form.telefone);
      if (!validacaoTelefone.valido) {
        setErroFormatoTelefone(validacaoTelefone.erro);
        setErro("Informe um WhatsApp válido com DDD.");
        return false;
      }
    } else if (form.telefone.replace(/\D/g, "").length < 10) {
      setErro("Informe um WhatsApp válido com DDD.");
      return false;
    }

    if (!servicoSelecionado) {
      setErro("Selecione um serviço.");
      return false;
    }

    if (!horarioSelecionado) {
      setErro("Selecione um horário disponível.");
      return false;
    }

    // No fluxo "cliente escolhe", o profissional é obrigatório.
    if (escolherProfissional && !profissionalSelecionado) {
      setErro("Selecione um profissional.");
      return false;
    }

    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");

    if (!validarCamposObrigatorios()) return;

    // Público: a esta altura a reserva já deveria existir (gravada ao entrar
    // em "dados", ver selecionarHorario). Sem ela não há o que fazer UPDATE —
    // volta pra "data" pra recriar, em vez de seguir com um id inexistente.
    if (!status && reservaId == null) {
      setErro("Sua reserva expirou. Escolha o horário novamente.");
      setHorarioSelecionado("");
      setEtapa("data");
      return;
    }

    // Regras do agendamento (estabelecimento.aviso_regras_agendamento):
    // popup bloqueante mostrado uma vez por sessão do wizard, na etapa final
    // de confirmação — sempre, com ou sem sinal a pagar. Confirmado, quem
    // libera o envio de fato é confirmarAvisoRegras, chamando
    // finalizarAgendamento diretamente. SÓ no público — o admin (status
    // truthy) escreveu essas regras pros PRÓPRIOS clientes lerem, não faz
    // sentido bloqueá-lo com o próprio aviso (mesmo raciocínio de
    // precisaSinal).
    if (!status && estabelecimento.aviso_regras_agendamento && !avisoRegrasConfirmado) {
      setMostrarPopupAvisoRegras(true);
      return;
    }

    await finalizarAgendamento(true);
  }

  async function confirmarAvisoRegras() {
    setAvisoRegrasConfirmado(true);
    setMostrarPopupAvisoRegras(false);
    await finalizarAgendamento(true);
  }

  // Zona pequena do botão dividido (só /admin, `status` truthy — ver JSX):
  // mesma validação do submit normal, mas em vez de criar na hora abre o
  // popup "tem certeza" (ver confirmarSemNotificar). Sem as checagens de
  // reservaId/aviso de regras acima porque essas são exclusivas do público,
  // que nunca vê este botão.
  function abrirPopupConfirmarSemNotificar() {
    setErro("");
    if (!validarCamposObrigatorios()) return;
    setPopupConfirmarSemNotificarAberto(true);
  }

  async function confirmarSemNotificar() {
    setPopupConfirmarSemNotificarAberto(false);
    await finalizarAgendamento(false);
  }

  // Roda DEPOIS que a dona confirma "mesmo assim" no popup de fora da janela
  // (ver finalizarAgendamento acima) — reinvoca com ignorarJanela:true pra
  // não reabrir o mesmo popup, preservando o `notificar` original.
  async function confirmarForaDaJanela() {
    setMostrarPopupForaDaJanela(false);
    await finalizarAgendamento(notificarForaDaJanela, { ignorarJanela: true });
  }

  // Submit final ("Confirmar agendamento").
  //
  // /admin (status truthy): comportamento de sempre — faz o INSERT aqui, na
  // hora. O público nunca passa por este caminho.
  //
  // Público (!status): a reserva JÁ FOI GRAVADA ao entrar em "dados" (ver
  // selecionarHorario) — aqui não há mais INSERT. Só existem dois casos:
  // exige sinal e a cliente marcou "já paguei" -> UPDATE declarando o
  // pagamento e liberando o status; qualquer outro caso (sem sinal, ou com
  // sinal mas caixa desmarcada) -> nada a gravar, só avança a UI, já que o
  // registro existe do jeito certo desde que a etapa foi alcançada.
  async function finalizarAgendamento(notificar = true, { ignorarJanela = false } = {}) {
    if (!status) {
      setEnviando(true);

      if (precisaSinal && sinalDeclarado) {
        const { error } = await supabase
          .from("agendamentos")
          .update({ sinal_declarado_pago: true, status: "pendente" })
          .eq("id", reservaId);

        setEnviando(false);
        if (error) {
          setErro(error.message);
          return;
        }
      } else {
        setEnviando(false);
      }

      limparFatia(estabelecimento.slug, "agendamento");

      onSucesso?.({
        form,
        servico: servicoSelecionado,
        horario: horarioSelecionado,
        profissional: escolherProfissional ? profissionalSelecionado : null,
      });
      return;
    }

    // ADMIN (modoLivre, único caminho que chega aqui — `status` truthy):
    // fora da janela de agendamento (estabelecimento.janela_agendamento_fim,
    // ver dentroDaJanelaAgendamento) o calendário só sinaliza visualmente
    // (borda tracejada, ver `liberado` acima) — aqui vira decisão consciente
    // antes do insert. ignorarJanela=true só quando confirmarForaDaJanela
    // reinvoca depois do "Confirmar mesmo assim?" (ver popup no JSX).
    if (!ignorarJanela && !dentroDaJanelaAgendamento(form.data, estabelecimento)) {
      setNotificarForaDaJanela(notificar);
      setMostrarPopupForaDaJanela(true);
      return;
    }

    setEnviando(true);

    // Revalida no servidor ANTES de inserir (ver validarAntecedenciaNoServidor
    // — mesma checagem do fluxo público, aplicada aqui também pra manter as
    // duas telas consistentes com o filtro já usado em horariosVisiveis).
    // modoLivre PULA essa checagem: antecedência mínima é uma regra de
    // negócio que o modo livre já deixa a dona ignorar na grade (ver
    // gradeAdmin, motivo 'antecedencia') — não faz sentido barrar de novo
    // aqui só porque o relógio do servidor concorda com o filtro normal. A
    // única coisa que continua protegida no servidor é a colisão real,
    // via constraint do banco (23P01, tratado no catch abaixo).
    const antecedenciaOk = modoLivre
      ? true
      : await validarAntecedenciaNoServidor({
          estabelecimentoId: estabelecimento.id,
          data: form.data,
          horario: horarioSelecionado,
        });
    if (!antecedenciaOk) {
      setEnviando(false);
      setErro("Esse horário não respeita mais a antecedência mínima do salão. Escolha outro.");
      setHorarioSelecionado("");
      setEtapa("data");
      return;
    }

    // Quem fica com a reserva: o escolhido pelo cliente, ou — no encaixe
    // automático — o menos ocupado entre os livres neste horário.
    let profissionalId;
    if (escolherProfissional) {
      profissionalId = profissionalSelecionado.id;
    } else {
      // modoLivre: `vagas` vem no formato enriquecido (ver calcularVagasPorHorario,
      // contexto='admin') — junta livres + bloqueados (a dona pode assumir um
      // horário bloqueado por regra; só sobreposição real já removeu o
      // profissional do mapa inteiro, nos dois formatos).
      const livres = modoLivre
        ? [
            ...(vagas[horarioSelecionado]?.livres ?? []),
            ...(vagas[horarioSelecionado]?.bloqueados ?? []).map((b) => b.profissionalId),
          ]
        : vagas[horarioSelecionado] ?? [];
      if (livres.length === 0) {
        setEnviando(false);
        setErro("Esse horário acabou de ser reservado. Escolha outro.");
        setHorarioSelecionado("");
        setEtapa("data");
        return;
      }
      profissionalId = await escolherMenosOcupado(
        estabelecimento.id,
        form.data,
        livres
      );
    }

    const payload = {
      nome_cliente: form.nome,
      telefone: normalizarWhatsapp(form.telefone),
      data: form.data,
      horario: horarioSelecionado,
      servico_id: servicoSelecionado.id,
      duracao_min: duracaoEfetivaServico(),
      estabelecimento_id: estabelecimento.id,
      profissional_id: profissionalId,
      status,
      sinal_declarado_pago: sinalDeclarado,
      finalizado: true,
    };
    const { data, error } = await supabase
      .from("agendamentos")
      .insert(payload)
      .select("id")
      .single();
    if (!error) {
      await salvarRespostasPerguntas(data.id);
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
        setEtapa("data");
        // Recarrega as vagas pra refletir quem ainda está livre neste dia.
        try {
          const mapa = await calcularVagasPorHorario({
            estabelecimentoId: estabelecimento.id,
            servicoId: servicoSelecionado.id,
            data: form.data,
            contexto: modoLivre ? "admin" : "publico",
            duracaoMinOverride: duracaoEfetivaServico(),
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

    // Notificação de confirmação (zona grande do botão dividido, ver JSX —
    // mesma mensagem/gatilho de "Confirmar" na aba Pendentes).
    // `notificar=false` (zona pequena, popup "sem notificar") pula só isto.
    if (notificar) {
      window.open(
        linkWhatsApp(
          form.telefone,
          MENSAGEM_CONFIRMACAO(
            {
              nome_cliente: form.nome,
              data: form.data,
              horario: horarioSelecionado,
              servicos: { nome: servicoSelecionado.nome },
            },
            estabelecimento.msg_confirmacao
          )
        ),
        "_blank",
        "noopener,noreferrer"
      );
    }

    // Sucesso: entrega o resumo ao consumidor (refetch + reset no admin — o
    // público nunca chega aqui). Não tocamos no layout ao redor daqui.
    onSucesso?.({
      form,
      servico: servicoSelecionado,
      horario: horarioSelecionado,
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

            {erroManutencaoExterna && (
              <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroManutencaoExterna}
              </p>
            )}

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
              ) : semProfissionalParaAgendar || (!modoLivre && diasSemanaAtivos.size === 0) ? (
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
                  estabelecimento={estabelecimento}
                  vencimentoManutencao={vencimentoManutencao}
                  modoLivre={modoLivre}
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

                {/* Horário restaurado de uma sessão anterior (ver
                    pendenteRestaurarRef) que já não está mais livre — outra
                    reserva ocupou enquanto a página estava "fora". */}
                {avisoHorarioIndisponivel && (
                  <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                    Esse horário não está mais disponível. Escolha outro.
                  </p>
                )}

                {carregandoSlots && (
                  <p className="text-sm text-body">Carregando horários...</p>
                )}

                {!carregandoSlots && erroSlots && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                    {erroSlots}
                  </p>
                )}

                {/* Público: grade normal (só o que respeita as regras). */}
                {!carregandoSlots && !erroSlots && !modoLivre && (
                  <>
                    {/* Sem nenhuma vaga no dia: ninguém trabalha, ou tudo já
                        foi reservado (a grade só lista horários com >=1
                        livre). */}
                    {horariosBase.length === 0 && (
                      <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                        Nenhum horário disponível neste dia.
                      </p>
                    )}

                    {/* Havia vaga, mas nada respeita mais a antecedência
                        mínima do salão (hora já passou, ou o corte do dia
                        seguinte fechou o dia inteiro — ver
                        filtrarPorAntecedenciaMinima). */}
                    {horariosBase.length > 0 && horariosVisiveis.length === 0 && (
                      <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                        Não há mais horários disponíveis para esta data.
                      </p>
                    )}

                    {horariosVisiveis.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {horariosVisiveis.map((slot) => {
                          // A grade só contém horários com pelo menos um
                          // profissional livre (no fluxo "cliente escolhe",
                          // livre para o selecionado), então nenhum botão
                          // fica travado.
                          const selecionado = horarioSelecionado === slot;

                          return (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => selecionarHorario(slot)}
                              disabled={criandoReserva}
                              aria-pressed={selecionado}
                              className={[
                                "rounded-lg px-2 py-2 text-sm font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-60",
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
                  </>
                )}

                {/* Admin (modoLivre): grade do dia inteiro, na granularidade
                    do salão (ver gradeAdmin) — inclui horários que as regras
                    normais bloqueariam (fora do expediente/modo, em cima de
                    uma ausência, fora da antecedência mínima), marcados com
                    borda tracejada + selo. Só nunca aparece aqui quem
                    colidiria com um agendamento real já confirmado (ver
                    calcularVagasPorHorario, contexto='admin'). */}
                {!carregandoSlots && !erroSlots && modoLivre && (
                  <>
                    {gradeAdmin.length === 0 && (
                      <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                        Nenhum horário disponível neste dia (todos colidem com
                        agendamentos já confirmados).
                      </p>
                    )}

                    {gradeAdmin.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {gradeAdmin.map(({ horario, status, motivo }) => {
                          const selecionado = horarioSelecionado === horario;
                          const bloqueado = status === "bloqueado";

                          return (
                            <button
                              key={horario}
                              type="button"
                              onClick={() => selecionarHorario(horario)}
                              disabled={criandoReserva}
                              aria-pressed={selecionado}
                              title={
                                bloqueado
                                  ? `Fora das regras normais de agendamento (${ROTULOS_MOTIVO_BLOQUEIO[motivo] ?? motivo})`
                                  : undefined
                              }
                              className={[
                                "relative rounded-lg px-2 py-2 text-sm font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-60",
                                selecionado
                                  ? "bg-primary text-white ring-primary"
                                  : bloqueado
                                  ? "border-2 border-dashed border-violet-300 bg-card text-body ring-border hover:border-violet-400"
                                  : "bg-card text-body ring-border hover:border-primary hover:ring-primary",
                              ].join(" ")}
                            >
                              {horario}
                              {bloqueado && !selecionado && (
                                <span
                                  aria-hidden="true"
                                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-violet-500"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* Gravação (público) ou cancelamento da tentativa anterior,
                    disparados ao tocar um horário — ver selecionarHorario. */}
                {criandoReserva && (
                  <p className="mt-2 text-sm text-body">Reservando horário...</p>
                )}

                {erro && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                    {erro}
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={voltarFisicoData}
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
                {/* /admin nunca chega aqui: o /admin sempre monta este wizard
                    com clienteInicial já preenchido (ver
                    IdentificacaoClienteAdmin em app/[salon]/admin/page.js, que
                    resolve o cliente por nome ANTES do wizard existir). Este
                    formulário livre é só o caminho público sem clienteInicial. */}
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
                    onBlur={handleBlurTelefone}
                    required
                    placeholder="(24) 99999-9999"
                    className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                  {erroFormatoTelefone && (
                    <p className="mt-1 text-xs text-red-600">{erroFormatoTelefone}</p>
                  )}
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

            {/* Só no /admin (status truthy): botão dividido, mesmo padrão da
                aba Pendentes (ver app/[salon]/admin/page.js) — zona grande
                (texto+zap) manda a notificação de confirmação de sempre;
                zona pequena (~64px, dois ícones) abre um popup e, aceito,
                cria sem notificar. O público mantém o botão único de sempre,
                sem WhatsApp nenhum aqui (ele já viu a tela de "Solicitação
                enviada" e usa o próprio botão fixo pra falar com o salão).
                Paleta FIXA (verde), igual Pendentes — não a cor de tema do
                salão (--color-primary): esta ação é sempre "confirmar", com
                o mesmo significado visual em qualquer tenant. */}
            {status ? (
              <div className="flex items-stretch overflow-hidden rounded-lg bg-green-50 ring-1 ring-green-100">
                <button
                  type="submit"
                  disabled={enviando}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 font-medium text-green-700 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <IconeWhatsApp />
                  {enviando ? "Enviando..." : rotuloSubmit}
                </button>
                <button
                  type="button"
                  onClick={abrirPopupConfirmarSemNotificar}
                  disabled={enviando}
                  aria-label="Confirmar sem notificar cliente"
                  title="Confirmar sem notificar cliente"
                  className="inline-flex w-16 shrink-0 items-center justify-center gap-1 border-l border-green-100 text-green-700 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <MessageCircleOff className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="submit"
                disabled={enviando}
                className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enviando ? "Enviando..." : rotuloSubmit}
              </button>
            )}

            {/* Só no /admin: no público a reserva já foi gravada de verdade
                ao entrar em "dados" (ver selecionarHorario), então esta
                etapa não permite mais navegação passo a passo pra trás — o
                voltar físico leva pro início do fluxo (onVoltarInicio/
                fecharDados acima), sem botão em tela equivalente. */}
            {status && (
              <button
                type="button"
                onClick={voltarFisicoDados}
                className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            )}

            {erro && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erro}
              </p>
            )}
          </>
        )}
      </form>

      {/* Popup de manutenção (eh_manutencao=true): confirma se a cliente já
          fez o serviço de origem antes de seguir. Mesmo shell visual do
          modal de alerta logo abaixo. "Sim" segue com a manutenção; "Não"
          troca pelo serviço de origem (achado em `servicos`, mesma lista do
          acordeão); clique no overlay fecha sem selecionar nada. */}
      {manutencaoPendente && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-manutencao-pendente"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={cancelarManutencao}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-manutencao-pendente"
              className="text-lg font-semibold text-heading"
            >
              Confirmar manutenção
            </h2>
            <p className="mt-2 text-sm text-body">
              Você já está com as unhas de alongamento ou gel aplicadas?
            </p>

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={confirmarManutencao}
                className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
              >
                Sim, fiz aqui
              </button>
              <button
                type="button"
                onClick={confirmarManutencaoOutroSalao}
                className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Sim, em outro salão
              </button>
              <button
                type="button"
                onClick={recusarManutencao}
                className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Não, está natural
              </button>
            </div>
          </div>
        </div>
      )}

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
              {perguntasServico
                .filter((pergunta) => perguntaDeveAparecer(pergunta, respostasPerguntas))
                .map((pergunta) => (
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

      {/* Regras do agendamento (ver handleSubmit/confirmarAvisoRegras acima):
          bloqueia o envio final do agendamento até a cliente confirmar. */}
      {mostrarPopupAvisoRegras && (
        <PopupRegrasAgendamento
          texto={estabelecimento.aviso_regras_agendamento}
          onConfirmar={confirmarAvisoRegras}
        />
      )}

      {/* Popup da zona pequena do botão dividido (só /admin) — mesmo texto e
          par Confirmar/Cancelar do popup equivalente na aba Pendentes. */}
      {popupConfirmarSemNotificarAberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-confirmar-sem-notificar"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setPopupConfirmarSemNotificarAberto(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-confirmar-sem-notificar"
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
                onClick={confirmarSemNotificar}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 font-medium text-white transition hover:bg-green-700"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setPopupConfirmarSemNotificarAberto(false)}
                className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fora da janela de agendamento (só /admin, modoLivre — ver
          finalizarAgendamento/confirmarForaDaJanela acima): mesmo padrão
          Confirmar/Cancelar do popup "sem notificar" logo acima. Cancelar só
          fecha o popup, sem gravar nada. */}
      {mostrarPopupForaDaJanela && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-fora-da-janela"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setMostrarPopupForaDaJanela(false)}
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
                onClick={confirmarForaDaJanela}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 font-medium text-white transition hover:bg-green-700"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setMostrarPopupForaDaJanela(false)}
                className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
