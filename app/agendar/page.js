"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { gerarSlots } from "@/lib/horarios";

const ESTADO_INICIAL = {
  nome: "",
  telefone: "",
  data: "",
};

// "YYYY-MM-DD" de hoje em horário local — usado como mínimo do date picker.
function dataDeHoje() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export default function AgendarPage() {
  const [form, setForm] = useState(ESTADO_INICIAL);
  const [horarioSelecionado, setHorarioSelecionado] = useState("");

  const [ocupados, setOcupados] = useState([]);
  const [carregandoSlots, setCarregandoSlots] = useState(false);
  const [erroSlots, setErroSlots] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState("");

  // Calculado a cada render: barato e mantém a fonte da verdade na função pura.
  const slots = gerarSlots(form.data);
  const ocupadosSet = new Set(ocupados);

  const [hoje] = useState(dataDeHoje);

  // Busca, no banco, SOMENTE os horários já ocupados naquela data.
  // Disparada por evento (troca de data / erro de duplicidade), não por effect:
  // é o que o React 19 recomenda pra reações a interações do usuário.
  async function carregarOcupados(data) {
    setErroSlots("");

    // Sem data ou dia fechado (domingo): nada a consultar.
    if (!data || gerarSlots(data).length === 0) {
      setOcupados([]);
      return;
    }

    setCarregandoSlots(true);

    const { data: linhas, error } = await supabase
      .from("agendamentos")
      .select("horario")
      .eq("data", data);

    setCarregandoSlots(false);

    if (error) {
      setErroSlots(error.message);
      setOcupados([]);
      return;
    }

    // O Postgres devolve horario como "HH:MM:SS"; normalizamos pra "HH:MM"
    // senão a comparação com os slots gerados não bate.
    setOcupados((linhas ?? []).map((linha) => linha.horario.slice(0, 5)));
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((anterior) => ({ ...anterior, [name]: value }));

    // Trocar a data invalida o horário escolhido e recarrega os ocupados do dia.
    if (name === "data") {
      setHorarioSelecionado("");
      carregarOcupados(value);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setSucesso(false);

    if (!form.nome || !form.telefone || !form.data) {
      setErro("Preencha nome, telefone e data para continuar.");
      return;
    }

    if (!horarioSelecionado) {
      setErro("Selecione um horário disponível.");
      return;
    }

    setEnviando(true);

    const { error } = await supabase.from("agendamentos").insert({
      nome_cliente: form.nome,
      telefone: form.telefone,
      data: form.data,
      horario: horarioSelecionado,
    });

    setEnviando(false);

    if (error) {
      // 23505 = violação da UNIQUE (data, horario): alguém reservou primeiro.
      const ehHorarioDuplicado =
        error.code === "23505" ||
        /duplicate key|violates unique constraint/i.test(error.message ?? "");

      if (ehHorarioDuplicado) {
        setErro("Esse horário acabou de ser reservado. Escolha outro.");
        setHorarioSelecionado("");
        // Recarrega os ocupados pra esse horário passar a aparecer travado.
        await carregarOcupados(form.data);
        return;
      }

      // Outros erros: mostra a mensagem real do Supabase.
      setErro(error.message);
      return;
    }

    setSucesso(true);
    setForm(ESTADO_INICIAL);
    setHorarioSelecionado("");
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-zinc-900">Agende seu horário</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Escolha a data e o horário disponível.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100"
        >
          <div>
            <label htmlFor="nome" className="mb-1 block text-sm font-medium text-zinc-700">
              Nome
            </label>
            <input
              id="nome"
              name="nome"
              type="text"
              value={form.nome}
              onChange={handleChange}
              required
              placeholder="Seu nome"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>

          <div>
            <label htmlFor="telefone" className="mb-1 block text-sm font-medium text-zinc-700">
              Telefone
            </label>
            <input
              id="telefone"
              name="telefone"
              type="tel"
              inputMode="tel"
              value={form.telefone}
              onChange={handleChange}
              required
              placeholder="(00) 00000-0000"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>

          <div>
            <label htmlFor="data" className="mb-1 block text-sm font-medium text-zinc-700">
              Data
            </label>
            <input
              id="data"
              name="data"
              type="date"
              value={form.data}
              onChange={handleChange}
              min={hoje}
              required
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>

          {/* Seletor de horários: só aparece depois que uma data é escolhida. */}
          {form.data && (
            <div>
              <span className="mb-1 block text-sm font-medium text-zinc-700">
                Horário
              </span>

              {carregandoSlots && (
                <p className="text-sm text-zinc-500">Carregando horários...</p>
              )}

              {!carregandoSlots && erroSlots && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                  {erroSlots}
                </p>
              )}

              {!carregandoSlots && !erroSlots && slots.length === 0 && (
                <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-500">
                  Fechado neste dia.
                </p>
              )}

              {!carregandoSlots && !erroSlots && slots.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((slot) => {
                    const ocupado = ocupadosSet.has(slot);
                    const selecionado = horarioSelecionado === slot;

                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={ocupado}
                        onClick={() => setHorarioSelecionado(slot)}
                        aria-pressed={selecionado}
                        className={[
                          "rounded-lg px-2 py-2 text-sm font-medium ring-1 transition",
                          ocupado
                            ? "cursor-not-allowed bg-zinc-100 text-zinc-300 line-through ring-zinc-200"
                            : selecionado
                            ? "bg-zinc-900 text-white ring-zinc-900"
                            : "bg-white text-zinc-700 ring-zinc-300 hover:border-zinc-900 hover:ring-zinc-400",
                        ].join(" ")}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? "Enviando..." : "Confirmar agendamento"}
          </button>

          {sucesso && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 ring-1 ring-green-100">
              Agendamento enviado com sucesso! Em breve confirmaremos seu horário.
            </p>
          )}

          {erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erro}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
