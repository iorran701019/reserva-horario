import Link from "next/link";

// Termos de uso da ACOLHE (a plataforma), não de um salão: estática, sem
// Supabase, sem tema por tenant, Server Component puro, no mesmo modelo de
// app/home/page.js. Linkada pelo RodapePagina de todo salão.
//
// >>> COLISÃO COM /[salon]:
//   "/termos" casaria com a rota dinâmica /[salon] (salon="termos"). Não é
//   bloqueante: no App Router o segmento ESTÁTICO sempre vence o dinâmico,
//   então esta página é a que responde. O efeito colateral é permanente,
//   porém: o slug "termos" fica queimado e não pode mais ser usado por nenhum
//   estabelecimento. Vale o mesmo cuidado antes de criar qualquer outra rota
//   de primeiro nível.
export const metadata = {
  title: "Termos de uso — Acolhe",
  description:
    "Termos de uso da plataforma de agendamento online Acolhe, usada por salões de beleza, manicures e nail designers independentes.",
};

// Fonte única do texto: a ordem aqui é a ordem na tela, e o número do título
// sai da posição (i + 1).
const SECOES = [
  {
    titulo: "Sobre esta plataforma",
    paragrafos: [
      "Este site é um sistema de agendamento online usado por salões de beleza, manicures e nail designers independentes para organizar horários de atendimento. A plataforma é fornecida por Acolhe, mas cada salão listado aqui é um negócio independente, responsável pelos próprios serviços, preços, prazos e atendimento.",
    ],
  },
  {
    titulo: "Cadastro e agendamento",
    paragrafos: [
      "Para agendar um horário, você fornece seu nome e número de WhatsApp. Esses dados são usados exclusivamente para identificar sua reserva e permitir que o salão entre em contato sobre o agendamento. Alguns salões podem solicitar informações adicionais (endereço, contato de emergência, respostas de anamnese) quando isso for necessário para o tipo de serviço prestado.",
    ],
  },
  {
    titulo: "Confirmação de horário e sinal",
    paragrafos: [
      "Alguns salões exigem um sinal de reserva via Pix para confirmar o agendamento. Quando isso se aplica, as condições (valor, prazo e forma de pagamento) são exibidas antes da confirmação. O comprovante de pagamento, quando enviado, é utilizado apenas para validar a reserva.",
    ],
  },
  {
    titulo: "Cancelamento e reagendamento",
    paragrafos: [
      "As regras de cancelamento e reagendamento (prazos, possibilidade de estorno do sinal) são definidas por cada salão e informadas no momento do agendamento. A plataforma não define nem interfere nessas regras.",
    ],
  },
  {
    titulo: "Responsabilidade",
    paragrafos: [
      "A plataforma disponibiliza a ferramenta de agendamento, mas não realiza os serviços de estética oferecidos pelos salões, nem se responsabiliza pela qualidade, execução ou eventuais disputas entre cliente e salão.",
    ],
  },
  {
    titulo: "Alterações",
    paragrafos: [
      "Estes termos podem ser atualizados. Alterações relevantes serão refletidas na data no topo desta página.",
    ],
  },
  {
    titulo: "Contato",
    paragrafos: [
      "Dúvidas sobre estes termos podem ser enviadas pelo WhatsApp exibido no rodapé do salão em que você agendou.",
    ],
  },
];

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-surface px-4 py-10">
      <article className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm font-medium text-body underline-offset-4 hover:text-heading hover:underline">
          ← Voltar ao início
        </Link>

        <h1 className="mt-8 text-2xl font-bold text-heading">Termos de uso</h1>
        <p className="mt-1 text-sm text-muted">Última atualização: 22/09/2026</p>

        {SECOES.map(({ titulo, paragrafos }, i) => (
          <section key={titulo} className="mt-8">
            <h2 className="text-lg font-semibold text-heading">
              {i + 1}. {titulo}
            </h2>
            {paragrafos.map((texto) => (
              <p key={texto} className="mt-2 text-sm leading-relaxed text-body">
                {texto}
              </p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
