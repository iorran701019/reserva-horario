import { CalendarClock, Banknote, BellRing, LayoutGrid } from "lucide-react";

// Os quatro recursos que a dona de salão pergunta primeiro. Lista de dados em
// vez de JSX repetido: o cartão é sempre o mesmo, só o conteúdo muda.
const RECURSOS = [
  {
    icone: CalendarClock,
    titulo: "Agendamento 24h",
    descricao:
      "A cliente marca sozinha pelo link, a qualquer hora. Depois, com calma, você confirma o agendamento dela dentro do app.",
  },
  {
    icone: Banknote,
    titulo: "Sinal via Pix",
    descricao:
      "Cobrança automática do sinal na hora de reservar — quem paga, comparece.",
  },
  {
    icone: BellRing,
    titulo: "Lembretes automáticos",
    descricao:
      "Confirmação e aviso de horário saem sozinhos, sem você lembrar de mandar mensagem.",
  },
  {
    icone: LayoutGrid,
    titulo: "Painel simples",
    descricao:
      "Tenha em mãos sua agenda, o histórico de cada cliente e relatórios financeiros, tudo em um só lugar.",
  },
];

export default function SecaoRecursos() {
  return (
    <section id="o-que-e" className="scroll-mt-20 px-4 py-12 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-4 sm:grid-cols-2">
          {RECURSOS.map(({ icone: Icone, titulo, descricao }) => (
            <div
              key={titulo}
              className="rounded-2xl bg-card p-8 shadow-sm ring-1 ring-border"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-primary">
                <Icone className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-heading">
                {titulo}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-body">
                {descricao}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
