"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import FotoPerfilCircular from "@/components/FotoPerfilCircular";
import CampoMensagemWhatsapp from "@/components/CampoMensagemWhatsapp";
import ModalImportarGoogleCalendar from "@/components/ModalImportarGoogleCalendar";
import { MENSAGENS_WHATSAPP_CONFIG, substituirVariaveis } from "@/lib/whatsapp";

// Configurações do salão (tabela `estabelecimentos`) editáveis pelo dono direto
// no admin:
//   escolha_profissional (boolean) – se o cliente pode escolher o profissional
//   ao agendar. O efeito real no fluxo de agendamento/disponibilidade vem numa
//   fatia seguinte; AQUI é só persistir a preferência.
//   sinal_regra/sinal_valor_centavos/sinal_chave_pix – regra do sinal de
//   reserva exigido no FormularioAgendamento (ver precisaSinal lá).
//
// O objeto `estabelecimento` (prop) traz só { id, nome, whatsapp, slug, ... },
// então o valor atual de cada campo é lido do banco ao montar. O update
// filtra por id e depende da RLS existente (só dono/global edita o próprio
// salão) — se o banco recusar, o campo reverte e mostra o erro.

// Reais digitado ("35" ou "35,50") -> centavos inteiros. 0 quando vazio ou
// não numérico — mesmo padrão de reaisParaCentavos do GerenciarServicos.
function reaisParaCentavos(reais) {
  if (!reais) return 0;
  const numero = Number(String(reais).replace(",", "."));
  return Number.isNaN(numero) ? 0 : Math.round(numero * 100);
}

// centavos -> string em reais pro input ("3550" -> "35.50"; null/0 -> "").
function centavosParaReais(centavos) {
  if (!centavos) return "";
  return (centavos / 100).toFixed(2);
}

// hoje + N dias -> "YYYY-MM-DD", pros 3 botões de atalho da janela de
// agendamento (ver bloco "Janela de agendamento"). Componente-a-componente
// (nunca toISOString, que despeja em UTC e pode voltar um dia).
function dataMaisDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Atalhos de dias pro campo de janela de agendamento (ver bloco "Janela de
// agendamento"): cada um calcula hoje + N e preenche o campo.
const ATALHOS_JANELA_DIAS = [45, 60, 90];

// Valores fictícios pra prévia das mensagens de WhatsApp (lista retrátil
// abaixo) — cobre todas as variáveis usadas por qualquer uma das 8
// mensagens (ver MENSAGENS_WHATSAPP_CONFIG em lib/whatsapp.js).
const VALORES_EXEMPLO_MENSAGENS = {
  nome_cliente: "Maria",
  data: "15/08",
  horario: "14:00",
  servico: "Manicure completa",
  link: "https://agenda.exemplo.com/salao",
  janela_fim: "30/09/2026",
};

export default function ConfiguracoesSalao({
  estabelecimento,
  // Chamado com a nova data logo após salvar a janela de agendamento (ver
  // aplicarJanela) — deixa quem chama (AdminPage) patchar sua PRÓPRIA cópia
  // de `estabelecimento`, já que ela só é buscada uma vez no mount e alimenta
  // o banner/popup e o calendário da aba Agendar. Opcional (no-op por
  // padrão): nada além do /admin passa isso hoje.
  onJanelaAgendamentoFimAtualizada = () => {},
  // Mesmo padrão acima, para as mensagens de WhatsApp editáveis (ver
  // salvarMensagem abaixo): chamado com (coluna, valor) por coluna gravada
  // com sucesso, pra AdminPage patchar sua própria cópia de `estabelecimento`
  // sem refetch. Opcional (no-op por padrão).
  onMensagemAtualizada = () => {},
  // true quando a navegação veio do banner "Agenda aberta até" (ver page.js) —
  // abre o bloco "Janela de agendamento" (accordion) já expandido e rola até
  // ele. Consumido uma vez (ver useEffect abaixo) via
  // onFocarBlocoJanelaConsumido, pra não reabrir sozinho numa visita normal.
  focarBlocoJanela = false,
  onFocarBlocoJanelaConsumido = () => {},
  // Chamado ao clicar "Cadastrar novo profissional" (bloco Equipe abaixo) —
  // quem decide o que fazer é o /admin (troca pra aba Profissionais + abre o
  // wizard). Opcional (no-op por padrão) só pra não quebrar se algum outro
  // consumidor montar ConfiguracoesSalao sem passar isso.
  onCadastrarProfissional = () => {},
}) {
  // Valor do toggle. undefined = ainda carregando o estado atual do banco.
  const [escolhaProfissional, setEscolhaProfissional] = useState(undefined);
  const [erro, setErro] = useState("");
  // Feedback de gravação: "" | "salvando" | "salvo".
  const [status, setStatus] = useState("");

  // Contagem de profissionais ATIVOS do salão, recontada a cada carga (nunca
  // hardcoded) — com 1 só, o cliente não tem outro pra escolher de qualquer
  // forma, então o toggle não faz sentido nessa tela. null = ainda carregando
  // (mantém o toggle oculto até saber o número de verdade, pra não piscar).
  const [qtdProfissionaisAtivos, setQtdProfissionaisAtivos] = useState(null);

  // Regra do sinal: 'desligado' | 'novos' | 'todos'. undefined = carregando.
  const [sinalRegra, setSinalRegra] = useState(undefined);
  const [sinalValor, setSinalValor] = useState("");
  const [sinalChavePix, setSinalChavePix] = useState("");
  const [erroSinal, setErroSinal] = useState("");
  const [statusSinal, setStatusSinal] = useState("");

  // Data final da janela de agendamento (estabelecimentos.janela_agendamento_fim,
  // "YYYY-MM-DD") — além dela, nenhum dia pode ser agendado, público ou
  // /admin (ver lib/janelaAgendamento.js -> dentroDaJanelaAgendamento, a
  // checagem única reaproveitada no calendário do wizard e em
  // lib/disponibilidade.js). Campo obrigatório pra SALVAR (não existe "sem
  // janela" como opção aqui), mas o state nasce "" até carregar — string
  // vazia só means "ainda não configurado", não é um valor válido de salvar.
  // undefined = ainda carregando.
  const [janelaAgendamentoFim, setJanelaAgendamentoFim] = useState(undefined);
  const [erroJanela, setErroJanela] = useState("");
  const [statusJanela, setStatusJanela] = useState("");
  // Popup de confirmação ao REDUZIR a janela com agendamentos reais além da
  // nova data (ver aplicarJanela). null = nenhum popup aberto. Guarda a nova
  // data + a contagem encontrada, pro botão "Confirmar" gravar sem repetir a
  // consulta.
  const [confirmandoReducaoJanela, setConfirmandoReducaoJanela] = useState(null);

  // Texto das regras do agendamento, mostrado num popup pra cliente, no
  // fluxo público, na etapa final de confirmação — sempre, com ou sem sinal
  // (ver PopupRegrasAgendamento/FormularioAgendamento). Texto livre; vazio
  // grava null (nenhum popup aparece). undefined = carregando.
  const [avisoRegrasAgendamento, setAvisoRegrasAgendamento] = useState(undefined);
  const [erroRegrasAgendamento, setErroRegrasAgendamento] = useState("");
  const [statusRegrasAgendamento, setStatusRegrasAgendamento] = useState("");

  // Dias pra manter a manutenção vencida em destaque. String vazia = nunca
  // caduca (grava null). undefined = ainda carregando o estado atual do banco.
  const [caducidadeDias, setCaducidadeDias] = useState(undefined);
  const [erroCaducidade, setErroCaducidade] = useState("");
  const [statusCaducidade, setStatusCaducidade] = useState("");

  // Cobrar o valor cheio do serviço de origem quando a manutenção é feita
  // depois do prazo (ver lib/manutencaoSugerida.js -> calcularPrecoManutencao,
  // usado pelo wizard de agendamento). undefined = ainda carregando.
  const [valorCheioAposPrazo, setValorCheioAposPrazo] = useState(undefined);
  const [erroValorCheio, setErroValorCheio] = useState("");
  const [statusValorCheio, setStatusValorCheio] = useState("");

  // Horas até uma reserva provisória (pendente/aguardando_sinal, criada
  // antecipadamente pelo wizard público — ver FormularioAgendamento) parar de
  // bloquear disponibilidade (ver lib/disponibilidade.js ->
  // calcularVagasPorHorario). String pro input; undefined = ainda carregando.
  const [reservaExpiraHoras, setReservaExpiraHoras] = useState(undefined);
  const [erroReservaExpira, setErroReservaExpira] = useState("");
  const [statusReservaExpira, setStatusReservaExpira] = useState("");

  // Antecedência mínima (em horas) pra cliente agendar pelo app (ver
  // lib/disponibilidade.js -> filtrarPorAntecedenciaMinima). String do
  // <select> ("" = "Nenhum"/null, senão "12"/"24"/"48"); undefined = ainda
  // carregando. O corte do dia seguinte (cutoffDiaSeguinte*) é uma regra
  // funcionalmente independente na lógica de bloqueio, mas a checkbox só é
  // exibida na UI quando antecedenciaMinimaHoras for "Nenhum" ou "12" — em
  // 24h/48h ela perde o sentido (a própria antecedência já cobre a manhã
  // seguinte, ver investigação no PR). O valor salvo no banco pode continuar
  // true mesmo com a checkbox oculta; é seguro, fica dormente sem efeito.
  const [antecedenciaMinimaHoras, setAntecedenciaMinimaHoras] = useState(undefined);
  const [cutoffDiaSeguinteAtivo, setCutoffDiaSeguinteAtivo] = useState(false);
  const [cutoffDiaSeguinteHora, setCutoffDiaSeguinteHora] = useState("19");
  const [erroAntecedenciaMinima, setErroAntecedenciaMinima] = useState("");
  const [statusAntecedenciaMinima, setStatusAntecedenciaMinima] = useState("");

  // Qual bloco retrátil está expandido — só um aberto por vez, mesmo padrão
  // do acordeão de categorias de serviço (ver GerenciarServicos.js).
  const [blocoAberto, setBlocoAberto] = useState(null);

  // Wrapper do bloco "Janela de agendamento" — alvo do scroll quando a
  // navegação chega via focarBlocoJanela (ver useEffect abaixo).
  const blocoJanelaRef = useRef(null);

  // Chegou aqui vindo do banner "Agenda aberta até": expande o bloco e rola
  // até ele. O setTimeout espera o DOM já refletir o acordeão aberto (senão o
  // scroll mira na altura ainda fechada, antes do conteúdo entrar) — mais
  // confiável que requestAnimationFrame aqui, que browsers pausam quando a
  // aba não está com foco/visível. onFocarBlocoJanelaConsumido só é chamado
  // DEPOIS do scrollIntoView (não antes): ele muda `focarBlocoJanela` pra
  // false no componente pai, o que re-executa este efeito e cancela o
  // temporizador ainda pendente (cleanup) — se consumisse a flag antes de
  // disparar o scroll, o timeout nunca chegava a rodar.
  useEffect(() => {
    if (!focarBlocoJanela) return;
    setBlocoAberto("janela");
    const temporizador = setTimeout(() => {
      blocoJanelaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocarBlocoJanelaConsumido();
    }, 80);
    return () => clearTimeout(temporizador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focarBlocoJanela]);

  // Horas mínimas de antecedência pra cliente cancelar um agendamento pelo
  // painel público (ver PainelCliente) — abaixo disso o botão "Cancelar"
  // some de lá. Não afeta o cancelamento pelo /admin. String pro input;
  // undefined = ainda carregando.
  const [cancelamentoPrazoHoras, setCancelamentoPrazoHoras] = useState(undefined);
  const [erroCancelamentoPrazo, setErroCancelamentoPrazo] = useState("");
  const [statusCancelamentoPrazo, setStatusCancelamentoPrazo] = useState("");

  // Link de compartilhamento do Google Maps, usado pelo card "Ver
  // localização" na tela de confirmação do agendamento (ver
  // app/[salon]/page.js). Vazio grava null (card não aparece pro cliente).
  // undefined = ainda carregando.
  const [linkLocalizacao, setLinkLocalizacao] = useState(undefined);
  const [erroLinkLocalizacao, setErroLinkLocalizacao] = useState("");
  const [statusLinkLocalizacao, setStatusLinkLocalizacao] = useState("");

  // Programa de fidelidade: brinde a cada N atendimentos concluídos (ver
  // lib/fidelidade.js -> verificarFidelidadeClientes, chamada ao carregar a
  // aba Pendentes do /admin). 100% derivado — nada além da config é gravado
  // aqui. undefined = ainda carregando.
  const [fidelidadeAtiva, setFidelidadeAtiva] = useState(undefined);
  const [fidelidadeMetaServicos, setFidelidadeMetaServicos] = useState("");
  const [fidelidadeContaManutencao, setFidelidadeContaManutencao] = useState(true);
  const [fidelidadeDescricaoBrinde, setFidelidadeDescricaoBrinde] = useState("");
  const [erroFidelidade, setErroFidelidade] = useState("");
  const [statusFidelidade, setStatusFidelidade] = useState("");

  // Foto de perfil (bucket 'fotos-perfil' do Supabase Storage, caminho fixo
  // `${estabelecimento.id}/perfil.<extensao>` — sempre sobrescreve, nunca
  // acumula lixo). foto_perfil_posicao vira x/y (0-100) pros sliders; string
  // salva no formato "x% y%" (mesmo formato consumido por FotoPerfilCircular
  // via object-position). foto_perfil_zoom é o multiplicador de zoom (1-3),
  // gravado junto com x/y no mesmo save (ver salvarFotoPerfilPosicao).
  // undefined = ainda carregando.
  const [fotoPerfilUrl, setFotoPerfilUrl] = useState(undefined);
  const [fotoPerfilX, setFotoPerfilX] = useState(50);
  const [fotoPerfilY, setFotoPerfilY] = useState(50);
  const [fotoPerfilZoom, setFotoPerfilZoom] = useState(1);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState("");
  const [statusFotoPosicao, setStatusFotoPosicao] = useState("");

  // Integração com Google Calendar (ver sql/estabelecimentos_google_calendar.sql
  // e app/api/google-calendar/callback/route.js). Nada é gravado direto por
  // aqui — "Conectar" só redireciona pro Google, quem grava é a rota de
  // callback (via service role); "Desconectar" zera os campos e apaga o
  // token. undefined = ainda carregando.
  const [googleCalendarAtivo, setGoogleCalendarAtivo] = useState(undefined);
  const [googleCalendarEmail, setGoogleCalendarEmail] = useState(null);
  const [desconectandoGoogleCalendar, setDesconectandoGoogleCalendar] = useState(false);
  const [erroGoogleCalendar, setErroGoogleCalendar] = useState("");
  const [modalImportarAberto, setModalImportarAberto] = useState(false);
  // Retorno da conexão do Google Calendar (ver
  // app/api/google-calendar/callback/route.js), que manda a contagem de
  // agendamentos sincronizados na primeira conexão via query string — o
  // navegador só volta pra cá depois do redirect do Google, não tem outro
  // jeito de passar esse dado pra tela. Lido direto no initializer (não num
  // effect) porque é o estado inicial da tela, não uma sincronização externa.
  const [sucessoGoogleCalendar] = useState(() => {
    if (typeof window === "undefined") return "";
    const total = Number(
      new URLSearchParams(window.location.search).get("google_calendar_sincronizados")
    );
    return total > 0
      ? `Conectado! ${total} agendamentos sincronizados com seu Google Calendar.`
      : "";
  });

  // As 9 mensagens de WhatsApp editáveis (ver MENSAGENS_WHATSAPP_CONFIG em
  // lib/whatsapp.js). `mensagens` guarda o texto VIGENTE de cada campo
  // (personalizado se houver, senão o padrão) — undefined = carregando.
  // Status/erro por campo, pra cada linha ter seu próprio feedback.
  const [mensagens, setMensagens] = useState(undefined);
  const [statusMensagens, setStatusMensagens] = useState({});
  const [erroMensagens, setErroMensagens] = useState({});
  // Qual das 9 mensagens está expandida — só uma por vez, mesmo padrão do
  // acordeão de blocos acima.
  const [mensagemExpandida, setMensagemExpandida] = useState(null);

  // Carrega os valores atuais ao abrir.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("estabelecimentos")
        .select(
          "escolha_profissional, sinal_regra, sinal_valor_centavos, sinal_chave_pix, aviso_regras_agendamento, manutencao_caducidade_dias, manutencao_valor_cheio_apos_prazo, reserva_provisoria_expira_horas, cancelamento_prazo_horas, link_localizacao, fidelidade_ativa, fidelidade_meta_servicos, fidelidade_conta_manutencao, fidelidade_descricao_brinde, foto_perfil_url, foto_perfil_posicao, foto_perfil_zoom, google_calendar_ativo, google_calendar_email, janela_agendamento_fim, antecedencia_minima_horas, cutoff_dia_seguinte_ativo, cutoff_dia_seguinte_hora, msg_confirmacao, msg_lembrete, msg_cancelamento, msg_reativacao, msg_solicitacao_enviada, msg_duvida_generica, msg_cancelamento_cliente, msg_ajuda_prazo_expirado, msg_falha_cadastro, msg_contato_admin, msg_fora_da_janela, msg_alteracao_data"
        )
        .eq("id", estabelecimento.id)
        .single();

      if (!ativo) return;

      if (error) {
        setErro(error.message);
        setErroSinal(error.message);
        setErroRegrasAgendamento(error.message);
        setErroCaducidade(error.message);
        setErroValorCheio(error.message);
        setErroReservaExpira(error.message);
        setErroCancelamentoPrazo(error.message);
        setErroLinkLocalizacao(error.message);
        setErroFidelidade(error.message);
        setErroFoto(error.message);
        setErroGoogleCalendar(error.message);
        setErroJanela(error.message);
        setErroAntecedenciaMinima(error.message);
        return;
      }
      setErro("");
      setEscolhaProfissional(Boolean(data?.escolha_profissional));

      setErroSinal("");
      setSinalRegra(data?.sinal_regra ?? "desligado");
      setSinalValor(centavosParaReais(data?.sinal_valor_centavos));
      setSinalChavePix(data?.sinal_chave_pix ?? "");

      setErroRegrasAgendamento("");
      setAvisoRegrasAgendamento(data?.aviso_regras_agendamento ?? "");

      setErroCaducidade("");
      setCaducidadeDias(
        data?.manutencao_caducidade_dias == null
          ? ""
          : String(data.manutencao_caducidade_dias)
      );

      setErroValorCheio("");
      setValorCheioAposPrazo(Boolean(data?.manutencao_valor_cheio_apos_prazo));

      setErroReservaExpira("");
      setReservaExpiraHoras(
        data?.reserva_provisoria_expira_horas == null
          ? ""
          : String(data.reserva_provisoria_expira_horas)
      );

      setErroCancelamentoPrazo("");
      setCancelamentoPrazoHoras(
        data?.cancelamento_prazo_horas == null
          ? ""
          : String(data.cancelamento_prazo_horas)
      );

      setErroLinkLocalizacao("");
      setLinkLocalizacao(data?.link_localizacao ?? "");

      setErroFidelidade("");
      setFidelidadeAtiva(Boolean(data?.fidelidade_ativa));
      setFidelidadeMetaServicos(
        data?.fidelidade_meta_servicos == null ? "" : String(data.fidelidade_meta_servicos)
      );
      setFidelidadeContaManutencao(data?.fidelidade_conta_manutencao ?? true);
      setFidelidadeDescricaoBrinde(data?.fidelidade_descricao_brinde ?? "");

      setErroFoto("");
      setFotoPerfilUrl(data?.foto_perfil_url ?? null);
      if (data?.foto_perfil_posicao) {
        const [xStr, yStr] = data.foto_perfil_posicao.split(" ");
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);
        if (!Number.isNaN(x)) setFotoPerfilX(x);
        if (!Number.isNaN(y)) setFotoPerfilY(y);
      }
      setFotoPerfilZoom(data?.foto_perfil_zoom ?? 1);

      setErroGoogleCalendar("");
      setGoogleCalendarAtivo(Boolean(data?.google_calendar_ativo));
      setGoogleCalendarEmail(data?.google_calendar_email ?? null);

      setErroJanela("");
      setJanelaAgendamentoFim(data?.janela_agendamento_fim ?? "");

      setErroAntecedenciaMinima("");
      setAntecedenciaMinimaHoras(
        data?.antecedencia_minima_horas == null
          ? ""
          : String(data.antecedencia_minima_horas)
      );
      setCutoffDiaSeguinteAtivo(Boolean(data?.cutoff_dia_seguinte_ativo));
      setCutoffDiaSeguinteHora(
        data?.cutoff_dia_seguinte_hora == null ? "19" : String(data.cutoff_dia_seguinte_hora)
      );

      const textosMensagens = {};
      MENSAGENS_WHATSAPP_CONFIG.forEach(({ campo, padrao, camposDestino }) => {
        // Campo unificado (ex.: msg_suporte_generico): usa a 1ª coluna não
        // nula das N colunas de destino, na ordem declarada, ou string vazia
        // — nunca um padrão hardcoded, já que as funções que leem essas
        // colunas têm padrões diferentes entre si (ver MENSAGENS_WHATSAPP_CONFIG
        // em lib/whatsapp.js).
        if (camposDestino) {
          textosMensagens[campo] = camposDestino.reduce(
            (valor, coluna) => valor ?? data?.[coluna],
            undefined
          ) ?? "";
          return;
        }
        textosMensagens[campo] = data?.[campo] ?? padrao;
      });
      setMensagens(textosMensagens);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Conta os profissionais ATIVOS do salão (pra decidir se o toggle acima
  // aparece). Separado do carregar() de cima pra não acoplar as duas queries.
  useEffect(() => {
    let ativo = true;

    async function contar() {
      const { count, error } = await supabase
        .from("profissionais")
        .select("id", { count: "exact", head: true })
        .eq("estabelecimento_id", estabelecimento.id)
        .eq("ativo", true);

      if (!ativo) return;
      if (!error) setQtdProfissionaisAtivos(count ?? 0);
    }

    contar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Limpa o parâmetro `google_calendar_sincronizados` (lido acima, no
  // initializer de sucessoGoogleCalendar) da URL, pra não reexibir a
  // mensagem de sucesso num refresh da página.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("google_calendar_sincronizados")) return;

    params.delete("google_calendar_sincronizados");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  // "Salvo ✓" some sozinho depois de um instante, pra não ficar preso na tela.
  useEffect(() => {
    if (status !== "salvo") return;
    const t = setTimeout(() => setStatus(""), 2500);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (statusSinal !== "salvo") return;
    const t = setTimeout(() => setStatusSinal(""), 2500);
    return () => clearTimeout(t);
  }, [statusSinal]);

  useEffect(() => {
    if (statusRegrasAgendamento !== "salvo") return;
    const t = setTimeout(() => setStatusRegrasAgendamento(""), 2500);
    return () => clearTimeout(t);
  }, [statusRegrasAgendamento]);

  useEffect(() => {
    if (statusCaducidade !== "salvo") return;
    const t = setTimeout(() => setStatusCaducidade(""), 2500);
    return () => clearTimeout(t);
  }, [statusCaducidade]);

  useEffect(() => {
    if (statusValorCheio !== "salvo") return;
    const t = setTimeout(() => setStatusValorCheio(""), 2500);
    return () => clearTimeout(t);
  }, [statusValorCheio]);

  useEffect(() => {
    if (statusReservaExpira !== "salvo") return;
    const t = setTimeout(() => setStatusReservaExpira(""), 2500);
    return () => clearTimeout(t);
  }, [statusReservaExpira]);

  useEffect(() => {
    if (statusCancelamentoPrazo !== "salvo") return;
    const t = setTimeout(() => setStatusCancelamentoPrazo(""), 2500);
    return () => clearTimeout(t);
  }, [statusCancelamentoPrazo]);

  useEffect(() => {
    if (statusLinkLocalizacao !== "salvo") return;
    const t = setTimeout(() => setStatusLinkLocalizacao(""), 2500);
    return () => clearTimeout(t);
  }, [statusLinkLocalizacao]);

  useEffect(() => {
    if (statusFidelidade !== "salvo") return;
    const t = setTimeout(() => setStatusFidelidade(""), 2500);
    return () => clearTimeout(t);
  }, [statusFidelidade]);

  useEffect(() => {
    if (statusFotoPosicao !== "salvo") return;
    const t = setTimeout(() => setStatusFotoPosicao(""), 2500);
    return () => clearTimeout(t);
  }, [statusFotoPosicao]);

  useEffect(() => {
    if (statusJanela !== "salvo") return;
    const t = setTimeout(() => setStatusJanela(""), 2500);
    return () => clearTimeout(t);
  }, [statusJanela]);

  useEffect(() => {
    if (statusAntecedenciaMinima !== "salvo") return;
    const t = setTimeout(() => setStatusAntecedenciaMinima(""), 2500);
    return () => clearTimeout(t);
  }, [statusAntecedenciaMinima]);

  // Abre/fecha um bloco retrátil — só um aberto por vez, mesmo padrão do
  // acordeão de categorias de serviço.
  function alternarBloco(chave) {
    setBlocoAberto((atual) => (atual === chave ? null : chave));
  }

  // Alterna e grava na hora. Otimista: reflete o novo valor imediatamente e, se
  // o banco recusar (ex.: RLS), reverte e mostra o erro.
  async function alternar() {
    const novo = !escolhaProfissional;
    setEscolhaProfissional(novo);
    setStatus("salvando");
    setErro("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ escolha_profissional: novo })
      .eq("id", estabelecimento.id);

    if (error) {
      setEscolhaProfissional(!novo);
      setStatus("");
      setErro(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatus("salvo");
  }

  // Grava os 3 campos do sinal juntos (mesma linha). `patch` sobrepõe o state
  // atual pra casos em que o campo que disparou o save ainda não commitou no
  // state (ex.: o próprio onChange da regra).
  async function salvarSinal(patch = {}) {
    const regra = patch.sinalRegra ?? sinalRegra;
    const valor = patch.sinalValor ?? sinalValor;
    const chavePix = patch.sinalChavePix ?? sinalChavePix;

    setStatusSinal("salvando");
    setErroSinal("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({
        sinal_regra: regra,
        sinal_valor_centavos: reaisParaCentavos(valor),
        sinal_chave_pix: chavePix || null,
      })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusSinal("");
      setErroSinal(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusSinal("salvo");
  }

  function handleSinalRegraChange(e) {
    const nova = e.target.value;
    setSinalRegra(nova);
    salvarSinal({ sinalRegra: nova });
  }

  // Vazio grava null (nenhum popup aparece no fluxo público).
  async function salvarRegrasAgendamento() {
    setStatusRegrasAgendamento("salvando");
    setErroRegrasAgendamento("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ aviso_regras_agendamento: avisoRegrasAgendamento || null })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusRegrasAgendamento("");
      setErroRegrasAgendamento(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusRegrasAgendamento("salvo");
  }

  // Vazio grava null (nunca caduca); caso contrário grava o inteiro digitado.
  async function salvarCaducidade() {
    const dias = caducidadeDias === "" ? null : parseInt(caducidadeDias, 10);

    setStatusCaducidade("salvando");
    setErroCaducidade("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ manutencao_caducidade_dias: dias })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusCaducidade("");
      setErroCaducidade(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusCaducidade("salvo");
  }

  // Alterna e grava na hora, mesmo padrão otimista de `alternar` acima.
  async function alternarValorCheioAposPrazo() {
    const novo = !valorCheioAposPrazo;
    setValorCheioAposPrazo(novo);
    setStatusValorCheio("salvando");
    setErroValorCheio("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ manutencao_valor_cheio_apos_prazo: novo })
      .eq("id", estabelecimento.id);

    if (error) {
      setValorCheioAposPrazo(!novo);
      setStatusValorCheio("");
      setErroValorCheio(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusValorCheio("salvo");
  }

  // Exige um inteiro > 0 (não faz sentido "nunca expira" aqui — a coluna já
  // nasce com default 48 no banco). Valor inválido/vazio reverte pro último
  // válido carregado, sem gravar.
  async function salvarReservaExpira() {
    const horas = parseInt(reservaExpiraHoras, 10);

    if (!Number.isInteger(horas) || horas <= 0) {
      setErroReservaExpira("Informe um número de horas maior que 0.");
      return;
    }

    setStatusReservaExpira("salvando");
    setErroReservaExpira("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ reserva_provisoria_expira_horas: horas })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusReservaExpira("");
      setErroReservaExpira(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setReservaExpiraHoras(String(horas));
    setStatusReservaExpira("salvo");
  }

  // Aceita 0 (sem trava de prazo — comportamento atual do botão "Cancelar" no
  // PainelCliente é preservado). Valor inválido/vazio reverte pro último
  // válido carregado, sem gravar.
  async function salvarCancelamentoPrazo() {
    const horas = parseInt(cancelamentoPrazoHoras, 10);

    if (!Number.isInteger(horas) || horas < 0) {
      setErroCancelamentoPrazo("Informe um número de horas maior ou igual a 0.");
      return;
    }

    setStatusCancelamentoPrazo("salvando");
    setErroCancelamentoPrazo("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ cancelamento_prazo_horas: horas })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusCancelamentoPrazo("");
      setErroCancelamentoPrazo(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setCancelamentoPrazoHoras(String(horas));
    setStatusCancelamentoPrazo("salvo");
  }

  // Vazio grava null (nenhum card "Ver localização" aparece pro cliente).
  async function salvarLinkLocalizacao() {
    setStatusLinkLocalizacao("salvando");
    setErroLinkLocalizacao("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ link_localizacao: linkLocalizacao || null })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusLinkLocalizacao("");
      setErroLinkLocalizacao(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusLinkLocalizacao("salvo");
  }

  // Grava os 4 campos da fidelidade juntos (mesma linha), mesmo padrão de
  // `salvarSinal` acima — `patch` sobrepõe o state atual pra casos em que o
  // campo que disparou o save (ex.: um dos toggles) ainda não commitou no
  // state. Retorna o erro (ou null) pra quem chamou decidir se reverte um
  // toggle otimista.
  async function salvarFidelidade(patch = {}) {
    const ativa = patch.fidelidadeAtiva ?? fidelidadeAtiva;
    const metaServicos = patch.fidelidadeMetaServicos ?? fidelidadeMetaServicos;
    const contaManutencao = patch.fidelidadeContaManutencao ?? fidelidadeContaManutencao;
    const descricaoBrinde = patch.fidelidadeDescricaoBrinde ?? fidelidadeDescricaoBrinde;

    setStatusFidelidade("salvando");
    setErroFidelidade("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({
        fidelidade_ativa: ativa,
        fidelidade_meta_servicos: metaServicos === "" ? null : parseInt(metaServicos, 10),
        fidelidade_conta_manutencao: contaManutencao,
        fidelidade_descricao_brinde: descricaoBrinde || null,
      })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusFidelidade("");
      setErroFidelidade(`Não foi possível salvar: ${error.message}`);
      return error;
    }

    setStatusFidelidade("salvo");
    return null;
  }

  // Alterna e grava na hora, mesmo padrão otimista de `alternarValorCheioAposPrazo`.
  async function alternarFidelidadeAtiva() {
    const novo = !fidelidadeAtiva;
    setFidelidadeAtiva(novo);
    const error = await salvarFidelidade({ fidelidadeAtiva: novo });
    if (error) setFidelidadeAtiva(!novo);
  }

  async function alternarFidelidadeContaManutencao() {
    const novo = !fidelidadeContaManutencao;
    setFidelidadeContaManutencao(novo);
    const error = await salvarFidelidade({ fidelidadeContaManutencao: novo });
    if (error) setFidelidadeContaManutencao(!novo);
  }

  // Sobe o arquivo pro bucket 'fotos-perfil', sempre no mesmo caminho (não
  // acumula lixo), e grava a URL pública + ?v=<timestamp> em
  // foto_perfil_url — o cache-buster evita que o otimizador de imagem do
  // Next continue servindo a foto antiga depois da troca.
  async function handleFotoPerfilChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setEnviandoFoto(true);
    setErroFoto("");

    const extensao = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const caminho = `${estabelecimento.id}/perfil.${extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from("fotos-perfil")
      .upload(caminho, file, { upsert: true, contentType: file.type });

    if (erroUpload) {
      setEnviandoFoto(false);
      setErroFoto(`Não foi possível enviar a foto: ${erroUpload.message}`);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("fotos-perfil").getPublicUrl(caminho);
    const urlComCache = `${publicUrl}?v=${Date.now()}`;

    const { error: erroUpdate } = await supabase
      .from("estabelecimentos")
      .update({ foto_perfil_url: urlComCache })
      .eq("id", estabelecimento.id);

    setEnviandoFoto(false);

    if (erroUpdate) {
      setErroFoto(`Não foi possível salvar a foto: ${erroUpdate.message}`);
      return;
    }

    setFotoPerfilUrl(urlComCache);
  }

  // Grava posição ("x% y%") + zoom juntos ao soltar qualquer um dos 3
  // sliders. Aceita x/y/zoom explícitos pra evitar depender do state ainda
  // não commitado no próprio evento que disparou o save (mesmo motivo do
  // `patch` em salvarSinal/salvarFidelidade).
  async function salvarFotoPerfilPosicao(
    x = fotoPerfilX,
    y = fotoPerfilY,
    zoom = fotoPerfilZoom
  ) {
    setStatusFotoPosicao("salvando");
    setErroFoto("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ foto_perfil_posicao: `${x}% ${y}%`, foto_perfil_zoom: zoom })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusFotoPosicao("");
      setErroFoto(`Não foi possível salvar a posição: ${error.message}`);
      return;
    }

    setStatusFotoPosicao("salvo");
  }

  // Redireciona pro consentimento do Google (não é fetch — a página inteira
  // navega pro domínio do Google e volta via app/api/google-calendar/callback).
  // `state` carrega o estabelecimento_id, pra rota de callback saber pra qual
  // salão gravar o token.
  function conectarGoogleCalendar() {
    const params = new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID,
      redirect_uri: `${process.env.NEXT_PUBLIC_URL_BASE}/api/google-calendar/callback`,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/userinfo.email",
      access_type: "offline",
      prompt: "consent",
      state: estabelecimento.id,
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  // Zera a integração: desliga o flag, esquece o e-mail e apaga o
  // refresh_token guardado (sql/estabelecimentos_google_calendar.sql — a
  // tabela não tem policy de SELECT/UPDATE pro cliente, só DELETE).
  async function desconectarGoogleCalendar() {
    setDesconectandoGoogleCalendar(true);
    setErroGoogleCalendar("");

    const { error: erroToken } = await supabase
      .from("google_calendar_tokens")
      .delete()
      .eq("estabelecimento_id", estabelecimento.id);

    if (erroToken) {
      setDesconectandoGoogleCalendar(false);
      setErroGoogleCalendar(`Não foi possível desconectar: ${erroToken.message}`);
      return;
    }

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ google_calendar_ativo: false, google_calendar_email: null })
      .eq("id", estabelecimento.id);

    setDesconectandoGoogleCalendar(false);

    if (error) {
      setErroGoogleCalendar(`Não foi possível desconectar: ${error.message}`);
      return;
    }

    setGoogleCalendarAtivo(false);
    setGoogleCalendarEmail(null);
  }

  // Grava janela_agendamento_fim. Campo obrigatório: novaData vazia não salva
  // (mesmo padrão de validação-sem-revert de salvarReservaExpira/salvarCancelamentoPrazo
  // acima — só mostra o erro e devolve).
  //
  // Se novaData REDUZ a janela atual (novaData < janelaAgendamentoFim já
  // salvo) e existe pelo menos um agendamento com data > novaData e status
  // <> 'cancelado' pra este salão, abre o popup de confirmação
  // (confirmandoReducaoJanela) em vez de gravar direto — quem confirma o
  // popup chama de novo com `pulaConfirmacao: true`. Aumentar/manter a
  // janela, ou reduzir sem nenhum agendamento afetado, grava direto.
  async function aplicarJanela(novaData, { pulaConfirmacao = false } = {}) {
    if (!novaData) {
      setErroJanela("Selecione uma data.");
      return;
    }
    setErroJanela("");

    const reduzindo = janelaAgendamentoFim && novaData < janelaAgendamentoFim;

    if (reduzindo && !pulaConfirmacao) {
      setStatusJanela("verificando");

      const { count, error } = await supabase
        .from("agendamentos")
        .select("id", { count: "exact", head: true })
        .eq("estabelecimento_id", estabelecimento.id)
        .gt("data", novaData)
        .neq("status", "cancelado");

      setStatusJanela("");

      if (error) {
        setErroJanela(`Não foi possível verificar: ${error.message}`);
        return;
      }

      if ((count ?? 0) > 0) {
        setConfirmandoReducaoJanela({ novaData, contagem: count });
        return;
      }
    }

    setStatusJanela("salvando");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ janela_agendamento_fim: novaData })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusJanela("");
      setErroJanela(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setJanelaAgendamentoFim(novaData);
    setStatusJanela("salvo");
    setConfirmandoReducaoJanela(null);
    onJanelaAgendamentoFimAtualizada(novaData);
  }

  // Grava a antecedência mínima (select "Nenhum"/12/24/48 — ver
  // filtrarPorAntecedenciaMinima em lib/disponibilidade.js). Regra
  // independente do corte do dia seguinte — não mexe nos campos de cutoff.
  async function salvarAntecedenciaMinima(novoValorStr) {
    const novoValor = novoValorStr === "" ? null : Number(novoValorStr);

    setStatusAntecedenciaMinima("salvando");
    setErroAntecedenciaMinima("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ antecedencia_minima_horas: novoValor })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusAntecedenciaMinima("");
      setErroAntecedenciaMinima(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setAntecedenciaMinimaHoras(novoValorStr);
    setStatusAntecedenciaMinima("salvo");
  }

  // Liga/desliga o corte do dia seguinte — regra independente da antecedência
  // mínima (ver filtrarPorAntecedenciaMinima em lib/disponibilidade.js). Ao
  // desligar, limpa também a hora gravada (null): o checkbox desmarcado não
  // deixa uma hora "fantasma" no banco.
  async function alternarCutoffDiaSeguinte() {
    const novo = !cutoffDiaSeguinteAtivo;
    setCutoffDiaSeguinteAtivo(novo);
    setStatusAntecedenciaMinima("salvando");
    setErroAntecedenciaMinima("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({
        cutoff_dia_seguinte_ativo: novo,
        cutoff_dia_seguinte_hora: novo ? Number(cutoffDiaSeguinteHora) : null,
      })
      .eq("id", estabelecimento.id);

    if (error) {
      setCutoffDiaSeguinteAtivo(!novo);
      setStatusAntecedenciaMinima("");
      setErroAntecedenciaMinima(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setStatusAntecedenciaMinima("salvo");
  }

  async function salvarCutoffDiaSeguinteHora(novaHoraStr) {
    setStatusAntecedenciaMinima("salvando");
    setErroAntecedenciaMinima("");

    const { error } = await supabase
      .from("estabelecimentos")
      .update({ cutoff_dia_seguinte_hora: Number(novaHoraStr) })
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusAntecedenciaMinima("");
      setErroAntecedenciaMinima(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setCutoffDiaSeguinteHora(novaHoraStr);
    setStatusAntecedenciaMinima("salvo");
  }

  // Grava o texto vigente de UMA mensagem (`mensagens[campo]`), literal —
  // inclusive string vazia, quando o dono esvazia o campo de propósito (ver
  // regra em MENSAGENS_WHATSAPP_CONFIG/lib/whatsapp.js: vazio salvo é ''
  // ("enviar em branco"), nunca null ("nunca editado, usa o padrão")).
  // Campo com `camposDestino` (ex.: msg_suporte_generico) grava o MESMO
  // texto em todas as colunas de destino de uma vez, em vez de só na
  // coluna `campo`.
  async function salvarMensagem(campo) {
    setStatusMensagens((s) => ({ ...s, [campo]: "salvando" }));
    setErroMensagens((s) => ({ ...s, [campo]: "" }));

    const config = MENSAGENS_WHATSAPP_CONFIG.find((item) => item.campo === campo);
    const colunas = config?.camposDestino ?? [campo];
    const valores = Object.fromEntries(colunas.map((coluna) => [coluna, mensagens[campo]]));

    const { error } = await supabase
      .from("estabelecimentos")
      .update(valores)
      .eq("id", estabelecimento.id);

    if (error) {
      setStatusMensagens((s) => ({ ...s, [campo]: "" }));
      setErroMensagens((s) => ({
        ...s,
        [campo]: `Não foi possível salvar: ${error.message}`,
      }));
      return;
    }

    colunas.forEach((coluna) => onMensagemAtualizada(coluna, valores[coluna]));

    setStatusMensagens((s) => ({ ...s, [campo]: "salvo" }));
    setTimeout(() => {
      setStatusMensagens((s) => (s[campo] === "salvo" ? { ...s, [campo]: "" } : s));
    }, 2500);
  }

  const carregandoValor = escolhaProfissional === undefined;
  const carregandoSinal = sinalRegra === undefined;
  const carregandoRegrasAgendamento = avisoRegrasAgendamento === undefined;
  const carregandoCaducidade = caducidadeDias === undefined;
  const carregandoValorCheio = valorCheioAposPrazo === undefined;
  const carregandoReservaExpira = reservaExpiraHoras === undefined;
  const carregandoCancelamentoPrazo = cancelamentoPrazoHoras === undefined;
  const carregandoLinkLocalizacao = linkLocalizacao === undefined;
  const carregandoFidelidade = fidelidadeAtiva === undefined;
  const carregandoFoto = fotoPerfilUrl === undefined;
  const carregandoGoogleCalendar = googleCalendarAtivo === undefined;
  const carregandoJanela = janelaAgendamentoFim === undefined;
  const carregandoAntecedenciaMinima = antecedenciaMinimaHoras === undefined;
  const sinalDesligado = sinalRegra === "desligado";
  // Com 1 só profissional ativo (ou enquanto a contagem ainda carrega), o
  // toggle some — não há outro profissional pro cliente escolher de qualquer
  // forma. Se o salão já tinha o valor "true" salvo de quando tinha 2+
  // profissionais, ele fica preservado no banco (não escrevemos nada aqui),
  // mas some da tela e não tem efeito prático nesse cenário. Volta a
  // aparecer normalmente assim que houver 2+ profissionais ativos de novo.
  const mostrarToggleEscolha =
    qtdProfissionaisAtivos != null && qtdProfissionaisAtivos >= 2;

  return (
    <>
    {mostrarToggleEscolha && (
    <section className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label
            htmlFor="toggle-escolha-prof"
            className="block text-sm font-medium text-heading"
          >
            Permitir que o cliente escolha o profissional ao agendar
          </label>
          <p className="mt-1 text-xs text-muted">
            Se desligado, o sistema encaixa automaticamente em um profissional
            disponível.
          </p>
        </div>

        <button
          id="toggle-escolha-prof"
          type="button"
          role="switch"
          aria-checked={Boolean(escolhaProfissional)}
          onClick={alternar}
          disabled={carregandoValor}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
            escolhaProfissional ? "bg-primary" : "bg-border"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              escolhaProfissional ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Feedback de gravação (some após "salvo"; erro persiste até o próximo OK). */}
      {status === "salvando" && (
        <p className="mt-2 text-xs text-muted">Salvando…</p>
      )}
      {status === "salvo" && !erro && (
        <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
      )}
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
    </section>
    )}

    <div className="space-y-4">

      {/* Bloco: Janela de agendamento — data final (janela_agendamento_fim)
          além da qual nenhum dia pode ser agendado, público ou /admin (ver
          lib/janelaAgendamento.js). Campo obrigatório: sempre grava só a
          data final, não existe "modo" persistido. */}
      <div ref={blocoJanelaRef} className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("janela")}
          aria-expanded={blocoAberto === "janela"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Janela de agendamento</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "janela" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "janela" && (
          <div className="border-t border-border p-4 space-y-4">
            <p className="text-xs text-muted">
              Nenhum cliente consegue agendar (nem você, pelo /admin) além
              desta data. Escolha um atalho ou uma data manual.
            </p>

            <div className="flex flex-wrap gap-2">
              {ATALHOS_JANELA_DIAS.map((dias) => (
                <button
                  key={dias}
                  type="button"
                  onClick={() => aplicarJanela(dataMaisDias(dias))}
                  disabled={carregandoJanela}
                  className="rounded-lg bg-surface px-3 py-2 text-sm font-medium text-heading ring-1 ring-border transition hover:bg-border/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  +{dias} dias
                </button>
              ))}
            </div>

            <div>
              <label
                htmlFor="janela-agendamento-fim"
                className="mb-1 block text-sm font-medium text-body"
              >
                Agenda aberta até
              </label>
              <input
                id="janela-agendamento-fim"
                type="date"
                value={janelaAgendamentoFim || ""}
                onChange={(e) => aplicarJanela(e.target.value)}
                disabled={carregandoJanela}
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {statusJanela === "verificando" && (
              <p className="text-xs text-muted">Verificando agendamentos afetados…</p>
            )}
            {statusJanela === "salvando" && (
              <p className="text-xs text-muted">Salvando…</p>
            )}
            {statusJanela === "salvo" && !erroJanela && (
              <p className="text-xs font-medium text-green-600">Salvo ✓</p>
            )}
            {erroJanela && <p className="text-xs text-red-600">{erroJanela}</p>}

            {/* Sub-bloco: antecedência mínima do CLIENTE (não afeta o
                calendário da janela acima, que é o limite máximo) + corte do
                dia seguinte. As duas regras são independentes na lógica de
                bloqueio (ver filtrarPorAntecedenciaMinima em
                lib/disponibilidade.js), mas a checkbox do corte só aparece
                na UI quando a antecedência for "Nenhum" ou "12h" — em 24h/48h
                a antecedência já cobre a manhã seguinte, então a checkbox
                fica escondida (não desabilitada). */}
            <div className="border-t border-border pt-4">
              <label
                htmlFor="antecedencia-minima-horas"
                className="mb-1 block text-sm font-medium text-body"
              >
                Antecedência mínima para agendamentos do cliente
              </label>
              <p className="mb-2 text-xs text-muted">
                Defina com quanta antecedência os clientes podem agendar pelo
                app.
              </p>
              <select
                id="antecedencia-minima-horas"
                value={antecedenciaMinimaHoras ?? ""}
                onChange={(e) => salvarAntecedenciaMinima(e.target.value)}
                disabled={carregandoAntecedenciaMinima}
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Nenhum</option>
                <option value="12">12 horas antes</option>
                <option value="24">24 horas antes</option>
                <option value="48">48 horas antes</option>
              </select>

              {(antecedenciaMinimaHoras === "" || antecedenciaMinimaHoras === "12") && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-body">
                    <input
                      type="checkbox"
                      checked={cutoffDiaSeguinteAtivo}
                      onChange={alternarCutoffDiaSeguinte}
                      disabled={carregandoAntecedenciaMinima}
                      className="h-4 w-4 rounded border-border"
                    />
                    Encerrar agendamentos da manhã seguinte às
                  </label>
                  <select
                    value={cutoffDiaSeguinteHora}
                    onChange={(e) => salvarCutoffDiaSeguinteHora(e.target.value)}
                    disabled={carregandoAntecedenciaMinima || !cutoffDiaSeguinteAtivo}
                    className="rounded-lg border border-border px-2 py-1 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {[18, 19, 20, 21].map((h) => (
                      <option key={h} value={h}>
                        {h}h
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {statusAntecedenciaMinima === "salvando" && (
                <p className="mt-2 text-xs text-muted">Salvando…</p>
              )}
              {statusAntecedenciaMinima === "salvo" && !erroAntecedenciaMinima && (
                <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
              )}
              {erroAntecedenciaMinima && (
                <p className="mt-2 text-xs text-red-600">{erroAntecedenciaMinima}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bloco: Cancelamento e prazos */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("cancelamento")}
          aria-expanded={blocoAberto === "cancelamento"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Cancelamento e prazos</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "cancelamento" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "cancelamento" && (
          <div className="border-t border-border p-4 space-y-4">
            <div>
              <label
                htmlFor="cancelamento-prazo-horas"
                className="mb-1 block text-sm font-medium text-body"
              >
                Prazo para Cancelamento (horas), em até:
              </label>
              <input
                id="cancelamento-prazo-horas"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={cancelamentoPrazoHoras ?? ""}
                onChange={(e) => setCancelamentoPrazoHoras(e.target.value)}
                onBlur={salvarCancelamentoPrazo}
                disabled={carregandoCancelamentoPrazo}
                placeholder="24"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-muted">
                Quantas horas antes do horário marcado a cliente ainda pode
                cancelar sozinha pelo painel dela. Depois desse prazo, o
                botão de cancelar some e ela precisa falar direto com você.
              </p>

              {statusCancelamentoPrazo === "salvando" && (
                <p className="mt-2 text-xs text-muted">Salvando…</p>
              )}
              {statusCancelamentoPrazo === "salvo" && !erroCancelamentoPrazo && (
                <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
              )}
              {erroCancelamentoPrazo && (
                <p className="mt-2 text-xs text-red-600">{erroCancelamentoPrazo}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="reserva-expira-horas"
                className="mb-1 block text-sm font-medium text-body"
              >
                Expiração de reserva provisória (horas)
              </label>
              <input
                id="reserva-expira-horas"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={reservaExpiraHoras ?? ""}
                onChange={(e) => setReservaExpiraHoras(e.target.value)}
                onBlur={salvarReservaExpira}
                disabled={carregandoReservaExpira}
                placeholder="48"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-muted">
                Cancelar reservas pendentes não confirmadas após quantas
                horas?
              </p>

              {statusReservaExpira === "salvando" && (
                <p className="mt-2 text-xs text-muted">Salvando…</p>
              )}
              {statusReservaExpira === "salvo" && !erroReservaExpira && (
                <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
              )}
              {erroReservaExpira && (
                <p className="mt-2 text-xs text-red-600">{erroReservaExpira}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bloco: Manutenção */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("manutencao")}
          aria-expanded={blocoAberto === "manutencao"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Manutenção</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "manutencao" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "manutencao" && (
          <div className="border-t border-border p-4 space-y-4">
            <div>
              <label
                htmlFor="manutencao-caducidade-dias"
                className="mb-1 block text-sm font-medium text-body"
              >
                Tolerância após o vencimento (dias)
              </label>
              <input
                id="manutencao-caducidade-dias"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={caducidadeDias ?? ""}
                onChange={(e) => setCaducidadeDias(e.target.value)}
                onBlur={salvarCaducidade}
                disabled={carregandoCaducidade}
                placeholder="Nunca caduca"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-muted">
                Depois de vencida, destacar por quantos dias? (deixe em
                branco para nunca caducar)
              </p>

              {statusCaducidade === "salvando" && (
                <p className="mt-2 text-xs text-muted">Salvando…</p>
              )}
              {statusCaducidade === "salvo" && !erroCaducidade && (
                <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
              )}
              {erroCaducidade && (
                <p className="mt-2 text-xs text-red-600">{erroCaducidade}</p>
              )}
            </div>

            <div>
              <label className="flex items-start gap-2 text-sm text-body">
                <input
                  type="checkbox"
                  checked={Boolean(valorCheioAposPrazo)}
                  onChange={alternarValorCheioAposPrazo}
                  disabled={carregandoValorCheio}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span>
                  <span className="block font-medium text-heading">
                    Valor cheio após o prazo
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    Se a última manutenção da cliente já venceu, o wizard de
                    agendamento cobra o preço do serviço original em vez do
                    preço da manutenção.
                  </span>
                </span>
              </label>

              {statusValorCheio === "salvando" && (
                <p className="mt-2 text-xs text-muted">Salvando…</p>
              )}
              {statusValorCheio === "salvo" && !erroValorCheio && (
                <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
              )}
              {erroValorCheio && (
                <p className="mt-2 text-xs text-red-600">{erroValorCheio}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bloco: Sinal de reserva */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("sinal")}
          aria-expanded={blocoAberto === "sinal"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Sinal de reserva</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "sinal" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "sinal" && (
          <div className="border-t border-border p-4">
            <p className="text-xs text-muted">
              Exige que o cliente declare o pagamento de um sinal via Pix
              antes de confirmar o agendamento.
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <label
                  htmlFor="sinal-regra"
                  className="mb-1 block text-sm font-medium text-body"
                >
                  Regra
                </label>
                <select
                  id="sinal-regra"
                  value={sinalRegra ?? "desligado"}
                  onChange={handleSinalRegraChange}
                  disabled={carregandoSinal}
                  className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="desligado">Desligado</option>
                  <option value="novos">Obrigatório para clientes novos</option>
                  <option value="todos">Obrigatório para todos</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="sinal-valor"
                  className="mb-1 block text-sm font-medium text-body"
                >
                  Valor do sinal (R$)
                </label>
                <input
                  id="sinal-valor"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={sinalValor}
                  onChange={(e) => setSinalValor(e.target.value)}
                  onBlur={() => salvarSinal()}
                  disabled={carregandoSinal || sinalDesligado}
                  placeholder="0,00"
                  className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor="sinal-chave-pix"
                  className="mb-1 block text-sm font-medium text-body"
                >
                  Chave Pix
                </label>
                <input
                  id="sinal-chave-pix"
                  type="text"
                  value={sinalChavePix}
                  onChange={(e) => setSinalChavePix(e.target.value)}
                  onBlur={() => salvarSinal()}
                  disabled={carregandoSinal || sinalDesligado}
                  placeholder="CPF, e-mail, telefone ou chave aleatória"
                  className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>

            {statusSinal === "salvando" && (
              <p className="mt-2 text-xs text-muted">Salvando…</p>
            )}
            {statusSinal === "salvo" && !erroSinal && (
              <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
            )}
            {erroSinal && (
              <p className="mt-2 text-xs text-red-600">{erroSinal}</p>
            )}
          </div>
        )}
      </div>

      {/* Bloco: Regras do agendamento */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("regras")}
          aria-expanded={blocoAberto === "regras"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Texto com regras de agendamento</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "regras" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "regras" && (
          <div className="border-t border-border p-4">
            <div>
              <label
                htmlFor="regras-agendamento"
                className="mb-1 block text-sm font-medium text-body"
              >
                Texto das regras
              </label>
              <textarea
                id="regras-agendamento"
                rows={4}
                value={avisoRegrasAgendamento ?? ""}
                onChange={(e) => setAvisoRegrasAgendamento(e.target.value)}
                onBlur={salvarRegrasAgendamento}
                disabled={carregandoRegrasAgendamento}
                placeholder="Deixe em branco para não mostrar nenhum aviso"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-muted">
                Um texto com as regras do seu atendimento — política de
                atraso, tolerância, e outras informações importantes. Aparece
                pra cliente confirmar que leu antes de fechar qualquer
                agendamento, com ou sem sinal. Use *asterisco* pra deixar
                palavras em negrito, como no WhatsApp. Deixe em branco se não
                quiser mostrar nada.
              </p>
            </div>

            {statusRegrasAgendamento === "salvando" && (
              <p className="mt-2 text-xs text-muted">Salvando…</p>
            )}
            {statusRegrasAgendamento === "salvo" && !erroRegrasAgendamento && (
              <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
            )}
            {erroRegrasAgendamento && (
              <p className="mt-2 text-xs text-red-600">{erroRegrasAgendamento}</p>
            )}
          </div>
        )}
      </div>

      {/* Bloco: Mensagens de WhatsApp — lista das 8 mensagens editáveis, cada
          uma com sua própria prévia (linha truncada) e expansão individual
          (mensagemExpandida), aninhada dentro deste bloco retrátil. */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("mensagens")}
          aria-expanded={blocoAberto === "mensagens"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="font-semibold text-heading">Mensagens de WhatsApp</span>
            <span className="truncate text-xs text-muted">
              Digite &quot;/&quot; para inserir variáveis
            </span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "mensagens" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "mensagens" && (
          <div className="border-t border-border divide-y divide-border">
            {MENSAGENS_WHATSAPP_CONFIG.map(({ campo, titulo, gatilho, variaveis, padrao }) => {
              const textoVigente = mensagens?.[campo] ?? padrao;
              const preview = substituirVariaveis(textoVigente, VALORES_EXEMPLO_MENSAGENS);
              const aberta = mensagemExpandida === campo;

              return (
                <div key={campo} className="p-4">
                  <button
                    type="button"
                    onClick={() =>
                      setMensagemExpandida((atual) => (atual === campo ? null : campo))
                    }
                    aria-expanded={aberta}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-heading">
                        {titulo}
                      </span>
                      <span className="mt-0.5 line-clamp-3 block text-xs text-muted">
                        {preview}
                      </span>
                    </span>
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-xs text-body">
                      {aberta ? "▲" : "▼"}
                    </span>
                  </button>

                  {aberta && (
                    <div className="mt-3 space-y-2">
                      <CampoMensagemWhatsapp
                        value={mensagens?.[campo] ?? ""}
                        onChange={(novo) =>
                          setMensagens((m) => ({ ...m, [campo]: novo }))
                        }
                        onBlur={() => salvarMensagem(campo)}
                        variaveisDisponiveis={variaveis}
                      />

                      <p className="text-xs text-muted">{gatilho}</p>

                      {statusMensagens[campo] === "salvando" && (
                        <p className="text-xs text-muted">Salvando…</p>
                      )}
                      {statusMensagens[campo] === "salvo" && !erroMensagens[campo] && (
                        <p className="text-xs font-medium text-green-600">Salvo ✓</p>
                      )}
                      {erroMensagens[campo] && (
                        <p className="text-xs text-red-600">{erroMensagens[campo]}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bloco: Fidelidade */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("fidelidade")}
          aria-expanded={blocoAberto === "fidelidade"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Fidelidade</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "fidelidade" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "fidelidade" && (
          <div className="border-t border-border p-4 space-y-4">
            <label className="flex items-start gap-2 text-sm text-body">
              <input
                type="checkbox"
                checked={Boolean(fidelidadeAtiva)}
                onChange={alternarFidelidadeAtiva}
                disabled={carregandoFidelidade}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span>
                <span className="block font-medium text-heading">
                  Programa de fidelidade ativo
                </span>
                <span className="mt-1 block text-xs text-muted">
                  Cria uma pendência no admin quando a cliente completa a meta
                  de serviços, pra você lembrar de dar o brinde.
                </span>
              </span>
            </label>

            <div>
              <label
                htmlFor="fidelidade-meta-servicos"
                className="mb-1 block text-sm font-medium text-body"
              >
                Quantos serviços até o brinde
              </label>
              <input
                id="fidelidade-meta-servicos"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={fidelidadeMetaServicos}
                onChange={(e) => setFidelidadeMetaServicos(e.target.value)}
                onBlur={() => salvarFidelidade()}
                disabled={carregandoFidelidade || !fidelidadeAtiva}
                placeholder="10"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-body">
              <input
                type="checkbox"
                checked={Boolean(fidelidadeContaManutencao)}
                onChange={alternarFidelidadeContaManutencao}
                disabled={carregandoFidelidade}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span>
                <span className="block font-medium text-heading">
                  Manutenções contam pra meta
                </span>
                <span className="mt-1 block text-xs text-muted">
                  Se desligado, agendamentos de serviços de manutenção não
                  somam pra meta de fidelidade.
                </span>
              </span>
            </label>

            <div>
              <label
                htmlFor="fidelidade-descricao-brinde"
                className="mb-1 block text-sm font-medium text-body"
              >
                Descrição do brinde
              </label>
              <input
                id="fidelidade-descricao-brinde"
                type="text"
                value={fidelidadeDescricaoBrinde}
                onChange={(e) => setFidelidadeDescricaoBrinde(e.target.value)}
                onBlur={() => salvarFidelidade()}
                disabled={carregandoFidelidade}
                placeholder="Manicure simples grátis"
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {statusFidelidade === "salvando" && (
              <p className="text-xs text-muted">Salvando…</p>
            )}
            {statusFidelidade === "salvo" && !erroFidelidade && (
              <p className="text-xs font-medium text-green-600">Salvo ✓</p>
            )}
            {erroFidelidade && (
              <p className="text-xs text-red-600">{erroFidelidade}</p>
            )}
          </div>
        )}
      </div>

      {/* Subtítulo: Configurações — separa os blocos de regras de negócio
          (acima) dos blocos de identidade/integração do salão (abaixo).
          Primeiro divisor de seção da tela. */}
      <h2 className="pt-4 text-lg font-semibold text-heading">
        Configurações
      </h2>

      {/* Bloco: Equipe — atalho pra cadastrar profissional. O wizard de
          criação mora em GerenciarProfissionais (aba Profissionais); este
          botão só troca de aba e dispara ele remotamente (ver
          onCadastrarProfissional / gatilhoNovoProfissional em page.js). */}
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <p className="text-sm font-medium text-heading">Equipe</p>
        <p className="mt-1 text-xs text-muted">
          Adicione um novo profissional à equipe.
        </p>
        <button
          type="button"
          onClick={onCadastrarProfissional}
          className="mt-3 inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
        >
          Cadastrar novo profissional
        </button>
      </div>

      {/* Bloco: Google Calendar */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("googleCalendar")}
          aria-expanded={blocoAberto === "googleCalendar"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Google Calendar</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "googleCalendar" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "googleCalendar" && (
          <div className="border-t border-border p-4">
            {googleCalendarAtivo ? (
              <div>
                <p className="text-sm text-body">
                  Conectado como{" "}
                  <span className="font-medium text-heading">
                    {googleCalendarEmail}
                  </span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setModalImportarAberto(true)}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
                  >
                    Importar do Google Calendar
                  </button>
                  <button
                    type="button"
                    onClick={desconectarGoogleCalendar}
                    disabled={carregandoGoogleCalendar || desconectandoGoogleCalendar}
                    className="rounded-lg bg-border/60 px-3 py-2 text-sm font-medium text-heading transition disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {desconectandoGoogleCalendar ? "Desconectando…" : "Desconectar"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-muted">
                  Conecte sua conta Google pra sincronizar os agendamentos com
                  o Google Calendar.
                </p>
                <button
                  type="button"
                  onClick={conectarGoogleCalendar}
                  disabled={carregandoGoogleCalendar}
                  className="mt-3 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Conectar Google Calendar
                </button>
              </div>
            )}

            {erroGoogleCalendar && (
              <p className="mt-2 text-xs text-red-600">{erroGoogleCalendar}</p>
            )}
            {sucessoGoogleCalendar && (
              <p className="mt-2 text-xs font-medium text-green-600">{sucessoGoogleCalendar}</p>
            )}
          </div>
        )}
      </div>

      {/* Bloco: Localização — mesmo padrão visual/comportamental do acordeão
          de categorias em GerenciarServicos.js (cabeçalho com título + seta,
          conteúdo só renderizado quando expandido). */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("localizacao")}
          aria-expanded={blocoAberto === "localizacao"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Localização</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "localizacao" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "localizacao" && (
          <div className="border-t border-border p-4">
            <div>
              <label
                htmlFor="link-localizacao"
                className="mb-1 block text-sm font-medium text-body"
              >
                Link do Google Maps
              </label>
              <input
                id="link-localizacao"
                type="text"
                value={linkLocalizacao ?? ""}
                onChange={(e) => setLinkLocalizacao(e.target.value)}
                onBlur={salvarLinkLocalizacao}
                disabled={carregandoLinkLocalizacao}
                placeholder="https://maps.app.goo.gl/..."
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-muted">
                Cole o link de compartilhamento do Google Maps (ex:
                maps.app.goo.gl/...). Se vazio, o card de localização não
                aparece pra cliente.
              </p>
            </div>

            {statusLinkLocalizacao === "salvando" && (
              <p className="mt-2 text-xs text-muted">Salvando…</p>
            )}
            {statusLinkLocalizacao === "salvo" && !erroLinkLocalizacao && (
              <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
            )}
            {erroLinkLocalizacao && (
              <p className="mt-2 text-xs text-red-600">{erroLinkLocalizacao}</p>
            )}
          </div>
        )}
      </div>

      {/* Bloco: Foto de perfil */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
        <button
          type="button"
          onClick={() => alternarBloco("fotoPerfil")}
          aria-expanded={blocoAberto === "fotoPerfil"}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="font-semibold text-heading">Foto de perfil</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-body">
            {blocoAberto === "fotoPerfil" ? "▲" : "▼"}
          </span>
        </button>

        {blocoAberto === "fotoPerfil" && (
          <div className="border-t border-border p-4">
            {fotoPerfilUrl ? (
              <FotoPerfilCircular
                src={fotoPerfilUrl}
                posicao={`${fotoPerfilX}% ${fotoPerfilY}%`}
                zoom={fotoPerfilZoom}
                diametro={96}
                alt="Foto de perfil"
              />
            ) : (
              <div className="mb-6 flex justify-center">
                <div
                  className="flex items-center justify-center rounded-full bg-border/40 p-2 text-center text-xs text-muted ring-1 ring-border"
                  style={{ width: 96, height: 96 }}
                >
                  Nenhuma foto enviada ainda
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="foto-perfil-input"
                  className="mb-1 block text-sm font-medium text-body"
                >
                  Enviar nova foto
                </label>
                <input
                  id="foto-perfil-input"
                  type="file"
                  accept="image/*"
                  onChange={handleFotoPerfilChange}
                  disabled={carregandoFoto || enviandoFoto}
                  className="block w-full text-sm text-body file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:cursor-not-allowed disabled:opacity-60"
                />
                {enviandoFoto && (
                  <p className="mt-2 text-xs text-muted">Enviando…</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="foto-perfil-x"
                  className="mb-1 block text-sm font-medium text-body"
                >
                  Posição horizontal
                </label>
                <input
                  id="foto-perfil-x"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={fotoPerfilX}
                  onChange={(e) => setFotoPerfilX(Number(e.target.value))}
                  onMouseUp={() => salvarFotoPerfilPosicao()}
                  onTouchEnd={() => salvarFotoPerfilPosicao()}
                  onKeyUp={() => salvarFotoPerfilPosicao()}
                  disabled={carregandoFoto || !fotoPerfilUrl}
                  className="w-full disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor="foto-perfil-y"
                  className="mb-1 block text-sm font-medium text-body"
                >
                  Posição vertical
                </label>
                <input
                  id="foto-perfil-y"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={fotoPerfilY}
                  onChange={(e) => setFotoPerfilY(Number(e.target.value))}
                  onMouseUp={() => salvarFotoPerfilPosicao()}
                  onTouchEnd={() => salvarFotoPerfilPosicao()}
                  onKeyUp={() => salvarFotoPerfilPosicao()}
                  disabled={carregandoFoto || !fotoPerfilUrl}
                  className="w-full disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor="foto-perfil-zoom"
                  className="mb-1 block text-sm font-medium text-body"
                >
                  Zoom
                </label>
                <input
                  id="foto-perfil-zoom"
                  type="range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={fotoPerfilZoom}
                  onChange={(e) => setFotoPerfilZoom(Number(e.target.value))}
                  onMouseUp={() => salvarFotoPerfilPosicao()}
                  onTouchEnd={() => salvarFotoPerfilPosicao()}
                  onKeyUp={() => salvarFotoPerfilPosicao()}
                  disabled={carregandoFoto || !fotoPerfilUrl}
                  className="w-full disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>

            {statusFotoPosicao === "salvando" && (
              <p className="mt-2 text-xs text-muted">Salvando…</p>
            )}
            {statusFotoPosicao === "salvo" && !erroFoto && (
              <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
            )}
            {erroFoto && <p className="mt-2 text-xs text-red-600">{erroFoto}</p>}
          </div>
        )}
      </div>

    </div>

    <ModalImportarGoogleCalendar
      estabelecimento={estabelecimento}
      aberto={modalImportarAberto}
      onFechar={() => setModalImportarAberto(false)}
    />

    {/* Popup de confirmação ao reduzir a janela de agendamento com
        agendamentos reais além da nova data (ver aplicarJanela). "Voltar"
        fecha sem gravar nada. */}
    {confirmandoReducaoJanela && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-reduzir-janela"
        className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
        onClick={() => setConfirmandoReducaoJanela(null)}
      >
        <div
          className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="titulo-reduzir-janela"
            className="text-lg font-semibold text-heading"
          >
            Reduzir janela de agendamento
          </h2>
          <p className="mt-2 text-sm text-body">
            Existem{" "}
            <span className="font-medium text-heading">
              {confirmandoReducaoJanela.contagem}
            </span>{" "}
            agendamento{confirmandoReducaoJanela.contagem === 1 ? "" : "s"}{" "}
            confirmado{confirmandoReducaoJanela.contagem === 1 ? "" : "s"} além
            dessa nova data — eles não serão cancelados automaticamente, mas
            você vai precisar tratá-los manualmente. Deseja continuar?
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              onClick={() =>
                aplicarJanela(confirmandoReducaoJanela.novaData, {
                  pulaConfirmacao: true,
                })
              }
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
            >
              Continuar
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoReducaoJanela(null)}
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
