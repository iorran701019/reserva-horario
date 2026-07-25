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
  "Olá {nome_cliente}. Infelizmente seu agendamento de {servico} no dia {data} às {horario} foi cancelado. Caso queira reagendar, acesse o link: {link} .";
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

// Metadados das 10 mensagens editáveis (coluna em `estabelecimentos`, rótulo,
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
    campo: "msg_solicitacao_enviada",
    titulo: "Solicitação enviada (cliente)",
    gatilho:
      'Mensagem sugerida ao cliente na tela "Solicitação enviada!", logo após ele agendar.',
    variaveis: ["nome_cliente", "servico", "data", "horario"],
    padrao: PADRAO_SOLICITACAO_ENVIADA,
  },
  {
    campo: "msg_duvida_generica",
    titulo: "Dúvida geral (botão fixo)",
    gatilho:
      'Mensagem sugerida no botão fixo "Falar com [nome]", visível em qualquer tela do fluxo público.',
    variaveis: [],
    padrao: PADRAO_DUVIDA_GENERICA,
  },
  {
    campo: "msg_cancelamento_cliente",
    titulo: "Cancelamento pelo cliente",
    gatilho:
      "Enviada ao estabelecimento quando o próprio cliente cancela um agendamento pelo painel dele.",
    variaveis: ["nome_cliente", "data", "horario"],
    padrao: PADRAO_CANCELAMENTO_CLIENTE,
  },
  {
    campo: "msg_ajuda_prazo_expirado",
    titulo: "Ajuda (prazo de cancelamento expirado)",
    gatilho:
      "Mensagem sugerida ao cliente quando o prazo pra cancelar sozinho pelo painel dele já passou.",
    variaveis: ["data", "horario"],
    padrao: PADRAO_AJUDA_PRAZO_EXPIRADO,
  },
  {
    campo: "msg_falha_cadastro",
    titulo: "Falha ao se cadastrar",
    gatilho:
      'Mensagem sugerida no modal "Fale com a gente", quando o WhatsApp digitado já está cadastrado com outro nome.',
    variaveis: [],
    padrao: PADRAO_FALHA_CADASTRO,
  },
  {
    campo: "msg_contato_admin",
    titulo: "Contato com cliente (admin)",
    gatilho: 'Mensagem sugerida ao clicar no WhatsApp do cliente, na aba Clientes do /admin.',
    variaveis: ["nome_cliente"],
    padrao: PADRAO_CONTATO_ADMIN,
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
