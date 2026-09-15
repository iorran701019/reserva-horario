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

// Tenant onde as demonstrações viram agendamento. Resolvido SEMPRE pelo slug
// em runtime — o id muda entre staging e produção.
export const SLUG_TENANT_COMERCIAL = "acolhe-comercial";

// "YYYY-MM-DD" do dia LOCAL (não toISOString, que em GMT-3 vira o dia
// seguinte depois das 21h). Comparável direto com colunas `date`.
export function hojeISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Mesma detecção do /admin e das rotas de API: código OU texto da constraint.
function ehHorarioOcupado(erro) {
  return (
    erro?.code === "23P01" ||
    /agendamentos_sem_sobreposicao|exclusion constraint/i.test(erro?.message ?? "")
  );
}

// Apaga o agendamento recém-criado num rollback. Só funciona enquanto o status
// ainda NÃO é "confirmado": a policy agendamentos_admin_delete exige
// status <> 'confirmado'. Zero linha sem erro = RLS filtrou = slot órfão.
async function apagarAgendamento(id) {
  const { data, error } = await supabase
    .from("agendamentos")
    .delete()
    .eq("id", id)
    .select("id");
  return !error && data?.length > 0;
}

// Gatilho de demonstração: cria o agendamento no tenant comercial e só então
// move o lead pra `demonstracao`. Ordem importa:
//   1. resolve estabelecimento + profissional pelo slug;
//   2. insere o agendamento como "pendente" — ainda apagável (ver
//      apagarAgendamento); 23P01 = horário ocupado, para aqui;
//   3. atualiza o lead com o uuid do agendamento; falhou → apaga o agendamento;
//   4. promove o agendamento a "confirmado" — só agora, quando não há mais
//      rollback pela frente; falhou → apaga o agendamento E devolve o lead ao
//      status/vínculo anteriores.
// Efeito colateral conhecido do passo 2: o webhook /api/notificacoes manda push
// "Pendente: {nome}" pra quem tiver notificação ativa no tenant comercial.
// O Painel classifica "pendente" como inbox (aba Pendentes), mas o /admin não
// tem realtime e a janela dura só o tempo de 2 requisições.
// `telefone` fica null de propósito: agendamentos tem RLS mais aberta que as
// tabelas do CRM, então o WhatsApp do lead não vai pra lá (card fica âmbar /
// "não vinculado" no Painel — aceito).
// Retorna { ok: true, agendamentoId } ou { ok: false, erro }.
export async function criarDemonstracao({ lead, data, horario, duracaoMin }) {
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

  const { data: agendamento, error: erroInsert } = await supabase
    .from("agendamentos")
    .insert({
      estabelecimento_id: estab.id,
      profissional_id: profissional.id,
      data,
      horario,
      duracao_min: duracaoMin,
      servico_id: null,
      servico_livre: "Demonstração Acolhe",
      status: "pendente",
      finalizado: true,
      nome_cliente: lead.nome,
      telefone: null,
      observacao: `Demonstração CRM — lead: ${lead.nome}`,
    })
    .select("id")
    .single();

  if (erroInsert) {
    return {
      ok: false,
      erro: ehHorarioOcupado(erroInsert)
        ? "Esse horário já está ocupado. Escolha outro."
        : erroInsert.message,
    };
  }

  const { data: linhas, error: erroLead } = await supabase
    .from("leads")
    .update({
      status: "demonstracao",
      agendamento_demonstracao_id: agendamento.id,
      atualizado_em: new Date().toISOString(),
    })
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
    return { ok: false, erro: `Não foi possível atualizar o lead: ${motivo}` };
  }

  const { data: confirmados, error: erroConfirmar } = await supabase
    .from("agendamentos")
    .update({ status: "confirmado" })
    .eq("id", agendamento.id)
    .select("id");

  if (erroConfirmar || !confirmados?.length) {
    const motivo = mensagemFalhaSalvar(erroConfirmar);
    const apagou = await apagarAgendamento(agendamento.id);
    // Volta ao estado de ANTES do gatilho: status anterior e o vínculo que o
    // lead já tinha (null no caso normal; outro uuid se já houve demonstração).
    const { data: revertidos, error: erroReverter } = await supabase
      .from("leads")
      .update({
        status: lead.status,
        agendamento_demonstracao_id: lead.agendamento_demonstracao_id ?? null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", lead.id)
      .select("id");
    const reverteu = !erroReverter && revertidos?.length > 0;

    const problemas = [
      !apagou && `o agendamento ${agendamento.id} NÃO pôde ser apagado (remova-o manualmente no Painel)`,
      !reverteu && `o lead NÃO voltou ao status anterior (${mensagemFalhaSalvar(erroReverter)})`,
    ].filter(Boolean);

    return {
      ok: false,
      erro: `Não foi possível confirmar o agendamento da demonstração: ${motivo}.${
        problemas.length ? ` Atenção: ${problemas.join("; ")}.` : " Nada foi gravado."
      }`,
    };
  }

  return { ok: true, agendamentoId: agendamento.id };
}
