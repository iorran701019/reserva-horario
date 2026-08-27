"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { buscarEstabelecimento } from "@/lib/estabelecimento";
import { buscarTema } from "@/lib/temas";
import { precisaAnamnese } from "@/lib/anamnese";
import { buscarAgendamentosAtivos } from "@/lib/agendamentosCliente";
import { classificarAgendamento } from "@/lib/particao";
import Hero from "@/components/Hero";
import RodapePagina from "@/components/RodapePagina";
import IdentificacaoCliente from "@/components/IdentificacaoCliente";
import FormularioAnamnese from "@/components/FormularioAnamnese";
import PainelCliente from "@/components/PainelCliente";
import ConfirmacaoSinal from "@/components/ConfirmacaoSinal";
import TelaSolicitacaoEnviada from "@/components/TelaSolicitacaoEnviada";
import FormularioAgendamento from "@/components/FormularioAgendamento";
import FotoPerfilCircular from "@/components/FotoPerfilCircular";
import { lerFatia, salvarFatia, limparFatia } from "@/lib/persistenciaAgendamento";
import { useVoltarFisico } from "@/lib/voltarFisico";

// Reserva que deve levar DIRETO ao ConfirmacaoSinal, pulando o PainelCliente
// — a cliente que voltou pra pagar o sinal não deveria ter que achar o botão
// "Confirmar pagamento" dentro do painel. Devolve null (= painel normal) só
// quando não há NENHUM aguardando_sinal vigente.
//
// Não existe mais trava de exclusividade: o que a cliente tem marcado ao
// redor (um corte já confirmado pra semana que vem, por exemplo) não muda o
// fato de que existe um sinal esperando por ela, e era isso que a versão
// antiga fazia — bastava um confirmado na lista pra ela cair no painel e ter
// que caçar o botão. O painel continua a um clique daqui ("Ver meus
// agendamentos").
//
// Descarta o que classificarAgendamento já considera histórico (o status cru
// não vira histórico sozinho quando o horário passa — mesma regra do
// PainelCliente): sem isso, um aguardando_sinal caducado prenderia a cliente
// numa tela de pagamento de reserva que nem existe mais.
//
// Havendo mais de um, vai o mais próximo por data/horário.
function reservaAguardandoSinal(lista) {
  if (!lista || lista.length === 0) return null;

  const agora = new Date();
  const emSinal = lista.filter(
    (item) =>
      classificarAgendamento(item, agora) !== "historico" &&
      item.status === "aguardando_sinal"
  );
  if (emSinal.length === 0) return null;

  return emSinal.sort((a, b) =>
    `${a.data} ${a.horario}`.localeCompare(`${b.data} ${b.horario}`)
  )[0];
}

// Por quanto tempo, depois de o agendamento entrar em "pendente"
// (agendamentos.pendente_desde), a cliente que volta ao link do salão ainda
// cai na tela de protocolo em vez do painel. É a janela em que "eu acabei de
// pedir" ainda é a informação mais útil pra ela; passada essa janela, a
// solicitação vira só mais uma linha do painel. Constante local de propósito
// — se algum dia virar configuração por salão, o lugar de ler é aqui.
const PENDENTE_PROTOCOLO_HORAS = 24;

// Este pendente ainda está dentro da janela de protocolo? Sem pendente_desde
// (linhas anteriores à coluna, ou um pendente que nunca passou pelo fluxo
// novo) a resposta é NÃO: painel normal, que é o comportamento de sempre.
function dentroDaJanelaProtocolo(item, agora) {
  if (!item.pendente_desde) return false;
  const desde = new Date(item.pendente_desde).getTime();
  if (Number.isNaN(desde)) return false;
  return agora.getTime() - desde < PENDENTE_PROTOCOLO_HORAS * 60 * 60 * 1000;
}

// Irmã de reservaAguardandoSinal, um degrau adiante do fluxo: a solicitação
// recém-enviada que deve levar DIRETO à tela de protocolo
// (TelaSolicitacaoEnviada), pulando o PainelCliente. Mesma mudança da irmã —
// sem trava de exclusividade: outros agendamentos ativos ao redor não apagam
// o fato de que ela acabou de pedir um horário e ainda está esperando
// resposta. Um pendente FORA da janela também não atrapalha mais os outros:
// só ele deixa de contar, em vez de derrubar a tela inteira pro painel.
//
// Descarta o que classificarAgendamento já considera histórico, pelo mesmo
// motivo de lá: um pendente cujo horário já passou não deve prender a cliente
// numa tela de "aguarde a confirmação".
function reservaEmProtocolo(lista) {
  if (!lista || lista.length === 0) return null;

  const agora = new Date();
  const emProtocolo = lista.filter(
    (item) =>
      classificarAgendamento(item, agora) !== "historico" &&
      item.status === "pendente" &&
      dentroDaJanelaProtocolo(item, agora)
  );
  if (emProtocolo.length === 0) return null;

  return emProtocolo.sort((a, b) =>
    `${a.data} ${a.horario}`.localeCompare(`${b.data} ${b.horario}`)
  )[0];
}

// Página pública de agendamento. A lógica do wizard (serviço, slots, ocupados,
// validação, insert) mora em FormularioAgendamento; aqui ficam só o layout e a
// tela de confirmação. O insert NÃO passa `status`, então o banco aplica o
// default "pendente" — comportamento histórico do fluxo público.
//
// Multi-tenant pela rota dinâmica /[salon]: o slug vem do PATH (useParams) e
// resolvemos o estabelecimento ANTES de montar o wizard. Slug inexistente cai
// em "Salão não encontrado". O nome e o WhatsApp da tela saem de estab.nome /
// estab.whatsapp.
export default function AgendarPage() {
  // Slug do salão no path (/[salon]). Fonte única do tenant nesta página.
  const { salon } = useParams();

  // Estabelecimento resolvido pelo slug do path: undefined = ainda resolvendo;
  // null = slug inexistente/inativo; objeto = encontrado.
  const [estabelecimento, setEstabelecimento] = useState(undefined);

  // Resumo do agendamento concluído (null = ainda no formulário). Os dados vêm
  // do callback onSucesso; ao desmontar/remontar o formulário, ele zera sozinho.
  const [resumo, setResumo] = useState(null);

  // Cliente identificado pela IdentificacaoCliente (null = ainda não passou por
  // ela). Persiste entre agendamentos da mesma visita, então um novo
  // agendamento (após "Fazer novo agendamento") não pede o WhatsApp de novo.
  // Restaurado do sessionStorage (ver lib/persistenciaAgendamento) num reload
  // real da página — chave pelo slug da ROTA (síncrono via useParams, ao
  // contrário de estabelecimento.id, que só resolve depois do fetch abaixo).
  // Não precisa de revalidação especial aqui: os dois efeitos logo abaixo já
  // rebuscam agendamentosAtivos/anamneseNecessaria ao vivo assim que
  // clienteIdentificado (restaurado ou não) e estabelecimento.id existem —
  // é assim que a sub-tela certa (painel/anamnese/wizard) reaparece com
  // dado FRESCO do banco, nunca uma tela de resumo estática.
  const [clienteIdentificado, setClienteIdentificado] = useState(() =>
    lerFatia(salon, "clienteIdentificado")
  );
  // Etapa interna do IdentificacaoCliente ("telefone" | "confirmar" |
  // "cadastroSimples" | "completarEndereco") — só usada aqui pra decidir
  // quando a FotoPerfilCircular deve aparecer (ver uso abaixo). Só é
  // atualizada pelo onEtapaChange de IdentificacaoCliente — que só monta
  // enquanto !clienteIdentificado. Com o cliente restaurado já identificado
  // do sessionStorage (reload real, ver clienteIdentificado acima),
  // IdentificacaoCliente nunca monta e esse sync nunca dispara: sem nascer
  // resolvido aqui, o default "telefone" ficaria preso pro resto da sessão,
  // vazando a foto (com o diametro da caixa do PASSO ATUAL, não da tela de
  // telefone) pro Painel/Anamnese/wizard. null nasce != "telefone", então a
  // condição da linha abaixo já resolve sem precisar tocar nela.
  const [etapaIdentificacao, setEtapaIdentificacao] = useState(() =>
    lerFatia(salon, "clienteIdentificado") ? null : "telefone"
  );

  // null = ainda checando (ou cliente ainda não identificado); true = precisa
  // preencher a anamnese antes do wizard; false = anamnese em dia, segue
  // direto pro FormularioAgendamento. Verificado assim que o cliente é
  // identificado (novo cadastro OU já existente com anamnese vencida).
  const [anamneseNecessaria, setAnamneseNecessaria] = useState(null);
  // true só depois que FormularioAnamnese avisa (via onVisivel) que carregou
  // um modelo REAL e está de fato mostrando o formulário — nunca no
  // flash-through de "sem modelo ativo" (anamneseNecessaria vira true,
  // FormularioAnamnese monta, mas modelo resolve null e ele já conclui
  // sozinho antes de mostrar qualquer coisa). Usado só pra gatear o voltar
  // físico da anamnese (ver useVoltarFisico abaixo) — sem isso, esse
  // flash-through empurraria uma entrada de histórico nunca consumida.
  // Resetado a false sempre que anamneseNecessaria deixa de ser true.
  const [anamneseVisivel, setAnamneseVisivel] = useState(false);
  // Ajuste durante a renderização (não um efeito — mesmo padrão já usado em
  // FormularioAgendamento.js pra `carregandoServicosAnterior`): dispara só na
  // transição de valor de `anamneseNecessaria` entre uma renderização e a
  // seguinte, comparando com `anamneseNecessariaAnterior`.
  const [anamneseNecessariaAnterior, setAnamneseNecessariaAnterior] = useState(
    anamneseNecessaria
  );
  if (anamneseNecessaria !== anamneseNecessariaAnterior) {
    setAnamneseNecessariaAnterior(anamneseNecessaria);
    if (anamneseNecessaria !== true) setAnamneseVisivel(false);
  }

  // Agendamentos ativos do cliente identificado (null = ainda não checado;
  // array = carregado). Se houver algum, o PainelCliente aparece antes do
  // wizard. modoNovoAgendamento força o fluxo normal mesmo com agendamentos
  // ativos, quando o cliente escolhe "Novo agendamento" no painel.
  const [agendamentosAtivos, setAgendamentosAtivos] = useState(null);
  // Nasce true se sobrou rascunho de anamnese OU de agendamento com conteúdo
  // de verdade no sessionStorage (ver lib/persistenciaAgendamento) — sinal
  // de que a cliente já tinha escolhido "novo agendamento" antes do reload,
  // mesmo tendo agendamentos ativos (senão o PainelCliente reapareceria por
  // cima do wizard em andamento). Exige CONTEÚDO (não só a fatia existir):
  // FormularioAnamnese só grava com um modelo carregado, mas um
  // estabelecimento sem serviço/data/resposta ainda escolhidos não deve
  // acionar isso. FormularioAnamnese/FormularioAgendamento revalidam o
  // próprio conteúdo restaurado contra o banco por conta própria — aqui só
  // decidimos QUAL tela mostrar.
  const [modoNovoAgendamento, setModoNovoAgendamento] = useState(() => {
    const anamnese = lerFatia(salon, "anamnese");
    const temAnamnesePendente = Boolean(
      anamnese &&
        (Object.keys(anamnese.respostas ?? {}).length > 0 || anamnese.aceite)
    );
    const agendamento = lerFatia(salon, "agendamento");
    const temAgendamentoPendente = agendamento?.servicoId != null;
    return temAnamnesePendente || temAgendamentoPendente;
  });

  // True depois que a cliente sai da confirmação de sinal automática (botão
  // "Ver meus agendamentos") sem ter confirmado — sem isso ela voltaria pra
  // mesma tela na hora, já que agendamentosAtivos continua igual. Não
  // persiste: um reload legitimamente reabre a confirmação.
  const [confirmacaoSinalPulada, setConfirmacaoSinalPulada] = useState(false);

  // Irmão do acima, pra tela de protocolo: true depois que a cliente clica
  // "Ver meus agendamentos" nela. Sem isso ela voltaria pra mesma tela na
  // hora, já que agendamentosAtivos continua igual. Também não persiste — um
  // reload dentro da janela legitimamente reabre o protocolo.
  const [protocoloPulado, setProtocoloPulado] = useState(false);

  // Agendamento JÁ existente que a cliente pediu pra editar (botão "Editar"
  // das telas de Pix e de protocolo). Havendo, o wizard monta em modo edição
  // (ver agendamentoEmEdicao em FormularioAgendamento) e passa a tratá-lo
  // como a reserva provisória ativa: trocar de horário cai no cancela-e-recria
  // que já existe lá, e sair sem trocar nada deixa o original intacto.
  const [agendamentoEditando, setAgendamentoEditando] = useState(null);

  // Serviço de manutenção escolhido no card de sugestão do PainelCliente
  // (null = fluxo normal). Repassado como `servicoInicial` pro
  // FormularioAgendamento pular a etapa de escolha de serviço.
  const [servicoManutencao, setServicoManutencao] = useState(null);

  // Incrementado ao "Fazer novo agendamento" pra forçar o useEffect abaixo a
  // rebuscar mesmo com clienteIdentificado/estabelecimento.id inalterados.
  const [agendamentosVersao, setAgendamentosVersao] = useState(0);

  // Profissional ativo de menor id, usado como "responsável" tanto no botão
  // fixo ContatoDono quanto no texto do bloco de sinal do
  // FormularioAgendamento — buscado uma única vez aqui pra não duplicar a
  // query nos dois lugares. null = carregando ou nenhum ativo (cai em "a
  // equipe").
  const [nomeProfissionalContato, setNomeProfissionalContato] = useState(null);

  // Grava o cliente identificado a cada mudança, pra sobreviver a um reload
  // real da página (ver lib/persistenciaAgendamento). Nunca limpa aqui: sem
  // um fluxo de "trocar de cliente"/logout, o único jeito de zerar
  // clienteIdentificado seria perder o estado em memória de qualquer forma
  // (reload), e nesse caso é exatamente isso que queremos restaurar.
  useEffect(() => {
    if (!salon || !clienteIdentificado) return;
    salvarFatia(salon, "clienteIdentificado", clienteIdentificado);
  }, [salon, clienteIdentificado]);

  useEffect(() => {
    if (!clienteIdentificado) return;
    let ativo = true;
    precisaAnamnese(clienteIdentificado.id, estabelecimento?.id).then(
      (necessaria) => {
        if (ativo) setAnamneseNecessaria(necessaria);
      }
    );
    return () => {
      ativo = false;
    };
  }, [clienteIdentificado, estabelecimento?.id]);

  useEffect(() => {
    if (!clienteIdentificado || !estabelecimento?.id) return;
    let ativo = true;
    buscarAgendamentosAtivos(
      estabelecimento.id,
      clienteIdentificado.telefone.replace(/\D/g, "")
    ).then((lista) => {
      if (ativo) setAgendamentosAtivos(lista);
    });
    return () => {
      ativo = false;
    };
  }, [clienteIdentificado, estabelecimento?.id, agendamentosVersao]);

  // Resolve o estabelecimento pelo slug do path ao montar (ou se o slug mudar).
  useEffect(() => {
    let ativo = true;
    buscarEstabelecimento(salon).then((estab) => {
      if (ativo) setEstabelecimento(estab);
    });
    return () => {
      ativo = false;
    };
  }, [salon]);

  // Busca o profissional ativo de menor id assim que o estabelecimento
  // resolve, pra alimentar ContatoDono e o texto do bloco de sinal.
  useEffect(() => {
    if (!estabelecimento?.id) return;
    let ativo = true;
    supabase
      .from("profissionais")
      .select("nome")
      .eq("estabelecimento_id", estabelecimento.id)
      .eq("ativo", true)
      .order("id", { ascending: true })
      .limit(1)
      .then(({ data }) => {
        if (ativo) setNomeProfissionalContato(data?.[0]?.nome ?? null);
      });
    return () => {
      ativo = false;
    };
  }, [estabelecimento?.id]);

  const nomeContatoExibido = nomeProfissionalContato ?? "a equipe";

  // Atalho pro pagamento do sinal: quando TUDO que a cliente tem ativo está
  // aguardando_sinal, ela cai direto no ConfirmacaoSinal em vez do
  // PainelCliente (ver reservaAguardandoSinal). modoNovoAgendamento tem
  // precedência — ela já escolheu abrir o wizard, não sequestramos isso.
  const agendamentoSinal =
    modoNovoAgendamento || confirmacaoSinalPulada || agendamentoEditando
      ? null
      : reservaAguardandoSinal(agendamentosAtivos);

  // Mesmo atalho, um degrau adiante: a solicitação recém-enviada (pendente
  // dentro da janela, ver reservaEmProtocolo) reabre a tela de protocolo em
  // vez do painel — a cliente que volta ao link no mesmo dia quer ver "já
  // pedi, aguarde", com Editar/Cancelar à mão. Mesmas precedências do irmão
  // acima.
  const agendamentoProtocolo =
    modoNovoAgendamento || protocoloPulado || agendamentoEditando
      ? null
      : reservaEmProtocolo(agendamentosAtivos);

  // onVoltarInicio do FormularioAgendamento (etapa "dados" do fluxo
  // público): a reserva já foi gravada de verdade ao entrar em "dados" (ver
  // selecionarHorario) e não pode ser cancelada/alterada por aqui — só a UI
  // volta pro início do fluxo (IdentificacaoCliente, etapa "telefone"),
  // remontada do zero. limparFatia evita que um reload LOGO DEPOIS deste
  // reset restaure o clienteIdentificado antigo do sessionStorage (ver
  // useState inicial de clienteIdentificado, acima) — a fatia "agendamento"
  // (servico/data/horario/reservaId) continua intacta de propósito: se a
  // cliente se identificar de novo com o MESMO WhatsApp, a restauração de
  // sessão que já existe em FormularioAgendamento reconecta sozinha na MESMA
  // reserva, sem duplicar. Mesmo reset de estados que "Fazer novo
  // agendamento" já faz (ver botão na tela de resumo, abaixo), pra não
  // flashar dado velho quando ela se identificar de novo.
  function voltarParaIdentificacao() {
    limparFatia(salon, "clienteIdentificado");
    setClienteIdentificado(null);
    setAgendamentosAtivos(null);
    setAnamneseNecessaria(null);
    setModoNovoAgendamento(false);
    setServicoManutencao(null);
    setConfirmacaoSinalPulada(false);
    setProtocoloPulado(false);
    setAgendamentoEditando(null);
  }

  // Sai da tela de protocolo/Pix rumo ao wizard limpo ("Fazer novo
  // agendamento") ou ao painel ("Ver meus agendamentos"). Os dois zeram o
  // resumo e rebuscam a lista, pra próxima tela nunca decidir em cima de
  // dado velho; a diferença é só qual das duas telas fica de pé depois.
  function recomecarFluxo({ paraOWizard }) {
    setResumo(null);
    setAgendamentoEditando(null);
    setServicoManutencao(null);
    setModoNovoAgendamento(paraOWizard);
    setProtocoloPulado(!paraOWizard);
    setConfirmacaoSinalPulada(!paraOWizard);
    setAgendamentosAtivos(null);
    setAgendamentosVersao((v) => v + 1);
  }

  // Submit final do wizard, nos dois modos (novo e edição): mostra a tela de
  // protocolo com o que acabou de ser gravado. Sair do modo edição aqui é
  // obrigatório — senão o "Fazer novo agendamento" da tela de protocolo
  // voltaria pro wizard de edição da reserva antiga.
  function concluirWizard(dados) {
    setAgendamentoEditando(null);
    setResumo(dados);
  }

  // Saída do modo edição SEM confirmar (voltar em tela ou físico). Rebuscar a
  // lista é obrigatório, não zelo: o modo edição pode ter trocado o horário
  // pelo caminho, e trocar cancela a linha antiga e cria outra
  // (selecionarHorario). Sem isso a régua de telas decidiria em cima da lista
  // carregada ANTES da edição e reabriria o protocolo do agendamento que
  // acabou de ser cancelado. O agendamento em si não é tocado aqui — quem
  // sai sem escolher outro horário volta pra ele intacto.
  function sairDaEdicao() {
    setAgendamentoEditando(null);
    setAgendamentosAtivos(null);
    setAgendamentosVersao((v) => v + 1);
  }

  // Entra em modo edição a partir de uma tela de agendamento existente (Pix,
  // protocolo pós-submit ou protocolo reaberto). Zera `resumo` junto: ele tem
  // precedência sobre a régua de telas lá embaixo, então sem isso a tela de
  // protocolo continuaria por cima do wizard que acabamos de pedir.
  function editarAgendamento({ id, servicoId, data, horario, profissionalId }) {
    setResumo(null);
    setAgendamentoEditando({ id, servicoId, data, horario, profissionalId });
  }

  // Depois de um cancelamento bem-sucedido (telas de Pix e de protocolo): não
  // há mais o que mostrar sobre aquele agendamento, então volta pro estado
  // neutro e deixa a régua de telas decidir de novo com a lista fresca —
  // painel (se sobrou algo) ou wizard.
  function aposCancelamento() {
    setResumo(null);
    setAgendamentoEditando(null);
    setServicoManutencao(null);
    setModoNovoAgendamento(false);
    setProtocoloPulado(false);
    setConfirmacaoSinalPulada(false);
    setAgendamentosAtivos(null);
    setAgendamentosVersao((v) => v + 1);
  }

  // Voltar físico (ou bubbling de onVoltarAntes do FormularioAgendamento, ver
  // etapa "servico") de anamnese/serviço pra "o que vinha logo antes do
  // wizard": PainelCliente, se a cliente chegou até aqui clicando "Novo
  // agendamento" nele (agendamentosAtivos ainda reflete isso, não é resetado
  // por modoNovoAgendamento); senão, Identificação. Não depende de
  // anamneseNecessaria pra decidir — uma vez que a anamnese foi
  // respondida/pulada, ela nunca reabre sozinha por aqui (ver decisão
  // registrada na conversa: reabrir arriscaria reenviar anamnese_respostas
  // duplicada, já que o insert não faz upsert). Por isso serve tanto pro
  // voltar DE anamnese (ainda não submetida) quanto DE "servico" (anamnese já
  // resolvida, se existiu) — mesmo destino nos dois casos.
  function voltarAntesDoWizard() {
    if (agendamentosAtivos && agendamentosAtivos.length > 0) {
      setModoNovoAgendamento(false);
      setServicoManutencao(null);
    } else {
      voltarParaIdentificacao();
    }
  }

  // Altura ao vivo da caixa de identificação/wizard, usada como diâmetro do
  // círculo de foto de perfil — ver FotoPerfilCircular. Ref em callback (não
  // useRef) porque esse `div` só existe depois que o estabelecimento resolve
  // e não há resumo — um useEffect com [] rodaria antes dele montar e nunca
  // reconectaria o observer. ResizeObserver em vez de medir uma vez porque a
  // altura muda de etapa pra etapa (telefone -> confirmar -> wizard...).
  const [caixaEl, setCaixaEl] = useState(null);
  const [alturaCaixa, setAlturaCaixa] = useState(0);
  useLayoutEffect(() => {
    if (!caixaEl) return;
    const medir = () => setAlturaCaixa(caixaEl.getBoundingClientRect().height);
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(caixaEl);
    return () => observer.disconnect();
  }, [caixaEl]);

  // Botão físico "voltar" na etapa anamnese: só arma depois que ela está
  // REALMENTE visível (ver anamneseVisivel acima) — evita empurrar uma
  // entrada de histórico durante o flash-through de "sem modelo ativo".
  // Antes dos returns condicionais abaixo — hooks não podem vir depois deles.
  const voltarFisicoAnamnese = useVoltarFisico(
    voltarAntesDoWizard,
    anamneseNecessaria === true && anamneseVisivel,
    "anamnese"
  );

  // Sucesso da anamnese (submit real): troca FormularioAnamnese pelo wizard
  // inteiro (page.js muda de branch de renderização) — precisa consumir a
  // entrada empurrada por ela mesma antes de sair, senão fica órfã (mesmo
  // raciocínio de IdentificacaoCliente, ver handleConfirmarSim/
  // handleSubmitSimples/onCadastrado). SÓ quando anamneseVisivel: no
  // flash-through de "sem modelo ativo" nada foi empurrado (o gate acima
  // nunca armou), então chamar a função de consumo cairia no fallback dela
  // (chama voltarAntesDoWizard DIRETO, indo pra Painel/Identificação em vez
  // de seguir pro wizard) — errado nesse caso.
  function concluirAnamnese() {
    if (anamneseVisivel) voltarFisicoAnamnese();
    setAnamneseNecessaria(false);
  }

  // Enquanto resolve o estabelecimento, segura a tela (evita piscar o wizard).
  if (estabelecimento === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  // Slug inexistente ou salão inativo: mensagem clara, sem wizard.
  if (estabelecimento === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h1 className="text-2xl font-bold text-heading">Salão não encontrado</h1>
          <p className="mt-2 text-sm text-body">
            Verifique o link de agendamento e tente novamente.
          </p>
        </div>
      </main>
    );
  }

  // Tema por salão (lib/temas.js), gate único pra árvore INTEIRA da página:
  // sobrescrevemos aqui as CSS custom properties que os componentes já leem
  // via classe Tailwind (bg-primary, hover:bg-primary-hover, text-heading,
  // ring-border/border-border) + as duas usadas pro texto/borda secundários
  // (text-body, text-muted — calendário, "Voltar", histórico). Qualquer
  // componente descendente que já usa esses tokens herda a cor certa
  // automaticamente — não precisa (nem deve) ler `tema` sozinho pra isso.
  // Sem tema.personalizado (todo o resto, incl. um 3º tenant sem identidade
  // própria), nada é sobrescrito e a paleta marrom global segue intacta.
  const tema = buscarTema(estabelecimento.slug);
  const temaAtivo = tema?.personalizado ? tema : null;
  const estiloTemaRaiz = temaAtivo
    ? {
        ...(temaAtivo.bgBody ? { backgroundColor: temaAtivo.bgBody } : {}),
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

  // Tela de protocolo LOGO APÓS o submit do wizard. O card em si mora em
  // TelaSolicitacaoEnviada — o mesmo componente que a régua de telas abaixo
  // reabre quando a cliente volta ao link dentro da janela de protocolo (ver
  // agendamentoProtocolo). `resumo` traz o que o wizard acabou de gravar,
  // incluindo o id da linha, que é o que habilita Editar/Cancelar aqui.
  if (resumo) {
    const { form, servico, horario, agendamentoId } = resumo;
    return (
      <main
        className="flex min-h-screen flex-col bg-surface"
        style={estiloTemaRaiz}
      >
        <Hero compacto nome={estabelecimento.nome} slug={estabelecimento.slug} />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
          <TelaSolicitacaoEnviada
            estabelecimento={estabelecimento}
            agendamentoId={agendamentoId ?? null}
            servicoNome={servico?.nome}
            data={form.data}
            horario={horario}
            nomeCliente={form.nome}
            onNovoAgendamento={() => recomecarFluxo({ paraOWizard: true })}
            onVerAgendamentos={() => recomecarFluxo({ paraOWizard: false })}
            onEditar={() =>
              editarAgendamento({
                id: agendamentoId,
                servicoId: servico?.id ?? null,
                data: form.data,
                horario,
                profissionalId: resumo.profissional?.id ?? null,
              })
            }
            onCancelado={aposCancelamento}
          />
        </div>
        <RodapePagina estabelecimento={estabelecimento} nome={nomeContatoExibido} />
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-surface"
      style={estiloTemaRaiz}
    >
      <Hero nome={estabelecimento.nome} slug={estabelecimento.slug} />
      {/* pt reduzido é o padrão pra TODOS os tenants agora — distância entre
          o fim do Hero e "Agende seu horário" enxuta por padrão, não só pra
          quem tem headerCompacto (esse flag continua valendo pros outros
          ajustes de padding do Hero, que são independentes). pb segue igual
          ao original, pra não mexer no respiro antes do ContatoDono no fim
          da página. */}
      <div className="mx-auto w-full max-w-md px-4 pt-3.5 pb-10 sm:pt-6 sm:pb-16">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-heading">Agende seu horário</h1>
          <p className="mt-1 text-sm text-body">
            Seu atendimento começa aqui.
          </p>
        </header>

        {/* Só na primeira etapa (identificação por WhatsApp) — nas etapas
            seguintes (painel, anamnese, formulário) a foto some. Isso inclui
            as 3 etapas internas do IdentificacaoCliente além de "telefone"
            (confirmar/cadastroSimples/completarEndereco), que também não são
            "identificado" ainda mas já não devem mostrar a foto. */}
        {etapaIdentificacao === "telefone" && (
          <FotoPerfilCircular
            src={estabelecimento.foto_perfil_url}
            posicao={estabelecimento.foto_perfil_posicao}
            zoom={estabelecimento.foto_perfil_zoom ?? 1}
            diametro={alturaCaixa}
            alt={`Foto de ${estabelecimento.nome}`}
          />
        )}

        {/* Antes do wizard: identifica o cliente pelo WhatsApp e, se a
            anamnese estiver vencida (ou nunca ter sido preenchida), cobra ela
            também. Só então monta o FormularioAgendamento, já com
            clienteInicial preenchido — a etapa "dados" dele vira um resumo em
            vez de pedir nome/WhatsApp de novo. */}
        <div ref={setCaixaEl}>
          {!clienteIdentificado ? (
            <IdentificacaoCliente
              slug={salon}
              estabelecimentoId={estabelecimento.id}
              cadastroCompleto={Boolean(estabelecimento.cadastro_completo)}
              exigirEndereco={estabelecimento.exigir_endereco !== false}
              estabelecimentoWhatsapp={estabelecimento.whatsapp}
              nomeContato={nomeContatoExibido}
              msgFalhaCadastro={estabelecimento.msg_falha_cadastro}
              onIdentificado={setClienteIdentificado}
              onEtapaChange={setEtapaIdentificacao}
            />
          ) : agendamentosAtivos === null ? (
            <p className="text-sm text-body">Carregando...</p>
          ) : agendamentoEditando ? (
            // Modo edição: o MESMO wizard de sempre, semeado com a reserva
            // existente (ver agendamentoEmEdicao em FormularioAgendamento) —
            // ele passa a tratá-la como a reserva provisória ativa, então
            // trocar de horário cai no cancela-e-recria já testado. Os dois
            // caminhos de "voltar" (etapa "servico" e etapa "dados") só saem
            // do modo edição: nenhum deles toca no agendamento, que fica
            // intacto se ela desistir.
            <FormularioAgendamento
              estabelecimento={estabelecimento}
              clienteInicial={clienteIdentificado}
              clienteEhNovo={clienteIdentificado?.clienteNovo ?? false}
              nomeProfissionalContato={nomeContatoExibido}
              agendamentoEmEdicao={agendamentoEditando}
              onSucesso={concluirWizard}
              onVoltarInicio={sairDaEdicao}
              onVoltarAntes={sairDaEdicao}
              onCancelado={aposCancelamento}
            />
          ) : agendamentoSinal ? (
            // Só falta o sinal: pula o painel e já abre a confirmação, com o
            // mesmo componente que o botão "Confirmar pagamento" do painel
            // usa. O envelope (card arredondado) é o mesmo que o
            // PainelCliente aplica na sua sub-tela, pra não mudar o visual
            // conforme o caminho de entrada.
            <div className="space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border">
              <ConfirmacaoSinal
                agendamentoId={agendamentoSinal.id}
                estabelecimento={estabelecimento}
                nomeProfissionalContato={nomeContatoExibido}
                rotuloVoltar="Ver meus agendamentos"
                agendamento={agendamentoSinal}
                nomeCliente={clienteIdentificado.nome}
                onConfirmado={() => {
                  // Reflete o novo status na lista em memória — com
                  // pendente_desde de AGORA, que é o que acabou de ser
                  // gravado: sem nenhum aguardando_sinal sobrando, a próxima
                  // render cai sozinha na tela de protocolo (ver
                  // agendamentoProtocolo).
                  setAgendamentosAtivos((anterior) =>
                    (anterior ?? []).map((a) =>
                      a.id === agendamentoSinal.id
                        ? {
                            ...a,
                            status: "pendente",
                            pendente_desde: new Date().toISOString(),
                          }
                        : a
                    )
                  );
                }}
                onVoltar={() => setConfirmacaoSinalPulada(true)}
                onEditar={() =>
                  editarAgendamento({
                    id: agendamentoSinal.id,
                    servicoId: agendamentoSinal.servico_id,
                    data: agendamentoSinal.data,
                    horario: String(agendamentoSinal.horario).slice(0, 5),
                    profissionalId: agendamentoSinal.profissional_id ?? null,
                  })
                }
                onCancelado={aposCancelamento}
              />
            </div>
          ) : agendamentoProtocolo ? (
            // Solicitação recém-enviada e ainda dentro da janela de protocolo:
            // reabre a MESMA tela de "Solicitação enviada!" do pós-submit, com
            // Editar/Cancelar à mão e a saída pro painel. Mesmo envelope das
            // outras sub-telas desta caixa.
            <TelaSolicitacaoEnviada
              estabelecimento={estabelecimento}
              agendamentoId={agendamentoProtocolo.id}
              servicoNome={agendamentoProtocolo.servicos?.nome ?? "Serviço"}
              data={agendamentoProtocolo.data}
              horario={String(agendamentoProtocolo.horario).slice(0, 5)}
              nomeCliente={clienteIdentificado.nome}
              onVerAgendamentos={() => setProtocoloPulado(true)}
              onEditar={() =>
                editarAgendamento({
                  id: agendamentoProtocolo.id,
                  servicoId: agendamentoProtocolo.servico_id,
                  data: agendamentoProtocolo.data,
                  horario: String(agendamentoProtocolo.horario).slice(0, 5),
                  profissionalId: agendamentoProtocolo.profissional_id ?? null,
                })
              }
              onCancelado={aposCancelamento}
            />
          ) : agendamentosAtivos.length > 0 && !modoNovoAgendamento ? (
            <PainelCliente
              estabelecimento={estabelecimento}
              cliente={clienteIdentificado}
              onNovoAgendamento={(servico) => {
                setServicoManutencao(servico ?? null);
                setModoNovoAgendamento(true);
              }}
              nomeProfissionalContato={nomeContatoExibido}
              onEditarAgendamento={editarAgendamento}
            />
          ) : anamneseNecessaria === null ? (
            <p className="text-sm text-body">Carregando...</p>
          ) : anamneseNecessaria ? (
            <FormularioAnamnese
              slug={salon}
              estabelecimentoId={estabelecimento.id}
              clienteId={clienteIdentificado.id}
              onConcluido={concluirAnamnese}
              onVisivel={() => setAnamneseVisivel(true)}
            />
          ) : (
            // Sem prop `status`: o insert mantém o default "pendente" do banco.
            <FormularioAgendamento
              estabelecimento={estabelecimento}
              clienteInicial={clienteIdentificado}
              clienteEhNovo={clienteIdentificado?.clienteNovo ?? false}
              nomeProfissionalContato={nomeContatoExibido}
              servicoInicial={servicoManutencao}
              onSucesso={concluirWizard}
              onVoltarInicio={voltarParaIdentificacao}
              onVoltarAntes={voltarAntesDoWizard}
              onCancelado={aposCancelamento}
            />
          )}
        </div>
      </div>
      <RodapePagina estabelecimento={estabelecimento} nome={nomeContatoExibido} />
    </main>
  );
}
