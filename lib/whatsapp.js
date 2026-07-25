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

// Mensagem do lembrete de horário. FUNÇÃO editável: recebe o item do
// agendamento e devolve a string pronta do WhatsApp, interpolando nome do
// cliente, data (DD/MM), horário (HH:MM) e nome do serviço. Vive aqui (e não
// no /admin) pra não sumir de novo numa refatoração da tela. Edite o texto à
// vontade — só preserve os campos do item que ele lê.
export function MENSAGEM_LEMBRETE(item) {
  const [, mes, dia] = String(item?.data ?? "").split("-");
  const data = dia && mes ? `${dia}/${mes}` : "—";
  const hora = String(item?.horario ?? "").slice(0, 5) || "—";
  const servico = item?.servicos?.nome ?? "serviço";

  return `Olá ${item?.nome_cliente}! Passando para lembrar do seu horário no dia ${data} às ${hora} para ${servico}. Qualquer dúvida, é só responder por aqui.`;
}

// Mensagem livre de reativação (botão "Entrar em contato" do Histórico).
// Curta, neutra e editável: saudação + nome, sem assumir data/serviço (o item
// já passou ou foi cancelado). Edite o texto à vontade.
export function MENSAGEM_CONTATO(item) {
  return `Olá ${item?.nome_cliente}! Tudo bem? Aqui é da barbearia. Sempre que quiser marcar um horário, é só chamar por aqui. 😊`;
}

// Mensagem de cancelamento (botão "Confirmar cancelamento" do /admin), com o
// link de reagendamento. Recebe `base` (origem da URL) e `salon` (slug do path)
// da PÁGINA — esta lib não lê env nem o slug por conta própria —, montando o
// destino do cliente pós-migração: <base>/<slug>. Sem env/lerSlug/?salon= aqui.
// Interpola nome, data (DD/MM), horário (HH:MM) e serviço, como MENSAGEM_LEMBRETE.
export function MENSAGEM_CANCELAMENTO(item, base, salon) {
  const [, mes, dia] = String(item?.data ?? "").split("-");
  const data = dia && mes ? `${dia}/${mes}` : "—";
  const hora = String(item?.horario ?? "").slice(0, 5) || "—";
  const servico = item?.servicos?.nome ?? "serviço";

  return `Olá ${item?.nome_cliente}. Infelizmente seu agendamento de ${servico} no dia ${data} às ${hora} foi cancelado. Caso queira reagendar, acesse o link: ${base}/${salon} .`;
}

// Mensagem de confirmação (botão "Confirmar" do /admin). Recebe o agendamento
// e devolve a string pronta, interpolando nome do cliente, data (DD/MM),
// horário (HH:MM) e nome do serviço. Edite o texto à vontade.
export function MENSAGEM_CONFIRMACAO(agendamento) {
  const [, mes, dia] = String(agendamento?.data ?? "").split("-");
  const data = dia && mes ? `${dia}/${mes}` : "—";
  const hora = String(agendamento?.horario ?? "").slice(0, 5) || "—";
  const servico = agendamento?.servicos?.nome ?? "serviço";

  return `Olá ${agendamento?.nome_cliente}! Seu agendamento de ${servico} no dia ${data} às ${hora} está confirmado. Será um prazer lhe atender! ✅`;
}

// Mensagem da tela de "Solicitação enviada!" (pós-agendamento do cliente),
// destino é o WhatsApp do estabelecimento. Diferente de MENSAGEM_LEMBRETE/
// CONFIRMACAO/CANCELAMENTO, `data` já chega FORMATADA (dd/mm · dia da semana,
// via formatarData de components/FormularioAgendamento) — esta lib não
// duplica esse formato pra não divergir da tela pública. Edite o texto à
// vontade — só preserve os campos que ele lê.
export function MENSAGEM_SOLICITACAO_ENVIADA({ servico, data, horario, nome }) {
  return `Olá! Acabei de solicitar um agendamento de ${servico} para ${data} às ${horario}. Meu nome é ${nome}.`;
}

// Mensagem livre de dúvida geral (botão fixo "Falar com {nome}" do
// ContatoDono, visível em qualquer tela do fluxo público). Sem parâmetros —
// texto fixo. Edite o texto à vontade.
export function MENSAGEM_DUVIDA_GENERICA() {
  return "Olá! Estou com uma dúvida.";
}

// Mensagem de cancelamento pelo PRÓPRIO cliente (botão "Cancelar" do painel
// do cliente), destino é o WhatsApp do estabelecimento — aviso, não pedido.
// `data` já chega FORMATADA (dd/mm · dia da semana, mesma formatarData de
// MENSAGEM_SOLICITACAO_ENVIADA); `horario` chega cru (sem slice), como no
// original. Edite o texto à vontade.
export function MENSAGEM_CANCELAMENTO_CLIENTE({ nomeCliente, data, horario }) {
  return `Olá! ${nomeCliente} cancelou o agendamento de ${data} às ${horario}.`;
}

// Mensagem de ajuda quando o prazo de cancelamento pelo cliente já passou
// (link com o nome do profissional, no painel do cliente). `data` já chega
// FORMATADA (dd/mm · dia da semana); `horario` já chega recortado (HH:MM).
// Edite o texto à vontade.
export function MENSAGEM_AJUDA_PRAZO_EXPIRADO({ data, horario }) {
  return `Olá! Preciso de ajuda com meu agendamento de ${data} às ${horario}.`;
}

// Mensagem livre de falha ao se cadastrar (modal "Fale com a gente" da
// checagem de WhatsApp já cadastrado, 3ª tentativa). Sem parâmetros — texto
// fixo. Edite o texto à vontade.
export function MENSAGEM_FALHA_CADASTRO() {
  return "Olá! Estou com um problema pra me cadastrar.";
}

// Mensagem livre pro admin puxar assunto com um cliente (link do WhatsApp no
// detalhe do cliente, aba Clientes). Edite o texto à vontade.
export function MENSAGEM_CONTATO_CLIENTE_ADMIN(cliente) {
  return `Olá ${cliente?.nome}!`;
}
