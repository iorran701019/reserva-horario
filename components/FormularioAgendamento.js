"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { gerarSlots } from "@/lib/horarios";

// Wizard de agendamento COMPARTILHADO entre o fluxo público (/agendar, cria
// "pendente") e a aba Agendar do /admin (cria "confirmado"). Toda a lógica de
// serviços, geração de slots, ocupados, validação e insert vive AQUI — os
// consumidores só fornecem a diferença via props (status do insert, rótulo do
// botão, o que fazer no sucesso) e o layout ao redor (Hero, header, tela de
// confirmação). NÃO duplicar a lógica de slots/ocupados em outro lugar.

const ESTADO_INICIAL = {
  nome: "",
  telefone: "",
  data: "",
};

// Ordem das etapas do wizard. Usada pelo indicador de progresso e pela
// navegação "Voltar" (cada etapa volta para a anterior nesta sequência).
const ETAPAS = [
  { id: "servico", rotulo: "Serviço" },
  { id: "data", rotulo: "Data" },
  { id: "dados", rotulo: "Dados" },
];

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

// "HH:MM" da hora atual em horário local — usado pra esconder, na data de
// hoje, os slots que já passaram. Zero-padded de tamanho fixo, igual aos
// slots gerados, pra que a comparação de string ("HH:MM" <= "HH:MM") bata.
function horaDeAgora() {
  const agora = new Date();
  const hora = String(agora.getHours()).padStart(2, "0");
  const min = String(agora.getMinutes()).padStart(2, "0");
  return `${hora}:${min}`;
}

// "YYYY-MM-DD" -> "dd/mm · dia da semana". Parse manual pra evitar o
// deslocamento de fuso que new Date("YYYY-MM-DD") sofre (vira UTC). Exportado
// pra tela de confirmação do consumidor reaproveitar a mesma formatação.
export function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")} · ${DIAS_SEMANA[d.getDay()]}`;
}

// preco_centavos (ex.: 3500) -> "R$ 35,00".
export function formatarPreco(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// "HH:MM" ou "HH:MM:SS" -> minutos desde a meia-noite. Base para tratar cada
// reserva e cada slot candidato como intervalos e detectar sobreposição.
function horaParaMin(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// Helper PURO (sem setState): busca no banco as reservas ativas da data e as
// devolve como INTERVALOS ocupados em minutos. A regra de status (ignorar
// cancelados) vive só aqui. Devolve sempre { ocupados, error } pra quem chama
// decidir o que fazer com o estado. `estabelecimentoId` particiona a consulta
// por salão (a view slots_ocupados já expõe a coluna estabelecimento_id).
async function buscarOcupados(data, duracaoMin, estabelecimentoId) {
  // Sem data ou dia fechado (gerarSlots vazio): nada a consultar.
  if (!data || gerarSlots(data, duracaoMin).length === 0) {
    return { ocupados: [], error: null };
  }

  // A view slots_ocupados já expõe só reservas ativas (status <> 'cancelado')
  // sem vazar dados pessoais; agora também traz a duração de cada reserva.
  const { data: linhas, error } = await supabase
    .from("slots_ocupados")
    .select("horario, duracao_min")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("data", data);

  if (error) return { ocupados: [], error };

  // Cada reserva vira um intervalo [inicio, inicio + duracao_min) em minutos:
  // é a sobreposição (não a igualdade de horário) que trava um slot.
  return {
    ocupados: (linhas ?? []).map((l) => {
      const inicio = horaParaMin(l.horario);
      return { inicio, fim: inicio + l.duracao_min };
    }),
    error: null,
  };
}

// Props:
//   estabelecimento – salão resolvido pelo slug do path ({ id, nome, whatsapp }). O
//                   consumidor só monta o formulário DEPOIS de resolvê-lo, então
//                   aqui ele é sempre não-nulo. Particiona serviços, ocupados e
//                   o insert por estabelecimento_id.
//   status        – status gravado no insert. Omitido (undefined) => mantém o
//                   default do banco ("pendente"), comportamento do público.
//                   O /admin passa "confirmado".
//   rotuloSubmit  – texto do botão de envio (default "Confirmar agendamento").
//   onSucesso     – callback após insert OK, recebe { form, servico, horario }.
//                   O consumidor decide o que mostrar/recarregar; remontar este
//                   componente (via prop key) zera o formulário pro próximo.
export default function FormularioAgendamento({
  estabelecimento,
  status,
  rotuloSubmit = "Confirmar agendamento",
  onSucesso,
}) {
  const [form, setForm] = useState(ESTADO_INICIAL);
  const [horarioSelecionado, setHorarioSelecionado] = useState("");

  // Etapa atual do wizard. Controla só a RENDERIZAÇÃO — a lógica de dados
  // (form, ocupados, validações) permanece a mesma de quando era página única.
  const [etapa, setEtapa] = useState("servico");

  const [servicos, setServicos] = useState([]);
  const [servicoSelecionado, setServicoSelecionado] = useState(null);
  const [carregandoServicos, setCarregandoServicos] = useState(true);
  const [erroServicos, setErroServicos] = useState("");

  const [ocupados, setOcupados] = useState([]);
  const [carregandoSlots, setCarregandoSlots] = useState(false);
  const [erroSlots, setErroSlots] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  // Busca os serviços ativos ao montar (ordenados por nome).
  useEffect(() => {
    let ativo = true;

    async function carregarServicos() {
      const { data, error } = await supabase
        .from("servicos")
        .select("id, nome, duracao_min, preco_centavos")
        .eq("estabelecimento_id", estabelecimento.id)
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
  }, [estabelecimento.id]);

  // Calculado a cada render: barato e mantém a fonte da verdade na função pura.
  // A duração do serviço escolhido define o passo entre os horários.
  const slots = gerarSlots(form.data, servicoSelecionado?.duracao_min);

  const [hoje] = useState(dataDeHoje);

  // Slots que vão pra tela. gerarSlots continua devolvendo a grade COMPLETA do
  // dia; aqui só removemos o que já passou — e SÓ quando a data escolhida é hoje
  // (recalcula a cada render, então troca de data já reflete a hora atual).
  // Data futura: nada é filtrado. Comparação puramente por string "HH:MM".
  const slotsDisponiveis =
    form.data === hoje
      ? slots.filter((slot) => slot > horaDeAgora())
      : slots;

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
        servicoSelecionado?.duracao_min,
        estabelecimento.id
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
  }, [form.data, servicoSelecionado, estabelecimento.id]);

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
    // Avanço automático: concluir a etapa de serviço leva à de data.
    setEtapa("data");
  }

  // Volta para a etapa anterior preservando o que já foi escolhido —
  // não limpa serviço, data nem horário.
  function voltarEtapa() {
    const indice = ETAPAS.findIndex((e) => e.id === etapa);
    if (indice > 0) setEtapa(ETAPAS[indice - 1].id);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");

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

    // Payload base idêntico ao do público. `status` só entra quando o
    // consumidor o fornece (admin => "confirmado"); omitido, o banco aplica o
    // default "pendente" — comportamento do /agendar público inalterado.
    const payload = {
      nome_cliente: form.nome,
      telefone: form.telefone,
      data: form.data,
      horario: horarioSelecionado,
      servico_id: servicoSelecionado.id,
      estabelecimento_id: estabelecimento.id,
    };
    if (status) payload.status = status;

    const { error } = await supabase.from("agendamentos").insert(payload);

    setEnviando(false);

    if (error) {
      // 23P01 = violação da exclusion constraint agendamentos_sem_sobreposicao:
      // outra reserva sobrepõe esse intervalo — alguém ocupou primeiro.
      const ehHorarioOcupado =
        error.code === "23P01" ||
        /agendamentos_sem_sobreposicao|exclusion constraint/i.test(
          error.message ?? ""
        );

      if (ehHorarioOcupado) {
        setErro("Esse horário acabou de ser reservado. Escolha outro.");
        setHorarioSelecionado("");
        // Recarrega os ocupados pra esse horário passar a aparecer travado.
        const recarregado = await buscarOcupados(
          form.data,
          servicoSelecionado?.duracao_min,
          estabelecimento.id
        );
        if (!recarregado.error) setOcupados(recarregado.ocupados);
        return;
      }

      // Outros erros: mostra a mensagem real do Supabase.
      setErro(error.message);
      return;
    }

    // Sucesso: entrega o resumo ao consumidor (tela de confirmação no público,
    // refetch + reset no admin). Não tocamos no layout ao redor daqui.
    onSucesso?.({
      form,
      servico: servicoSelecionado,
      horario: horarioSelecionado,
    });
  }

  return (
    <>
      {/* Indicador de progresso do wizard. Etapa atual destacada, etapas
          concluídas marcadas com check, etapas futuras neutras. */}
      <ol className="mb-6 flex items-center gap-2">
        {ETAPAS.map((passo, i) => {
          const indiceAtual = ETAPAS.findIndex((p) => p.id === etapa);
          const concluida = i < indiceAtual;
          const atual = i === indiceAtual;

          return (
            <li
              key={passo.id}
              className="flex flex-1 flex-col items-center gap-1.5"
            >
              <span
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ring-1 transition",
                  atual
                    ? "bg-primary text-white ring-primary"
                    : concluida
                    ? "bg-green-100 text-green-700 ring-green-200"
                    : "bg-card text-body ring-border",
                ].join(" ")}
                aria-current={atual ? "step" : undefined}
              >
                {concluida ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-4 w-4"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={[
                  "text-xs font-medium",
                  atual
                    ? "text-heading"
                    : concluida
                    ? "text-green-700"
                    : "text-body",
                ].join(" ")}
              >
                {passo.rotulo}
              </span>
            </li>
          );
        })}
      </ol>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border"
      >
        {/* Etapa 1 — Serviço: alimenta a duração usada na geração de slots. */}
        {etapa === "servico" && (
          <div>
            <span className="mb-1 block text-sm font-medium text-body">
              Serviço
            </span>

            {carregandoServicos && (
              <p className="text-sm text-body">Carregando serviços...</p>
            )}

            {!carregandoServicos && erroServicos && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erroServicos}
              </p>
            )}

            {!carregandoServicos && !erroServicos && servicos.length === 0 && (
              <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
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
                          ? "bg-primary text-white ring-primary"
                          : "bg-card text-body ring-border hover:border-primary hover:ring-primary",
                      ].join(" ")}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{servico.nome}</span>
                        <span
                          className={[
                            "block text-sm",
                            selecionado ? "text-on-primary/90" : "text-body",
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
        )}

        {/* Etapa 2 — Data: campo de data e, depois de escolhida, a grade de
            horários (a grade só aparece após a data, como antes). */}
        {etapa === "data" && (
          <>
            <div>
              <label htmlFor="data" className="mb-1 block text-sm font-medium text-body">
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
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>

            {/* Seletor de horários: precisa de um serviço escolhido (define a
                duração dos slots) e de uma data preenchida. */}
            {!servicoSelecionado && (
              <p className="text-sm text-body">
                Selecione um serviço para ver os horários.
              </p>
            )}

            {servicoSelecionado && form.data && (
              <div>
                <span className="mb-1 block text-sm font-medium text-body">
                  Horário
                </span>

                {carregandoSlots && (
                  <p className="text-sm text-body">Carregando horários...</p>
                )}

                {!carregandoSlots && erroSlots && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                    {erroSlots}
                  </p>
                )}

                {!carregandoSlots && !erroSlots && slots.length === 0 && (
                  <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                    Fechado neste dia.
                  </p>
                )}

                {/* Dia aberto (slots.length > 0) mas tudo já passou: só pode
                    acontecer quando a data é hoje e a hora atual ultrapassou o
                    último horário. Mostra um aviso discreto no lugar da grade. */}
                {!carregandoSlots &&
                  !erroSlots &&
                  slots.length > 0 &&
                  slotsDisponiveis.length === 0 && (
                    <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
                      Não há mais horários disponíveis para hoje.
                    </p>
                  )}

                {!carregandoSlots && !erroSlots && slotsDisponiveis.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slotsDisponiveis.map((slot) => {
                      // O slot candidato começa em `slot` e dura a duração do
                      // serviço escolhido, formando [candInicio, candFim).
                      // Travado se sobrepuser qualquer intervalo ocupado.
                      const candInicio = horaParaMin(slot);
                      const candFim =
                        candInicio + servicoSelecionado.duracao_min;
                      const ocupado = ocupados.some(
                        (intervalo) =>
                          candInicio < intervalo.fim &&
                          intervalo.inicio < candFim
                      );
                      const selecionado = horarioSelecionado === slot;

                      return (
                        <button
                          key={slot}
                          type="button"
                          disabled={ocupado}
                          aria-disabled={ocupado}
                          onClick={() => {
                            setHorarioSelecionado(slot);
                            // Avanço automático: escolher o horário conclui
                            // a etapa de data e leva à de dados.
                            setEtapa("dados");
                          }}
                          aria-pressed={selecionado}
                          className={[
                            "rounded-lg px-2 py-2 text-sm font-medium ring-1 transition",
                            ocupado
                              ? "cursor-not-allowed bg-surface text-muted line-through ring-border"
                              : selecionado
                              ? "bg-primary text-white ring-primary"
                              : "bg-card text-body ring-border hover:border-primary hover:ring-primary",
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
              type="button"
              onClick={voltarEtapa}
              className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Voltar
            </button>
          </>
        )}

        {/* Etapa 3 — Dados: nome, WhatsApp e confirmação. */}
        {etapa === "dados" && (
          <>
            <div>
              <label htmlFor="nome" className="mb-1 block text-sm font-medium text-body">
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
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>

            <div>
              <label htmlFor="telefone" className="mb-1 block text-sm font-medium text-body">
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
                className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>

            <button
              type="submit"
              disabled={enviando}
              className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? "Enviando..." : rotuloSubmit}
            </button>

            <button
              type="button"
              onClick={voltarEtapa}
              className="w-full rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Voltar
            </button>

            {erro && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                {erro}
              </p>
            )}
          </>
        )}
      </form>
    </>
  );
}
