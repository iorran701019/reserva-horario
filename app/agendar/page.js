"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { gerarSlots } from "@/lib/horarios";

const ESTADO_INICIAL = {
  nome: "",
  telefone: "",
  data: "",
};

const DIAS_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

// "YYYY-MM-DD" de hoje em horário local — usado como mínimo do date picker.
function dataDeHoje() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// "YYYY-MM-DD" -> "dd/mm · dia da semana". Parse manual pra evitar o
// deslocamento de fuso que new Date("YYYY-MM-DD") sofre (vira UTC).
function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")} · ${DIAS_SEMANA[d.getDay()]}`;
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

  // Foca o título da confirmação ao montar — leitores de tela anunciam o status.
  const tituloConfirmacaoRef = useRef(null);
  useEffect(() => {
    if (sucesso) tituloConfirmacaoRef.current?.focus();
  }, [sucesso]);

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

    // Mantém form e horarioSelecionado preenchidos: a tela de confirmação
    // os usa pra montar o resumo. O reset acontece em "novo agendamento".
    setSucesso(true);
  }

  function novoAgendamento() {
    setForm(ESTADO_INICIAL);
    setHorarioSelecionado("");
    setSucesso(false);
    setErro("");
  }

  if (sucesso) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-10">
        <div
          role="status"
          className="mx-auto w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-100"
        >
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-10 w-10 text-green-600"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1
            ref={tituloConfirmacaoRef}
            tabIndex={-1}
            className="mt-6 text-2xl font-bold text-zinc-900 outline-none"
          >
            Solicitação enviada!
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Recebemos seu agendamento. Em breve a barbearia confirma seu horário.
          </p>

          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            Aguardando confirmação
          </span>

          <dl className="mt-6 space-y-3 rounded-xl bg-zinc-50 p-4 text-left text-sm ring-1 ring-zinc-100">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Serviço</dt>
              <dd className="font-medium text-zinc-900">Corte simples</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Data</dt>
              <dd className="font-medium text-zinc-900">{formatarData(form.data)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Horário</dt>
              <dd className="font-medium text-zinc-900">{horarioSelecionado}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Nome</dt>
              <dd className="font-medium text-zinc-900">{form.nome}</dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={novoAgendamento}
            className="mt-6 w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800"
          >
            Fazer novo agendamento
          </button>
        </div>
      </main>
    );
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
