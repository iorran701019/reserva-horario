// Dados da ACOLHE (o produto), não de um tenant. Nada aqui varia por salão —
// é justamente por isso que não mora em `estabelecimentos` (como
// msg_duvida_generica e as outras MENSAGEM_* de lib/whatsapp.js, que são
// configuráveis por salão em ConfiguracoesSalao) nem em variável de ambiente:
// o número é fixo por produto, igual em qualquer ambiente, e `.env*` está no
// .gitignore — passar por env significaria replicar o valor à mão na Vercel
// sem ganho nenhum.

// WhatsApp do suporte da Acolhe, no formato que paraNumeroWhatsApp()
// (lib/whatsapp.js) já espera: SÓ DÍGITOS, com o DDI na frente e sem "+"
// nem símbolos. Com 55 + 13 dígitos ele é considerado já internacional e
// passa intacto pro link do wa.me.
export const WHATSAPP_SUPORTE_ACOLHE = "5524999187739";

// Mensagem que abre a conversa a partir do item "Suporte" do drawer do
// /admin. Quem clica é a DONA do salão falando com a Acolhe (não uma cliente
// falando com o salão), então o texto não tem variáveis nem passa por
// substituirVariaveis — é literal e igual pra todo mundo.
export const MENSAGEM_SUPORTE_ACOLHE =
  "Olá! Preciso de ajuda com o painel de agendamentos.";
