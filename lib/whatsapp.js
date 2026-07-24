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
