"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatarPreco } from "@/components/FormularioAgendamento";

// Aba "Profissionais" do /admin: CRUD dos profissionais do salão (tabela
// `profissionais`), sempre particionado por estabelecimento_id (o consumidor já
// resolveu o salão e passa o objeto via prop). Segue o MESMO padrão visual da
// aba "Serviços": cards ring-border, criar/editar inline, soft delete com modal
// de confirmação — nenhuma resolução de tenant vive aqui.
//
// A LISTA e o soft delete seguem iguais; muda só o criar/editar:
//   - CRIAR  → wizard em 3 janelas (A: identificação+dias / B: horários /
//              C: serviços que o profissional atende), navegável por
//              "Voltar"/"Avançar"; o botão Salvar mora na Janela C.
//   - EDITAR → tela de resumo com todos os dados (nome, dias, horários,
//              serviços), tudo editável de uma vez, sem refazer o wizard.
//
// Convenções das tabelas:
//   profissionais.ativo      – "excluir" é soft delete (ativo=false); NUNCA
//                              DELETE físico, pra preservar agendamentos antigos.
//   horarios_trabalho        – uma linha por (profissional_id, dia_semana);
//                              dia_semana 0=domingo … 6=sábado; hora_inicio/
//                              hora_fim (time); almoco_inicio/almoco_fim (time,
//                              OPCIONAL, tudo-ou-nada). Regras espelhadas na UI:
//                              hora_fim > hora_inicio e almoço tudo-ou-nada, pra
//                              o insert nunca bater nas checks do banco.
//   servico_profissional     – vínculo N:N (servico_id, profissional_id): quais
//                              serviços o profissional atende. Gravado com a mesma
//                              estratégia "substitui tudo" dos horários (apaga os
//                              vínculos do profissional e reinsere os marcados).

// Troca de modo_horario ('janela'/'fixo') é operação sensível (reidrata toda a
// agenda do profissional) — por ora fica controlada manualmente via SQL direto
// em vez de exposta na tela de edição. Só oculta o seletor da EDIÇÃO (o wizard
// de criação continua com o seletor normal); o valor salvo continua sendo
// respeitado no cálculo de disponibilidade. Reverter: true.
const MOSTRAR_TOGGLE_MODO_HORARIO = false;

// Dias da semana no padrão de Date.getDay()/dia_semana: 0=domingo … 6=sábado.
const DIAS = [
  { n: 0, rotulo: "Domingo", curto: "Dom" },
  { n: 1, rotulo: "Segunda", curto: "Seg" },
  { n: 2, rotulo: "Terça", curto: "Ter" },
  { n: 3, rotulo: "Quarta", curto: "Qua" },
  { n: 4, rotulo: "Quinta", curto: "Qui" },
  { n: 5, rotulo: "Sexta", curto: "Sex" },
  { n: 6, rotulo: "Sábado", curto: "Sáb" },
];

// Etapas do wizard de criação (só no "novo"). A edição usa a tela de resumo.
const ETAPAS = [
  { id: "A", rotulo: "Identificação e dias" },
  { id: "B", rotulo: "Horários" },
  { id: "C", rotulo: "Serviços" },
];

// Abas da tela de edição (switcher local). A criação segue no wizard; só a
// edição é dividida nestas três seções.
const ABAS_EDICAO = [
  { id: "horarios", rotulo: "Horários" },
  { id: "servicos", rotulo: "Serviços" },
  { id: "ausencias", rotulo: "Exceções de Horário" },
];

// Bloco de horário vazio (campos "HH:MM" do <input type="time">; "" = vazio).
const BLOCO_VAZIO = {
  hora_inicio: "",
  hora_fim: "",
  almoco_inicio: "",
  almoco_fim: "",
};

// Grade de horário vazia: 7 dias, todos desligados. Cada dia é um BLOCO + ativo.
function diasVazios() {
  return DIAS.map(() => ({ ativo: false, ...BLOCO_VAZIO }));
}

// Grade vazia do modo 'fixo': 7 arrays de horários "HH:MM" (tags), um por dia.
function horariosFixosVazios() {
  return DIAS.map(() => []);
}

// Estado inicial do formulário. `modoHorario` ('janela'|'fixo', profissionais.
// modo_horario) decide qual grade vale: 'janela' usa `dias`/`horarioComum`
// (horarios_trabalho); 'fixo' usa `horariosFixosPorDia` (horarios_fixos), e
// `dias[i].ativo` continua controlando quais dias estão ligados nos dois
// modos. `mesmoHorario`:
//   null  – ainda não respondido (Janela A, só importa no modo 'janela')
//   true  – um único horário aplicado a todos os dias ativos (usa horarioComum)
//   false – horário próprio por dia (usa os campos de cada `dias[i]`)
// `temAlmoco` controla só a VISIBILIDADE dos campos de almoço (bloco único no
// modo "Sim", coluna inteira da grade no modo "Não"). Desmarcar apenas recolhe
// os campos — NÃO zera os valores em memória; ao remarcar, eles voltam. O almoço
// só vira null ao salvar (ver handleSalvar). `almocoSalvoOriginal` guarda se o
// profissional JÁ tinha almoço salvo no banco quando o form abriu: é o que
// dispara o confirm de remoção (desmarcar + tinha almoço antes = remoção real).
const FORM_INICIAL = {
  nome: "",
  dias: diasVazios(),
  modoHorario: "janela",
  horariosFixosPorDia: horariosFixosVazios(),
  mesmoHorario: null,
  temAlmoco: false,
  almocoSalvoOriginal: false,
  horarioComum: { ...BLOCO_VAZIO },
  servicos: [], // ids dos serviços (servicos.id) que o profissional atende
};

// "HH:MM:SS" (time do Postgres) -> "HH:MM" pro <input type="time">. Aceita já
// no formato curto ou vazio/null.
function paraHHMM(hora) {
  return hora ? String(hora).slice(0, 5) : "";
}

// "HH:MM" -> minutos desde a meia-noite, pra comparar início/fim.
function minutos(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Valida um bloco de horário (entrada/almoço/saída), espelhando as checks do
// banco. Devolve a mensagem de erro (string) ou null se estiver ok. `rotulo`
// prefixa a mensagem (nome do dia, ou "Horário" no modo "mesmo pra todos").
// `temAlmoco=false` pula toda a validação de almoço (ele será gravado null).
function validarBloco(bloco, rotulo, temAlmoco) {
  if (!bloco.hora_inicio || !bloco.hora_fim) {
    return `${rotulo}: informe início e fim do expediente.`;
  }
  if (minutos(bloco.hora_fim) <= minutos(bloco.hora_inicio)) {
    return `${rotulo}: o fim deve ser maior que o início.`;
  }

  if (!temAlmoco) return null;

  const temInicioAlmoco = Boolean(bloco.almoco_inicio);
  const temFimAlmoco = Boolean(bloco.almoco_fim);
  if (temInicioAlmoco !== temFimAlmoco) {
    return `${rotulo}: preencha início e fim do almoço, ou deixe ambos vazios.`;
  }
  if (temInicioAlmoco && temFimAlmoco) {
    if (minutos(bloco.almoco_fim) <= minutos(bloco.almoco_inicio)) {
      return `${rotulo}: o fim do almoço deve ser maior que o início.`;
    }
    if (
      minutos(bloco.almoco_inicio) < minutos(bloco.hora_inicio) ||
      minutos(bloco.almoco_fim) > minutos(bloco.hora_fim)
    ) {
      return `${rotulo}: o almoço deve ficar dentro do expediente.`;
    }
  }

  return null;
}

// Uma linha de horarios_trabalho a partir de um bloco (almoço "" -> null).
// Com `temAlmoco=false` o almoço é sempre null (checkbox "Almoço" desmarcada).
function linhaDia(diaSemana, bloco, temAlmoco) {
  return {
    dia_semana: diaSemana,
    hora_inicio: bloco.hora_inicio,
    hora_fim: bloco.hora_fim,
    almoco_inicio: temAlmoco ? bloco.almoco_inicio || null : null,
    almoco_fim: temAlmoco ? bloco.almoco_fim || null : null,
  };
}

// Valida o formulário inteiro e monta os dados prontos pra gravar. Devolve
// { erro } ou { nome, modoHorario, horarios } (modo 'janela') / { nome,
// modoHorario, horariosFixos } (modo 'fixo').
//
// Modo 'janela': no "mesmo horário" (mesmoHorario = true) valida o bloco
// comum uma vez e o REPLICA em cada dia ativo; senão valida e usa o bloco
// próprio de cada dia.
//
// Modo 'fixo': cada dia ativo precisa de PELO MENOS um horário na lista de
// tags (`horariosFixosPorDia[i]`) — um dia ligado sem horário deixaria a
// agenda vazia nesse dia sem o dono perceber, então bloqueia aqui.
function coletarDados(form) {
  const nome = form.nome.trim();
  if (!nome) return { erro: "Informe o nome do profissional." };

  const indicesAtivos = [];
  for (let i = 0; i < form.dias.length; i++) {
    if (form.dias[i].ativo) indicesAtivos.push(i);
  }
  if (indicesAtivos.length === 0) {
    return { erro: "Selecione ao menos um dia de trabalho." };
  }

  if (form.modoHorario === "fixo") {
    const diaSemHorario = indicesAtivos.find(
      (i) => form.horariosFixosPorDia[i].length === 0
    );
    if (diaSemHorario != null) {
      return {
        erro: `${DIAS[diaSemHorario].rotulo}: cadastre ao menos um horário fixo (ou desative o dia).`,
      };
    }
    const horariosFixos = indicesAtivos.flatMap((i) =>
      form.horariosFixosPorDia[i].map((horario) => ({ dia_semana: i, horario }))
    );
    return { nome, modoHorario: "fixo", horariosFixos };
  }

  const temAlmoco = form.temAlmoco;
  const horarios = [];
  if (form.mesmoHorario) {
    const erro = validarBloco(form.horarioComum, "Horário", temAlmoco);
    if (erro) return { erro };
    for (const i of indicesAtivos) {
      horarios.push(linhaDia(i, form.horarioComum, temAlmoco));
    }
  } else {
    for (const i of indicesAtivos) {
      const erro = validarBloco(form.dias[i], DIAS[i].rotulo, temAlmoco);
      if (erro) return { erro };
      horarios.push(linhaDia(i, form.dias[i], temAlmoco));
    }
  }

  return { nome, modoHorario: "janela", horarios };
}

// Linhas de horarios_trabalho -> grade de 7 dias (pra reidratar o form). Usado
// ao editar e no fallback quando a criação do profissional dá certo mas a grade
// falha (aí caímos na tela de resumo já com os horários que o dono digitou).
function diasDeHorarios(horarios) {
  const dias = diasVazios();
  for (const h of horarios) {
    dias[h.dia_semana] = {
      ativo: true,
      hora_inicio: paraHHMM(h.hora_inicio),
      hora_fim: paraHHMM(h.hora_fim),
      almoco_inicio: paraHHMM(h.almoco_inicio),
      almoco_fim: paraHHMM(h.almoco_fim),
    };
  }
  return dias;
}

// Linhas de horarios_fixos -> grade de 7 dias {ativo, ...BLOCO_VAZIO} (só o
// `ativo` importa no modo 'fixo'; os campos de bloco ficam vazios/sem uso).
// Um dia aparece ativo se tiver PELO MENOS uma linha — a validação de
// coletarDados garante que todo dia ativo salvo tem ao menos um horário.
function diasDeHorariosFixos(linhas) {
  const dias = diasVazios();
  for (const l of linhas) {
    dias[l.dia_semana] = { ...dias[l.dia_semana], ativo: true };
  }
  return dias;
}

// Linhas de horarios_fixos -> grade de 7 arrays de "HH:MM" (as tags de cada
// dia), ordenadas.
function horariosFixosPorDiaDeLinhas(linhas) {
  const porDia = horariosFixosVazios();
  for (const l of linhas) {
    porDia[l.dia_semana] = [...porDia[l.dia_semana], paraHHMM(l.horario)].sort();
  }
  return porDia;
}

// Reconstrói o form pra tela de resumo quando a criação do profissional deu
// certo mas a gravação da agenda/serviços falhou (cai no fallback de edição,
// já com os dados que o dono digitou, pra corrigir/reenviar). Espelha o
// resultado de coletarDados (janela: horarios; fixo: horariosFixos).
function formDeFallback({ nome, modoHorario, horarios, horariosFixos, servicos, almocoSalvoOriginal }) {
  if (modoHorario === "fixo") {
    return {
      nome,
      dias: diasDeHorariosFixos(horariosFixos),
      modoHorario: "fixo",
      horariosFixosPorDia: horariosFixosPorDiaDeLinhas(horariosFixos),
      mesmoHorario: false,
      temAlmoco: false,
      almocoSalvoOriginal: false,
      horarioComum: { ...BLOCO_VAZIO },
      servicos,
    };
  }
  return {
    nome,
    dias: diasDeHorarios(horarios),
    modoHorario: "janela",
    horariosFixosPorDia: horariosFixosVazios(),
    mesmoHorario: false,
    temAlmoco: horarios.some((h) => h.almoco_inicio),
    almocoSalvoOriginal,
    horarioComum: { ...BLOCO_VAZIO },
    servicos,
  };
}

// Interruptor visual (liga/desliga) reutilizado nos toggles de dia. Só o
// desenho; o <button> que o envolve trata o clique/aria.
function Interruptor({ ativo }) {
  return (
    <span
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        ativo ? "bg-primary" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          ativo ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

// Checkbox pequena "Almoço" que revela/esconde os campos de almoço. Controla o
// bloco único (modo "Sim") ou a coluna inteira da grade (modo "Não"/edição).
function CheckAlmoco({ checked, onChange }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
      />
      Almoço
    </label>
  );
}

// Campos compactos de um bloco de horário: entrada, saída e — só quando
// `mostrarAlmoco` — almoço (início/fim), lado a lado (quebram em telas
// estreitas). `onCampo(campo, valor)` patcha o bloco no pai. `rotulo` só entra
// nos aria-labels (acessibilidade).
function CamposHorario({ bloco, onCampo, rotulo, mostrarAlmoco }) {
  const classe =
    "mt-1 w-28 rounded-lg border border-border px-2 py-1.5 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10";
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-body">
        Entrada
        <input
          type="time"
          aria-label={`Entrada — ${rotulo}`}
          value={bloco.hora_inicio}
          onChange={(e) => onCampo("hora_inicio", e.target.value)}
          className={classe}
        />
      </label>
      {mostrarAlmoco && (
        <>
          <label className="text-xs font-medium text-body">
            Almoço início
            <input
              type="time"
              aria-label={`Início do almoço — ${rotulo}`}
              value={bloco.almoco_inicio}
              onChange={(e) => onCampo("almoco_inicio", e.target.value)}
              className={classe}
            />
          </label>
          <label className="text-xs font-medium text-body">
            Almoço fim
            <input
              type="time"
              aria-label={`Fim do almoço — ${rotulo}`}
              value={bloco.almoco_fim}
              onChange={(e) => onCampo("almoco_fim", e.target.value)}
              className={classe}
            />
          </label>
        </>
      )}
      <label className="text-xs font-medium text-body">
        Saída
        <input
          type="time"
          aria-label={`Saída — ${rotulo}`}
          value={bloco.hora_fim}
          onChange={(e) => onCampo("hora_fim", e.target.value)}
          className={classe}
        />
      </label>
    </div>
  );
}

// Grade compacta por dia (usada no modo "horário próprio por dia" e na tela de
// resumo da edição). Uma linha por dia: rótulo + toggle à esquerda; quando o
// dia está ativo, os campos de horário aparecem ao lado (quebram no mobile).
// `onToggle(i)` liga/desliga o dia; `onCampo(i, campo, valor)` edita um horário.
// `mostrarAlmoco` revela a coluna de almoço em todas as linhas.
function GradeDias({ dias, onToggle, onCampo, mostrarAlmoco }) {
  return (
    <div className="space-y-2">
      {DIAS.map((info, i) => {
        const dia = dias[i];
        return (
          <div
            key={info.n}
            className={`rounded-xl p-2.5 ring-1 transition ${
              dia.ativo ? "bg-card ring-border" : "bg-surface ring-border"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => onToggle(i)}
                role="switch"
                aria-checked={dia.ativo}
                className="flex items-center justify-between gap-3 sm:w-32 sm:shrink-0"
              >
                <span className="text-sm font-medium text-heading">
                  {info.rotulo}
                </span>
                <Interruptor ativo={dia.ativo} />
              </button>

              {dia.ativo && (
                <div className="sm:flex-1">
                  <CamposHorario
                    bloco={dia}
                    rotulo={info.rotulo}
                    mostrarAlmoco={mostrarAlmoco}
                    onCampo={(campo, valor) => onCampo(i, campo, valor)}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Chip removível de horário fixo — "HH:MM" + botão "x".
function TagHorario({ horario, onRemover }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-medium text-heading ring-1 ring-border">
      {horario}
      <button
        type="button"
        onClick={onRemover}
        aria-label={`Remover horário ${horario}`}
        className="leading-none text-muted transition hover:text-red-600"
      >
        ×
      </button>
    </span>
  );
}

// Campo "adicionar horário" de UM dia no modo 'fixo': input de horário +
// botão "+", que insere numa lista de tags removíveis. `horarios` já vem
// ordenado; `onAdicionar`/`onRemover` recebem o valor "HH:MM". Sem nenhuma
// tag, mostra um aviso (o dia está ativo mas ainda não tem horário — bloqueia
// o salvar, ver coletarDados/diaFixoSemHorario).
function CamposHorariosFixos({ horarios, onAdicionar, onRemover, rotulo }) {
  const [novo, setNovo] = useState("");

  function adicionar() {
    if (!novo) return;
    onAdicionar(novo);
    setNovo("");
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="time"
          aria-label={`Novo horário — ${rotulo}`}
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          className="w-28 rounded-lg border border-border px-2 py-1.5 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        <button
          type="button"
          onClick={adicionar}
          disabled={!novo}
          className="rounded-lg bg-card px-2.5 py-1.5 text-sm font-medium text-primary ring-1 ring-primary/40 transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Adicionar
        </button>
      </div>
      {horarios.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {horarios.map((h) => (
            <TagHorario key={h} horario={h} onRemover={() => onRemover(h)} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs font-medium text-amber-600">
          Nenhum horário cadastrado ainda.
        </p>
      )}
    </div>
  );
}

// Grade compacta por dia no modo 'fixo' (mesmo toggle ativa/inativa de
// GradeDias); quando o dia está ativo, mostra a lista de tags de horário no
// lugar dos campos de Entrada/Almoço/Saída.
function GradeDiasFixos({ dias, onToggle, horariosFixosPorDia, onAdicionarHorario, onRemoverHorario }) {
  return (
    <div className="space-y-2">
      {DIAS.map((info, i) => {
        const dia = dias[i];
        return (
          <div
            key={info.n}
            className={`rounded-xl p-2.5 ring-1 transition ${
              dia.ativo ? "bg-card ring-border" : "bg-surface ring-border"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <button
                type="button"
                onClick={() => onToggle(i)}
                role="switch"
                aria-checked={dia.ativo}
                className="flex items-center justify-between gap-3 sm:w-32 sm:shrink-0"
              >
                <span className="text-sm font-medium text-heading">
                  {info.rotulo}
                </span>
                <Interruptor ativo={dia.ativo} />
              </button>

              {dia.ativo && (
                <div className="sm:flex-1">
                  <CamposHorariosFixos
                    horarios={horariosFixosPorDia[i]}
                    rotulo={info.rotulo}
                    onAdicionar={(h) => onAdicionarHorario(i, h)}
                    onRemover={(h) => onRemoverHorario(i, h)}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Janela C / seção de serviços: lista os serviços ATIVOS do salão com checkbox;
// marcar define quais o profissional atende (grava em servico_profissional).
// `selecionados` é o array de ids marcados; `onToggle(id)` liga/desliga um.
// Sem serviços cadastrados, orienta a cadastrar antes (em vez de lista vazia).
function ListaServicos({ servicos, carregando, erro, selecionados, onToggle }) {
  if (carregando) {
    return (
      <p className="rounded-lg bg-surface px-3 py-3 text-sm text-body ring-1 ring-border">
        Carregando serviços...
      </p>
    );
  }

  if (erro) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
        {erro}
      </p>
    );
  }

  if (servicos.length === 0) {
    return (
      <div className="rounded-xl bg-surface px-4 py-6 text-center ring-1 ring-border">
        <p className="text-sm text-body">
          Cadastre serviços primeiro na aba Serviços.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {servicos.map((servico) => {
        const marcado = selecionados.includes(servico.id);
        return (
          <li key={servico.id}>
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-1 transition ${
                marcado ? "bg-card ring-primary/40" : "bg-surface ring-border hover:bg-card"
              }`}
            >
              <input
                type="checkbox"
                checked={marcado}
                onChange={() => onToggle(servico.id)}
                className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-heading">
                  {servico.nome}
                </span>
                <span className="block text-xs text-muted">
                  {servico.duracao_min} min · {formatarPreco(servico.preco_centavos)}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

// "YYYY-MM-DD" (date do Postgres) -> "DD/MM/AAAA". Monta o Date por partes
// (new Date(ano, mes-1, dia)) e NUNCA new Date("YYYY-MM-DD"): o construtor de
// string interpreta como UTC e, em GMT-3, joga a data pro dia anterior.
function formatarDataBR(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// "HH:MM:SS"/"HH:MM" -> "HH:MM – HH:MM" pra rótulo de faixa de horário.
function faixaHora(inicio, fim) {
  return `${paraHHMM(inicio)} – ${paraHHMM(fim)}`;
}

// Selo pequeno "Bloqueio"/"Liberação" pra distinguir os dois tipos de
// registro na lista de ausências (tipo_registro ausente = ausencia, linhas
// antigas de antes da coluna existir).
function SeloTipoRegistro({ tipoRegistro }) {
  const liberacao = tipoRegistro === "liberacao";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        liberacao
          ? "bg-green-50 text-green-700 ring-1 ring-green-100"
          : "bg-red-50 text-red-700 ring-1 ring-red-100"
      }`}
    >
      {liberacao ? "Liberação" : "Bloqueio"}
    </span>
  );
}

// Agrupa as ausências recorrentes por faixa de horário + natureza
// (hora_inicio|hora_fim|tipo_registro): dias com a MESMA faixa E a mesma
// natureza (bloqueio/liberação) entram no mesmo grupo (ordenados por dia da
// semana). Cada dia continua sendo uma linha própria (id próprio) — o delete
// é por id.
function agruparRecorrentes(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    const chave = `${l.hora_inicio ?? ""}|${l.hora_fim ?? ""}|${l.tipo_registro ?? "ausencia"}`;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(l);
  }
  return [...mapa.values()].map((itens) => ({
    inicio: itens[0].hora_inicio,
    tipoRegistro: itens[0].tipo_registro ?? "ausencia",
    fim: itens[0].hora_fim,
    itens: [...itens].sort((a, b) => a.dia_semana - b.dia_semana),
  }));
}

// Seção "Ausências" da tela de edição do profissional: CRUD da tabela
// `ausencias` (só cadastro/listagem/exclusão — o motor de disponibilidade NÃO
// é tocado aqui). Duas naturezas na mesma tabela:
//   recorrente – repete toda semana num dia (dia_semana 0..6) numa faixa
//                hora_inicio/hora_fim. Salvar insere UMA LINHA POR DIA marcado,
//                todas com a mesma faixa (dia_inteiro sempre false).
//   periodo    – intervalo data_inicio..data_fim (início=fim = um único dia).
//                dia_inteiro=true bloqueia o dia todo (horas null); senão usa a
//                faixa hora_inicio/hora_fim (obrigatória).
// Auto-contida: carrega, insere e exclui direto no Supabase por profissional_id.
//
// Uma única lista suspensa escolhe o formato de cadastro:
//   recorrente – "Ausência fixa": dias da semana + faixa, uma linha por dia.
//   umdia      – "Um dia específico": uma data (data_inicio=data_fim), com
//                toggle "dia inteiro" (liga = horas null; desliga = faixa).
//   varios     – "Vários dias": intervalo data_inicio..data_fim, sempre dia
//                inteiro (viagem/férias), horas null.
//   avulsas    – "Datas avulsas": N datas não sequenciais (data_inicio=
//                data_fim em cada uma), ligadas por um `grupo_id` comum
//                (crypto.randomUUID(), gerado uma vez por salvamento) pra
//                excluir o lote inteiro de uma vez. Toggle "dia inteiro" como
//                em "umdia"; em horários específicos, MESMA grade de
//                MARCADORES_HORARIO da liberação, mas em multi-seleção — uma
//                linha por combinação data×horário, hora_fim = hora_inicio +
//                1h (somarUmaHora), tipo_registro sempre "ausencia".
const OPCOES_AUSENCIA = [
  {
    valor: "recorrente",
    rotulo: "Ausência fixa",
    exemplo: "horário diário da academia",
  },
  {
    valor: "umdia",
    rotulo: "Um dia específico",
    exemplo: "consulta médica ou folga",
  },
  { valor: "varios", rotulo: "Vários dias", exemplo: "viagem ou férias" },
  {
    valor: "avulsas",
    rotulo: "Datas/horários avulsos - ex: Curso",
    exemplo: null,
  },
];

// No modo Liberar, só "Um dia específico" é oferecido — liberação recorrente
// deve ser feita editando a agenda de verdade (horarios_fixos ou a
// janela/expediente), não como exceção aqui. Vale pra QUALQUER profissional
// (fixo ou janela).
const OPCAO_LIBERACAO_UNICA = [
  {
    valor: "umdia",
    rotulo: "Um dia específico",
    exemplo: "abrir horário extra numa data pontual",
  },
];

// Marcadores de horário sugerido (grade de 07:00 a 21:00, de hora em hora)
// pro modo Liberar + "Um dia específico".
const MARCADORES_HORARIO = Array.from({ length: 15 }, (_, i) =>
  `${String(i + 7).padStart(2, "0")}:00`
);

// "YYYY-MM-DD" -> dia da semana LOCAL (0=domingo…6=sábado), Date por partes
// (mesma técnica de formatarDataBR — evita o desvio de fuso do construtor de
// string).
function diaSemanaDeISO(iso) {
  if (!iso) return null;
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia).getDay();
}

// "YYYY-MM-DD" de hoje em horário LOCAL — usado pra desabilitar datas
// passadas nos seletores da aba Exceções (mesma técnica de app/[salon]/admin/
// page.js: componente-a-componente, nunca toISOString, que é UTC e pode
// voltar um dia em GMT-3).
function hojeISOLocal() {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Date -> "YYYY-MM-DD" em horário LOCAL, generalização de hojeISOLocal pra
// qualquer data (não só hoje) — usada pela grade do mini-calendário de
// "Datas avulsas" (MiniCalendarioMultiplo).
function paraISOLocal(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Marcadores "HH:00" cuja hora já começou — desabilitados no grid de
// liberação só quando a data escolhida é HOJE (em qualquer outra data, um
// horário "passado" hoje ainda está no futuro nela). Fora daqui, devolve
// sempre vazio.
function horariosPassadosHoje(diaData) {
  if (diaData !== hojeISOLocal()) return new Set();
  const agora = new Date();
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const passados = new Set();
  for (const marcador of MARCADORES_HORARIO) {
    if (minutos(marcador) <= minutosAgora) passados.add(marcador);
  }
  return passados;
}

// Marcadores "HH:00" que já fazem parte do horário normal do profissional
// naquele dia da semana — usado pra desabilitar no grid de liberação (só
// clica quem é exceção de verdade):
//   modo 'fixo'   – desabilita os horários que já existem em horarios_fixos.
//   modo 'janela' – desabilita os que caem dentro da janela entrada–saída,
//                   exceto o intervalo de almoço (fora do normal, clicável).
function horariosNormaisDoDia({ modoHorario, dia, horariosFixosPorDia, dias }) {
  if (dia == null) return new Set();

  if (modoHorario === "fixo") {
    return new Set(horariosFixosPorDia?.[dia] ?? []);
  }

  const bloco = dias?.[dia];
  if (!bloco?.ativo || !bloco.hora_inicio || !bloco.hora_fim) return new Set();

  const inicio = minutos(bloco.hora_inicio);
  const fim = minutos(bloco.hora_fim);
  const temAlmoco = Boolean(bloco.almoco_inicio && bloco.almoco_fim);
  const almocoInicio = temAlmoco ? minutos(bloco.almoco_inicio) : null;
  const almocoFim = temAlmoco ? minutos(bloco.almoco_fim) : null;

  const normais = new Set();
  for (const marcador of MARCADORES_HORARIO) {
    const m = minutos(marcador);
    const dentroExpediente = m >= inicio && m < fim;
    const dentroAlmoco = temAlmoco && m >= almocoInicio && m < almocoFim;
    if (dentroExpediente && !dentroAlmoco) normais.add(marcador);
  }
  return normais;
}

// hora "HH:MM" + 1h, sem estourar o dia. Usado só como hora_fim de linhas de
// liberação — lib/disponibilidade.js só olha hora_inicio pra esse
// tipo_registro, então este valor é só pra exibição na lista.
function somarUmaHora(hhmm) {
  const total = Math.min(minutos(hhmm) + 60, 23 * 60 + 59);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Pro dia escolhido no formulário, cruza os registros JÁ CADASTRADOS em
// `lista` (já carregada em memória — nenhuma busca nova) pra saber quais
// marcadores da grade já têm bloqueio ou liberação ANTES de qualquer clique
// nesta ação. Mesma regra de casamento usada em lib/disponibilidade.js
// (excecoesDoDia): recorrente casa pelo dia da semana, periodo pelo
// intervalo data_inicio..data_fim.
function statusGradeDoDia(lista, diaData, diaSemana) {
  const bloqueados = new Set();
  const liberados = new Set();
  let diaTodoBloqueado = false;
  if (!diaData) return { bloqueados, liberados, diaTodoBloqueado };

  for (const a of lista) {
    const casaRecorrente = a.tipo === "recorrente" && a.dia_semana === diaSemana;
    const casaPeriodo =
      a.tipo === "periodo" && a.data_inicio <= diaData && diaData <= a.data_fim;
    if (!casaRecorrente && !casaPeriodo) continue;

    if ((a.tipo_registro ?? "ausencia") === "liberacao") {
      if (a.hora_inicio) liberados.add(paraHHMM(a.hora_inicio));
      continue;
    }

    if (a.dia_inteiro) {
      diaTodoBloqueado = true;
      continue;
    }
    if (!a.hora_inicio || !a.hora_fim) continue;
    const ini = minutos(paraHHMM(a.hora_inicio));
    const fim = minutos(paraHHMM(a.hora_fim));
    for (const marcador of MARCADORES_HORARIO) {
      const m = minutos(marcador);
      if (m >= ini && m < fim) bloqueados.add(marcador);
    }
  }

  return { bloqueados, liberados, diaTodoBloqueado };
}

// Agrupa os períodos de UM ÚNICO DIA (data_inicio === data_fim) pela mesma
// data — um card por dia, listando dentro cada bloqueio/liberação daquele
// dia. Períodos de VÁRIOS dias (férias/viagem) ficam de fora do agrupamento e
// continuam um card por linha, como hoje (não faz sentido condensá-los sob
// uma única data). Dentro do card, bloqueios aparecem antes das liberações —
// espelha a precedência real do cálculo de disponibilidade
// (lib/disponibilidade.js: aplicarExcecoes aplica bloqueios por último).
function agruparPeriodosPorDia(periodos) {
  const multiDia = periodos.filter((a) => a.data_inicio !== a.data_fim);

  const mapa = new Map();
  for (const a of periodos) {
    if (a.data_inicio !== a.data_fim) continue;
    if (!mapa.has(a.data_inicio)) mapa.set(a.data_inicio, []);
    mapa.get(a.data_inicio).push(a);
  }

  const grupos = [...mapa.entries()]
    .map(([data, itens]) => ({
      data,
      itens: [...itens].sort((x, y) => {
        const xLiberacao = (x.tipo_registro ?? "ausencia") === "liberacao";
        const yLiberacao = (y.tipo_registro ?? "ausencia") === "liberacao";
        if (xLiberacao !== yLiberacao) return xLiberacao ? 1 : -1;
        return (x.hora_inicio ?? "").localeCompare(y.hora_inicio ?? "");
      }),
    }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  return { grupos, multiDia };
}

// Agrupa registros de "Datas avulsas" (grupo_id não nulo, ver coletarLinhas)
// num único card por grupo — fica de FORA de agruparPeriodosPorDia (nunca
// entra no agrupamento por dia único nem no de vários dias), mesmo quando o
// grupo tem só uma data. Dentro do card: datas ordenadas e sem repetição (uma
// mesma data pode ter várias linhas quando são horários específicos), e
// diaInteiro/horarios refletem a escolha única do grupo inteiro (todas as
// linhas de um mesmo grupo_id levam a mesma escolha, ver coletarLinhas).
function agruparPorGrupoId(periodos) {
  const mapa = new Map();
  for (const a of periodos) {
    if (!a.grupo_id) continue;
    if (!mapa.has(a.grupo_id)) mapa.set(a.grupo_id, []);
    mapa.get(a.grupo_id).push(a);
  }

  return [...mapa.entries()]
    .map(([grupoId, itens]) => {
      const datas = [...new Set(itens.map((a) => a.data_inicio))].sort();
      const diaInteiro = itens.every((a) => a.dia_inteiro);
      const horarios = diaInteiro
        ? []
        : [...new Set(itens.map((a) => paraHHMM(a.hora_inicio)))].sort();
      return {
        grupoId,
        itens,
        datas,
        diaInteiro,
        horarios,
        motivo: itens[0]?.motivo ?? null,
      };
    })
    .sort((a, b) => (a.datas[0] < b.datas[0] ? -1 : a.datas[0] > b.datas[0] ? 1 : 0));
}

// Mini-calendário de mês pra seleção de MÚLTIPLAS datas (modo "Datas
// avulsas"). Mesmo desenho de grade 7 colunas do calendário público
// (components/FormularioAgendamento.js: CalendarioDias) — cabeçalho de dias
// da semana, navegação de mês, células arredondadas —, mas SEM nenhuma das
// restrições de agendamento daquele componente (janela, dia da semana ativo,
// vencimento): aqui qualquer dia a partir de `min` é clicável, e o clique
// ALTERNA (toggle) a data no conjunto `selecionadas`, em vez de substituir
// uma seleção única. Não reaproveita CalendarioDias diretamente pra não medir
// esse formulário admin com as regras do fluxo público de agendamento.
function MiniCalendarioMultiplo({ mes, min, selecionadas, onAlternar, onPrev, onNext, podeVoltar }) {
  const ano = mes.getFullYear();
  const mesIdx = mes.getMonth();
  const primeiroDiaSemana = new Date(ano, mesIdx, 1).getDay();
  const diasNoMes = new Date(ano, mesIdx + 1, 0).getDate();

  const celulas = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);

  const rotuloMes = mes.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-border">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          disabled={!podeVoltar}
          aria-label="Mês anterior"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <span className="text-sm font-semibold capitalize text-heading">
          {rotuloMes}
        </span>

        <button
          type="button"
          onClick={onNext}
          aria-label="Próximo mês"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-body ring-1 ring-border transition hover:bg-surface"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
        {DIAS.map((info) => (
          <span key={info.n} className="py-1">
            {info.curto}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {celulas.map((d, i) => {
          if (d === null) return <span key={`vazio-${i}`} />;

          const date = new Date(ano, mesIdx, d);
          const iso = paraISOLocal(date);
          const passado = iso < min;
          const sel = selecionadas.has(iso);

          return (
            <button
              key={iso}
              type="button"
              disabled={passado}
              aria-disabled={passado}
              aria-pressed={sel}
              onClick={() => onAlternar(iso)}
              className={[
                "flex h-9 items-center justify-center rounded-lg text-sm transition",
                passado
                  ? "cursor-not-allowed text-muted/40"
                  : sel
                  ? "bg-primary font-semibold text-white ring-1 ring-primary"
                  : "text-body ring-1 ring-border hover:border-primary hover:ring-primary",
              ].join(" ")}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SecaoAusencias({
  profissionalId,
  estabelecimentoId,
  modoHorario,
  horariosFixosPorDia,
  dias,
}) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Natureza do registro: 'ausencia' bloqueia o horário, 'liberacao' abre um
  // horário extra (fora da janela/lista normal). Mesmo formulário pros dois —
  // só muda o que é gravado em `tipo_registro`.
  const [tipoRegistro, setTipoRegistro] = useState("ausencia");

  // Formato de cadastro escolhido na lista suspensa.
  const [modo, setModo] = useState("recorrente");
  const [formErro, setFormErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Bloqueio de dia inteiro pendente de confirmação — só é setado quando o
  // dia já tem liberações pontuais cadastradas (ver salvar()). Guarda as
  // linhas do bloqueio E as liberações que serão excluídas junto, se
  // confirmado.
  const [confirmarBloqueio, setConfirmarBloqueio] = useState(null);

  // Campos "Ausência fixa" (recorrente).
  const [recDias, setRecDias] = useState([]); // dia_semana 0..6 marcados
  const [recInicio, setRecInicio] = useState("");
  const [recFim, setRecFim] = useState("");
  const [recMotivo, setRecMotivo] = useState("");

  // Campos "Um dia específico" (periodo, data única). dia_inteiro começa ligado
  // (só se aplica a tipoRegistro="ausencia" — liberação usa os marcadores).
  const [diaData, setDiaData] = useState("");
  const [diaInteiro, setDiaInteiro] = useState(true);
  const [diaHoraInicio, setDiaHoraInicio] = useState("");
  const [diaHoraFim, setDiaHoraFim] = useState("");
  const [diaMotivo, setDiaMotivo] = useState("");

  // Marcadores selecionados no grid de liberação + campo livre pra horário
  // fora da grade (fora de 07h–21h ou fora da hora redonda).
  const [diaHorarios, setDiaHorarios] = useState([]);
  const [diaOutroHorario, setDiaOutroHorario] = useState("");

  // Campos "Vários dias" (periodo, intervalo). Sempre dia inteiro.
  const [varInicio, setVarInicio] = useState("");
  const [varFim, setVarFim] = useState("");
  const [varMotivo, setVarMotivo] = useState("");

  // Campos "Datas avulsas" (periodo, N datas não sequenciais ligadas por
  // grupo_id, sempre tipo_registro="ausencia"). avulsasMes é só navegação do
  // mini-calendário, não é resetado em limparCampos (mesma ideia de
  // mesVisivel em components/FormularioAgendamento.js).
  const [avulsasMes, setAvulsasMes] = useState(() => new Date());
  const [avulsasDatas, setAvulsasDatas] = useState([]); // ISO "YYYY-MM-DD", sem duplicatas
  const [avulsasDiaInteiro, setAvulsasDiaInteiro] = useState(true);
  const [avulsasHorarios, setAvulsasHorarios] = useState([]); // "HH:MM" marcados, multi-seleção
  const [avulsasMotivo, setAvulsasMotivo] = useState("");

  // Grupo de "Datas avulsas" pendente de confirmação de exclusão (ver
  // agruparPorGrupoId) — mesma ideia de confirmarBloqueio, mas aqui a
  // exclusão sempre apaga o grupo_id inteiro de uma vez.
  const [confirmarExclusaoGrupo, setConfirmarExclusaoGrupo] = useState(null);

  // Carga inicial: todas as ausências do profissional.
  useEffect(() => {
    let vivo = true;

    async function carregar() {
      setCarregando(true);
      const { data, error } = await supabase
        .from("ausencias")
        .select(
          "id, tipo, tipo_registro, dia_semana, data_inicio, data_fim, dia_inteiro, hora_inicio, hora_fim, motivo, grupo_id"
        )
        .eq("profissional_id", profissionalId);

      if (!vivo) return;

      if (error) {
        setErro(error.message);
      } else {
        setErro("");
        setLista(data ?? []);
      }
      setCarregando(false);
    }

    carregar();
    return () => {
      vivo = false;
    };
  }, [profissionalId]);

  function alternarRecDia(n) {
    setRecDias((atual) =>
      atual.includes(n) ? atual.filter((d) => d !== n) : [...atual, n]
    );
  }

  function alternarDiaHorario(h) {
    setDiaHorarios((atual) =>
      atual.includes(h) ? atual.filter((x) => x !== h) : [...atual, h]
    );
  }

  // Alterna (toggle) uma data no conjunto de "Datas avulsas" — usado tanto
  // pelo clique numa célula do mini-calendário quanto pelo "×" de um chip
  // (ambos removem a data se ela já estiver selecionada).
  function alternarAvulsasData(iso) {
    setAvulsasDatas((atual) =>
      atual.includes(iso) ? atual.filter((d) => d !== iso) : [...atual, iso]
    );
  }

  function alternarAvulsasHorario(h) {
    setAvulsasHorarios((atual) =>
      atual.includes(h) ? atual.filter((x) => x !== h) : [...atual, h]
    );
  }

  function avulsasMesAnterior() {
    setAvulsasMes((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }

  function avulsasProximoMes() {
    setAvulsasMes((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  // Zera os campos de todos os formatos (chamado após salvar com sucesso).
  function limparCampos() {
    setRecDias([]);
    setRecInicio("");
    setRecFim("");
    setRecMotivo("");
    setDiaData("");
    setDiaInteiro(true);
    setDiaHoraInicio("");
    setDiaHoraFim("");
    setDiaMotivo("");
    setDiaHorarios([]);
    setDiaOutroHorario("");
    setVarInicio("");
    setVarFim("");
    setVarMotivo("");
    setAvulsasDatas([]);
    setAvulsasDiaInteiro(true);
    setAvulsasHorarios([]);
    setAvulsasMotivo("");
  }

  // Valida conforme o `modo` e monta as linhas a inserir. Devolve { erro } ou
  // { linhas }. As comparações de data usam ISO "YYYY-MM-DD" (lexicográfica,
  // sem criar Date — evita o desvio de fuso do construtor de string). Toda
  // linha leva `tipo_registro` (ausencia/liberacao) conforme o botão ativo no
  // topo do formulário. Liberação precisa de um horário específico — não faz
  // sentido em "dia inteiro" (não haveria horário pra liberar).
  function coletarLinhas() {
    if (modo === "recorrente") {
      if (recDias.length === 0) return { erro: "Selecione ao menos um dia." };
      if (!recInicio || !recFim) {
        return { erro: "Informe início e fim do horário." };
      }
      if (minutos(recFim) <= minutos(recInicio)) {
        return { erro: "O fim deve ser maior que o início." };
      }
      const linhas = [...recDias]
        .sort((a, b) => a - b)
        .map((dia_semana) => ({
          profissional_id: profissionalId,
          estabelecimento_id: estabelecimentoId,
          tipo: "recorrente",
          tipo_registro: tipoRegistro,
          dia_semana,
          dia_inteiro: false,
          hora_inicio: recInicio,
          hora_fim: recFim,
          motivo: recMotivo.trim() || null,
        }));
      return { linhas };
    }

    if (modo === "umdia") {
      if (!diaData) return { erro: "Informe a data." };

      // Liberação: cada marcador selecionado (+ "outro horário") vira UMA
      // linha própria, todas na mesma data/motivo — não usa dia_inteiro.
      if (tipoRegistro === "liberacao") {
        // Bloqueio de dia inteiro sempre vence (mesma precedência de
        // lib/disponibilidade.js) — não faz sentido liberar horários pontuais
        // num dia já todo bloqueado. Checado de novo aqui (além do grid
        // desabilitado) pra cobrir o submit em si.
        const diaSemana = diaSemanaDeISO(diaData);
        if (statusGradeDoDia(lista, diaData, diaSemana).diaTodoBloqueado) {
          return {
            erro:
              "Este dia está totalmente bloqueado. Exclua o bloqueio antes de liberar horários específicos.",
          };
        }
        const horarios = [
          ...new Set([
            ...diaHorarios,
            ...(diaOutroHorario ? [diaOutroHorario] : []),
          ]),
        ];
        if (horarios.length === 0) {
          return { erro: "Selecione ao menos um horário." };
        }
        return {
          linhas: horarios.map((hora_inicio) => ({
            profissional_id: profissionalId,
            estabelecimento_id: estabelecimentoId,
            tipo: "periodo",
            tipo_registro: "liberacao",
            data_inicio: diaData,
            data_fim: diaData,
            dia_inteiro: false,
            hora_inicio,
            hora_fim: somarUmaHora(hora_inicio),
            motivo: diaMotivo.trim() || null,
          })),
        };
      }

      if (!diaInteiro) {
        if (!diaHoraInicio || !diaHoraFim) {
          return { erro: "Informe início e fim do horário." };
        }
        if (minutos(diaHoraFim) <= minutos(diaHoraInicio)) {
          return { erro: "O fim deve ser maior que o início." };
        }
      }
      return {
        linhas: [
          {
            profissional_id: profissionalId,
            estabelecimento_id: estabelecimentoId,
            tipo: "periodo",
            tipo_registro: "ausencia",
            data_inicio: diaData,
            data_fim: diaData,
            dia_inteiro: diaInteiro,
            hora_inicio: diaInteiro ? null : diaHoraInicio,
            hora_fim: diaInteiro ? null : diaHoraFim,
            motivo: diaMotivo.trim() || null,
          },
        ],
      };
    }

    // modo === "varios": intervalo sempre em dia inteiro (não combina com liberação).
    if (modo === "varios") {
      if (tipoRegistro === "liberacao") {
        return {
          erro: "Liberação precisa de um horário específico — use \"Ausência fixa\" ou \"Um dia específico\".",
        };
      }
      if (!varInicio || !varFim) {
        return { erro: "Informe as datas de início e fim." };
      }
      if (varFim < varInicio) {
        return { erro: "A data de fim deve ser igual ou depois do início." };
      }
      return {
        linhas: [
          {
            profissional_id: profissionalId,
            estabelecimento_id: estabelecimentoId,
            tipo_registro: tipoRegistro,
            tipo: "periodo",
            data_inicio: varInicio,
            data_fim: varFim,
            dia_inteiro: true,
            hora_inicio: null,
            hora_fim: null,
            motivo: varMotivo.trim() || null,
          },
        ],
      };
    }

    // modo === "avulsas": N datas não sequenciais, sempre tipo_registro=
    // "ausencia" (não oferecido em Liberar — ver OPCAO_LIBERACAO_UNICA).
    // Todas as linhas do lote levam o MESMO grupo_id novo, pra poder excluir
    // o grupo inteiro de uma vez (ver agruparPorGrupoId / excluirGrupo).
    if (avulsasDatas.length === 0) {
      return { erro: "Selecione ao menos uma data." };
    }
    if (!avulsasDiaInteiro && avulsasHorarios.length === 0) {
      return { erro: "Selecione ao menos um horário." };
    }

    const datasOrdenadas = [...avulsasDatas].sort();
    const grupoId = crypto.randomUUID();
    const motivo = avulsasMotivo.trim() || null;

    const linhas = avulsasDiaInteiro
      ? datasOrdenadas.map((data) => ({
          profissional_id: profissionalId,
          estabelecimento_id: estabelecimentoId,
          tipo: "periodo",
          tipo_registro: "ausencia",
          data_inicio: data,
          data_fim: data,
          dia_inteiro: true,
          hora_inicio: null,
          hora_fim: null,
          motivo,
          grupo_id: grupoId,
        }))
      : datasOrdenadas.flatMap((data) =>
          avulsasHorarios.map((hora_inicio) => ({
            profissional_id: profissionalId,
            estabelecimento_id: estabelecimentoId,
            tipo: "periodo",
            tipo_registro: "ausencia",
            data_inicio: data,
            data_fim: data,
            dia_inteiro: false,
            hora_inicio,
            hora_fim: somarUmaHora(hora_inicio),
            motivo,
            grupo_id: grupoId,
          }))
        );

    return { linhas };
  }

  async function salvar() {
    setFormErro("");
    const { erro, linhas } = coletarLinhas();
    if (erro) {
      setFormErro(erro);
      return;
    }

    // Bloqueio de dia inteiro sempre vence sobre liberações pontuais do
    // mesmo dia (mesma precedência de lib/disponibilidade.js) — deixá-las
    // coexistir no banco é um estado morto e visualmente contraditório (ver
    // agruparPeriodosPorDia). Confirma com o usuário antes de excluí-las.
    if (tipoRegistro === "ausencia" && modo === "umdia" && diaInteiro) {
      const liberacoesConflitantes = lista.filter(
        (a) =>
          a.tipo === "periodo" &&
          (a.tipo_registro ?? "ausencia") === "liberacao" &&
          a.data_inicio === diaData
      );
      if (liberacoesConflitantes.length > 0) {
        setConfirmarBloqueio({ linhas, liberacoes: liberacoesConflitantes });
        return;
      }
    }

    await gravar(linhas);
  }

  // Grava as `linhas` do bloqueio/liberação e, quando vier de uma
  // confirmação de conflito, exclui antes as liberações que perderam o
  // sentido — mesma função usada nos dois caminhos (com e sem conflito) pra
  // não duplicar a lógica de insert/atualização de lista.
  async function gravar(linhas, liberacoesParaExcluir = []) {
    setSalvando(true);

    if (liberacoesParaExcluir.length > 0) {
      const { error: erroExclusao } = await supabase
        .from("ausencias")
        .delete()
        .in(
          "id",
          liberacoesParaExcluir.map((a) => a.id)
        );
      if (erroExclusao) {
        setSalvando(false);
        setFormErro(erroExclusao.message);
        return;
      }
    }

    const { data, error } = await supabase
      .from("ausencias")
      .insert(linhas)
      .select();

    setSalvando(false);
    if (error) {
      setFormErro(error.message);
      return;
    }

    const idsExcluidos = new Set(liberacoesParaExcluir.map((a) => a.id));
    setLista((atual) => [
      ...atual.filter((a) => !idsExcluidos.has(a.id)),
      ...(data ?? []),
    ]);
    limparCampos();
  }

  async function confirmarBloqueioComExclusao() {
    if (!confirmarBloqueio) return;
    const { linhas, liberacoes } = confirmarBloqueio;
    setConfirmarBloqueio(null);
    await gravar(linhas, liberacoes);
  }

  async function excluir(id) {
    setErro("");
    const { error } = await supabase.from("ausencias").delete().eq("id", id);
    if (error) {
      setErro(`Não foi possível excluir a ausência: ${error.message}`);
      return;
    }
    setLista((atual) => atual.filter((a) => a.id !== id));
  }

  // Exclui TODAS as linhas de um grupo de "Datas avulsas" de uma vez (mesmo
  // grupo_id) — chamado só depois da confirmação em confirmarExclusaoGrupo.
  async function excluirGrupo(grupoId) {
    setErro("");
    const { error } = await supabase
      .from("ausencias")
      .delete()
      .eq("grupo_id", grupoId);
    if (error) {
      setErro(`Não foi possível excluir o grupo: ${error.message}`);
      return;
    }
    setLista((atual) => atual.filter((a) => a.grupo_id !== grupoId));
  }

  async function confirmarExclusaoGrupoConfirmada() {
    if (!confirmarExclusaoGrupo) return;
    const grupoId = confirmarExclusaoGrupo.grupoId;
    setConfirmarExclusaoGrupo(null);
    await excluirGrupo(grupoId);
  }

  const classeCampo =
    "rounded-lg border border-border px-2 py-1.5 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10";

  // No modo Liberar só "Um dia específico" é oferecido (ver OPCAO_LIBERACAO_UNICA).
  const opcoesModo =
    tipoRegistro === "liberacao" ? OPCAO_LIBERACAO_UNICA : OPCOES_AUSENCIA;

  // Marcadores já "normais" pro dia da semana da data escolhida — desabilitados
  // no grid de liberação.
  const diaSemanaEscolhido = diaSemanaDeISO(diaData);
  const horariosNormais = horariosNormaisDoDia({
    modoHorario,
    dia: diaSemanaEscolhido,
    horariosFixosPorDia,
    dias,
  });
  // Horários da grade que já ficaram pra trás (só quando diaData é hoje) e o
  // que já existe cadastrado nesse dia (bloqueio/liberação), pra colorir a
  // grade antes de qualquer clique novo.
  const horariosPassados = horariosPassadosHoje(diaData);
  const statusGrade = statusGradeDoDia(lista, diaData, diaSemanaEscolhido);
  const hoje = hojeISOLocal();

  const gruposRec = agruparRecorrentes(
    lista.filter((a) => a.tipo === "recorrente")
  );
  const periodos = lista
    .filter((a) => a.tipo === "periodo")
    .sort((a, b) =>
      a.data_inicio < b.data_inicio ? -1 : a.data_inicio > b.data_inicio ? 1 : 0
    );
  // Registros de grupo_id (Datas avulsas) ficam de FORA do agrupamento por
  // dia único/vários dias — têm o card próprio de agruparPorGrupoId.
  const periodosIndividuais = periodos.filter((a) => !a.grupo_id);
  const periodosAvulsos = periodos.filter((a) => a.grupo_id);
  const { grupos: gruposPeriodo, multiDia } = agruparPeriodosPorDia(periodosIndividuais);
  const gruposAvulsos = agruparPorGrupoId(periodosAvulsos);
  const vazio = gruposRec.length === 0 && periodos.length === 0;

  // Mês atual pra travar o "mês anterior" do mini-calendário de "Datas
  // avulsas" (mesmo cálculo de podeVoltarMes em components/FormularioAgendamento.js).
  const agoraMes = new Date();
  const podeVoltarAvulsas =
    avulsasMes.getFullYear() > agoraMes.getFullYear() ||
    (avulsasMes.getFullYear() === agoraMes.getFullYear() &&
      avulsasMes.getMonth() > agoraMes.getMonth());

  return (
    <div className="space-y-4">
      {/* FORM único: a lista suspensa escolhe o formato; os campos seguem. */}
      <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
        {/* Natureza do registro: bloqueia ou libera um horário. Mesmo
            formulário abaixo pros dois — só muda o que é gravado. */}
        <div className="flex gap-2">
          {[
            { valor: "ausencia", rotulo: "Bloquear horário" },
            { valor: "liberacao", rotulo: "Liberar horário" },
          ].map((opcao) => {
            const selecionado = tipoRegistro === opcao.valor;
            return (
              <button
                key={opcao.valor}
                type="button"
                aria-pressed={selecionado}
                onClick={() => {
                  setTipoRegistro(opcao.valor);
                  setFormErro("");
                  // Liberar só oferece "Um dia específico" — força o modo pra
                  // manter select e estado consistentes.
                  if (opcao.valor === "liberacao") setModo("umdia");
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ring-1 transition ${
                  selecionado
                    ? opcao.valor === "liberacao"
                      ? "bg-green-600 text-white ring-green-600"
                      : "bg-primary text-white ring-primary"
                    : "bg-card text-body ring-border hover:bg-surface"
                }`}
              >
                {opcao.rotulo}
              </button>
            );
          })}
        </div>

        <label className="mt-3 block text-xs font-medium text-body">
          {tipoRegistro === "liberacao" ? "Tipo de liberação" : "Tipo de ausência"}
          <select
            value={modo}
            onChange={(e) => {
              setModo(e.target.value);
              setFormErro("");
            }}
            className={`mt-1 block w-full ${classeCampo}`}
          >
            {opcoesModo.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.exemplo ? `${o.rotulo} — ex.: ${o.exemplo}` : o.rotulo}
              </option>
            ))}
          </select>
        </label>

        {/* OPÇÃO 1 — Ausência fixa (recorrente). */}
        {modo === "recorrente" && (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {DIAS.map((info) => {
                const ativo = recDias.includes(info.n);
                return (
                  <button
                    key={info.n}
                    type="button"
                    role="checkbox"
                    aria-checked={ativo}
                    onClick={() => alternarRecDia(info.n)}
                    className={`rounded-lg px-2.5 py-1.5 text-sm font-medium ring-1 transition ${
                      ativo
                        ? "bg-primary text-white ring-primary"
                        : "bg-card text-body ring-border hover:bg-surface"
                    }`}
                  >
                    {info.curto}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs font-medium text-body">
                Início
                <input
                  type="time"
                  aria-label="Início da ausência fixa"
                  value={recInicio}
                  onChange={(e) => setRecInicio(e.target.value)}
                  className={`mt-1 block w-28 ${classeCampo}`}
                />
              </label>
              <label className="text-xs font-medium text-body">
                Fim
                <input
                  type="time"
                  aria-label="Fim da ausência fixa"
                  value={recFim}
                  onChange={(e) => setRecFim(e.target.value)}
                  className={`mt-1 block w-28 ${classeCampo}`}
                />
              </label>
              <label className="min-w-[8rem] flex-1 text-xs font-medium text-body">
                Motivo (opcional)
                <input
                  type="text"
                  value={recMotivo}
                  onChange={(e) => setRecMotivo(e.target.value)}
                  placeholder="Ex.: academia, aula…"
                  className={`mt-1 block w-full ${classeCampo}`}
                />
              </label>
            </div>
          </>
        )}

        {/* OPÇÃO 2 — Um dia específico (periodo, data única). */}
        {modo === "umdia" && (
          <>
            <label className="mt-3 block text-xs font-medium text-body">
              Data
              <input
                type="date"
                aria-label="Data da ausência"
                min={hoje}
                value={diaData}
                onChange={(e) => {
                  setDiaData(e.target.value);
                  // Muda o dia da semana → o conjunto de marcadores "normais"
                  // muda junto; zera a seleção pra não deixar horário marcado
                  // que pertencia à data anterior.
                  setDiaHorarios([]);
                  setDiaOutroHorario("");
                }}
                className={`mt-1 block ${classeCampo}`}
              />
            </label>

            {tipoRegistro === "ausencia" ? (
              <>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={diaInteiro}
                    onClick={() => setDiaInteiro((v) => !v)}
                    className="flex items-center gap-2"
                  >
                    <span className="text-sm font-medium text-heading">
                      Dia inteiro
                    </span>
                    <Interruptor ativo={diaInteiro} />
                  </button>
                </div>

                {!diaInteiro && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="text-xs font-medium text-body">
                      Início
                      <input
                        type="time"
                        aria-label="Início do horário no dia"
                        value={diaHoraInicio}
                        onChange={(e) => setDiaHoraInicio(e.target.value)}
                        className={`mt-1 block w-28 ${classeCampo}`}
                      />
                    </label>
                    <label className="text-xs font-medium text-body">
                      Fim
                      <input
                        type="time"
                        aria-label="Fim do horário no dia"
                        value={diaHoraFim}
                        onChange={(e) => setDiaHoraFim(e.target.value)}
                        className={`mt-1 block w-28 ${classeCampo}`}
                      />
                    </label>
                  </div>
                )}
              </>
            ) : statusGrade.diaTodoBloqueado ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100">
                Este dia está totalmente bloqueado. Exclua o bloqueio antes de
                liberar horários específicos.
              </p>
            ) : (
              <div className="mt-3">
                <span className="block text-xs font-medium text-body">
                  Horários disponíveis
                </span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {MARCADORES_HORARIO.map((h) => {
                    const normal = horariosNormais.has(h);
                    const passado = horariosPassados.has(h);
                    const desabilitado = normal || passado;
                    const selecionado = diaHorarios.includes(h);
                    // Bloqueio sempre vence na cor também, espelhando a
                    // precedência real (lib/disponibilidade.js): se o dia
                    // inteiro ou esse horário específico já está bloqueado,
                    // não importa se também existe liberação.
                    const jaBloqueado =
                      statusGrade.diaTodoBloqueado || statusGrade.bloqueados.has(h);
                    const jaLiberado = !jaBloqueado && statusGrade.liberados.has(h);

                    let classeEstado;
                    if (normal) {
                      // Já faz parte do expediente normal recorrente — verde
                      // translúcido hachurado (mesma receita de jaLiberado)
                      // em vez do cinza apagado: comunica "já disponível",
                      // não "indisponível". Continua desabilitado ao clique.
                      classeEstado =
                        "cursor-not-allowed exc-horario-liberado text-green-700 ring-green-300";
                    } else if (desabilitado) {
                      classeEstado = "cursor-not-allowed bg-surface text-muted/60 ring-border";
                    } else if (selecionado) {
                      classeEstado = "bg-green-600 text-white ring-green-600";
                    } else if (jaBloqueado) {
                      classeEstado = "exc-horario-bloqueado text-red-700 ring-red-300";
                    } else if (jaLiberado) {
                      classeEstado = "exc-horario-liberado text-green-700 ring-green-300";
                    } else {
                      classeEstado = "bg-card text-body ring-border hover:bg-surface";
                    }

                    let titulo;
                    if (normal) titulo = "Já faz parte do horário normal deste dia";
                    else if (passado) titulo = "Esse horário já passou";
                    else if (jaBloqueado) titulo = "Esse horário já está bloqueado nesse dia";
                    else if (jaLiberado) titulo = "Esse horário já foi liberado nesse dia";

                    return (
                      <button
                        key={h}
                        type="button"
                        role="checkbox"
                        aria-checked={selecionado}
                        disabled={desabilitado}
                        title={titulo}
                        onClick={() => alternarDiaHorario(h)}
                        className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-medium ring-1 transition ${classeEstado}`}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>
                <label className="mt-3 block text-xs font-medium text-body">
                  Outro horário (opcional)
                  <input
                    type="time"
                    aria-label="Outro horário de liberação"
                    value={diaOutroHorario}
                    onChange={(e) => setDiaOutroHorario(e.target.value)}
                    className={`mt-1 block w-28 ${classeCampo}`}
                  />
                </label>
              </div>
            )}

            <label className="mt-3 block text-xs font-medium text-body">
              Motivo (opcional)
              <input
                type="text"
                value={diaMotivo}
                onChange={(e) => setDiaMotivo(e.target.value)}
                placeholder={
                  tipoRegistro === "liberacao"
                    ? "Ex.: demanda extra, cliente encaixado…"
                    : "Ex.: consulta médica, folga…"
                }
                className={`mt-1 block w-full ${classeCampo}`}
              />
            </label>
          </>
        )}

        {/* OPÇÃO 3 — Vários dias (periodo, intervalo, sempre dia inteiro). */}
        {modo === "varios" && (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs font-medium text-body">
                De
                <input
                  type="date"
                  aria-label="Data de início"
                  min={hoje}
                  value={varInicio}
                  onChange={(e) => setVarInicio(e.target.value)}
                  className={`mt-1 block ${classeCampo}`}
                />
              </label>
              <label className="text-xs font-medium text-body">
                Até
                <input
                  type="date"
                  aria-label="Data de fim"
                  min={varInicio || hoje}
                  value={varFim}
                  onChange={(e) => setVarFim(e.target.value)}
                  className={`mt-1 block ${classeCampo}`}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">
              O intervalo inteiro fica bloqueado (dias completos).
            </p>
            <label className="mt-3 block text-xs font-medium text-body">
              Motivo (opcional)
              <input
                type="text"
                value={varMotivo}
                onChange={(e) => setVarMotivo(e.target.value)}
                placeholder="Ex.: férias, viagem…"
                className={`mt-1 block w-full ${classeCampo}`}
              />
            </label>
          </>
        )}

        {/* OPÇÃO 4 — Datas avulsas (periodo, N datas não sequenciais ligadas
            por grupo_id, sempre tipo_registro="ausencia"). */}
        {modo === "avulsas" && (
          <>
            <div className="mt-3">
              <span className="block text-xs font-medium text-body">
                Datas
              </span>
              <div className="mt-1">
                <MiniCalendarioMultiplo
                  mes={avulsasMes}
                  min={hoje}
                  selecionadas={new Set(avulsasDatas)}
                  onAlternar={alternarAvulsasData}
                  onPrev={avulsasMesAnterior}
                  onNext={avulsasProximoMes}
                  podeVoltar={podeVoltarAvulsas}
                />
              </div>

              {avulsasDatas.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...avulsasDatas].sort().map((iso) => (
                    <span
                      key={iso}
                      className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-heading ring-1 ring-border"
                    >
                      {formatarDataBR(iso)}
                      <button
                        type="button"
                        aria-label={`Remover ${formatarDataBR(iso)}`}
                        onClick={() => alternarAvulsasData(iso)}
                        className="text-muted transition hover:text-red-600"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={avulsasDiaInteiro}
                onClick={() => setAvulsasDiaInteiro((v) => !v)}
                className="flex items-center gap-2"
              >
                <span className="text-sm font-medium text-heading">
                  Dia inteiro
                </span>
                <Interruptor ativo={avulsasDiaInteiro} />
              </button>
            </div>

            {!avulsasDiaInteiro && (
              <div className="mt-3">
                <span className="block text-xs font-medium text-body">
                  Horários
                </span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {MARCADORES_HORARIO.map((h) => {
                    const selecionado = avulsasHorarios.includes(h);
                    return (
                      <button
                        key={h}
                        type="button"
                        role="checkbox"
                        aria-checked={selecionado}
                        onClick={() => alternarAvulsasHorario(h)}
                        className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-medium ring-1 transition ${
                          selecionado
                            ? "bg-primary text-white ring-primary"
                            : "bg-card text-body ring-border hover:bg-surface"
                        }`}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <label className="mt-3 block text-xs font-medium text-body">
              Motivo (opcional)
              <input
                type="text"
                value={avulsasMotivo}
                onChange={(e) => setAvulsasMotivo(e.target.value)}
                placeholder="Ex.: curso, plantão…"
                className={`mt-1 block w-full ${classeCampo}`}
              />
            </label>
          </>
        )}

        {formErro && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100">
            {formErro}
          </p>
        )}

        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className={`mt-3 inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
            tipoRegistro === "liberacao"
              ? "bg-green-600 hover:bg-green-700"
              : "bg-primary hover:bg-primary-hover"
          }`}
        >
          {salvando
            ? "Adicionando..."
            : tipoRegistro === "liberacao"
              ? "Adicionar liberação"
              : "Adicionar bloqueio"}
        </button>
      </div>

      {/* LISTA das ausências já cadastradas. */}
      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
          {erro}
        </p>
      )}

      {carregando ? (
        <p className="rounded-lg bg-surface px-3 py-3 text-sm text-body ring-1 ring-border">
          Carregando ausências...
        </p>
      ) : vazio ? (
        <p className="rounded-lg bg-surface px-3 py-4 text-center text-sm text-body ring-1 ring-border">
          Nenhuma ausência cadastrada.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Recorrentes agrupadas por faixa de horário. Borda + selo indicam
              bloqueio (vermelho) ou liberação (verde). */}
          {gruposRec.map((grupo) => (
            <div
              key={`${grupo.inicio}|${grupo.fim}|${grupo.tipoRegistro}`}
              className={`rounded-xl border-l-4 bg-card p-3 ring-1 ring-border ${
                grupo.tipoRegistro === "liberacao"
                  ? "border-l-green-500"
                  : "border-l-red-400"
              }`}
            >
              <p className="flex items-center gap-2 text-xs font-medium text-muted">
                <SeloTipoRegistro tipoRegistro={grupo.tipoRegistro} />
                Toda semana · {faixaHora(grupo.inicio, grupo.fim)}
              </p>
              <ul className="mt-2 space-y-1.5">
                {grupo.itens.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 text-sm text-heading">
                      {DIAS.find((d) => d.n === a.dia_semana)?.rotulo}
                      {a.motivo && (
                        <span className="text-muted"> · {a.motivo}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => excluir(a.id)}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                    >
                      Excluir
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Períodos de UM dia, condensados por data — um card por dia,
              listando dentro cada bloqueio/liberação daquele dia (já
              ordenados com bloqueios primeiro, ver agruparPeriodosPorDia).
              Borda vermelha se o dia tem QUALQUER bloqueio (que sempre vence,
              ver lib/disponibilidade.js); verde só quando é liberação pura. */}
          {gruposPeriodo.map((grupo) => {
            const temBloqueio = grupo.itens.some(
              (a) => (a.tipo_registro ?? "ausencia") !== "liberacao"
            );
            return (
              <div
                key={grupo.data}
                className={`rounded-xl border-l-4 bg-card p-3 ring-1 ring-border ${
                  temBloqueio ? "border-l-red-400" : "border-l-green-500"
                }`}
              >
                <p className="text-sm font-medium text-heading">
                  {formatarDataBR(grupo.data)}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {grupo.itens.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm text-body">
                        <SeloTipoRegistro tipoRegistro={a.tipo_registro} />
                        {a.dia_inteiro
                          ? "Dia inteiro"
                          : faixaHora(a.hora_inicio, a.hora_fim)}
                        {a.motivo && (
                          <span className="text-muted"> · {a.motivo}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => excluir(a.id)}
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                      >
                        Excluir
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {/* Períodos de VÁRIOS dias (férias/viagem), um card por linha —
              sempre dia inteiro e nunca liberação (ver coletarLinhas). */}
          {multiDia.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-l-red-400 bg-card p-3 ring-1 ring-border"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-heading">
                  <SeloTipoRegistro tipoRegistro={a.tipo_registro} />
                  {formatarDataBR(a.data_inicio)} até {formatarDataBR(a.data_fim)}
                </p>
                <p className="text-xs text-muted">
                  Dia inteiro
                  {a.motivo && <> · {a.motivo}</>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => excluir(a.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
              >
                Excluir
              </button>
            </div>
          ))}

          {/* Grupos de "Datas avulsas" (grupo_id), um card por grupo (ver
              agruparPorGrupoId) — resumo compacto no topo (qtde de datas +
              dia inteiro/horários) e a lista completa das datas abaixo.
              Excluir apaga o grupo_id inteiro de uma vez, com confirmação. */}
          {gruposAvulsos.map((grupo) => (
            <div
              key={grupo.grupoId}
              className="flex items-start justify-between gap-3 rounded-xl border-l-4 border-l-red-400 bg-card p-3 ring-1 ring-border"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-heading">
                  <SeloTipoRegistro tipoRegistro="ausencia" />
                  {grupo.datas.length === 1 ? "1 data" : `${grupo.datas.length} datas`}
                  {" · "}
                  {grupo.diaInteiro ? "dia inteiro" : grupo.horarios.join(", ")}
                </p>
                {grupo.motivo && (
                  <p className="mt-0.5 text-xs text-muted">{grupo.motivo}</p>
                )}
                <p className="mt-1.5 text-xs text-body">
                  {grupo.datas.map(formatarDataBR).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmarExclusaoGrupo(grupo)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
              >
                Excluir
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Confirmação: exclusão de um grupo inteiro de "Datas avulsas" (ver
          excluirGrupo) — avisa quantas datas serão desbloqueadas. */}
      {confirmarExclusaoGrupo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-excluir-grupo-avulsas"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setConfirmarExclusaoGrupo(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-excluir-grupo-avulsas"
              className="text-lg font-semibold text-heading"
            >
              Excluir datas avulsas
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja excluir este grupo? Isso vai desbloquear{" "}
              <span className="font-medium text-heading">
                {confirmarExclusaoGrupo.datas.length === 1
                  ? "1 data"
                  : `${confirmarExclusaoGrupo.datas.length} datas`}
              </span>
              .
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={confirmarExclusaoGrupoConfirmada}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setConfirmarExclusaoGrupo(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação: bloqueio de dia inteiro que vai excluir liberações
          pontuais já cadastradas nesse mesmo dia (ver salvar()). */}
      {confirmarBloqueio && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-confirmar-bloqueio"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setConfirmarBloqueio(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-confirmar-bloqueio"
              className="text-lg font-semibold text-heading"
            >
              Bloquear o dia inteiro
            </h2>
            <p className="mt-2 text-sm text-body">
              Este dia já tem{" "}
              <span className="font-medium text-heading">
                {confirmarBloqueio.liberacoes.length === 1
                  ? "1 horário liberado"
                  : `${confirmarBloqueio.liberacoes.length} horários liberados`}
              </span>
              . Ao bloquear o dia inteiro, eles serão excluídos
              automaticamente, já que deixam de fazer sentido. Deseja
              continuar?
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={confirmarBloqueioComExclusao}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setConfirmarBloqueio(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GerenciarProfissionais({ estabelecimento }) {
  const [profissionais, setProfissionais] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Formulário de criar/editar. `editando`:
  //   null    – fechado (só a lista)
  //   "novo"  – criando (wizard de 3 etapas, controlado por `etapa`)
  //   objeto  – editando o profissional correspondente (tela de resumo)
  const [editando, setEditando] = useState(null);
  const [etapa, setEtapa] = useState("A"); // etapa do wizard (só no "novo")
  const [form, setForm] = useState(FORM_INICIAL);
  const [erroForm, setErroForm] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [carregandoForm, setCarregandoForm] = useState(false);
  const [abaEdicao, setAbaEdicao] = useState("horarios"); // aba ativa na edição

  // Profissional "armado" para soft delete (controla o modal de confirmação).
  const [profissionalParaExcluir, setProfissionalParaExcluir] = useState(null);

  // Serviços ATIVOS do salão, pra montar a lista de vínculos (Janela C / resumo).
  // Carregados uma vez; a seleção por profissional vive em `form.servicos`.
  const [servicosSalao, setServicosSalao] = useState([]);
  const [carregandoServicos, setCarregandoServicos] = useState(true);
  const [erroServicos, setErroServicos] = useState("");

  // Carga inicial. Traz ATIVOS e INATIVOS (o CRUD mostra os dois, com ação de
  // reativar). Ordena ativos primeiro e, dentro, por nome.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("profissionais")
        .select("id, nome, ativo, modo_horario")
        .eq("estabelecimento_id", estabelecimento.id)
        .order("ativo", { ascending: false })
        .order("nome", { ascending: true });

      if (!ativo) return;

      if (error) {
        setErro(error.message);
      } else {
        setErro("");
        setProfissionais(data ?? []);
      }
      setCarregando(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Carrega os serviços ATIVOS do salão (só os que podem ser vinculados). O
  // vínculo em si (quais o profissional atende) vem do form, não daqui.
  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const { data, error } = await supabase
        .from("servicos")
        .select("id, nome, duracao_min, preco_centavos")
        .eq("estabelecimento_id", estabelecimento.id)
        .eq("ativo", true)
        .order("nome", { ascending: true });

      if (!ativo) return;

      if (error) {
        setErroServicos(error.message);
      } else {
        setErroServicos("");
        setServicosSalao(data ?? []);
      }
      setCarregandoServicos(false);
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Abre o wizard de criação, sempre da Etapa A com o form zerado. Modo
  // 'janela' por padrão, pra não afetar o fluxo de criação de sempre.
  function abrirNovo() {
    setForm({
      nome: "",
      dias: diasVazios(),
      modoHorario: "janela",
      horariosFixosPorDia: horariosFixosVazios(),
      mesmoHorario: null,
      temAlmoco: false,
      almocoSalvoOriginal: false,
      horarioComum: { ...BLOCO_VAZIO },
      servicos: [],
    });
    setErroForm("");
    setEtapa("A");
    setEditando("novo");
  }

  // Edição: carrega o profissional e sua agenda (horarios_trabalho OU
  // horarios_fixos, conforme modo_horario) na tela de resumo. `mesmoHorario=
  // false` porque a edição sempre trabalha por dia (a grade real do banco
  // pode diferir entre dias). Busca as duas tabelas de horário em paralelo —
  // só a do modo atual é usada, mas evita duas idas ao banco se o dono trocar
  // de modo na tela de edição.
  async function abrirEdicao(profissional) {
    setEditando(profissional);
    setAbaEdicao("horarios");
    setErroForm("");
    const modoHorario = profissional.modo_horario ?? "janela";
    setForm({
      nome: profissional.nome,
      dias: diasVazios(),
      modoHorario,
      horariosFixosPorDia: horariosFixosVazios(),
      mesmoHorario: false,
      temAlmoco: false,
      almocoSalvoOriginal: false,
      horarioComum: { ...BLOCO_VAZIO },
      servicos: [],
    });
    setCarregandoForm(true);

    // Grade (janela + fixo) + vínculos de serviço em paralelo (todos por
    // profissional_id).
    const [resHorarios, resFixos, resVinculos] = await Promise.all([
      supabase
        .from("horarios_trabalho")
        .select("dia_semana, hora_inicio, hora_fim, almoco_inicio, almoco_fim")
        .eq("profissional_id", profissional.id),
      supabase
        .from("horarios_fixos")
        .select("dia_semana, horario")
        .eq("profissional_id", profissional.id),
      supabase
        .from("servico_profissional")
        .select("servico_id")
        .eq("profissional_id", profissional.id),
    ]);

    setCarregandoForm(false);

    if (resHorarios.error) {
      setErroForm(`Não foi possível carregar os horários: ${resHorarios.error.message}`);
      return;
    }
    if (resFixos.error) {
      setErroForm(`Não foi possível carregar os horários fixos: ${resFixos.error.message}`);
      return;
    }
    if (resVinculos.error) {
      setErroForm(`Não foi possível carregar os serviços: ${resVinculos.error.message}`);
      return;
    }

    // Se qualquer linha tem almoço salvo, já vem com a checkbox marcada e os
    // campos visíveis; senão vem desmarcada e ocultos. `almocoSalvoOriginal`
    // registra esse estado inicial (pra decidir o confirm de remoção no save).
    // Só faz sentido no modo 'janela' (o 'fixo' não tem almoço).
    const tinhaAlmoco = (resHorarios.data ?? []).some((h) => h.almoco_inicio);
    setForm({
      nome: profissional.nome,
      dias:
        modoHorario === "fixo"
          ? diasDeHorariosFixos(resFixos.data ?? [])
          : diasDeHorarios(resHorarios.data ?? []),
      modoHorario,
      horariosFixosPorDia: horariosFixosPorDiaDeLinhas(resFixos.data ?? []),
      mesmoHorario: false,
      temAlmoco: tinhaAlmoco,
      almocoSalvoOriginal: tinhaAlmoco,
      horarioComum: { ...BLOCO_VAZIO },
      servicos: (resVinculos.data ?? []).map((v) => v.servico_id),
    });
  }

  function fecharForm() {
    setEditando(null);
    setEtapa("A");
    setForm(FORM_INICIAL);
    setErroForm("");
  }

  function handleNome(e) {
    const nome = e.target.value;
    setForm((anterior) => ({ ...anterior, nome }));
  }

  function setMesmoHorario(valor) {
    setForm((anterior) => ({ ...anterior, mesmoHorario: valor }));
  }

  // Troca o modo de agenda ('janela'/'fixo'). Toda troca de fato (não clicar
  // de novo no que já está selecionado) passa por confirm(): mudar o tipo
  // pode deixar a agenda sem horários até o dono cadastrar/revisar do outro
  // jeito.
  function setModoHorario(valor) {
    setForm((anterior) => {
      if (anterior.modoHorario === valor) return anterior;
      const ok = window.confirm(
        "Mudar o tipo de agenda pode deixar a agenda sem horários até você cadastrar/revisar. Continuar?"
      );
      if (!ok) return anterior;
      return { ...anterior, modoHorario: valor };
    });
  }

  // Adiciona/remove uma tag de horário fixo de um dia (modo 'fixo'). Ignora
  // duplicata; mantém a lista ordenada.
  function adicionarHorarioFixo(dia, horario) {
    setForm((anterior) => {
      const atual = anterior.horariosFixosPorDia[dia];
      if (atual.includes(horario)) return anterior;
      const atualizado = [...atual, horario].sort();
      return {
        ...anterior,
        horariosFixosPorDia: anterior.horariosFixosPorDia.map((lista, i) =>
          i === dia ? atualizado : lista
        ),
      };
    });
  }

  function removerHorarioFixo(dia, horario) {
    setForm((anterior) => ({
      ...anterior,
      horariosFixosPorDia: anterior.horariosFixosPorDia.map((lista, i) =>
        i === dia ? lista.filter((h) => h !== horario) : lista
      ),
    }));
  }

  function setTemAlmoco(valor) {
    setForm((anterior) => ({ ...anterior, temAlmoco: valor }));
  }

  // Liga/desliga o vínculo com um serviço (por id) na seleção do form.
  function alternarServico(id) {
    setForm((anterior) => ({
      ...anterior,
      servicos: anterior.servicos.includes(id)
        ? anterior.servicos.filter((s) => s !== id)
        : [...anterior.servicos, id],
    }));
  }

  // "Selecionar todos": marca/desmarca de uma vez todos os serviços MOSTRADOS
  // (os ativos do salão). Se todos já estão marcados, desmarca só esses (união/
  // diferença preserva algum vínculo oculto de serviço inativo, se houver).
  function alternarTodosServicos() {
    setForm((anterior) => {
      const idsMostrados = servicosSalao.map((s) => s.id);
      const todosMarcados =
        idsMostrados.length > 0 &&
        idsMostrados.every((id) => anterior.servicos.includes(id));
      if (todosMarcados) {
        return {
          ...anterior,
          servicos: anterior.servicos.filter((id) => !idsMostrados.includes(id)),
        };
      }
      return { ...anterior, servicos: [...new Set([...anterior.servicos, ...idsMostrados])] };
    });
  }

  // Liga/desliga um dia. Desligar não apaga os campos (preserva se religar).
  function alternarDia(indice) {
    setForm((anterior) => ({
      ...anterior,
      dias: anterior.dias.map((dia, i) =>
        i === indice ? { ...dia, ativo: !dia.ativo } : dia
      ),
    }));
  }

  // Patch de um campo de horário de um dia específico.
  function handleCampoDia(indice, campo, valor) {
    setForm((anterior) => ({
      ...anterior,
      dias: anterior.dias.map((dia, i) =>
        i === indice ? { ...dia, [campo]: valor } : dia
      ),
    }));
  }

  // Patch de um campo do bloco comum (modo "mesmo horário todos os dias").
  function handleCampoComum(campo, valor) {
    setForm((anterior) => ({
      ...anterior,
      horarioComum: { ...anterior.horarioComum, [campo]: valor },
    }));
  }

  // Navegação do wizard. Da Etapa A valida o essencial (nome, ≥1 dia, resposta
  // do "mesmo horário?" — só no modo 'janela') antes de mostrar a Janela B. Da
  // Etapa B valida o form inteiro (mesma checagem do salvar) antes da Janela C.
  function avancar() {
    if (etapa === "A") {
      if (!form.nome.trim()) {
        setErroForm("Informe o nome do profissional.");
        return;
      }
      if (!form.dias.some((d) => d.ativo)) {
        setErroForm("Selecione ao menos um dia de trabalho.");
        return;
      }
      if (form.modoHorario === "janela" && form.mesmoHorario === null) {
        setErroForm("Escolha se o horário é o mesmo todos os dias.");
        return;
      }
      setErroForm("");
      setEtapa("B");
      return;
    }

    if (etapa === "B") {
      const { erro } = coletarDados(form);
      if (erro) {
        setErroForm(erro);
        return;
      }
      setErroForm("");
      setEtapa("C");
    }
  }

  function voltar() {
    setErroForm("");
    setEtapa((atual) => (atual === "C" ? "B" : "A"));
  }

  // Apaga todas as linhas de uma tabela de horário pertencentes ao
  // profissional. Usado tanto pra regravar a tabela do modo atual quanto pra
  // limpar a do modo OPOSTO ao salvar (ver salvarAgenda).
  async function apagarPorProfissional(tabela, profissionalId) {
    const { error } = await supabase
      .from(tabela)
      .delete()
      .eq("profissional_id", profissionalId);
    return error ?? null;
  }

  // Regrava a grade inteira (horarios_trabalho, modo 'janela'): apaga as
  // linhas atuais do profissional e insere as dos dias ativos. Substituição
  // total mantém "uma linha por (profissional_id, dia_semana)" sem upsert
  // manual. Validação client-side roda ANTES.
  async function salvarHorarios(profissionalId, horarios) {
    const erroDelete = await apagarPorProfissional("horarios_trabalho", profissionalId);
    if (erroDelete) return erroDelete;

    if (horarios.length === 0) return null;

    const linhas = horarios.map((h) => ({ ...h, profissional_id: profissionalId }));
    const { error: erroInsert } = await supabase
      .from("horarios_trabalho")
      .insert(linhas);
    return erroInsert ?? null;
  }

  // Regrava a lista inteira de horarios_fixos (modo 'fixo'): mesma estratégia
  // "substitui tudo" de salvarHorarios, uma linha por (profissional, dia,
  // horario).
  async function salvarHorariosFixos(profissionalId, horariosFixos) {
    const erroDelete = await apagarPorProfissional("horarios_fixos", profissionalId);
    if (erroDelete) return erroDelete;

    if (horariosFixos.length === 0) return null;

    const linhas = horariosFixos.map((h) => ({ ...h, profissional_id: profissionalId }));
    const { error: erroInsert } = await supabase
      .from("horarios_fixos")
      .insert(linhas);
    return erroInsert ?? null;
  }

  // Regrava a agenda do profissional conforme `dados.modoHorario` (resultado
  // de coletarDados) e limpa a tabela do modo OPOSTO — só uma fonte de
  // horários fica ativa por vez, sem linha órfã de um modo antigo.
  async function salvarAgenda(profissionalId, dados) {
    if (dados.modoHorario === "fixo") {
      const erroOutro = await apagarPorProfissional("horarios_trabalho", profissionalId);
      if (erroOutro) return erroOutro;
      return salvarHorariosFixos(profissionalId, dados.horariosFixos);
    }
    const erroOutro = await apagarPorProfissional("horarios_fixos", profissionalId);
    if (erroOutro) return erroOutro;
    return salvarHorarios(profissionalId, dados.horarios);
  }

  // Regrava os vínculos de serviço: apaga os do profissional e insere os
  // marcados. Mesma estratégia "substitui tudo" dos horários. Devolve o erro
  // do Supabase ou null.
  async function salvarServicos(profissionalId, servicoIds) {
    const { error: erroDelete } = await supabase
      .from("servico_profissional")
      .delete()
      .eq("profissional_id", profissionalId);
    if (erroDelete) return erroDelete;

    if (servicoIds.length === 0) return null;

    const linhas = servicoIds.map((servico_id) => ({
      servico_id,
      profissional_id: profissionalId,
    }));
    const { error: erroInsert } = await supabase
      .from("servico_profissional")
      .insert(linhas);
    return erroInsert ?? null;
  }

  async function handleSalvar() {
    const {
      erro: erroValidacao,
      nome,
      modoHorario,
      horarios,
      horariosFixos,
    } = coletarDados(form);
    if (erroValidacao) {
      setErroForm(erroValidacao);
      return;
    }
    const dadosAgenda = { modoHorario, horarios, horariosFixos };

    // Remoção real de almoço: checkbox desmarcada E o profissional tinha almoço
    // salvo antes. Só aí `horarios` vai com almoço null nas linhas — confirma
    // antes, porque libera o intervalo pra agendamento. Cancelar mantém o almoço
    // salvo: remarca a checkbox (valores seguem em memória) e aborta o save.
    // Só se aplica ao modo 'janela' (o 'fixo' não tem almoço).
    if (modoHorario === "janela" && !form.temAlmoco && form.almocoSalvoOriginal) {
      const ok = window.confirm(
        "Remover o horário de almoço deste profissional? Os clientes poderão agendar nesse intervalo."
      );
      if (!ok) {
        setTemAlmoco(true);
        return;
      }
    }

    setSalvando(true);
    setErroForm("");

    if (editando === "novo") {
      // Cria já ativo, particionado pelo estabelecimento resolvido.
      const { data, error } = await supabase
        .from("profissionais")
        .insert({
          nome,
          ativo: true,
          estabelecimento_id: estabelecimento.id,
          modo_horario: modoHorario,
        })
        .select("id, nome, ativo, modo_horario")
        .single();

      if (error) {
        setSalvando(false);
        setErroForm(error.message);
        return;
      }

      const erroHorarios = await salvarAgenda(data.id, dadosAgenda);
      if (erroHorarios) {
        setSalvando(false);
        // Profissional criado; a agenda falhou. Cai na tela de resumo (edição)
        // já com os horários/serviços digitados, pra corrigir/reenviar. A
        // gravação falhou: nada foi persistido, então almocoSalvoOriginal=false
        // (não há almoço a "remover" no próximo save).
        setProfissionais((atuais) => ordenar([...atuais, data]));
        setForm(
          formDeFallback({
            nome,
            modoHorario,
            horarios,
            horariosFixos,
            servicos: form.servicos,
            almocoSalvoOriginal: false,
          })
        );
        setEditando(data);
        setErroForm(`Profissional criado, mas os horários falharam: ${erroHorarios.message}`);
        return;
      }

      const erroServicos = await salvarServicos(data.id, form.servicos);
      setSalvando(false);
      if (erroServicos) {
        // Profissional + agenda salvos; os vínculos falharam. Cai no resumo pra
        // reenviar (o próximo salvar regrava os vínculos inteiros).
        setProfissionais((atuais) => ordenar([...atuais, data]));
        setForm(
          formDeFallback({
            nome,
            modoHorario,
            horarios,
            horariosFixos,
            servicos: form.servicos,
            almocoSalvoOriginal: (horarios ?? []).some((h) => h.almoco_inicio),
          })
        );
        setEditando(data);
        setErroForm(`Profissional criado, mas os serviços falharam: ${erroServicos.message}`);
        return;
      }

      setProfissionais((atuais) => ordenar([...atuais, data]));
      fecharForm();
      return;
    }

    // Edição: atualiza o nome + modo de agenda e regrava a agenda.
    const { error } = await supabase
      .from("profissionais")
      .update({ nome, modo_horario: modoHorario })
      .eq("id", editando.id);

    if (error) {
      setSalvando(false);
      setErroForm(error.message);
      return;
    }

    const erroHorarios = await salvarAgenda(editando.id, dadosAgenda);
    if (erroHorarios) {
      setSalvando(false);
      setErroForm(`Nome salvo, mas os horários falharam: ${erroHorarios.message}`);
      return;
    }

    const erroServicos = await salvarServicos(editando.id, form.servicos);
    setSalvando(false);
    if (erroServicos) {
      setErroForm(`Nome e horários salvos, mas os serviços falharam: ${erroServicos.message}`);
      return;
    }

    setProfissionais((atuais) =>
      ordenar(
        atuais.map((p) =>
          p.id === editando.id ? { ...p, nome, modo_horario: modoHorario } : p
        )
      )
    );
    fecharForm();
  }

  // Soft delete: marca ativo=false (nunca DELETE físico). A grade em
  // horarios_trabalho é preservada (some da UI, mas fica no banco).
  async function handleExcluir(profissional) {
    const { error } = await supabase
      .from("profissionais")
      .update({ ativo: false })
      .eq("id", profissional.id);

    if (error) {
      setErro(`Não foi possível desativar o profissional: ${error.message}`);
      setProfissionalParaExcluir(null);
      return;
    }

    setErro("");
    setProfissionais((atuais) => ordenar(atualizarAtivo(atuais, profissional.id, false)));
    setProfissionalParaExcluir(null);
  }

  // Reativa um profissional soft-deleted (ativo=true).
  async function handleReativar(profissional) {
    const { error } = await supabase
      .from("profissionais")
      .update({ ativo: true })
      .eq("id", profissional.id);

    if (error) {
      setErro(`Não foi possível reativar o profissional: ${error.message}`);
      return;
    }

    setErro("");
    setProfissionais((atuais) => ordenar(atualizarAtivo(atuais, profissional.id, true)));
  }

  if (carregando) {
    return (
      <p className="rounded-lg bg-card px-4 py-3 text-sm text-body shadow-sm ring-1 ring-border">
        Carregando profissionais...
      </p>
    );
  }

  if (erro) {
    return (
      <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
        {erro}
      </p>
    );
  }

  // Dias ativos (rótulos) pro resumo do modo "mesmo horário".
  const diasAtivosRotulos = DIAS.filter((info) => form.dias[info.n].ativo).map(
    (info) => info.curto
  );
  const indiceEtapa = ETAPAS.findIndex((e) => e.id === etapa);

  // Modo 'fixo' com algum dia ativo sem nenhum horário na lista: deixaria a
  // agenda vazia nesse dia sem o dono perceber — bloqueia o Salvar (com
  // mensagem visível, não só disabled silencioso; ver coletarDados).
  const diaFixoSemHorario =
    form.modoHorario === "fixo" &&
    form.dias.some((d, i) => d.ativo && form.horariosFixosPorDia[i].length === 0);

  return (
    <>
      {/* Cabeçalho da aba + ação de criar. O botão some enquanto o formulário
          está aberto pra não competir com ele. */}
      {!editando && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-body">
            {profissionais.length} profissiona{profissionais.length === 1 ? "l" : "is"}
          </p>
          <button
            type="button"
            onClick={abrirNovo}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            Novo profissional
          </button>
        </div>
      )}

      {/* WIZARD DE CRIAÇÃO (editando === "novo"): 3 janelas navegáveis. */}
      {editando === "novo" && (
        <div className="mb-4 space-y-4 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border">
          <div>
            <h3 className="text-base font-semibold text-heading">Novo profissional</h3>
            {/* Stepper: barrinhas + "Passo N de 3 · rótulo". */}
            <div className="mt-3 flex items-center gap-1.5">
              {ETAPAS.map((e, i) => (
                <div
                  key={e.id}
                  className={`h-1.5 flex-1 rounded-full transition ${
                    i <= indiceEtapa ? "bg-primary" : "bg-border"
                  }`}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs font-medium text-muted">
              Passo {indiceEtapa + 1} de {ETAPAS.length} · {ETAPAS[indiceEtapa].rotulo}
            </p>
          </div>

          {/* JANELA A — Identificação e dias. */}
          {etapa === "A" && (
            <div className="space-y-4">
              <div>
                <label htmlFor="nome-prof" className="mb-1 block text-sm font-medium text-body">
                  Nome
                </label>
                <input
                  id="nome-prof"
                  type="text"
                  value={form.nome}
                  onChange={handleNome}
                  placeholder="Ex.: João da Silva"
                  className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>

              <div>
                <span className="mb-2 block text-sm font-medium text-body">
                  Dias que trabalha
                </span>
                <div className="flex flex-wrap gap-2">
                  {DIAS.map((info) => {
                    const ativo = form.dias[info.n].ativo;
                    return (
                      <button
                        key={info.n}
                        type="button"
                        role="checkbox"
                        aria-checked={ativo}
                        onClick={() => alternarDia(info.n)}
                        className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 transition ${
                          ativo
                            ? "bg-primary text-white ring-primary"
                            : "bg-card text-body ring-border hover:bg-surface"
                        }`}
                      >
                        {info.rotulo}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="mb-2 block text-sm font-medium text-body">
                  Tipo de agenda
                </span>
                <div className="flex gap-2">
                  {[
                    { valor: "janela", rotulo: "Janela contínua" },
                    { valor: "fixo", rotulo: "Horários fixos" },
                  ].map((opcao) => {
                    const selecionado = form.modoHorario === opcao.valor;
                    return (
                      <button
                        key={opcao.valor}
                        type="button"
                        aria-pressed={selecionado}
                        onClick={() => setModoHorario(opcao.valor)}
                        className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium ring-1 transition ${
                          selecionado
                            ? "bg-primary text-white ring-primary"
                            : "bg-card text-body ring-border hover:bg-surface"
                        }`}
                      >
                        {opcao.rotulo}
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.modoHorario === "janela" && (
                <div>
                  <span className="mb-2 block text-sm font-medium text-body">
                    Mesmo horário todos os dias?
                  </span>
                  <div className="flex gap-2">
                    {[
                      { valor: true, rotulo: "Sim" },
                      { valor: false, rotulo: "Não" },
                    ].map((opcao) => {
                      const selecionado = form.mesmoHorario === opcao.valor;
                      return (
                        <button
                          key={opcao.rotulo}
                          type="button"
                          aria-pressed={selecionado}
                          onClick={() => setMesmoHorario(opcao.valor)}
                          className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium ring-1 transition ${
                            selecionado
                              ? "bg-primary text-white ring-primary"
                              : "bg-card text-body ring-border hover:bg-surface"
                          }`}
                        >
                          {opcao.rotulo}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* JANELA B — Horários. Modo 'fixo' usa tags por dia; 'janela'
              depende do "mesmo horário?". */}
          {etapa === "B" && (
            <div className="space-y-3">
              {form.modoHorario === "fixo" ? (
                <>
                  <p className="text-sm text-body">
                    Cadastre os horários fixos de cada dia ativo (ex.: 08:00,
                    10:00, 13:00).
                  </p>
                  <GradeDiasFixos
                    dias={form.dias}
                    onToggle={alternarDia}
                    horariosFixosPorDia={form.horariosFixosPorDia}
                    onAdicionarHorario={adicionarHorarioFixo}
                    onRemoverHorario={removerHorarioFixo}
                  />
                </>
              ) : form.mesmoHorario ? (
                <>
                  <p className="text-sm text-body">
                    Este horário será aplicado a todos os dias ativos
                    {diasAtivosRotulos.length > 0 && (
                      <> ({diasAtivosRotulos.join(", ")})</>
                    )}
                    .
                  </p>
                  <div className="rounded-xl bg-card p-3 ring-1 ring-border">
                    {/* Checkbox "Almoço" junto ao bloco único. */}
                    <div className="mb-2 flex justify-end">
                      <CheckAlmoco checked={form.temAlmoco} onChange={setTemAlmoco} />
                    </div>
                    <CamposHorario
                      bloco={form.horarioComum}
                      rotulo="todos os dias"
                      mostrarAlmoco={form.temAlmoco}
                      onCampo={handleCampoComum}
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* Cabeçalho da grade: a checkbox "Almoço" controla a coluna
                      de almoço de todos os dias de uma vez. */}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-body">
                      Defina o horário de cada dia. Você pode ligar/desligar dias
                      aqui também.
                    </p>
                    <CheckAlmoco checked={form.temAlmoco} onChange={setTemAlmoco} />
                  </div>
                  <GradeDias
                    dias={form.dias}
                    onToggle={alternarDia}
                    onCampo={handleCampoDia}
                    mostrarAlmoco={form.temAlmoco}
                  />
                </>
              )}
            </div>
          )}

          {/* JANELA C — Serviços que o profissional atende. */}
          {etapa === "C" && (
            <ListaServicos
              servicos={servicosSalao}
              carregando={carregandoServicos}
              erro={erroServicos}
              selecionados={form.servicos}
              onToggle={alternarServico}
            />
          )}

          {erroForm && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erroForm}
            </p>
          )}

          {etapa === "C" && diaFixoSemHorario && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-amber-100">
              Cadastre ao menos um horário fixo pra cada dia ativo antes de
              salvar (volte à Janela B).
            </p>
          )}

          {/* Navegação do wizard. */}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            {etapa === "C" ? (
              <button
                type="button"
                onClick={handleSalvar}
                disabled={salvando || diaFixoSemHorario}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            ) : (
              <button
                type="button"
                onClick={avancar}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover"
              >
                Avançar
              </button>
            )}
            <button
              type="button"
              onClick={etapa === "A" ? fecharForm : voltar}
              className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              {etapa === "A" ? "Cancelar" : "Voltar"}
            </button>
          </div>
        </div>
      )}

      {/* TELA DE RESUMO (edição): tudo editável de uma vez. */}
      {editando && editando !== "novo" && (
        <div className="mb-4 space-y-5 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border">
          <h3 className="text-base font-semibold text-heading">Editar profissional</h3>

          {carregandoForm ? (
            <p className="rounded-lg bg-surface px-3 py-3 text-sm text-body ring-1 ring-border">
              Carregando dados...
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="nome-prof-edit" className="mb-1 block text-sm font-medium text-body">
                  Nome
                </label>
                <input
                  id="nome-prof-edit"
                  type="text"
                  value={form.nome}
                  onChange={handleNome}
                  placeholder="Ex.: João da Silva"
                  className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>

              {/* Switcher de abas (estado local `abaEdicao`). */}
              <div className="flex gap-1 rounded-lg bg-surface p-1 ring-1 ring-border">
                {ABAS_EDICAO.map((aba) => (
                  <button
                    key={aba.id}
                    type="button"
                    onClick={() => setAbaEdicao(aba.id)}
                    aria-pressed={abaEdicao === aba.id}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                      abaEdicao === aba.id
                        ? "bg-card text-heading shadow-sm ring-1 ring-border"
                        : "text-body hover:text-heading"
                    }`}
                  >
                    {aba.rotulo}
                  </button>
                ))}
              </div>

              {/* ABA Horários — tipo de agenda + grade de dias (janela) ou
                  tags de horário fixo, conforme o modo. */}
              {abaEdicao === "horarios" && (
                <div className="space-y-4">
                  {MOSTRAR_TOGGLE_MODO_HORARIO && (
                    <div>
                      <span className="mb-2 block text-sm font-medium text-body">
                        Tipo de agenda
                      </span>
                      <div className="flex gap-2">
                        {[
                          { valor: "janela", rotulo: "Janela contínua" },
                          { valor: "fixo", rotulo: "Horários fixos" },
                        ].map((opcao) => {
                          const selecionado = form.modoHorario === opcao.valor;
                          return (
                            <button
                              key={opcao.valor}
                              type="button"
                              aria-pressed={selecionado}
                              onClick={() => setModoHorario(opcao.valor)}
                              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium ring-1 transition ${
                                selecionado
                                  ? "bg-primary text-white ring-primary"
                                  : "bg-card text-body ring-border hover:bg-surface"
                              }`}
                            >
                              {opcao.rotulo}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {form.modoHorario === "fixo" ? (
                    <div>
                      <span className="mb-2 block text-sm font-medium text-body">
                        Dias e horários fixos
                      </span>
                      <GradeDiasFixos
                        dias={form.dias}
                        onToggle={alternarDia}
                        horariosFixosPorDia={form.horariosFixosPorDia}
                        onAdicionarHorario={adicionarHorarioFixo}
                        onRemoverHorario={removerHorarioFixo}
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-body">
                          Dias e horários
                        </span>
                        <CheckAlmoco checked={form.temAlmoco} onChange={setTemAlmoco} />
                      </div>
                      <GradeDias
                        dias={form.dias}
                        onToggle={alternarDia}
                        onCampo={handleCampoDia}
                        mostrarAlmoco={form.temAlmoco}
                      />
                    </div>
                  )}

                  {diaFixoSemHorario && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-amber-100">
                      Cadastre ao menos um horário fixo pra cada dia ativo
                      antes de salvar.
                    </p>
                  )}
                </div>
              )}

              {/* ABA Serviços — seleção + "Selecionar todos". */}
              {abaEdicao === "servicos" && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-body">Serviços</span>
                    {servicosSalao.length > 0 && (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-body">
                        <input
                          type="checkbox"
                          checked={servicosSalao.every((s) =>
                            form.servicos.includes(s.id)
                          )}
                          onChange={alternarTodosServicos}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
                        />
                        Selecionar todos
                      </label>
                    )}
                  </div>
                  <ListaServicos
                    servicos={servicosSalao}
                    carregando={carregandoServicos}
                    erro={erroServicos}
                    selecionados={form.servicos}
                    onToggle={alternarServico}
                  />
                </div>
              )}

              {/* ABA Ausências. */}
              {abaEdicao === "ausencias" && (
                <SecaoAusencias
                  profissionalId={editando.id}
                  estabelecimentoId={estabelecimento.id}
                  modoHorario={form.modoHorario}
                  horariosFixosPorDia={form.horariosFixosPorDia}
                  dias={form.dias}
                />
              )}
            </>
          )}

          {erroForm && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {erroForm}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              onClick={handleSalvar}
              disabled={salvando || carregandoForm || diaFixoSemHorario}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={fecharForm}
              className="flex-1 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de profissionais. Some enquanto o formulário está aberto pra
          manter o foco numa coisa só (mobile). */}
      {!editando && (
        profissionais.length === 0 ? (
          <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
            Nenhum profissional cadastrado.
          </p>
        ) : (
          <ul className="space-y-3">
            {profissionais.map((profissional) => (
              <li
                key={profissional.id}
                className={`rounded-2xl p-4 shadow-sm ring-1 transition ${
                  profissional.ativo ? "bg-card ring-border" : "bg-surface ring-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate font-medium text-heading">
                    {profissional.nome}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                      profissional.ativo
                        ? "bg-green-50 text-green-700 ring-green-100"
                        : "bg-surface text-body ring-border"
                    }`}
                  >
                    {profissional.ativo ? "Ativo" : "Inativo"}
                  </span>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {profissional.ativo ? (
                    <>
                      <button
                        type="button"
                        onClick={() => abrirEdicao(profissional)}
                        className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setProfissionalParaExcluir(profissional)}
                        className="inline-flex flex-1 items-center justify-center rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                      >
                        Desativar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReativar(profissional)}
                      className="inline-flex flex-1 items-center justify-center rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100"
                    >
                      Reativar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {/* Modal de confirmação do soft delete. Deixa claro que o histórico é
          preservado (o profissional só fica inativo). */}
      {profissionalParaExcluir && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-excluir-profissional"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setProfissionalParaExcluir(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="titulo-excluir-profissional"
              className="text-lg font-semibold text-heading"
            >
              Desativar profissional
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja desativar{" "}
              <span className="font-medium text-heading">
                {profissionalParaExcluir.nome}
              </span>
              ? Ele deixará de aparecer para novos agendamentos, mas o histórico é
              preservado.
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => handleExcluir(profissionalParaExcluir)}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setProfissionalParaExcluir(null)}
                className="flex-1 rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Reordena a lista pela mesma chave da query (ativos primeiro, depois nome).
function ordenar(lista) {
  return [...lista].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.nome.localeCompare(b.nome);
  });
}

// Patch imutável do campo `ativo` de um profissional na lista.
function atualizarAtivo(lista, id, ativo) {
  return lista.map((p) => (p.id === id ? { ...p, ativo } : p));
}
