import { supabase } from "@/lib/supabaseClient";
import {
  classificarAgendamento,
  ehAgendamentoConfirmadoFuturo,
  STATUS_SUCESSO,
} from "@/lib/particao";
import { linkWhatsApp, MENSAGEM_CANCELAMENTO_CLIENTE } from "@/lib/whatsapp";
import { normalizarWhatsapp } from "@/lib/whatsappValidacao";

// As RPCs de leitura (sql/rpcs_leitura_cliente.sql) devolvem o nome do serviço
// numa coluna plana (`servico_nome`), porque uma função SQL não tem como
// montar o objeto aninhado que o `servicos(nome)` do PostgREST montava. Esta
// função remonta esse objeto na saída, pra que as telas continuem lendo
// `item.servicos?.nome` sem nenhuma mudança. `null` quando não há serviço
// (agendamento importado do Google Calendar tem servico_id nulo) — mesmo
// valor que o PostgREST devolvia nesse caso.
function comServicoAninhado({ servico_nome, ...resto }) {
  return {
    ...resto,
    servicos: servico_nome == null ? null : { nome: servico_nome },
  };
}

// Agendamentos ATIVOS (pendente ou confirmado) de um cliente num salão,
// identificado pelo telefone (dígitos). Usado pelo PainelCliente no fluxo
// público para mostrar o que já está marcado antes de abrir um novo wizard.
// finalizado = true exclui reservas provisórias (ver `agendamentoId` em
// FormularioAgendamento): a reserva antecipada do clique no horário grava
// finalizado false, e só vira true quando a cliente conclui a etapa "Dados".
// "concluido" entra junto com "confirmado" (STATUS_SUCESSO) só pra preservar
// o comportamento de antes do cron: um confirmado já passado sempre veio
// nesta lista (e todo consumidor corta com classificarAgendamento), e é essa
// lista não vazia que faz o app/[salon]/page.js abrir o PainelCliente. Sem o
// concluido aqui, a cliente cujo último atendimento o cron concluiu cairia
// direto no wizard, perdendo o histórico e a manutenção sugerida do painel.
// Erro de rede/consulta não quebra a tela: devolve lista vazia.
//
// A leitura sai pela RPC `agendamentos_cliente_ativos`
// (sql/rpcs_leitura_cliente.sql), não mais por um select direto: a policy de
// SELECT anon em `agendamentos` cai na Etapa 8, e sem ela este select voltaria
// vazio em silêncio — o painel da cliente sumiria e todo mundo cairia direto
// no wizard. A função devolve as MESMAS colunas com os MESMOS filtros; o único
// acréscimo é o salão precisar estar ativo (ver o arquivo SQL). O /admin
// também passa por aqui (lib/clientesAdmin.js) e continua funcionando: o grant
// inclui `authenticated`.
export async function buscarAgendamentosAtivos(estabelecimentoId, telefoneDigitos) {
  const { data, error } = await supabase.rpc("agendamentos_cliente_ativos", {
    p_estabelecimento_id: estabelecimentoId,
    p_telefone: telefoneDigitos,
  });

  if (error) return [];
  return (data ?? []).map(comServicoAninhado);
}

// Histórico recente (concluido ou cancelado) de um cliente num salão, dos
// últimos `diasLimite` dias. Só o que já foi RESOLVIDO no banco: confirmado/
// pendente/aguardando_sinal ficam de fora mesmo com o horário já passado — um
// confirmado passado ainda não concluído espera a conclusão (cron ou a dona na
// lista "Aguardando Conclusão" da aba Pendentes), não é Histórico ainda.
// expirado_automaticamente = true também sai: é o cron que cancelou o pendente
// por vencimento do horário (ver expirar_pendentes_vencidos), e "Expirado" é
// linguagem interna do salão — a cliente não deve ver isso no próprio painel.
// A ficha do cliente no /admin (buscarHistoricoCompleto, lib/clientesAdmin.js)
// NÃO filtra, de propósito: ali a dona continua vendo tudo.
// Erro de rede/consulta não quebra a tela: devolve lista vazia.
//
// Leitura pela RPC `agendamentos_cliente_historico`
// (sql/rpcs_leitura_cliente.sql) pelo mesmo motivo de buscarAgendamentosAtivos
// acima. Com ela, o "hoje menos diasLimite" que este bloco montava
// componente-a-componente passa a ser calculado no BANCO, em
// America/Sao_Paulo: um celular com o fuso errado deixa de deslocar o corte
// do histórico. Os filtros de status continuam idênticos.
export async function buscarHistoricoRecente(
  estabelecimentoId,
  telefoneDigitos,
  diasLimite = 30
) {
  const { data, error } = await supabase.rpc("agendamentos_cliente_historico", {
    p_estabelecimento_id: estabelecimentoId,
    p_telefone: telefoneDigitos,
    p_dias: diasLimite,
  });

  if (error) return [];
  return (data ?? []).map(comServicoAninhado);
}

// Nome exibido pra etapa anterior de um serviço de duas datas quando o salão
// não deu um (servicos.nome_etapa_anterior nulo). O padrão vive na UI, e não
// no banco, de propósito — ver sql/segunda_data_reserva_grupo.sql: assim o
// texto muda sem migration nem UPDATE em massa. Mora AQUI, exportado, porque
// são dois consumidores (o wizard, ao montar o par, e as telas da cliente, ao
// lê-lo de volta) e duas cópias do literal divergiriam na primeira mudança.
export const NOME_ETAPA_ANTERIOR_PADRAO = "Teste";

// A etapa anterior de um agendamento, procurada na PRÓPRIA lista em que ele
// veio. Devolve { nome, data, horario } pronto pra tela, ou null quando não
// há par (o caso normal) ou quando a irmã não está nesta lista.
//
// "não está nesta lista" acontece de verdade e NÃO é erro: as listas da
// cliente são recortadas (só ativos, só o histórico dos últimos N dias) e
// ainda passam por classificarAgendamento, então uma etapa anterior que já
// aconteceu sai do recorte enquanto o atendimento principal continua nele. O
// desfecho certo aí é o card falar só do principal — não inventar uma linha
// que a cliente não pode mais ver nem cancelar.
//
// `nome_etapa_anterior` é lido do PRÓPRIO item, não da irmã: as duas linhas
// do par são do mesmo serviço, então trazem o mesmo valor, e ler do item faz
// a função continuar funcionando quando a irmã só tem as colunas que a lista
// carregou.
//
// `horario` sai fatiado em HH:MM: o Postgres devolve "10:00:00" e é isso que
// toda tela da cliente exibe hoje (ver `String(item.horario).slice(0, 5)`
// espalhado por elas).
export function etapaAnteriorDoPar(item, lista) {
  if (!item?.reserva_grupo_id) return null;

  const irma = (lista ?? []).find(
    (outro) =>
      outro.id !== item.id &&
      outro.reserva_grupo_id === item.reserva_grupo_id &&
      outro.papel_reserva === "anterior"
  );
  if (!irma) return null;

  return {
    nome: item.nome_etapa_anterior?.trim() || NOME_ETAPA_ANTERIOR_PADRAO,
    data: irma.data,
    horario: String(irma.horario).slice(0, 5),
  };
}

// Colapsa os pares de uma lista de agendamentos da cliente: a linha
// 'principal' continua sendo o item (com `etapaAnterior` pendurada nela) e a
// linha 'anterior' SOME da lista, porque as duas juntas são UM agendamento
// pros olhos de quem marcou — duas datas do mesmo compromisso, não dois
// compromissos.
//
// Linha sem `reserva_grupo_id` passa intacta, na mesma posição: é a
// esmagadora maioria, e uma cliente sem nenhum par vê exatamente a lista de
// hoje, item por item, com as mesmas chaves e a mesma ordem.
//
// O card fica na posição da linha PRINCIPAL (não na da anterior, que vem
// antes na ordem por data): a data grande do card é a do principal, e mantê-la
// no lugar certo da ordenação é o que impede um card de 23/11 aparecer antes
// de um de 15/11 só porque o teste dele é em outubro. A etapa anterior aparece
// como uma linha a mais DENTRO do card, onde a diferença de data se explica
// sozinha.
//
// A anterior só é absorvida quando a principal está NA MESMA LISTA. Se a
// principal saiu do recorte (cancelada, ou já virada histórico), a anterior
// continua como um item normal — esconder um horário que a cliente ainda tem
// marcado seria bem pior que mostrar uma linha solta.
export function agruparPares(lista) {
  const linhas = lista ?? [];

  const principaisPorGrupo = new Map();
  for (const item of linhas) {
    if (item.reserva_grupo_id && item.papel_reserva === "principal") {
      principaisPorGrupo.set(item.reserva_grupo_id, item);
    }
  }
  if (principaisPorGrupo.size === 0) return linhas;

  const resultado = [];
  for (const item of linhas) {
    if (
      item.papel_reserva === "anterior" &&
      principaisPorGrupo.has(item.reserva_grupo_id)
    ) {
      continue;
    }
    const etapaAnterior = etapaAnteriorDoPar(item, linhas);
    resultado.push(etapaAnterior ? { ...item, etapaAnterior } : item);
  }
  return resultado;
}

// Quais dos `telefones` (dígitos) têm agendamento PENDENTE ativo no salão.
// Devolve um Set com os telefones que têm — os demais simplesmente não
// aparecem. Usada pela busca de cliente por nome do admin (ver
// IdentificacaoClienteAdmin) pra marcar o resultado com o selo "pendente"
// antes da dona escolher, em UMA query pros até 8 nomes do dropdown, em vez
// de uma por linha.
//
// Aplica a MESMA regra do inbox da aba Pendentes (ver `inbox` em
// app/[salon]/admin/page.js): status pendente/aguardando_sinal + finalizado
// (exclui reserva antecipada abandonada no meio do wizard) + telefone
// preenchido (exclui importado do Google Calendar sem cliente vinculado) +
// classificarAgendamento === "inbox" (o status cru não vira histórico sozinho
// quando o horário passa, então um pendente caducado ainda vem do banco como
// "pendente" e precisa ser descartado aqui). Se as duas regras divergirem, o
// selo passa a prometer uma pendência que a aba Pendentes não mostra.
//
// duracao_min sai do serviço quando houver (mesmo "elevar ao topo" de
// buscarAgendamentos no admin), com a coluna do próprio agendamento como
// segunda opção — é o que classificarAgendamento lê pra saber se o
// atendimento já terminou.
//
// Erro de rede/consulta não quebra a tela: devolve Set vazio (nenhum selo, o
// fluxo segue como era antes).
export async function buscarPendentesPorTelefones(estabelecimentoId, telefones) {
  const alvos = [...new Set((telefones ?? []).filter(Boolean))];
  if (alvos.length === 0) return new Set();

  const { data, error } = await supabase
    .from("agendamentos")
    .select("telefone, data, horario, status, duracao_min, servicos(duracao_min)")
    .eq("estabelecimento_id", estabelecimentoId)
    .in("telefone", alvos)
    .in("status", ["pendente", "aguardando_sinal"])
    .eq("finalizado", true);

  if (error) return new Set();

  // Um único `agora` pra classificar a lista toda, igual ao render do inbox.
  const agora = new Date();
  const comPendencia = new Set();

  for (const item of data ?? []) {
    // Sem data/horário não dá pra classificar (fimDoAtendimento parseia as
    // duas) — mesmo guard do PainelCalendario.
    if (!item.data || !item.horario) continue;

    const duracao_min = item.servicos?.duracao_min ?? item.duracao_min ?? null;
    if (classificarAgendamento({ ...item, duracao_min }, agora) === "inbox") {
      comPendencia.add(item.telefone);
    }
  }

  return comPendencia;
}

// Quais dos `telefones` (dígitos) têm agendamento CONFIRMADO ainda no futuro
// no salão. Devolve um Set com os telefones que têm — os demais simplesmente
// não aparecem. Alimenta a tag "Agendado"/"Sem agenda" da lista de Clientes
// (ver GerenciarClientes), em UMA query pra lista toda em vez de uma por
// cliente.
//
// A query traz STATUS_SUCESSO (confirmado + concluido) pra seguir a regra do
// resto do projeto, mas na prática só confirmado passa pelo corte de
// ehAgendamentoConfirmadoFuturo — concluido é sempre passado.
//
// Mesmo molde de buscarPendentesPorTelefones acima: filtra por status +
// finalizado no banco (exclui reserva antecipada abandonada no meio do
// wizard) e faz o corte de "ainda vai acontecer" no JS, porque o status cru
// não vira histórico sozinho quando o horário passa. A REGRA em si mora em
// ehAgendamentoConfirmadoFuturo (lib/particao) — a mesma que o /admin aplica
// sobre os agendamentos já carregados em memória, pra que as duas telas nunca
// discordem sobre quem está agendado.
//
// duracao_min sai do serviço quando houver, com a coluna do próprio
// agendamento como segunda opção — é o que classificarAgendamento lê pra
// saber se o atendimento já terminou.
//
// Erro de rede/consulta não quebra a tela: devolve Set vazio.
export async function buscarConfirmadosPorTelefones(estabelecimentoId, telefones) {
  // Normaliza ANTES de consultar (e não só na saída): um registro legado em
  // `clientes.whatsapp` gravado com máscara nunca casaria com o telefone
  // só-dígitos de `agendamentos`, e o cliente ficaria eternamente "Sem
  // agenda". Dedupe depois de normalizar, porque duas grafias do mesmo
  // número colapsam na mesma chave.
  const alvos = [...new Set(
    (telefones ?? []).map((t) => String(t ?? "").replace(/\D/g, "")).filter(Boolean)
  )];
  if (alvos.length === 0) return new Set();

  const { data, error } = await supabase
    .from("agendamentos")
    .select("telefone, data, horario, status, duracao_min, servicos(duracao_min)")
    .eq("estabelecimento_id", estabelecimentoId)
    .in("telefone", alvos)
    .in("status", STATUS_SUCESSO)
    .eq("finalizado", true);

  if (error) return new Set();

  // Um único `agora` pra classificar a lista toda.
  const agora = new Date();
  const resultado = new Set();

  for (const item of data ?? []) {
    // Sem data/horário não dá pra classificar (fimDoAtendimento parseia as
    // duas) — mesmo guard de buscarPendentesPorTelefones.
    if (!item.data || !item.horario) continue;

    const duracao_min = item.servicos?.duracao_min ?? item.duracao_min ?? null;
    if (ehAgendamentoConfirmadoFuturo({ ...item, duracao_min }, agora)) {
      resultado.add(String(item.telefone).replace(/\D/g, ""));
    }
  }

  return resultado;
}

// Cancelamento de um agendamento PELA CLIENTE, no fluxo público. Fonte única
// das três telas que oferecem isso hoje: a lista do PainelCliente, a tela de
// pagamento do sinal (ConfirmacaoSinal) e a tela de protocolo
// (TelaSolicitacaoEnviada) — antes só existia dentro do PainelCliente.
//
// Grava o MESMO par de sempre (status "cancelado" + cancelado_por_cliente,
// que é o que o /admin lê pra distinguir de um cancelamento dele) e, só se o
// update der certo, abre o WhatsApp do salão com o aviso automático. A ordem
// importa: abrir o WhatsApp antes de saber que gravou avisaria a dona de um
// cancelamento que não aconteceu.
//
// O aviso, porém, só vale pra quem já estava CONFIRMADO: desistir de uma
// solicitação que ainda estava "aguardando_sinal"/"pendente" cancela do mesmo
// jeito, mas em silêncio (ver o SELECT de status abaixo). As telas não
// precisam saber a diferença — o retorno é { ok: true, erro: null } nos dois
// casos.
//
// Devolve { ok, erro }: `erro` é a mensagem a MOSTRAR na tela. Antes o erro
// era engolido em silêncio (`if (error) return`) e a cliente ficava achando
// que tinha cancelado — quem chama agora é obrigado a lidar com ele.
//
// `dataFormatada` já chega pronta (dd/mm · dia da semana, ver formatarData) —
// mesma convenção de MENSAGEM_AJUDA_PRAZO_EXPIRADO, pra este módulo não
// precisar importar nada de components/. Já o `horario` é normalizado AQUI
// (String(...).slice(0, 5)): as três telas passam o que têm em mãos, e uma
// delas (a lista do PainelCliente) entrega o valor cru do banco, com segundos
// — a dona recebia "às 16:00:00" numa mensagem e "às 16:00" na outra. Cortar
// no helper alinha os três textos de uma vez e é idempotente pra quem já
// manda "HH:MM".
export async function cancelarAgendamentoCliente({
  agendamentoId,
  estabelecimento,
  nomeCliente,
  dataFormatada,
  horario,
}) {
  const horarioExibido = String(horario ?? "").slice(0, 5);

  // Uma chamada só: a RPC grava o cancelamento e DEVOLVE o status anterior
  // (ver agendamento_cancelar_cliente em sql/rpcs_agendamento_publico.sql).
  // Antes eram duas idas ao banco — um SELECT do status e o UPDATE — com o
  // buraco de o status poder mudar entre as duas; agora a leitura e a escrita
  // acontecem sob o mesmo FOR UPDATE.
  //
  // É o status ANTERIOR que decide se a dona precisa ser avisada. Um
  // agendamento ainda em "aguardando_sinal"/"pendente" nunca foi confirmado
  // por ela: cancelar aí é a cliente desistindo de uma solicitação que a dona
  // talvez nem tenha visto, e o aviso no WhatsApp vira ruído. Só "confirmado"
  // desfaz um compromisso já firmado, e esse continua notificando como sempre.
  //
  // null é o "não gravou" da RPC — linha inexistente, salão inativo, ou status
  // que este fluxo não cancela ("cancelado", "concluido"). Ocupa exatamente o
  // lugar que o `.select("id")` com ZERO linhas ocupava antes: sem essa
  // checagem, a função devolveria ok:true, o WhatsApp de cancelamento abriria
  // e a cliente iria embora achando que cancelou, com o horário ainda de pé na
  // agenda da dona.
  const { data: statusAnterior, error } = await supabase.rpc(
    "agendamento_cancelar_cliente",
    { p_id: agendamentoId }
  );

  if (error || statusAnterior == null) {
    return {
      ok: false,
      erro: "Não foi possível cancelar agora. Tente de novo em instantes.",
    };
  }

  const cancelamentoSilencioso =
    statusAnterior === "aguardando_sinal" || statusAnterior === "pendente";

  // Cancelou algo que a dona ainda não tinha confirmado: grava e sai calado.
  if (cancelamentoSilencioso) {
    return { ok: true, erro: null };
  }

  window.open(
    linkWhatsApp(
      estabelecimento.whatsapp,
      MENSAGEM_CANCELAMENTO_CLIENTE(
        { nomeCliente, data: dataFormatada, horario: horarioExibido },
        estabelecimento.msg_cancelamento_cliente
      )
    ),
    "_blank",
    "noopener,noreferrer"
  );

  return { ok: true, erro: null };
}

// --- Prazo mínimo entre agendamentos ---------------------------------------

// Diferença em dias inteiros entre duas datas "YYYY-MM-DD" (valor absoluto).
// Compara meia-noite local com meia-noite local, então não sofre com fuso nem
// com horário de verão dentro da janela.
function distanciaEmDias(isoA, isoB) {
  const [anoA, mesA, diaA] = isoA.split("-").map(Number);
  const [anoB, mesB, diaB] = isoB.split("-").map(Number);
  const a = new Date(anoA, mesA - 1, diaA);
  const b = new Date(anoB, mesB - 1, diaB);
  return Math.abs(Math.round((a - b) / (24 * 60 * 60 * 1000)));
}

// Já existe um agendamento do MESMO cliente perto demais de `dataAlvo`?
// "Perto demais" = menos de `prazoDias` dias de distância, pros DOIS lados —
// um atendimento recente que acabou de acontecer conta tanto quanto um já
// marcado pra semana que vem. Alimenta o aviso de "agendamentos próximos" nos
// dois fluxos (público, em selecionarHorario; /admin, no gate de
// finalizarAgendamento — ver components/FormularioAgendamento.js).
//
// A chave é o TELEFONE normalizado, não um clienteId: `agendamentos` não tem
// coluna cliente_id (mesma limitação de buscarAgendamentosAtivos acima e de
// lib/clientesAdmin.js). O telefone chega cru dos dois fluxos — o público
// repassa a string digitada em IdentificacaoCliente, e o /admin repassa
// `clientes.whatsapp`, que em registros legados pode ter máscara — então
// normalizarWhatsapp roda AQUI, antes de qualquer query, e não na chamada:
// um número mascarado nunca casaria com a coluna só-dígitos de `agendamentos`
// e o conflito passaria batido (mesmo cuidado de buscarConfirmadosPorTelefones).
//
// Filtro de status igual ao de buscarAgendamentosAtivos (pendente +
// confirmado + concluido + aguardando_sinal): "cancelado" nunca conflita, e
// deixar aguardando_sinal de fora abriria o furo óbvio de reservar, não pagar
// e reservar de novo no dia seguinte. "concluido" conta como o confirmado
// passado contava antes do cron — um atendimento recente é justamente o que
// esta regra existe pra pegar. Falta (no-show) é gravada como cancelado +
// nao_compareceu (ver lib/conclusao.js), então também não conflita.
//
// `finalizado` segue o mesmo corte das funções vizinhas (exclui a reserva
// antecipada abandonada no meio do wizard), com uma exceção: os importados do
// Google Calendar nascem finalizado=false (ver
// app/api/google-calendar/importar), e um evento já vinculado a uma cliente é
// atendimento real — sem o ramo `origem=importado` o salão que importa a
// agenda ficaria com metade do histórico invisível pra esta regra.
//
// `idsIgnorados` tira de cena as linhas que são a PRÓPRIA tentativa em curso:
// a reserva antecipada que o wizard público já gravou nesta sessão (ver
// reservaId em FormularioAgendamento) e o agendamento em edição. Sem isso a
// cliente que volta e troca de horário conflitaria com ela mesma.
//
// Devolve o conflito MAIS PRÓXIMO de `dataAlvo` ({ id, data, horario, status,
// servicos: { nome } }) ou null quando não há nenhum. Erro de rede/consulta
// também devolve null — mesma escolha das funções vizinhas: uma falha de
// leitura não pode virar um aviso inventado na cara da cliente, e a regra que
// realmente protege a agenda (a exclusion constraint) continua no banco.
export async function buscarConflitoPrazoMinimo(
  estabelecimentoId,
  telefone,
  dataAlvo,
  prazoDias,
  idsIgnorados = []
) {
  const dias = Number(prazoDias);
  if (!Number.isInteger(dias) || dias <= 0) return null;
  if (!estabelecimentoId || !dataAlvo) return null;

  const telefoneDigitos = normalizarWhatsapp(telefone);
  if (!telefoneDigitos) return null;

  // Janela consultada com o prazo cheio pros dois lados, agora pela RPC
  // `agendamentos_cliente_janela_prazo` (sql/rpcs_leitura_cliente.sql) — mesmo
  // motivo das duas funções acima: a policy de SELECT anon cai na Etapa 8.
  // Quem calcula os extremos passa a ser o banco (a partir de p_data e
  // p_prazo_dias), então deslocarISO deixou de ser usado aqui.
  //
  // O corte fino (distância ESTRITAMENTE menor que o prazo) continua no JS
  // logo abaixo, pra que "7 dias de prazo" aceite dois agendamentos a exatos 7
  // dias um do outro em vez de recusar por um dia de folga — e porque
  // `idsIgnorados` é estado da tentativa em curso, que não tem por que viajar
  // até o banco.
  const { data, error } = await supabase.rpc("agendamentos_cliente_janela_prazo", {
    p_estabelecimento_id: estabelecimentoId,
    p_telefone: telefoneDigitos,
    p_data: dataAlvo,
    p_prazo_dias: dias,
  });

  if (error) return null;

  const ignorados = new Set((idsIgnorados ?? []).filter((id) => id != null));

  const candidatos = (data ?? [])
    .map(comServicoAninhado)
    .filter((item) => item.data && !ignorados.has(item.id))
    .filter((item) => distanciaEmDias(item.data, dataAlvo) < dias);

  if (candidatos.length === 0) return null;

  // Mais próximo primeiro: é o que a dona/cliente precisa ver no popup pra
  // decidir. Empate (mesmo dia) fica com o mais cedo, que a ordenação da
  // query já garante — sort estável.
  return candidatos.sort(
    (a, b) => distanciaEmDias(a.data, dataAlvo) - distanciaEmDias(b.data, dataAlvo)
  )[0];
}
