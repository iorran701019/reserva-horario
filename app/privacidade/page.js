import BotaoVoltarHistorico from "@/components/BotaoVoltarHistorico";

// Política de privacidade da ACOLHE (a plataforma), não de um salão:
// estática, sem Supabase, sem tema por tenant, Server Component puro, no
// mesmo modelo de app/home/page.js. Linkada pelo RodapePagina de todo salão.
//
// >>> COLISÃO COM /[salon]:
//   "/privacidade" casaria com a rota dinâmica /[salon] (salon="privacidade").
//   Não é bloqueante: no App Router o segmento ESTÁTICO sempre vence o
//   dinâmico, então esta página é a que responde. O efeito colateral é
//   permanente, porém: o slug "privacidade" fica queimado e não pode mais ser
//   usado por nenhum estabelecimento. Vale o mesmo cuidado antes de criar
//   qualquer outra rota de primeiro nível.
export const metadata = {
  title: "Política de privacidade — Acolhe",
  description:
    "Como a plataforma de agendamento online Acolhe coleta, usa e protege os dados de quem agenda um horário.",
};

// Fonte única do texto: a ordem aqui é a ordem na tela, e o número do título
// sai da posição (i + 1). Seção com `itens` vira lista; com `paragrafos`,
// texto corrido.
const SECOES = [
  {
    titulo: "Quais dados coletamos",
    itens: [
      "Nome e número de WhatsApp, para identificar seu agendamento.",
      "Data e horário escolhidos, e o serviço solicitado.",
      "Quando aplicável ao salão: endereço, contato de emergência e respostas de anamnese (histórico relevante para o serviço).",
      "Comprovante de pagamento Pix, quando o sinal de reserva é exigido.",
    ],
  },
  {
    titulo: "Para que usamos esses dados",
    paragrafos: [
      "Os dados servem exclusivamente para viabilizar o agendamento: identificar quem está marcando o horário, permitir contato do salão sobre a reserva, e, quando aplicável, embasar o atendimento (anamnese) ou confirmar o pagamento do sinal.",
    ],
  },
  {
    titulo: "Com quem compartilhamos",
    paragrafos: [
      "Seus dados são visíveis apenas para o salão em que você agendou o horário. Não vendemos nem compartilhamos essas informações com terceiros para fins de marketing. Quando o sinal é pago via Pix automático, o processamento do pagamento é feito por um parceiro de pagamentos (AbacatePay), responsável apenas pela confirmação da transação.",
    ],
  },
  {
    titulo: "Armazenamento e segurança",
    paragrafos: [
      "Os dados ficam armazenados em banco de dados protegido, acessível somente pelo salão correspondente e pela equipe técnica responsável pela manutenção da plataforma.",
    ],
  },
  {
    titulo: "Seus direitos",
    paragrafos: [
      "Você pode solicitar a qualquer momento, pelo WhatsApp do salão, a correção ou exclusão dos seus dados, conforme a Lei Geral de Proteção de Dados (LGPD).",
    ],
  },
  {
    titulo: "Contato",
    paragrafos: [
      "Dúvidas sobre esta política podem ser enviadas pelo WhatsApp exibido no rodapé do salão em que você agendou.",
    ],
  },
];

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-surface px-4 py-10">
      <article className="mx-auto max-w-2xl">
        <BotaoVoltarHistorico className="text-sm font-medium text-body underline-offset-4 hover:text-heading hover:underline">
          ← Voltar ao início
        </BotaoVoltarHistorico>

        <h1 className="mt-8 text-2xl font-bold text-heading">Política de privacidade</h1>
        <p className="mt-1 text-sm text-muted">Última atualização: 22/09/2026</p>

        {SECOES.map(({ titulo, paragrafos, itens }, i) => (
          <section key={titulo} className="mt-8">
            <h2 className="text-lg font-semibold text-heading">
              {i + 1}. {titulo}
            </h2>
            {paragrafos?.map((texto) => (
              <p key={texto} className="mt-2 text-sm leading-relaxed text-body">
                {texto}
              </p>
            ))}
            {itens && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-body">
                {itens.map((texto) => (
                  <li key={texto}>{texto}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>
    </main>
  );
}
