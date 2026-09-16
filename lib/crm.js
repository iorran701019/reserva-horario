import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";

// CRM comercial do Acolhe (/painel-global/crm). As listas abaixo espelham
// EXATAMENTE os check constraints de `leads` e `interacoes` em staging — se o
// check mudar no banco, muda aqui junto, senão o insert/update volta 23514.

// Fluxo principal do quadro, na ordem das colunas. `perdido` fica fora de
// propósito: tem área própria (aba Perdidos), não é etapa do funil.
export const STATUS_ATIVOS = [
  { id: "novo", rotulo: "Novo" },
  { id: "contatado", rotulo: "Contatado" },
  { id: "interessado", rotulo: "Interessado" },
  { id: "demonstracao", rotulo: "Demonstração" },
  { id: "negociacao", rotulo: "Negociação" },
  { id: "convertido", rotulo: "Convertido" },
];

export const STATUS_TODOS = [...STATUS_ATIVOS, { id: "perdido", rotulo: "Perdido" }];

export const ORIGENS = [
  { id: "instagram", rotulo: "Instagram" },
  { id: "whatsapp", rotulo: "WhatsApp" },
  { id: "indicacao", rotulo: "Indicação" },
  { id: "prospeccao_presencial", rotulo: "Prospecção presencial" },
  { id: "evento", rotulo: "Evento" },
  { id: "site", rotulo: "Site" },
  { id: "outro", rotulo: "Outro" },
];

export const MOTIVOS_PERDA = [
  { id: "sem_interesse", rotulo: "Sem interesse" },
  { id: "preco", rotulo: "Preço" },
  { id: "ja_usa_outro_sistema", rotulo: "Já usa outro sistema" },
  { id: "nao_respondeu", rotulo: "Não respondeu" },
  { id: "adiou_decisao", rotulo: "Adiou a decisão" },
  { id: "outro", rotulo: "Outro" },
];

export const CANAIS_INTERACAO = [
  { id: "whatsapp", rotulo: "WhatsApp" },
  { id: "instagram", rotulo: "Instagram" },
  { id: "presencial", rotulo: "Presencial" },
  { id: "outro", rotulo: "Outro" },
];

export function rotulo(lista, id) {
  return lista.find((item) => item.id === id)?.rotulo ?? id ?? "";
}

// `cidade` é texto livre no cadastro: "Barra Mansa", "barra mansa " e
// "Barra  Mansa" são a mesma cidade, assim como "Três Rios" e "Tres Rios". Só
// pra agrupar/comparar em memória — o valor gravado no banco não muda.
// "" = lead sem cidade.
export function chaveCidade(cidade) {
  return (cidade ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Opções do filtro de cidade: uma por chaveCidade, rotulada pela grafia mais
// frequente (empate → a primeira encontrada). `contagem` vem de `leadsContados`
// (a base da visão atual), mas as opções saem de `leads` (todos), pra lista
// não mudar ao trocar de visão. Ordem alfabética.
export function opcoesCidade(leads, leadsContados) {
  const grupos = new Map();
  for (const lead of leads) {
    const chave = chaveCidade(lead.cidade);
    if (!chave) continue;
    if (!grupos.has(chave)) grupos.set(chave, { chave, grafias: new Map(), contagem: 0 });
    const grafia = lead.cidade.trim().replace(/\s+/g, " ");
    const grafias = grupos.get(chave).grafias;
    grafias.set(grafia, (grafias.get(grafia) ?? 0) + 1);
  }
  for (const lead of leadsContados) {
    const grupo = grupos.get(chaveCidade(lead.cidade));
    if (grupo) grupo.contagem += 1;
  }
  return [...grupos.values()]
    .map(({ chave, grafias, contagem }) => {
      let rotulo = "";
      let maior = 0;
      // Map preserva a ordem de inserção, e `>` estrito mantém a primeira no empate.
      for (const [grafia, n] of grafias) {
        if (n > maior) [rotulo, maior] = [grafia, n];
      }
      return { chave, rotulo, contagem };
    })
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

// Tenant onde os atendimentos com leads viram agendamento. Resolvido SEMPRE
// pelo slug em runtime — o id muda entre staging e produção.
export const SLUG_TENANT_COMERCIAL = "acolhe-comercial";

// "YYYY-MM-DD" do dia LOCAL (não toISOString, que em GMT-3 vira o dia
// seguinte depois das 21h). Comparável direto com colunas `date`.
export function hojeISO(d = new Date()) {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Urgência do próximo atendimento pela data E hora, em horário local: é a
// classificação dos blocos do Follow-up e da bolinha do card do Quadro.
//   "atrasado" → data/hora já passou (inclui hoje mais cedo);
//   "hoje"     → hoje, horário ainda por vir;
//   "proximo"  → data futura; null sem atendimento marcado.
// Compara strings "YYYY-MM-DD HH:MM" — horario vem do banco como HH:MM:SS.
export function urgenciaAtendimento(atendimento, agora = new Date()) {
  if (!atendimento) return null;
  const hoje = hojeISO(agora);
  const horaAgora = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  const quando = `${atendimento.data} ${String(atendimento.horario ?? "00:00").slice(0, 5)}`;
  if (quando < `${hoje} ${horaAgora}`) return "atrasado";
  if (atendimento.data === hoje) return "hoje";
  return "proximo";
}

// Mesma detecção do /admin e das rotas de API: código OU texto da constraint.
function ehHorarioOcupado(erro) {
  return (
    erro?.code === "23P01" ||
    /agendamentos_sem_sobreposicao|exclusion constraint/i.test(erro?.message ?? "")
  );
}

// Colunas de `agendamentos` lidas pelo CRM (card, follow-up, detalhe). Embed
// com hint pela coluna: `leads` tem DUAS FKs pra agendamentos
// (agendamento_demonstracao_id, legado, e proximo_atendimento_agendamento_id).
export const SELECT_LEADS_COM_ATENDIMENTO =
  "*, proximo_atendimento:agendamentos!proximo_atendimento_agendamento_id(id, data, horario, duracao_min, servico_livre, status)";

// Nome do tipo gravado em servico_livre ("{tipo} — {lead}"). agendamentos não
// guarda o id do tipo, então é daqui que o CRM tira o rótulo pra exibir.
export function tipoDoAtendimento(agendamento) {
  return agendamento?.servico_livre?.split(" — ")[0] ?? "";
}

// Apaga um agendamento do CRM. Sempre "pendente" (policy
// agendamentos_admin_delete só bloqueia "confirmado"). Zero linha sem erro =
// RLS filtrou.
async function apagarAgendamento(id) {
  const { data, error } = await supabase
    .from("agendamentos")
    .delete()
    .eq("id", id)
    .select("id");
  return !error && data?.length > 0;
}

// Expiração automática do próximo atendimento ao mudar o status do lead.
// Espelho de move_para_status: um tipo com `expira_ao_sair_de` = X some da
// agenda quando o lead SAI de X (ex.: Contato inicial some ao deixar "novo").
// Chamada ANTES de gravar o novo status, com o lead ainda no status antigo.
// Decide pelo `proximo_atendimento_tipo_id` (gravado por marcarAtendimento),
// nunca pelo texto de servico_livre. Retorna:
//   { ok: true, expirou: false }  → não mexe no próximo atendimento;
//   { ok: true, expirou: true }   → agendamento apagado; o chamador limpa
//                                   os dois vínculos no MESMO update do status;
//   { ok: false, erro }           → nada foi apagado; não mudar o status.
export async function expirarAtendimentoAoSairDoStatus(lead) {
  if (!lead?.proximo_atendimento_tipo_id) return { ok: true, expirou: false };

  const { data: tipo, error: erroTipo } = await supabase
    .from("tipos_atendimento")
    .select("id, expira_ao_sair_de")
    .eq("id", lead.proximo_atendimento_tipo_id)
    .maybeSingle();
  if (erroTipo) {
    return { ok: false, erro: `Não foi possível ler o tipo do próximo atendimento: ${erroTipo.message}` };
  }
  if (!tipo || tipo.expira_ao_sair_de !== lead.status) return { ok: true, expirou: false };

  const agendamentoId = lead.proximo_atendimento_agendamento_id;
  if (agendamentoId && !(await apagarAgendamento(agendamentoId))) {
    // Zero linha pode ser "já não existia" (segue) ou RLS (para).
    const { data: ainda, error: erroLer } = await supabase
      .from("agendamentos")
      .select("id")
      .eq("id", agendamentoId)
      .maybeSingle();
    if (erroLer || ainda) {
      return {
        ok: false,
        erro: `Não foi possível remover o próximo atendimento (${erroLer?.message ?? "sem permissão para apagar"}). O status não foi alterado.`,
      };
    }
  }
  return { ok: true, expirou: true };
}

// Marca ou remarca o próximo atendimento de um lead. Ponto único: botão
// "Marcar atendimento" do detalhe e mudança de status pra uma etapa que algum
// tipo move (ex.: Demonstração). Ordem:
//   1. resolve estabelecimento + profissional do tenant comercial pelo slug
//      (antes do delete, pra uma falha aqui não mexer em nada);
//   2. se o lead já tem atendimento vinculado, lê e apaga (sumiu = segue);
//      agendamento legado "confirmado" (demonstração da fase 1) não é apagável
//      — para aqui e manda cancelar no Painel;
//   3. insere em "pendente" com duração do tipo; 23P01 = horário ocupado;
//   4. atualiza o lead (vínculo + move_para_status do tipo, se houver);
//      falhou → apaga o novo.
// Em qualquer falha depois do passo 2, o agendamento antigo é reinserido com
// o MESMO id e o vínculo do lead restaurado — sem isso, uma remarcação pra um
// horário ocupado apagaria o compromisso que já existia. Reinserir "pendente"
// dispara de novo o push do /api/notificacoes (aceito).
// Efeito colateral conhecido do passo 3: push "Pendente: {nome}" pra quem
// tiver notificação ativa no tenant comercial.
// `telefone` fica null de propósito: agendamentos tem RLS mais aberta que as
// tabelas do CRM, então o WhatsApp do lead não vai pra lá.
// Retorna { ok: true, agendamentoId } ou { ok: false, erro }.
export async function marcarAtendimento({ lead, tipo, data, horario, observacao }) {
  const { data: estab, error: erroEstab } = await supabase
    .from("estabelecimentos")
    .select("id")
    .eq("slug", SLUG_TENANT_COMERCIAL)
    .maybeSingle();
  if (erroEstab || !estab) {
    return {
      ok: false,
      erro: `Tenant "${SLUG_TENANT_COMERCIAL}" não encontrado${erroEstab ? `: ${erroEstab.message}` : "."}`,
    };
  }

  const { data: profissionais, error: erroProf } = await supabase
    .from("profissionais")
    .select("id")
    .eq("estabelecimento_id", estab.id)
    .eq("ativo", true)
    .order("id")
    .limit(1);
  const profissional = profissionais?.[0];
  if (erroProf || !profissional) {
    return {
      ok: false,
      erro: `Nenhum profissional ativo no tenant comercial${erroProf ? `: ${erroProf.message}` : "."}`,
    };
  }

  let anterior = null;
  if (lead.proximo_atendimento_agendamento_id) {
    const { data: linha, error: erroLer } = await supabase
      .from("agendamentos")
      .select("*")
      .eq("id", lead.proximo_atendimento_agendamento_id)
      .maybeSingle();
    if (erroLer) {
      return { ok: false, erro: `Não foi possível ler o atendimento atual: ${erroLer.message}` };
    }
    if (linha) {
      if (linha.status === "confirmado") {
        return {
          ok: false,
          erro: "O atendimento atual está confirmado e não pode ser apagado daqui. Cancele-o no Painel do Acolhe — Comercial e tente de novo.",
        };
      }
      const { data: apagadas, error: erroApagar } = await supabase
        .from("agendamentos")
        .delete()
        .eq("id", linha.id)
        .select("id");
      if (erroApagar || !apagadas?.length) {
        return {
          ok: false,
          erro: `Não foi possível apagar o atendimento atual: ${erroApagar?.message ?? "nenhuma linha removida (sem permissão)."} Nada foi alterado.`,
        };
      }
      anterior = linha;
    }
  }

  // Desfaz o passo 2. Devolve o texto a anexar na mensagem de erro.
  async function restaurarAnterior() {
    if (!anterior) return " Nada foi gravado.";
    const { error: erroReinserir } = await supabase.from("agendamentos").insert(anterior);
    if (erroReinserir) {
      return ` Atenção: o atendimento anterior (${formatarResumo(anterior)}) foi apagado e NÃO pôde ser restaurado (${erroReinserir.message}).`;
    }
    const { data: linhas, error: erroVinculo } = await supabase
      .from("leads")
      .update({
        proximo_atendimento_agendamento_id: anterior.id,
        proximo_atendimento_tipo_id: lead.proximo_atendimento_tipo_id ?? null,
      })
      .eq("id", lead.id)
      .select("id");
    if (erroVinculo || !linhas?.length) {
      return ` Atenção: o atendimento anterior foi restaurado na agenda, mas NÃO voltou a ficar vinculado ao lead (${mensagemFalhaSalvar(erroVinculo)}).`;
    }
    return " O atendimento anterior foi mantido.";
  }

  const { data: agendamento, error: erroInsert } = await supabase
    .from("agendamentos")
    .insert({
      estabelecimento_id: estab.id,
      profissional_id: profissional.id,
      data,
      horario,
      duracao_min: tipo.duracao_min,
      servico_id: null,
      servico_livre: `${tipo.nome} — ${lead.nome}`,
      status: "pendente",
      // true de propósito: `finalizado` marca "a cliente terminou o wizard
      // público", e aqui não existe wizard — o atendimento nasce completo.
      // (Ele ainda não aparece na aba Pendentes do /admin do tenant comercial:
      // aquele inbox também exige `telefone`, que o CRM não copia do lead. A
      // tela dele é a aba Agenda do hub.)
      finalizado: true,
      nome_cliente: lead.nome,
      telefone: null,
      observacao: observacao?.trim() || null,
      // Discriminador lido pelo PainelCalendario (aba Agenda do hub): sem
      // ele, este pendente seria indistinguível do pendente real de uma
      // cliente de salão, que o calendário esconde da Lista de propósito.
      origem: "crm",
    })
    .select("id")
    .single();

  if (erroInsert) {
    const motivo = ehHorarioOcupado(erroInsert)
      ? "Esse horário já está ocupado. Escolha outro."
      : erroInsert.message;
    return { ok: false, erro: `${motivo}${anterior ? await restaurarAnterior() : ""}` };
  }

  const patch = {
    proximo_atendimento_agendamento_id: agendamento.id,
    // Qual tipo gerou o vínculo — lido por expirarAtendimentoAoSairDoStatus.
    proximo_atendimento_tipo_id: tipo.id,
    atualizado_em: new Date().toISOString(),
  };
  if (tipo.move_para_status) {
    patch.status = tipo.move_para_status;
    if (tipo.move_para_status === "convertido" && !lead.data_conversao) patch.data_conversao = hojeISO();
  }

  const { data: linhas, error: erroLead } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", lead.id)
    .select("id");

  if (erroLead || !linhas?.length) {
    const motivo = mensagemFalhaSalvar(erroLead);
    if (!(await apagarAgendamento(agendamento.id))) {
      return {
        ok: false,
        erro: `Não foi possível atualizar o lead (${motivo}) e o agendamento ${agendamento.id} NÃO pôde ser apagado — remova-o manualmente no Painel.`,
      };
    }
    return { ok: false, erro: `Não foi possível atualizar o lead: ${motivo}.${await restaurarAnterior()}` };
  }

  return { ok: true, agendamentoId: agendamento.id };
}

function formatarResumo(agendamento) {
  const [ano, mes, dia] = String(agendamento.data).split("-");
  return `${dia}/${mes}/${ano} às ${String(agendamento.horario).slice(0, 5)}`;
}
