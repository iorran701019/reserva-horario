// Helpers para montar links de WhatsApp (wa.me) a partir de um telefone digitado.

// Normaliza um telefone para o formato que o wa.me espera (só dígitos, com DDI).
// Regra: remove tudo que não for dígito; se já vier com "55" e 12/13 dígitos,
// assume que já está internacional e devolve como está; senão tira zeros à
// esquerda e prefixa "55" (Brasil).
export function paraNumeroWhatsApp(telefone) {
  const digitos = String(telefone ?? "").replace(/\D/g, "");

  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    return digitos;
  }

  const semZerosAEsquerda = digitos.replace(/^0+/, "");
  return `55${semZerosAEsquerda}`;
}

// Monta o link clicável do WhatsApp com a mensagem já codificada.
export function linkWhatsApp(telefone, texto) {
  return `https://wa.me/${paraNumeroWhatsApp(telefone)}?text=${encodeURIComponent(texto)}`;
}

// Mesmo link, sem parâmetro de mensagem — abre a conversa em branco, pro dono
// escrever livremente (ex.: card de "cancelamento_cliente" do inbox, onde não
// há um texto padrão a sugerir).
export function linkWhatsAppSemMensagem(telefone) {
  return `https://wa.me/${paraNumeroWhatsApp(telefone)}`;
}

// Substitui cada "{chave}" do template pelo valor correspondente em `valores`
// (objeto plano). Chaves de `{...}` que não existem em `valores` são
// ignoradas (o texto "{chave}" permanece como está) — usado tanto pelas
// MENSAGEM_* abaixo quanto pela prévia da tela de configurações.
export function substituirVariaveis(template, valores = {}) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (correspondencia, chave) =>
    Object.prototype.hasOwnProperty.call(valores, chave)
      ? String(valores[chave])
      : correspondencia
  );
}

// Textos padrão (usados quando o estabelecimento não personalizou a
// mensagem) — a MESMA redação de sempre, só reescrita como template com
// placeholders "{variavel}" em vez de interpolação direta.
const PADRAO_CONFIRMACAO =
  "Olá {nome_cliente}! Seu agendamento de {servico} no dia {data} às {horario} está confirmado. Será um prazer lhe atender! ✅";
const PADRAO_LEMBRETE =
  "Olá {nome_cliente}! Passando para lembrar do seu horário no dia {data} às {horario} para {servico}. Qualquer dúvida, é só responder por aqui.";
const PADRAO_CANCELAMENTO =
  "Olá {nome_cliente}. Infelizmente seu agendamento do seu serviço no dia {data} às {horario} foi cancelado. Caso queira reagendar, acesse o link: {link} .";
const PADRAO_REATIVACAO =
  "Olá {nome_cliente}! Tudo bem? Aqui é da barbearia. Sempre que quiser marcar um horário, é só chamar por aqui. 😊";
const PADRAO_SOLICITACAO_ENVIADA =
  "Olá! Acabei de solicitar um agendamento de {servico} para {data} às {horario}. Meu nome é {nome_cliente}.";
const PADRAO_DUVIDA_GENERICA = "Olá! Estou com uma dúvida.";
const PADRAO_CANCELAMENTO_CLIENTE =
  "Olá! {nome_cliente} cancelou o agendamento de {data} às {horario}.";
const PADRAO_AJUDA_PRAZO_EXPIRADO =
  "Olá! Preciso de ajuda com meu agendamento de {data} às {horario}.";
const PADRAO_FALHA_CADASTRO = "Olá! Estou com um problema pra me cadastrar.";
const PADRAO_CONTATO_ADMIN = "Olá {nome_cliente}!";
const PADRAO_FORA_DA_JANELA =
  "Olá {nome_cliente}! Nossa agenda está aberta até {janela_fim} e seu horário de {data} às {horario} acabou ficando fora desse período. Vamos combinar uma nova data?";
const PADRAO_ALTERACAO_DATA =
  "Olá {nome_cliente}! Sua data foi alterada para {data} às {horario}. Qualquer dúvida, é só chamar por aqui.";

// Metadados das 9 mensagens editáveis (coluna em `estabelecimentos`, rótulo,
// quando é disparada e quais variáveis aceita) — fonte única consumida pela
// seção "Mensagens de WhatsApp" de ConfiguracoesSalao.js pra montar a lista,
// a prévia e o menu de autocomplete, sem duplicar essas strings lá.
export const MENSAGENS_WHATSAPP_CONFIG = [
  {
    campo: "msg_confirmacao",
    titulo: "Confirmação de agendamento",
    gatilho: "Enviada quando você confirma um agendamento na Agenda do /admin.",
    variaveis: ["nome_cliente", "servico", "data", "horario"],
    padrao: PADRAO_CONFIRMACAO,
  },
  {
    campo: "msg_lembrete",
    titulo: "Lembrete de horário",
    gatilho:
      'Enviada ao clicar em "Lembrete" (ou "Reenviar lembrete") no detalhe de um agendamento.',
    variaveis: ["nome_cliente", "servico", "data", "horario"],
    padrao: PADRAO_LEMBRETE,
  },
  {
    campo: "msg_cancelamento",
    titulo: "Cancelamento pelo salão",
    gatilho: "Enviada quando você cancela o agendamento de um cliente pelo /admin.",
    variaveis: ["nome_cliente", "servico", "data", "horario", "link"],
    padrao: PADRAO_CANCELAMENTO,
  },
  {
    campo: "msg_reativacao",
    titulo: "Reativação de cliente",
    gatilho:
      'Enviada ao clicar em "Entrar em contato" no histórico de um cliente sem agendamento ativo.',
    variaveis: ["nome_cliente"],
    padrao: PADRAO_REATIVACAO,
  },
  {
    campo: "msg_contato_admin",
    titulo: "Contato com cliente (admin)",
    gatilho: 'Mensagem sugerida ao clicar no WhatsApp do cliente, na aba Clientes do /admin.',
    variaveis: ["nome_cliente"],
    padrao: PADRAO_CONTATO_ADMIN,
  },
  {
    campo: "msg_fora_da_janela",
    titulo: "Fora da janela de agendamento",
    gatilho:
      'Enviada ao clicar em "Entrar em contato" na seção "Fora da janela de agendamento" (aba Pendentes do /admin).',
    variaveis: ["nome_cliente", "data", "horario", "janela_fim"],
    padrao: PADRAO_FORA_DA_JANELA,
  },
  {
    campo: "msg_alteracao_data",
    titulo: "Alteração de data",
    gatilho:
      'Enviada pela zona grande do botão dividido "Alterar data" (seção "Fora da janela de agendamento", aba Pendentes do /admin).',
    variaveis: ["nome_cliente", "data", "horario"],
    padrao: PADRAO_ALTERACAO_DATA,
  },
  {
    // Entrada de UI unificada: um único campo grava o MESMO texto nas quatro
    // colunas abaixo. As funções MENSAGEM_DUVIDA_GENERICA,
    // MENSAGEM_FALHA_CADASTRO, MENSAGEM_SOLICITACAO_ENVIADA e
    // MENSAGEM_AJUDA_PRAZO_EXPIRADO continuam separadas, cada uma lendo sua
    // própria coluna em tempo de execução — só a tela de configurações trata
    // as quatro como um campo só. `camposDestino` (em vez de `campo`
    // sozinho) é quem sinaliza esse caso pra ConfiguracoesSalao.js.
    // As duas últimas colunas normalmente interpolam {data}/{horario}/etc.
    // via substituirVariaveis; como este campo não oferece variáveis, o
    // texto salvo aqui não tem "{...}" pra substituir e sai literal nos dois
    // contextos — decisão consciente, reversível se algum dia precisar de
    // volta um campo próprio com variáveis pra alguma das quatro.
    campo: "msg_suporte_generico",
    camposDestino: [
      "msg_duvida_generica",
      "msg_falha_cadastro",
      "msg_solicitacao_enviada",
      "msg_ajuda_prazo_expirado",
    ],
    titulo: "Mensagem do cliente ao Salão",
    gatilho:
      "Botão fixo de dúvida geral, cadastro com conflito de nome, confirmação de solicitação enviada, ou ajuda com prazo de cancelamento expirado.",
    variaveis: [],
  },
  {
    campo: "msg_cancelamento_cliente",
    titulo: "Cancelamento pelo cliente",
    gatilho:
      "Enviada ao estabelecimento quando o próprio cliente cancela um agendamento pelo painel dele.",
    variaveis: ["nome_cliente", "data", "horario"],
    padrao: PADRAO_CANCELAMENTO_CLIENTE,
  },
];

// Mensagem do lembrete de horário. FUNÇÃO editável: recebe o item do
// agendamento e devolve a string pronta do WhatsApp, interpolando nome do
// cliente, data (DD/MM), horário (HH:MM) e nome do serviço. Vive aqui (e não
// no /admin) pra não sumir de novo numa refatoração da tela.
// `textoPersonalizado` é o texto salvo em estabelecimentos.msg_lembrete:
// null/undefined usa o padrão acima; string (mesmo vazia) vira o template.
export function MENSAGEM_LEMBRETE(item, textoPersonalizado) {
  const [, mes, dia] = String(item?.data ?? "").split("-");
  const data = dia && mes ? `${dia}/${mes}` : "—";
  const horario = String(item?.horario ?? "").slice(0, 5) || "—";
  const servico = item?.servicos?.nome ?? "serviço";

  const template = textoPersonalizado ?? PADRAO_LEMBRETE;
  return substituirVariaveis(template, {
    nome_cliente: item?.nome_cliente,
    data,
    horario,
    servico,
  });
}

// Mensagem livre de reativação (botão "Entrar em contato" do Histórico).
// Curta, neutra: saudação + nome, sem assumir data/serviço (o item já passou
// ou foi cancelado). `textoPersonalizado` = estabelecimentos.msg_reativacao.
export function MENSAGEM_CONTATO(item, textoPersonalizado) {
  const template = textoPersonalizado ?? PADRAO_REATIVACAO;
  return substituirVariaveis(template, { nome_cliente: item?.nome_cliente });
}

// Mensagem de cancelamento (botão "Confirmar cancelamento" do /admin), com o
// link de reagendamento. Recebe `base` (origem da URL) e `salon` (slug do path)
// da PÁGINA — esta lib não lê env nem o slug por conta própria —, montando o
// destino do cliente pós-migração: <base>/<slug>. Sem env/lerSlug/?salon= aqui.
// `textoPersonalizado` = estabelecimentos.msg_cancelamento.
export function MENSAGEM_CANCELAMENTO(item, base, salon, textoPersonalizado) {
  const [, mes, dia] = String(item?.data ?? "").split("-");
  const data = dia && mes ? `${dia}/${mes}` : "—";
  const horario = String(item?.horario ?? "").slice(0, 5) || "—";
  const servico = item?.servicos?.nome ?? "serviço";

  const template = textoPersonalizado ?? PADRAO_CANCELAMENTO;
  return substituirVariaveis(template, {
    nome_cliente: item?.nome_cliente,
    servico,
    data,
    horario,
    link: `${base}/${salon}`,
  });
}

// Mensagem de confirmação (botão "Confirmar" do /admin). Recebe o agendamento
// e devolve a string pronta, interpolando nome do cliente, data (DD/MM),
// horário (HH:MM) e nome do serviço. `textoPersonalizado` =
// estabelecimentos.msg_confirmacao.
export function MENSAGEM_CONFIRMACAO(agendamento, textoPersonalizado) {
  const [, mes, dia] = String(agendamento?.data ?? "").split("-");
  const data = dia && mes ? `${dia}/${mes}` : "—";
  const horario = String(agendamento?.horario ?? "").slice(0, 5) || "—";
  const servico = agendamento?.servicos?.nome ?? "serviço";

  const template = textoPersonalizado ?? PADRAO_CONFIRMACAO;
  return substituirVariaveis(template, {
    nome_cliente: agendamento?.nome_cliente,
    servico,
    data,
    horario,
  });
}

// Mensagem da tela de "Solicitação enviada!" (pós-agendamento do cliente),
// destino é o WhatsApp do estabelecimento. Diferente de MENSAGEM_LEMBRETE/
// CONFIRMACAO/CANCELAMENTO, `data` já chega FORMATADA (dd/mm · dia da semana,
// via formatarData de components/FormularioAgendamento) — esta lib não
// duplica esse formato pra não divergir da tela pública.
// `textoPersonalizado` = estabelecimentos.msg_solicitacao_enviada.
export function MENSAGEM_SOLICITACAO_ENVIADA({ servico, data, horario, nome }, textoPersonalizado) {
  const template = textoPersonalizado ?? PADRAO_SOLICITACAO_ENVIADA;
  return substituirVariaveis(template, { servico, data, horario, nome_cliente: nome });
}

// Mensagem livre de dúvida geral (botão fixo "Falar com {nome}" do
// ContatoDono, visível em qualquer tela do fluxo público). Sem variáveis.
// `textoPersonalizado` = estabelecimentos.msg_duvida_generica.
export function MENSAGEM_DUVIDA_GENERICA(textoPersonalizado) {
  const template = textoPersonalizado ?? PADRAO_DUVIDA_GENERICA;
  return substituirVariaveis(template, {});
}

// Mensagem de cancelamento pelo PRÓPRIO cliente (botão "Cancelar" do painel
// do cliente), destino é o WhatsApp do estabelecimento — aviso, não pedido.
// `data` já chega FORMATADA (dd/mm · dia da semana, mesma formatarData de
// MENSAGEM_SOLICITACAO_ENVIADA); `horario` chega cru (sem slice), como no
// original. `textoPersonalizado` = estabelecimentos.msg_cancelamento_cliente.
export function MENSAGEM_CANCELAMENTO_CLIENTE({ nomeCliente, data, horario }, textoPersonalizado) {
  const template = textoPersonalizado ?? PADRAO_CANCELAMENTO_CLIENTE;
  return substituirVariaveis(template, { nome_cliente: nomeCliente, data, horario });
}

// Mensagem de ajuda quando o prazo de cancelamento pelo cliente já passou
// (link com o nome do profissional, no painel do cliente). `data` já chega
// FORMATADA (dd/mm · dia da semana); `horario` já chega recortado (HH:MM).
// `textoPersonalizado` = estabelecimentos.msg_ajuda_prazo_expirado.
export function MENSAGEM_AJUDA_PRAZO_EXPIRADO({ data, horario }, textoPersonalizado) {
  const template = textoPersonalizado ?? PADRAO_AJUDA_PRAZO_EXPIRADO;
  return substituirVariaveis(template, { data, horario });
}

// Mensagem livre de falha ao se cadastrar (modal "Fale com a gente" da
// checagem de WhatsApp já cadastrado, 3ª tentativa). Sem variáveis.
// `textoPersonalizado` = estabelecimentos.msg_falha_cadastro.
export function MENSAGEM_FALHA_CADASTRO(textoPersonalizado) {
  const template = textoPersonalizado ?? PADRAO_FALHA_CADASTRO;
  return substituirVariaveis(template, {});
}

// Mensagem livre pro admin puxar assunto com um cliente (link do WhatsApp no
// detalhe do cliente, aba Clientes). `textoPersonalizado` =
// estabelecimentos.msg_contato_admin.
export function MENSAGEM_CONTATO_CLIENTE_ADMIN(cliente, textoPersonalizado) {
  const template = textoPersonalizado ?? PADRAO_CONTATO_ADMIN;
  return substituirVariaveis(template, { nome_cliente: cliente?.nome });
}

// Mensagem livre pro admin avisar um cliente cujo agendamento ficou fora da
// janela de agendamento vigente (botão "Entrar em contato" da seção "Fora da
// janela de agendamento", aba Pendentes do /admin). `janelaFim` chega CRUA
// ("YYYY-MM-DD", estabelecimentos.janela_agendamento_fim) e é formatada aqui
// pra dd/mm/aaaa — diferente de `data`/`horario` do agendamento, que ficam no
// padrão dd/mm dos outros MENSAGEM_* (o limite da janela pode ser meses à
// frente, então o ano importa). `textoPersonalizado` =
// estabelecimentos.msg_fora_da_janela.
export function MENSAGEM_FORA_DA_JANELA(item, janelaFim, textoPersonalizado) {
  const [, mes, dia] = String(item?.data ?? "").split("-");
  const data = dia && mes ? `${dia}/${mes}` : "—";
  const horario = String(item?.horario ?? "").slice(0, 5) || "—";

  const [anoJanela, mesJanela, diaJanela] = String(janelaFim ?? "").split("-");
  const janela_fim =
    diaJanela && mesJanela && anoJanela ? `${diaJanela}/${mesJanela}/${anoJanela}` : "—";

  const template = textoPersonalizado ?? PADRAO_FORA_DA_JANELA;
  return substituirVariaveis(template, {
    nome_cliente: item?.nome_cliente,
    data,
    horario,
    janela_fim,
  });
}

// Mensagem de alteração de data (zona grande do botão dividido "Alterar
// data", seção "Fora da janela de agendamento" do /admin). `agendamento` deve
// vir com a NOVA data/horario já aplicada (quem chama monta esse objeto antes
// do UPDATE terminar de refletir no estado local — mesmo motivo de
// MENSAGEM_CONFIRMACAO receber o registro que acabou de mudar). `data` chega
// crua ("YYYY-MM-DD"), `horario` chega crua ("HH:MM:SS" ou "HH:MM") — mesmo
// tratamento (split/slice) das outras MENSAGEM_* acima. `textoPersonalizado`
// = estabelecimentos.msg_alteracao_data.
export function MENSAGEM_ALTERACAO_DATA(agendamento, textoPersonalizado) {
  const [, mes, dia] = String(agendamento?.data ?? "").split("-");
  const data = dia && mes ? `${dia}/${mes}` : "—";
  const horario = String(agendamento?.horario ?? "").slice(0, 5) || "—";

  const template = textoPersonalizado ?? PADRAO_ALTERACAO_DATA;
  return substituirVariaveis(template, {
    nome_cliente: agendamento?.nome_cliente,
    data,
    horario,
  });
}
