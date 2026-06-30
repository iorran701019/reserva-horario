import Hero from "@/components/Hero";

// Raiz "/". Com o multi-tenant agora por rota dinâmica (/[salon]), não existe
// salão padrão: cada salão é acessado pelo seu próprio link (/<slug>). A raiz é
// só uma tela neutra — NÃO resolve tenant nem aponta pra um salão específico.
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-surface">
      <Hero />

      <section className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h2 className="text-xl font-semibold text-heading">
            Selecione um salão
          </h2>
          <p className="mt-2 text-sm text-body">
            Acesse pelo link de agendamento do seu salão para reservar um
            horário.
          </p>
        </div>
      </section>
    </main>
  );
}
