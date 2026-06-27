import Link from "next/link";
import Hero from "@/components/Hero";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-surface">
      <Hero />

      <section className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h2 className="text-xl font-semibold text-heading">
            Pronto para se cuidar?
          </h2>
          <p className="mt-2 text-sm text-body">
            Agende seu horário online em poucos passos.
          </p>
          <Link
            href="/agendar"
            className="mt-6 inline-block w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-on-primary transition hover:bg-primary-hover"
          >
            Agendar horário
          </Link>
        </div>
      </section>
    </main>
  );
}
