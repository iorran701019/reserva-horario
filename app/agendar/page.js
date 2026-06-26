"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { gerarSlots, WHATSAPP_LOJA } from "@/lib/horarios";
import { linkWhatsApp } from "@/lib/whatsapp";

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

// preco_centavos (ex.: 3500) -> "R$ 35,00".
function formatarPreco(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Helper PURO (sem setState): busca no banco os horários já ocupados na data.
// A regra de status (ignorar cancelados) vive só aqui. Devolve sempre
// { ocupados, error } pra quem chama decidir o que fazer com o estado.
async function buscarOcupados(data, duracaoMin) {
  // Sem data ou dia fechado (gerarSlots vazio): nada a consultar.
  if (!data || gerarSlots(data, duracaoMin).length === 0) {
    return { ocupados: [], error: null };
  }

  const { data: linhas, error } = await supabase
    .from("slots_ocupados")
    .select("horario")
    .eq("data", data);

  if (error) return { ocupados: [], error };

  // O Postgres devolve horario como "HH:MM:SS"; normalizamos pra "HH:MM"
  // senão a comparação com os slots gerados não bate.
  return {
    ocupados: (linhas ?? []).map((l) => l.horario.slice(0, 5)),
    error: null,
  };
}

export default function AgendarPage() {
  const [form, setForm] = useState(ESTADO_INICIAL);
  const [horarioSelecionado, setHorarioSelecionado] = useState("");

  const [servicos, setServicos] = useState([]);
  const [servicoSelecionado, setServicoSelecionado] = useState(null);
  const [carregandoServicos, setCarregandoServicos] = useState(true);
  const [erroServicos, setErroServicos] = useState("");

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

  // Busca os serviços ativos ao montar a página (ordenados por nome).
  useEffect(() => {
    let ativo = true;

    async function carregarServicos() {
      const { data, error } = await supabase
        .from("servicos")
        .select("id, nome, duracao_min, preco_centavos")
        .eq("ativo", true)
        .order("nome");

      if (!ativo) return;

      if (error) {
        setErroServicos(error.message);
      } else {
        setServicos(data ?? []);
      }
      setCarregandoServicos(false);
    }

    carregarServicos();
    return () => {
      ativo = false;
    };
  }, []);

  // Calculado a cada render: barato e mantém a fonte da verdade na função pura.
  // A duração do serviço escolhido define o passo entre os horários.
  const slots = gerarSlots(form.data, servicoSelecionado?.duracao_min);
  const ocupadosSet = new Set(ocupados);

  const [hoje] = useState(dataDeHoje);

  // Mantém `ocupados` sincronizado com a data/serviço selecionados.
  // Busca async declarada DENTRO do efeito (padrão idiomático): os setState
  // ficam aqui, ao redor do helper puro buscarOcupados, e a flag `ativo`
  // cancela corridas entre datas / setState após desmontar.
  useEffect(() => {
    if (!form.data) return;
    let ativo = true;

    async function sincronizar() {
      setErroSlots("");
      setCarregandoSlots(true);

      const { ocupados, error } = await buscarOcupados(
        form.data,
        servicoSelecionado?.duracao_min
      );

      if (!ativo) return;

      setCarregandoSlots(false);

      if (error) {
        setErroSlots(error.message);
        setOcupados([]);
        return;
      }

      setOcupados(ocupados);
    }

    sincronizar();
    return () => {
      ativo = false;
    };
  }, [form.data, servicoSelecionado]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((anterior) => ({ ...anterior, [name]: value }));

    // Trocar a data invalida o horário escolhido; o useEffect [form.data]
    // cuida de recarregar os ocupados do novo dia.
    if (name === "data") {
      setHorarioSelecionado("");
    }
  }

  // Trocar de serviço muda a duração e, portanto, os slots gerados:
  // o horário escolhido pode não existir mais, então o limpamos.
  function selecionarServico(servico) {
    setServicoSelecionado(servico);
    setHorarioSelecionado("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setSucesso(false);

    if (!form.nome || !form.telefone || !form.data) {
      setErro("Preencha nome, WhatsApp e data para continuar.");
      return;
    }

    // Validação leve: pelo menos 10 dígitos (DDD + número) após limpar a máscara.
    if (form.telefone.replace(/\D/g, "").length < 10) {
      setErro("Informe um WhatsApp válido com DDD.");
      return;
    }

    if (!servicoSelecionado) {
      setErro("Selecione um serviço.");
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
      servico_id: servicoSelecionado.id,
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
        const recarregado = await buscarOcupados(
          form.data,
          servicoSelecionado?.duracao_min
        );
        if (!recarregado.error) setOcupados(recarregado.ocupados);
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
    setServicoSelecionado(null);
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
              <dd className="font-medium text-zinc-900">
                {servicoSelecionado?.nome}
              </dd>
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

          <a
            href={linkWhatsApp(
              WHATSAPP_LOJA,
              `Olá! Acabei de solicitar um agendamento de ${servicoSelecionado?.nome} para ${formatarData(form.data)} às ${horarioSelecionado}. Meu nome é ${form.nome}.`
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 font-medium text-green-700 ring-1 ring-green-600 transition hover:bg-green-50"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24.044 12.045.044 5.463.044.102 5.404.1 11.986c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.582 0 11.943-5.361 11.945-11.945a11.86 11.86 0 00-3.418-8.4" />
            </svg>
            Falar no WhatsApp
          </a>
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
              WhatsApp
            </label>
            <input
              id="telefone"
              name="telefone"
              type="tel"
              inputMode="tel"
              value={form.telefone}
              onChange={handleChange}
              required
              placeholder="(24) 99999-9999"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>

          {/* Seletor de serviço: alimenta a duração usada na geração de slots. */}
          <div>
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Serviço
            </span>

            {carregandoServicos && (
              <p className="text-sm text-zinc-500">Carregando serviços...</p>
            )}

            {!carregandoServicos && erroServicos && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroServicos}
              </p>
            )}

            {!carregandoServicos && !erroServicos && servicos.length === 0 && (
              <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-500">
                Nenhum serviço disponível no momento.
              </p>
            )}

            {!carregandoServicos && !erroServicos && servicos.length > 0 && (
              <div className="space-y-2">
                {servicos.map((servico) => {
                  const selecionado = servicoSelecionado?.id === servico.id;

                  return (
                    <button
                      key={servico.id}
                      type="button"
                      onClick={() => selecionarServico(servico)}
                      aria-pressed={selecionado}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left ring-1 transition",
                        selecionado
                          ? "bg-zinc-900 text-white ring-zinc-900"
                          : "bg-white text-zinc-700 ring-zinc-300 hover:border-zinc-900 hover:ring-zinc-400",
                      ].join(" ")}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{servico.nome}</span>
                        <span
                          className={[
                            "block text-sm",
                            selecionado ? "text-zinc-300" : "text-zinc-500",
                          ].join(" ")}
                        >
                          {servico.duracao_min} min
                        </span>
                      </span>

                      {servico.preco_centavos != null && (
                        <span className="shrink-0 font-medium">
                          {formatarPreco(servico.preco_centavos)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
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

          {/* Seletor de horários: precisa de um serviço escolhido (define a
              duração dos slots) e de uma data preenchida. */}
          {!servicoSelecionado && (
            <p className="text-sm text-zinc-500">
              Selecione um serviço para ver os horários.
            </p>
          )}

          {servicoSelecionado && form.data && (
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
                        aria-disabled={ocupado}
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
