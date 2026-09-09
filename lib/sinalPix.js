// Status EFETIVO da cobrança de sinal Pix — a cascata de rebaixamento.
//
// O problema que isto resolve: `estabelecimentos.metodo_cobranca_pix` guarda a
// INTENÇÃO da dona ('manual' | 'abacatepay'), não a capacidade real de cobrar.
// Escolher 'abacatepay' sem conectar a conta, ou 'manual' sem preencher a
// chave Pix, deixava o salão num estado que só quebrava lá na frente, na cara
// da cliente: o wizard gravava a linha em "aguardando_sinal" e mostrava um
// bloco de Pix sem chave pra copiar (manual) ou a caixa vermelha de "não foi
// possível gerar o Pix" (abacatepay, ver BlocoQrCodeAbacatePay). Ninguém no
// /admin ficava sabendo.
//
// A cascata desce um degrau por vez, sempre pro nível que ainda funciona:
//
//   abacatepay (sem credencial)  ->  manual (sem chave)  ->  desligado
//
// Rebaixar pro manual é rede de segurança de verdade, não consolo: no manual a
// cliente copia a chave e manda o comprovante, então o sinal continua sendo
// COBRADO — só perde a automação. Por isso o degrau existe em vez de a falha
// da credencial ir direto pra 'desligado'.
//
// REGRA DE OURO: nada aqui é persistido. O resultado é derivado a cada
// leitura, e é justamente isso que preserva a distinção entre os dois
// "desligado" possíveis, sem coluna nova:
//
//   sinal_regra === 'desligado'                  -> DELIBERADO (a dona desligou)
//   sinal_regra != 'desligado' && efetivo desligado -> INVOLUNTÁRIO (`rebaixado`)
//
// Gravar o rebaixamento em `metodo_cobranca_pix` mataria essa distinção na
// primeira escrita — a configuração da dona viraria indistinguível do
// acidente. Se algum dia isso precisar virar estado durável, é coluna nova,
// não sobrescrita desta.
//
// Módulo PURO, sem import de supabase, mesmo padrão de lib/janelaAgendamento.js:
// a regra fica testável e roda igual no browser e no servidor. Quem descobre
// se a credencial da AbacatePay existe são os dois loaders
// (lib/estabelecimento.js e lib/perfil.js), que hidratam
// `abacatepay_conectado` no objeto do estabelecimento — a tabela
// `abacatepay_credenciais` não tem policy de RLS e é ilegível pro browser (um
// join client-side devolveria null pra todo mundo, ver o comentário em
// app/api/abacatepay/conectado/route.js).

// Uma chave Pix só conta como preenchida se sobrar algo depois do trim: a UI
// grava `chavePix || null`, o que barra a string vazia mas NÃO barra " ", e um
// espaço em branco não é uma chave que dê pra copiar.
function chavePixPreenchida(chave) {
  return typeof chave === "string" && chave.trim() !== "";
}

// { sinal_regra, metodo_cobranca_pix, sinal_chave_pix, abacatepayConectado }
//   -> { metodoEfetivo: 'abacatepay' | 'manual' | 'desligado', rebaixado }
//
// `metodoEfetivo` é o que TODO ponto de decisão deve consumir no lugar do
// `metodo_cobranca_pix` cru — inclusive o gate de `precisaSinal`, senão o
// wizard segue gravando "aguardando_sinal" por uma cobrança que não existe.
//
// `rebaixado` é true SÓ no desligamento involuntário. Ele nunca é true junto
// de um metodoEfetivo que ainda cobra: cair de 'abacatepay' pra 'manual' é a
// cascata funcionando como projetado (o sinal continua sendo cobrado), e
// pintar isso de vermelho seria alarme falso. O aviso desse caso intermediário
// é a borda vermelha da própria seção de Configurações, que compara o método
// cru com o efetivo — ver ConfiguracoesSalao.
//
// `abacatepayConectado` é a presença da api_key, e SÓ dela. O webhook faltando
// (webhook_id null) não rebaixa nada: o QR Code já funciona sem ele, só a
// confirmação automática de quem paga e fecha a tela é que não chega sozinha —
// e disso a tela de Configurações já avisa em âmbar, separadamente.
export function calcularStatusSinalPix({
  sinal_regra,
  metodo_cobranca_pix,
  sinal_chave_pix,
  abacatepayConectado,
} = {}) {
  // Desligado por escolha: sai antes de qualquer checagem de dado. Não há
  // cobrança pra viabilizar, então chave vazia e credencial ausente são
  // esperadas, não defeito — marcar `rebaixado` aqui encheria a tela de
  // vermelho em todo salão que simplesmente não cobra sinal.
  if (sinal_regra === "desligado") {
    return { metodoEfetivo: "desligado", rebaixado: false };
  }

  // Degrau 1: automático. Só se sustenta com a credencial no lugar; sem ela,
  // NÃO retorna — cai no degrau de baixo, que é o ponto da cascata.
  if (metodo_cobranca_pix === "abacatepay" && abacatepayConectado) {
    return { metodoEfetivo: "abacatepay", rebaixado: false };
  }

  // Degrau 2: manual. Alcançado tanto por escolha ('manual') quanto por queda
  // do degrau 1 — de propósito os dois caminhos terminam aqui, é o que faz a
  // chave Pix valer como rede de segurança pro salão de cobrança automática.
  if (chavePixPreenchida(sinal_chave_pix)) {
    return { metodoEfetivo: "manual", rebaixado: false };
  }

  // Fundo do poço: a regra do salão pedia cobrança e não sobrou nenhum meio de
  // cobrar. Único caso de `rebaixado: true`.
  return { metodoEfetivo: "desligado", rebaixado: true };
}

// A configuração ATUAL do salão está rebaixada? Açúcar pros pontos que só
// querem o booleano (o card de Pendentes, a borda da seção de Configurações) e
// não precisam do método. Mesma fonte, nunca uma segunda regra.
export function sinalPixRebaixado(estabelecimento) {
  return calcularStatusSinalPix({
    sinal_regra: estabelecimento?.sinal_regra,
    metodo_cobranca_pix: estabelecimento?.metodo_cobranca_pix,
    sinal_chave_pix: estabelecimento?.sinal_chave_pix,
    abacatepayConectado: estabelecimento?.abacatepay_conectado,
  }).rebaixado;
}

// Método efetivo a partir do objeto de estabelecimento já hidratado — o
// atalho que os componentes usam pra escolher entre o bloco de QR Code e o
// bloco manual. Aceita undefined (estabelecimento ainda carregando) e responde
// 'desligado', que é o lado seguro: nenhuma tela de cobrança é montada antes
// de saber o que o salão realmente consegue cobrar.
export function metodoEfetivoSinalPix(estabelecimento) {
  return calcularStatusSinalPix({
    sinal_regra: estabelecimento?.sinal_regra,
    metodo_cobranca_pix: estabelecimento?.metodo_cobranca_pix,
    sinal_chave_pix: estabelecimento?.sinal_chave_pix,
    abacatepayConectado: estabelecimento?.abacatepay_conectado,
  }).metodoEfetivo;
}
