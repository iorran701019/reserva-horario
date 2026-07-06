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

// Estado inicial do formulário. `mesmoHorario`:
//   null  – ainda não respondido (Janela A)
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

// Valida o formulário inteiro e monta as linhas de horário prontas pra gravar.
// Devolve { erro } ou { nome, horarios }. No modo "mesmo horário" (mesmoHorario
// = true) valida o bloco comum uma vez e o REPLICA em cada dia ativo; senão
// valida e usa o bloco próprio de cada dia.
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

  return { nome, horarios };
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
        .select("id, nome, ativo")
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

  // Abre o wizard de criação, sempre da Etapa A com o form zerado.
  function abrirNovo() {
    setForm({
      nome: "",
      dias: diasVazios(),
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

  // Edição: carrega o profissional e sua grade (horarios_trabalho) na tela de
  // resumo. `mesmoHorario=false` porque a edição sempre trabalha por dia (a
  // grade real do banco pode diferir entre dias).
  async function abrirEdicao(profissional) {
    setEditando(profissional);
    setErroForm("");
    setForm({
      nome: profissional.nome,
      dias: diasVazios(),
      mesmoHorario: false,
      temAlmoco: false,
      almocoSalvoOriginal: false,
      horarioComum: { ...BLOCO_VAZIO },
      servicos: [],
    });
    setCarregandoForm(true);

    // Grade + vínculos de serviço em paralelo (ambos por profissional_id).
    const [resHorarios, resVinculos] = await Promise.all([
      supabase
        .from("horarios_trabalho")
        .select("dia_semana, hora_inicio, hora_fim, almoco_inicio, almoco_fim")
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
    if (resVinculos.error) {
      setErroForm(`Não foi possível carregar os serviços: ${resVinculos.error.message}`);
      return;
    }

    // Se qualquer linha tem almoço salvo, já vem com a checkbox marcada e os
    // campos visíveis; senão vem desmarcada e ocultos. `almocoSalvoOriginal`
    // registra esse estado inicial (pra decidir o confirm de remoção no save).
    const tinhaAlmoco = (resHorarios.data ?? []).some((h) => h.almoco_inicio);
    setForm({
      nome: profissional.nome,
      dias: diasDeHorarios(resHorarios.data ?? []),
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
  // do "mesmo horário?") antes de mostrar a Janela B. Da Etapa B valida o form
  // inteiro (mesma checagem do salvar) antes da Janela C.
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
      if (form.mesmoHorario === null) {
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

  // Regrava a grade inteira: apaga as linhas atuais do profissional e insere as
  // dos dias ativos. Substituição total mantém "uma linha por (profissional_id,
  // dia_semana)" sem upsert manual. Validação client-side roda ANTES.
  async function salvarHorarios(profissionalId, horarios) {
    const { error: erroDelete } = await supabase
      .from("horarios_trabalho")
      .delete()
      .eq("profissional_id", profissionalId);
    if (erroDelete) return erroDelete;

    if (horarios.length === 0) return null;

    const linhas = horarios.map((h) => ({ ...h, profissional_id: profissionalId }));
    const { error: erroInsert } = await supabase
      .from("horarios_trabalho")
      .insert(linhas);
    return erroInsert ?? null;
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
    const { erro: erroValidacao, nome, horarios } = coletarDados(form);
    if (erroValidacao) {
      setErroForm(erroValidacao);
      return;
    }

    // Remoção real de almoço: checkbox desmarcada E o profissional tinha almoço
    // salvo antes. Só aí `horarios` vai com almoço null nas linhas — confirma
    // antes, porque libera o intervalo pra agendamento. Cancelar mantém o almoço
    // salvo: remarca a checkbox (valores seguem em memória) e aborta o save.
    if (!form.temAlmoco && form.almocoSalvoOriginal) {
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
        .insert({ nome, ativo: true, estabelecimento_id: estabelecimento.id })
        .select("id, nome, ativo")
        .single();

      if (error) {
        setSalvando(false);
        setErroForm(error.message);
        return;
      }

      const erroHorarios = await salvarHorarios(data.id, horarios);
      if (erroHorarios) {
        setSalvando(false);
        // Profissional criado; a grade falhou. Cai na tela de resumo (edição)
        // já com os horários/serviços digitados, pra corrigir/reenviar.
        setProfissionais((atuais) => ordenar([...atuais, data]));
        // A gravação da grade falhou: nada de almoço foi persistido, então
        // almocoSalvoOriginal=false (não há almoço a "remover" no próximo save).
        setForm({
          nome,
          dias: diasDeHorarios(horarios),
          mesmoHorario: false,
          temAlmoco: horarios.some((h) => h.almoco_inicio),
          almocoSalvoOriginal: false,
          horarioComum: { ...BLOCO_VAZIO },
          servicos: form.servicos,
        });
        setEditando(data);
        setErroForm(`Profissional criado, mas os horários falharam: ${erroHorarios.message}`);
        return;
      }

      const erroServicos = await salvarServicos(data.id, form.servicos);
      setSalvando(false);
      if (erroServicos) {
        // Profissional + grade salvos; os vínculos falharam. Cai no resumo pra
        // reenviar (o próximo salvar regrava os vínculos inteiros).
        setProfissionais((atuais) => ordenar([...atuais, data]));
        setForm({
          nome,
          dias: diasDeHorarios(horarios),
          mesmoHorario: false,
          temAlmoco: horarios.some((h) => h.almoco_inicio),
          almocoSalvoOriginal: horarios.some((h) => h.almoco_inicio),
          horarioComum: { ...BLOCO_VAZIO },
          servicos: form.servicos,
        });
        setEditando(data);
        setErroForm(`Profissional criado, mas os serviços falharam: ${erroServicos.message}`);
        return;
      }

      setProfissionais((atuais) => ordenar([...atuais, data]));
      fecharForm();
      return;
    }

    // Edição: atualiza o nome e regrava a grade.
    const { error } = await supabase
      .from("profissionais")
      .update({ nome })
      .eq("id", editando.id);

    if (error) {
      setSalvando(false);
      setErroForm(error.message);
      return;
    }

    const erroHorarios = await salvarHorarios(editando.id, horarios);
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
      ordenar(atuais.map((p) => (p.id === editando.id ? { ...p, nome } : p)))
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
            </div>
          )}

          {/* JANELA B — Horários. Depende do "mesmo horário?". */}
          {etapa === "B" && (
            <div className="space-y-3">
              {form.mesmoHorario ? (
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

          {/* Navegação do wizard. */}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            {etapa === "C" ? (
              <button
                type="button"
                onClick={handleSalvar}
                disabled={salvando}
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

              <div>
                <span className="mb-2 block text-sm font-medium text-body">Serviços</span>
                <ListaServicos
                  servicos={servicosSalao}
                  carregando={carregandoServicos}
                  erro={erroServicos}
                  selecionados={form.servicos}
                  onToggle={alternarServico}
                />
              </div>
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
              disabled={salvando || carregandoForm}
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
