"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageCircleOff, X } from "lucide-react";
import NavegacaoMes from "@/components/NavegacaoMes";
import { useNavegacaoMes } from "@/lib/useNavegacaoMes";
import {
  buscarClientes,
  buscarResumoCliente,
  buscarHistoricoCompleto,
  buscarAnamneseDetalhe,
  buscarObservacoes,
  buscarAnotacoesLivres,
  criarAnotacaoLivre,
  buscarTodasEtiquetas,
} from "@/lib/clientesAdmin";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";
import { supabase } from "@/lib/supabaseClient";
import { existeModeloAtivo } from "@/lib/anamnese";
import { buscarConfirmadosPorTelefones } from "@/lib/agendamentosCliente";
import { classificarAgendamento, rotuloHistorico, ordenarHistoricoPorStatus } from "@/lib/particao";
import { buscarProgressoFidelidade } from "@/lib/fidelidade";
import { formatarDataBR, formatarHorario } from "@/lib/data";
import {
  linkWhatsApp,
  linkWhatsAppSemMensagem,
  MENSAGEM_CONTATO_CLIENTE_ADMIN,
} from "@/lib/whatsapp";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import BadgeFidelidade from "@/components/BadgeFidelidade";
import AtualizarDadosCliente from "@/components/AtualizarDadosCliente";
import FormularioAnamnese from "@/components/FormularioAnamnese";
import ModalAlterarWhatsapp from "@/components/ModalAlterarWhatsapp";
import CarrosselAgendamentos from "@/components/CarrosselAgendamentos";
import SeletorEtiquetaRapido, {
  CORES_ETIQUETA,
  COR_ETIQUETA_PADRAO,
  corEtiqueta,
} from "@/components/SeletorEtiquetaRapido";

// Aba "Clientes" do /admin: lista somente-leitura dos clientes do salão
// (tabela `clientes`, particionada por estabelecimento_id) com busca por nome
// e um "modo detalhe" que traz o resumo do relacionamento (próximo
// agendamento, último atendimento concluído, situação da anamnese). Mesmo
// padrão visual/estrutural de GerenciarProfissionais.js: cards
// `rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border`, clique abre o
// detalhe substituindo a lista, botão "Voltar" fecha.

// Paleta de cores da etiqueta: os 8 swatches de CORES_ETIQUETA como botões de
// rádio. Substituiu o campinho de emoji — a cor é o que distingue uma etiqueta
// da outra na tela agora (ver SeletorEtiquetaRapido.js).
//
// É um componente próprio porque aparece DUAS vezes no CRUD, em contextos
// diferentes: no form "Nova etiqueta" e no renomear inline.
//
// role="radiogroup" + aria-checked em vez de <input type="radio"> porque os
// dois usos ficam dentro do mesmo <form>/lista e radios nativos precisariam de
// `name` único por linha pra não se agruparem entre si.
function PaletaCorEtiqueta({ valor, onChange, disabled }) {
  return (
    <div role="radiogroup" aria-label="Cor da etiqueta" className="flex flex-wrap gap-1.5">
      {Object.entries(CORES_ETIQUETA).map(([chave, { rotulo, swatch }]) => {
        const selecionada = chave === valor;
        return (
          <button
            key={chave}
            type="button"
            role="radio"
            aria-checked={selecionada}
            aria-label={rotulo}
            title={rotulo}
            disabled={disabled}
            onClick={() => onChange(chave)}
            className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition disabled:cursor-not-allowed disabled:opacity-60 ${swatch} ${
              selecionada ? "ring-2 ring-heading" : "ring-1 ring-border hover:brightness-95"
            }`}
          />
        );
      })}
    </div>
  );
}

// true se o mês de `nascimento` (date "YYYY-MM-DD") for o mês atual — decide o
// badge "🎂 Aniversário" do card. Lê o mês por partes (sem construir Date),
// mesma convenção anti-fuso do resto do arquivo.
function ehAniversarianteDoMes(nascimento) {
  if (!nascimento) return false;
  const mes = Number(String(nascimento).slice(5, 7));
  return mes === new Date().getMonth() + 1;
}

// Situação da anamnese mais recente: null (nunca preenchida) ou "em_dia"/
// "vencida" (mais de 12 meses desde `criadoEm`, um timestamptz).
function situacaoAnamnese(criadoEm) {
  if (!criadoEm) return null;
  const limite = new Date();
  limite.setMonth(limite.getMonth() - 12);
  return new Date(criadoEm) < limite ? "vencida" : "em_dia";
}

// Cabeçalho clicável do padrão de acordeão usado em Histórico, Anamnese e
// Observações: título + contador opcional + seta que indica aberto/fechado.
function CabecalhoRetratil({ titulo, contador, aberto, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 text-left"
    >
      <h4 className="text-sm font-semibold text-heading">
        {titulo}
        {contador !== undefined && (
          <span className="ml-2 text-xs font-normal text-body">
            ({contador})
          </span>
        )}
      </h4>
      {aberto ? (
        <ChevronDown className="h-4 w-4 shrink-0 text-body" />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-body" />
      )}
    </button>
  );
}

// Tipo exibido para um item com observação: deriva da partição já usada no
// resto do painel (lib/particao) em vez de reimplementar a regra —
// "confirmado" (ainda ativo) é "Observação", qualquer outra coisa (histórico
// ou, por segurança, um "inbox" que não devia ter chegado aqui) é "Anotação".
function tipoObservacao(item) {
  return classificarAgendamento(item) === "confirmado" ? "Observação" : "Anotação";
}

// Rótulo exibido pra cada `tipo` (ver tipoObservacao acima) — só o texto
// mostrado na tag muda (com o contexto de onde a nota nasceu); o valor
// interno ("Observação"/"Anotação") continua o mesmo, usado pelo filtro
// (ver observacoesFiltradas) e pela lógica que decide qual tipo é.
const ROTULO_TIPO_OBSERVACAO = {
  Observação: "Observação (Painel)",
  Anotação: "Anotação (Histórico)",
};

// Texto + cor do badge de cada categoria do Histórico (ver rotuloHistorico,
// lib/particao). buscarHistoricoCompleto só traz confirmado/cancelado (nunca
// "caducado" — pendente vencido), mas a entrada fica aqui por completude.
const HISTORICO_BADGE = {
  expirado: { rotulo: "Expirado", classe: "bg-gray-100 text-gray-700 ring-gray-200" },
  cancelado: { rotulo: "Cancelado", classe: "bg-gray-100 text-gray-700 ring-gray-200" },
  concluido: { rotulo: "Concluído", classe: "bg-green-100 text-green-700 ring-green-200" },
  caducado: { rotulo: "Vencido", classe: "bg-gray-100 text-gray-700 ring-gray-200" },
};

// Detalhe de um cliente: dados cadastrais + resumo do relacionamento
// (próximo agendamento, anamnese) + três seções retráteis carregadas sob
// demanda (histórico completo, detalhe da anamnese, observações/anotações).
// `cliente` já traz os campos cadastrais de buscarClientes.
function DetalheCliente({
  cliente,
  estabelecimento,
  estabelecimentoId,
  msgContatoAdmin,
  onVoltar,
  onAgendarPara,
  onCancelarAgendamento,
  ultimoCancelamento,
  onEtiquetaAlterada,
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Cópia local dos dados cadastrais: nasce igual à prop `cliente`, mas
  // passa a refletir nome/whatsapp/endereço/etc. novos assim que o botão
  // "Editar" (ver AtualizarDadosCliente modoAdmin abaixo) salva com sucesso
  // — sem precisar recarregar a lista inteira. Mesmo padrão de
  // `clienteAtual` em PainelCliente.js.
  const [clienteAtual, setClienteAtual] = useState(cliente);
  const [editandoDados, setEditandoDados] = useState(false);
  const [alterandoWhatsapp, setAlterandoWhatsapp] = useState(false);

  const [resumo, setResumo] = useState(null);
  const [carregando, setCarregando] = useState(true);

  // Existe modelo de anamnese ATIVO pro estabelecimento (ver lib/anamnese.js
  // existeModeloAtivo)? Decide se a seção "Anamnese" abaixo aparece —
  // salão sem anamnese configurada não tem o que mostrar. null = ainda
  // resolvendo (a seção some por padrão até saber, mesmo tratamento de
  // `carregando` pro resto do resumo).
  const [temModeloAtivo, setTemModeloAtivo] = useState(null);

  // Progresso do programa de fidelidade (ver lib/fidelidade.js), banner no
  // topo da ficha. null = programa desligado ou nada a mostrar ainda.
  const [progressoFidelidade, setProgressoFidelidade] = useState(null);

  useEffect(() => {
    let ativo = true;
    buscarProgressoFidelidade(clienteAtual.id, estabelecimento).then((resultado) => {
      if (ativo) setProgressoFidelidade(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [clienteAtual.id, estabelecimento]);

  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [historico, setHistorico] = useState(null);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  // Reordena por status (Expirado, Cancelado, Concluído — ver
  // ordenarHistoricoPorStatus) preservando a ordem cronológica que já vem da
  // query (mais recente primeiro), e agrupa por trimestre (mesmo componente/
  // hook da aba Histórico do admin geral, ver app/[salon]/admin/page.js).
  // Chamado incondicionalmente aqui (antes do `return` de editandoDados
  // abaixo) porque é hook — precisa rodar sempre na mesma ordem entre renders.
  const navTrimestreHistorico = useNavegacaoMes(
    ordenarHistoricoPorStatus(historico ?? [])
  );

  const [anamneseAberta, setAnamneseAberta] = useState(false);
  const [anamneseDetalhe, setAnamneseDetalhe] = useState(null);
  const [carregandoAnamneseDetalhe, setCarregandoAnamneseDetalhe] = useState(false);
  const [editandoAnamnese, setEditandoAnamnese] = useState(false);

  const [observacoesAbertas, setObservacoesAbertas] = useState(false);
  const [observacoes, setObservacoes] = useState(null);
  const [carregandoObservacoes, setCarregandoObservacoes] = useState(false);
  const [filtroObs, setFiltroObs] = useState("todos");

  const [adicionandoAnotacao, setAdicionandoAnotacao] = useState(false);
  const [rascunhoAnotacao, setRascunhoAnotacao] = useState("");
  const [salvandoAnotacao, setSalvandoAnotacao] = useState(false);
  const [erroAnotacao, setErroAnotacao] = useState("");

  const telefoneDigitos = String(clienteAtual.whatsapp ?? "").replace(/\D/g, "");

  // Guarda contra setState depois do unmount. Antes era um `let ativo` local
  // do efeito; virou ref porque a busca agora roda de DOIS lugares (montagem e
  // refetch pós-cancelamento) e o segundo não tem cleanup próprio pra desarmar.
  // O `= true` no corpo do efeito não é redundante: em dev o Strict Mode monta,
  // desmonta e remonta: sem ele a ref ficaria false pra sempre já no primeiro
  // ciclo e o resumo nunca apareceria.
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // Busca (ou rebusca) o resumo do relacionamento + se o salão tem anamnese
  // ativa. `buscarResumoCliente` já traz proximosAgendamentos/ultimoAtendimento/
  // anamneseData de uma vez (3 consultas em paralelo, ver lib/clientesAdmin),
  // então não dá pra refazer só a lista de agendamentos — e nem compensa.
  async function recarregarResumo() {
    setCarregando(true);
    const [dados, temModelo] = await Promise.all([
      buscarResumoCliente(clienteAtual.id, estabelecimentoId, telefoneDigitos),
      existeModeloAtivo(estabelecimentoId),
    ]);
    if (montadoRef.current) {
      setResumo(dados);
      setTemModeloAtivo(temModelo);
      setCarregando(false);
    }
  }

  useEffect(() => {
    recarregarResumo();
  }, [clienteAtual.id, telefoneDigitos, estabelecimentoId]);

  // Cancelou um dos agendamentos que ESTA ficha mostra no carrossel "Próximos
  // agendamentos"? Refaz o resumo. O cancelamento é gravado lá no /admin
  // (handleCancelar), que patcha a própria lista dele e não tem como alcançar
  // este state — o sinal chega por `ultimoCancelamento` (ver page.js).
  // Procura o id na lista INTEIRA (não só no primeiro item): o carrossel deixa
  // cancelar qualquer um dos futuros, e comparar só um id faria o cancelamento
  // do segundo em diante passar batido. O `some` também evita rebuscar quando o
  // cancelado foi de outro cliente/outra aba. Sem o refetch o carrossel ficaria
  // mostrando um agendamento já cancelado até fechar e reabrir a ficha (o
  // resumo só recarrega quando o cliente/telefone muda).
  useEffect(() => {
    if (
      ultimoCancelamento &&
      (resumo?.proximosAgendamentos ?? []).some(
        (item) => item.id === ultimoCancelamento.id
      )
    ) {
      recarregarResumo();
    }
  }, [ultimoCancelamento]);

  async function toggleHistorico() {
    const abrir = !historicoAberto;
    setHistoricoAberto(abrir);
    if (abrir && historico === null) {
      setCarregandoHistorico(true);
      const dados = await buscarHistoricoCompleto(estabelecimentoId, telefoneDigitos);
      setHistorico(dados);
      setCarregandoHistorico(false);
    }
  }

  async function toggleAnamnese() {
    const abrir = !anamneseAberta;
    setAnamneseAberta(abrir);
    if (abrir && anamneseDetalhe === null) {
      setCarregandoAnamneseDetalhe(true);
      const detalhe = await buscarAnamneseDetalhe(clienteAtual.id, estabelecimentoId);
      setAnamneseDetalhe(detalhe);
      setCarregandoAnamneseDetalhe(false);
    }
  }

  // Após salvar pelo FormularioAnamnese (modoAdmin, ver botão Editar/Preencher
  // acima): refaz o detalhe e o carimbo usado por `situacaoAnamnese` (badge
  // Em dia/Vencida), pra ficha refletir a resposta nova sem recarregar a
  // página. Já abre a seção expandida com o resultado.
  async function handleAnamneseSalva() {
    setEditandoAnamnese(false);
    setCarregandoAnamneseDetalhe(true);
    const detalhe = await buscarAnamneseDetalhe(clienteAtual.id, estabelecimentoId);
    setAnamneseDetalhe(detalhe);
    setCarregandoAnamneseDetalhe(false);
    setAnamneseAberta(true);
    setResumo((atual) => ({
      ...atual,
      anamneseData: detalhe.resposta ? { criado_em: detalhe.resposta.criado_em } : null,
    }));
  }

  // Mescla observações de agendamento (lib/clientesAdmin buscarObservacoes)
  // com anotações livres (buscarAnotacoesLivres) num único array de notas
  // normalizadas — cada uma já com { id, data, tipo, texto } prontos pro
  // render e pro filtro, sem precisar saber de onde a nota veio.
  async function toggleObservacoes() {
    const abrir = !observacoesAbertas;
    setObservacoesAbertas(abrir);
    if (abrir && observacoes === null) {
      setCarregandoObservacoes(true);
      const [doAgendamento, livres] = await Promise.all([
        buscarObservacoes(estabelecimentoId, telefoneDigitos),
        buscarAnotacoesLivres(clienteAtual.id, estabelecimentoId),
      ]);
      const mescladas = [
        ...doAgendamento.map((item) => ({
          id: `agendamento-${item.id}`,
          data: item.data,
          tipo: tipoObservacao(item),
          texto: item.observacao,
        })),
        ...livres.map((item) => ({
          id: `livre-${item.id}`,
          data: item.criado_em,
          tipo: "Anotação",
          texto: item.texto,
        })),
      ].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
      setObservacoes(mescladas);
      setCarregandoObservacoes(false);
    }
  }

  async function handleSalvarAnotacao() {
    const texto = rascunhoAnotacao.trim();
    if (!texto) return;

    setSalvandoAnotacao(true);
    setErroAnotacao("");
    const { data, error } = await criarAnotacaoLivre(clienteAtual.id, estabelecimentoId, texto);
    setSalvandoAnotacao(false);

    if (error) {
      setErroAnotacao(`Não foi possível salvar: ${error.message}`);
      return;
    }

    setObservacoes((atual) => [
      { id: `livre-${data.id}`, data: data.criado_em, tipo: "Anotação", texto: data.texto },
      ...(atual ?? []),
    ]);
    setRascunhoAnotacao("");
    setAdicionandoAnotacao(false);
  }

  const observacoesFiltradas = useMemo(() => {
    const lista = observacoes ?? [];
    if (filtroObs === "todos") return lista;
    const alvo = filtroObs === "observacao" ? "Observação" : "Anotação";
    return lista.filter((item) => item.tipo === alvo);
  }, [observacoes, filtroObs]);

  const anamnese = situacaoAnamnese(resumo?.anamneseData?.criado_em);

  // Edição dos dados cadastrais (botão "Editar" abaixo): substitui a ficha
  // inteira pelo formulário, mesmo padrão de PainelCliente.js. modoAdmin
  // torna tudo opcional exceto nome/whatsapp (ver AtualizarDadosCliente).
  if (editandoDados) {
    return (
      <div className="space-y-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <AtualizarDadosCliente
          clienteId={clienteAtual.id}
          estabelecimentoId={estabelecimento.id}
          exigirEndereco={estabelecimento.exigir_endereco !== false}
          modoAdmin
          onAtualizado={(dados) => {
            setClienteAtual((anterior) => ({ ...anterior, ...dados }));
            setEditandoDados(false);
          }}
          onCancelar={() => setEditandoDados(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <button
        type="button"
        onClick={onVoltar}
        className="inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface"
      >
        <ChevronLeft className="h-4 w-4" />
        Voltar
      </button>

      <div>
        {/* Nome + etiqueta na MESMA linha: a etiqueta é um qualificador do
            cliente, não um dado de contato — separá-la do nome (jogando pro
            bloco de WhatsApp/emergência abaixo) a leria como mais um campo
            cadastral. `clienteAtual` é a cópia local da ficha, então trocar a
            etiqueta aqui reflete na hora; onEtiquetaAlterada leva a mesma
            troca pra lista por trás, que não seria refeita ao voltar. */}
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-base font-semibold text-heading">{clienteAtual.nome}</h3>
          <SeletorEtiquetaRapido
            estabelecimentoId={estabelecimento.id}
            clienteId={clienteAtual.id}
            etiqueta={clienteAtual.etiquetas_cliente ?? null}
            onEtiquetaAlterada={(nova) => {
              setClienteAtual((anterior) => ({
                ...anterior,
                etiqueta_id: nova?.id ?? null,
                etiquetas_cliente: nova ? { nome: nova.nome, cor: nova.cor } : null,
              }));
              onEtiquetaAlterada?.(clienteAtual.id, nova);
            }}
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            href={linkWhatsApp(
              clienteAtual.whatsapp,
              MENSAGEM_CONTATO_CLIENTE_ADMIN(clienteAtual, msgContatoAdmin)
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            {clienteAtual.whatsapp}
          </a>
          {clienteAtual.contato_emergencia && (
            <span className="text-sm text-body">
              Emergência:{" "}
              <a
                href={linkWhatsApp(
                  clienteAtual.contato_emergencia,
                  MENSAGEM_CONTATO_CLIENTE_ADMIN(clienteAtual, msgContatoAdmin)
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {clienteAtual.contato_emergencia}
              </a>
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Atalho pro wizard da aba Agendar já com esta cliente escolhida
              (pula o pré-passo de busca por nome). Quem navega é o /admin
              — ver onAgendarPara em app/[salon]/admin/page.js, o MESMO
              atalho do "Novo agendamento" do Histórico, incluindo o aviso
              de cliente com pendente. Diferença: aqui a cliente veio da
              tabela `clientes`, então o id vai preenchido de verdade (no
              Histórico vai null). Some quando o pai não passa o callback. */}
          {onAgendarPara && (
            <button
              type="button"
              onClick={() =>
                onAgendarPara({
                  id: clienteAtual.id,
                  nome: clienteAtual.nome,
                  telefone: clienteAtual.whatsapp,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
            >
              <CalendarPlus className="h-4 w-4" />
              Agendar
            </button>
          )}
          {/* Contato livre: abre a conversa do WhatsApp em branco, sem
              mensagem pré-preenchida — mesmo padrão (e mesmo visual) do
              "Entrar em contato" do inbox de Pendentes. Convive com o link
              do número logo abaixo, que leva a MENSAGEM_CONTATO_CLIENTE_ADMIN
              pronta: aqui a dona escreve o que quiser. */}
          <button
            type="button"
            onClick={() =>
              window.open(
                linkWhatsAppSemMensagem(clienteAtual.whatsapp),
                "_blank",
                "noopener,noreferrer"
              )
            }
            disabled={!clienteAtual.whatsapp}
            title={!clienteAtual.whatsapp ? "Telefone não cadastrado" : undefined}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-50"
          >
            <IconeWhatsApp />
            Entrar em contato
          </button>
          <button
            type="button"
            onClick={() => setAlterandoWhatsapp(true)}
            className="rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface"
          >
            Alterar WhatsApp
          </button>
          <button
            type="button"
            onClick={() => setEditandoDados(true)}
            className="rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface"
          >
            Editar
          </button>
        </div>
      </div>

      {progressoFidelidade && (
        <BadgeFidelidade
          variante="banner"
          atual={progressoFidelidade.atual}
          meta={progressoFidelidade.meta}
          descricaoBrinde={progressoFidelidade.descricaoBrinde}
        />
      )}

      {/* Falta a data de nascimento num salão que exige cadastro completo.
          Substitui a tag homônima que ficava no card da lista: aqui a ficha
          diz QUAL campo falta, e a condição lê `clienteAtual` (não a prop
          `cliente`) pra sumir na hora se a dona preencher pelo botão
          "Editar" acima, sem recarregar a lista. */}
      {estabelecimento.cadastro_completo && !clienteAtual.nascimento && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
          Cadastro incompleto — data de nascimento não preenchida.
        </div>
      )}

      <dl className="space-y-1 text-sm">
        {(clienteAtual.endereco || clienteAtual.bairro || clienteAtual.cidade || clienteAtual.estado) && (
          <div className="flex justify-between gap-3">
            <dt className="text-body">Endereço</dt>
            <dd className="text-right font-medium text-heading">
              {[clienteAtual.endereco, clienteAtual.bairro, clienteAtual.cidade, clienteAtual.estado]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        )}
        {clienteAtual.instagram && (
          <div className="flex justify-between gap-3">
            <dt className="text-body">Instagram</dt>
            <dd className="text-right font-medium text-heading">{clienteAtual.instagram}</dd>
          </div>
        )}
        {clienteAtual.nascimento && (
          <div className="flex justify-between gap-3">
            <dt className="text-body">Nascimento</dt>
            <dd className="text-right font-medium text-heading">
              {formatarDataBR(clienteAtual.nascimento)}
            </dd>
          </div>
        )}
      </dl>

      {carregando ? (
        <p className="text-sm text-body">Carregando resumo...</p>
      ) : (
        <div className="space-y-3">
          {/* Carrossel dos agendamentos confirmados futuros (ver
              buscarProximosAgendamentos em lib/clientesAdmin). Substituiu o
              card único "Próximo agendamento", que só mostrava o primeiro da
              lista e escondia os demais.

              As ações vão por render prop e recebem o item ATUAL do
              carrossel, não mais um "próximo" fixo: cancelar age sobre o que
              está na tela. O botão só ARMA o modal de confirmação do /admin
              (ver onCancelarAgendamento em app/[salon]/admin/page.js) — a
              gravação e a mensagem de WhatsApp continuam sendo as MESMAS dos
              cards do Painel/Pendentes (handleCancelar). Botão dividido no
              mesmo padrão de lá: zona grande cancela E notifica; zona pequena
              cancela sem notificar. Os itens vêm de buscarAgendamentosAtivos,
              que não seleciona nome_cliente/telefone (a query filtra POR
              telefone) — completa os dois com os dados do cliente desta
              ficha, senão o nome do modal sairia vazio e o link do WhatsApp
              sem número. Some quando o pai não passa o callback, igual ao
              "Agendar". */}
          <CarrosselAgendamentos
            titulo="Próximos agendamentos"
            itens={resumo.proximosAgendamentos ?? []}
            vazio="Nenhum agendamento ativo."
            onSelecionarItem={(item) =>
              router.push(`${pathname}?aba=painel&data=${item.data}`, {
                scroll: false,
              })
            }
            renderAcoes={(item) =>
              onCancelarAgendamento &&
              item && (
                <div className="flex items-stretch overflow-hidden rounded-lg bg-card ring-1 ring-red-200">
                  <button
                    type="button"
                    onClick={() =>
                      onCancelarAgendamento(
                        {
                          ...item,
                          nome_cliente: clienteAtual.nome,
                          telefone: telefoneDigitos,
                        },
                        true
                      )
                    }
                    className="inline-flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                  >
                    <IconeWhatsApp className="h-3.5 w-3.5" />
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onCancelarAgendamento(
                        {
                          ...item,
                          nome_cliente: clienteAtual.nome,
                          telefone: telefoneDigitos,
                        },
                        false
                      )
                    }
                    aria-label="Cancelar sem notificar cliente"
                    title="Cancelar sem notificar cliente"
                    className="inline-flex w-12 shrink-0 items-center justify-center gap-1 border-l border-red-200 text-red-600 transition hover:bg-red-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <MessageCircleOff className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )
            }
          />

          <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
            <CabecalhoRetratil
              titulo="Histórico"
              contador={historico?.length}
              aberto={historicoAberto}
              onClick={toggleHistorico}
            />
            {historicoAberto && (
              <div className="mt-2 space-y-2">
                {carregandoHistorico ? (
                  <p className="text-sm text-body">Carregando histórico...</p>
                ) : (historico ?? []).length === 0 ? (
                  <p className="text-sm text-body">
                    Nenhum atendimento no histórico ainda.
                  </p>
                ) : (
                  <>
                    <NavegacaoMes
                      rotulo={navTrimestreHistorico.rotulo}
                      temAnterior={navTrimestreHistorico.temAnterior}
                      temProximo={navTrimestreHistorico.temProximo}
                      noAtual={navTrimestreHistorico.noAtual}
                      onAnterior={navTrimestreHistorico.irParaAnterior}
                      onProximo={navTrimestreHistorico.irParaProximo}
                      onVoltarAtual={navTrimestreHistorico.voltarParaAtual}
                    />

                    {navTrimestreHistorico.itensDoMes.length === 0 ? (
                      <p className="text-sm text-body">
                        Nenhum atendimento no histórico neste mês.
                      </p>
                    ) : (
                      navTrimestreHistorico.itensDoMes.map((item) => {
                        const meta = HISTORICO_BADGE[rotuloHistorico(item)];
                        return (
                          <div
                            key={item.id}
                            className="flex flex-wrap items-center gap-2 text-sm text-body"
                          >
                            <span className="font-medium text-heading">
                              {formatarDataBR(item.data)} · {formatarHorario(item.horario)}
                            </span>
                            <span>{item.servicos?.nome ?? "Serviço"}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${meta.classe}`}
                            >
                              {meta.rotulo}
                            </span>
                            {/* Respostas do popup de perguntas do serviço (ver
                                lib/agendamentoRespostas), quando houver. */}
                            {(item.respostas ?? []).length > 0 && (
                              <ul className="basis-full space-y-0.5">
                                {item.respostas.map((texto, i) => (
                                  <li key={i} className="text-xs text-body">
                                    {texto}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {temModeloAtivo && (
            <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
              {editandoAnamnese ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-heading">Anamnese</h4>
                    <button
                      type="button"
                      onClick={() => setEditandoAnamnese(false)}
                      className="rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                    >
                      Cancelar
                    </button>
                  </div>
                  <FormularioAnamnese
                    estabelecimentoId={estabelecimentoId}
                    clienteId={clienteAtual.id}
                    modoAdmin
                    onConcluido={handleAnamneseSalva}
                  />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <CabecalhoRetratil
                      titulo="Anamnese"
                      aberto={anamneseAberta}
                      onClick={toggleAnamnese}
                    />
                    <button
                      type="button"
                      onClick={() => setEditandoAnamnese(true)}
                      className="shrink-0 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface"
                    >
                      {anamnese === null ? "Preencher" : "Editar"}
                    </button>
                  </div>
                  {anamnese === null ? (
                    <p className="mt-1.5 text-sm text-body">Nunca preenchida.</p>
                  ) : (
                    <p
                      className={`mt-1.5 text-sm font-medium ${
                        anamnese === "vencida" ? "text-amber-700" : "text-green-700"
                      }`}
                    >
                      {anamnese === "vencida" ? "Vencida" : "Em dia"} (preenchida em{" "}
                      {formatarDataBR(resumo.anamneseData.criado_em)})
                    </p>
                  )}

                  {anamneseAberta && (
                    <div className="mt-2">
                      {carregandoAnamneseDetalhe ? (
                        <p className="text-sm text-body">Carregando anamnese...</p>
                      ) : (
                        anamneseDetalhe?.resposta && (
                          <div className="space-y-3">
                            {anamneseDetalhe.modelo?.titulo && (
                              <h5 className="text-sm font-semibold text-heading">
                                {anamneseDetalhe.modelo.titulo}
                              </h5>
                            )}

                            {(anamneseDetalhe.modelo?.secoes ?? []).map((secao, si) => (
                              <div
                                key={si}
                                className="space-y-1.5 rounded-lg bg-card p-2.5 ring-1 ring-border"
                              >
                                <p className="text-sm font-medium text-heading">
                                  {secao.titulo}
                                </p>
                                {(secao.perguntas ?? []).map((pergunta, pi) => (
                                  <div
                                    key={pi}
                                    className="flex items-center justify-between gap-2 text-sm text-body"
                                  >
                                    <span>{pergunta}</span>
                                    <span className="font-medium text-heading">
                                      {anamneseDetalhe.resposta.respostas?.[pergunta] === "sim"
                                        ? "Sim"
                                        : "Não"}
                                    </span>
                                  </div>
                                ))}
                                {anamneseDetalhe.resposta.observacoes?.[secao.titulo] && (
                                  <p className="mt-1 text-xs text-body">
                                    Obs: {anamneseDetalhe.resposta.observacoes[secao.titulo]}
                                  </p>
                                )}
                              </div>
                            ))}

                            <p className="text-sm text-body">
                              Termos aceitos:{" "}
                              <span className="font-medium text-heading">
                                {anamneseDetalhe.resposta.termos_aceitos ? "Sim" : "Não"}
                              </span>{" "}
                              ({formatarDataBR(anamneseDetalhe.resposta.criado_em)})
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
            <CabecalhoRetratil
              titulo="Observações e anotações"
              contador={observacoes?.length}
              aberto={observacoesAbertas}
              onClick={toggleObservacoes}
            />
            {observacoesAbertas && (
              <div className="mt-2 space-y-2">
                {adicionandoAnotacao ? (
                  <div className="flex flex-col gap-2 rounded-lg bg-card p-2.5 ring-1 ring-border">
                    <textarea
                      value={rascunhoAnotacao}
                      onChange={(e) => setRascunhoAnotacao(e.target.value)}
                      maxLength={280}
                      rows={3}
                      placeholder="Anotação sobre o cliente..."
                      className="w-full resize-none break-words rounded-lg bg-surface px-3 py-2 text-sm text-heading ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted">
                        {rascunhoAnotacao.length}/280
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAdicionandoAnotacao(false);
                            setRascunhoAnotacao("");
                            setErroAnotacao("");
                          }}
                          className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={salvandoAnotacao || !rascunhoAnotacao.trim()}
                          onClick={handleSalvarAnotacao}
                          className="inline-flex items-center justify-center rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-green-100 transition hover:bg-green-100 disabled:opacity-60"
                        >
                          {salvandoAnotacao ? "Salvando..." : "Salvar"}
                        </button>
                      </div>
                    </div>
                    {erroAnotacao && (
                      <p className="text-xs text-red-700">{erroAnotacao}</p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAdicionandoAnotacao(true)}
                    className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface"
                  >
                    + Adicionar anotação
                  </button>
                )}

                <div className="flex gap-2">
                  {[
                    { valor: "observacao", rotulo: "Observações" },
                    { valor: "anotacao", rotulo: "Anotações" },
                    { valor: "todos", rotulo: "Todos" },
                  ].map((opcao) => (
                    <button
                      key={opcao.valor}
                      type="button"
                      onClick={() => setFiltroObs(opcao.valor)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                        filtroObs === opcao.valor
                          ? "bg-primary text-white ring-primary"
                          : "bg-card text-body ring-border hover:bg-surface"
                      }`}
                    >
                      {opcao.rotulo}
                    </button>
                  ))}
                </div>

                {carregandoObservacoes ? (
                  <p className="text-sm text-body">Carregando observações...</p>
                ) : observacoesFiltradas.length === 0 ? (
                  <p className="text-sm text-body">
                    Nenhuma observação registrada ainda.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {observacoesFiltradas.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-lg bg-card p-2.5 text-sm ring-1 ring-border"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-heading">
                            {formatarDataBR(item.data)}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                              item.tipo === "Observação"
                                ? "bg-blue-50 text-blue-700 ring-blue-200"
                                : "bg-purple-50 text-purple-700 ring-purple-200"
                            }`}
                          >
                            {ROTULO_TIPO_OBSERVACAO[item.tipo] ?? item.tipo}
                          </span>
                        </div>
                        <p className="mt-1 text-body">{item.texto}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ModalAlterarWhatsapp
        cliente={alterandoWhatsapp ? clienteAtual : null}
        estabelecimentoId={estabelecimentoId}
        onFechar={() => setAlterandoWhatsapp(false)}
        onAlterado={(novoWhatsapp) => {
          setClienteAtual((anterior) => ({ ...anterior, whatsapp: novoWhatsapp }));
          // Histórico/observações foram carregados com o telefone antigo —
          // limpa e fecha os acordeões pra recarregar sob o número novo na
          // próxima abertura (evita mostrar dados presos ao número trocado).
          setHistorico(null);
          setHistoricoAberto(false);
          setObservacoes(null);
          setObservacoesAbertas(false);
          setAlterandoWhatsapp(false);
        }}
      />
    </div>
  );
}

// Filtro por situação de agenda da lista de Clientes (client-side, sobre o
// Set `telefonesAgendados` que já alimenta a tag de cada card). "todos" não
// filtra. Não há regra nova aqui: quem decide o que é "Agendado" continua
// sendo ehAgendamentoConfirmadoFuturo (lib/particao), via
// buscarConfirmadosPorTelefones — o filtro só consulta o mesmo Set que a
// tag, pra que chip e badge nunca discordem.
const FILTROS_STATUS_CLIENTE = [
  { id: "todos", rotulo: "Todos" },
  { id: "agendado", rotulo: "Agendado" },
  { id: "sem_agenda", rotulo: "Sem agenda" },
];

// Valor do <select> de etiqueta que significa "não filtrar". String porque o
// value de um <option> sempre é string — os demais valores são o
// `etiqueta_id` convertido, e a comparação no filtro confronta string com
// string dos dois lados, sem depender do tipo que o banco devolve.
const ETIQUETA_TODAS = "todas";

// Valor do mesmo <select> que recorta quem NÃO tem etiqueta nenhuma
// (etiqueta_id null). Não é um id de etiqueta: é o complemento da taxonomia
// inteira, e por isso precisa de um sentinela próprio — "nenhuma" nunca
// colide com um id, que é numérico. Mesmo par que o SeletorEtiquetaRapido já
// mostra no card ("Sem etiqueta" quando não há), agora do lado do filtro.
const ETIQUETA_NENHUMA = "nenhuma";

export default function GerenciarClientes({
  estabelecimento,
  onAgendarPara,
  onCancelarAgendamento,
  ultimoCancelamento,
}) {
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");

  // Os dois recortes da faixa de filtros (ver FILTROS_STATUS_CLIENTE e
  // ETIQUETA_TODAS acima). Combinam em AND entre si e com a busca por nome;
  // nenhum dos dois dispara ida ao banco — a lista inteira já está em
  // memória, e o insumo do status também (telefonesAgendados).
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroEtiqueta, setFiltroEtiqueta] = useState(ETIQUETA_TODAS);

  const [selecionado, setSelecionado] = useState(null);

  // Insumo da tag "Agendado"/"Sem agenda": telefones (dígitos) com algum
  // agendamento confirmado ainda no futuro. Uma consulta pra lista toda, não
  // uma por cliente. Set vazio = todo mundo aparece como "Sem agenda", que é
  // o estado correto enquanto a busca não volta (e também se ela falhar).
  const [telefonesAgendados, setTelefonesAgendados] = useState(new Set());

  // ---- Bloco "Etiquetas" (CRUD da tabela `etiquetas_cliente`) -------------
  // Lista COMPLETA (ativas + desativadas): a dona precisa ver as desativadas
  // pra reativar. O popover de escolha (SeletorEtiquetaRapido) usa a lista só
  // das ativas, buscada por ele mesmo — este state não alimenta aquele.
  const [etiquetas, setEtiquetas] = useState([]);
  const [carregandoEtiquetas, setCarregandoEtiquetas] = useState(true);
  const [blocoEtiquetasAberto, setBlocoEtiquetasAberto] = useState(false);

  // Criar: form inline, aberto sob demanda dentro do bloco.
  const [criandoEtiqueta, setCriandoEtiqueta] = useState(false);
  const [novoNomeEtiqueta, setNovoNomeEtiqueta] = useState("");
  const [novaCorEtiqueta, setNovaCorEtiqueta] = useState(COR_ETIQUETA_PADRAO);
  const [salvandoEtiqueta, setSalvandoEtiqueta] = useState(false);
  const [erroCriarEtiqueta, setErroCriarEtiqueta] = useState("");

  // Renomear: inline, na própria linha da etiqueta (mesmo padrão do
  // renomear-categoria em GerenciarServicos.js).
  const [etiquetaEditandoId, setEtiquetaEditandoId] = useState(null);
  const [nomeEdicaoEtiqueta, setNomeEdicaoEtiqueta] = useState("");
  const [corEdicaoEtiqueta, setCorEdicaoEtiqueta] = useState(COR_ETIQUETA_PADRAO);

  // Etiqueta "armada" pra desativação (modal de confirmação) — soft delete via
  // `ativa=false`, nunca DELETE: quem já foi marcado com ela continua
  // mostrando o rótulo (ver buscarClientes em lib/clientesAdmin.js).
  const [etiquetaParaDesativar, setEtiquetaParaDesativar] = useState(null);

  // Trava as ações do bloco (renomear/mover/desativar/reativar) enquanto uma
  // gravação está em voo, pra não disparar duas de uma vez.
  const [ocupadoEtiqueta, setOcupadoEtiqueta] = useState(false);
  const [erroAcaoEtiqueta, setErroAcaoEtiqueta] = useState("");

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ?cliente=<telefone normalizado> vem de um card do Histórico: assim que a
  // lista chega, abre a ficha correspondente e limpa o parâmetro — senão o
  // refresh de fundo reabriria a ficha depois que a dona voltasse pra lista.
  useEffect(() => {
    const telefoneParam = searchParams.get("cliente");
    if (!telefoneParam || clientes.length === 0) return;

    const encontrado = clientes.find(
      (c) => String(c.whatsapp ?? "").replace(/\D/g, "") === telefoneParam
    );
    if (encontrado) {
      setSelecionado(encontrado);
    }
    // Só ?cliente= sai: ?aba=clientes FICA, senão a aba-pai do /admin volta
    // pra "pendentes" e desmonta esta tela no mesmo instante.
    const params = new URLSearchParams(searchParams);
    params.delete("cliente");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, clientes]);

  useEffect(() => {
    let ativo = true;

    buscarClientes(estabelecimento.id).then((dadosClientes) => {
      if (!ativo) return;
      setClientes(dadosClientes);
      setCarregando(false);

      // Fora do Promise.all de propósito: a lista de telefones SÓ existe
      // depois que buscarClientes volta. Encadeada aqui, sem segurar o
      // setCarregando acima — a lista aparece na hora e a tag chega um
      // instante depois, em vez de a tela inteira esperar mais uma ida ao
      // banco.
      buscarConfirmadosPorTelefones(
        estabelecimento.id,
        dadosClientes.map((cli) => cli.whatsapp).filter(Boolean)
      ).then((telefones) => {
        if (ativo) setTelefonesAgendados(telefones);
      });
    });

    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Carrega a lista de etiquetas do salão. Independente do carregamento dos
  // clientes: uma falha aqui não segura a lista principal (e vice-versa).
  useEffect(() => {
    let ativo = true;

    buscarTodasEtiquetas(estabelecimento.id).then((lista) => {
      if (!ativo) return;
      setEtiquetas(lista);
      setCarregandoEtiquetas(false);
    });

    return () => {
      ativo = false;
    };
  }, [estabelecimento.id]);

  // Patch da etiqueta de um cliente na lista em memória, sem refetch. Chamado
  // tanto pelo badge do card quanto pela ficha (ver onEtiquetaAlterada do
  // DetalheCliente): sem isto, voltar da ficha pra lista mostraria a etiqueta
  // antiga até a próxima montagem.
  function patchEtiquetaDoCliente(clienteId, nova) {
    setClientes((atuais) =>
      atuais.map((c) =>
        c.id === clienteId
          ? {
              ...c,
              etiqueta_id: nova?.id ?? null,
              etiquetas_cliente: nova ? { nome: nova.nome, cor: nova.cor } : null,
            }
          : c
      )
    );
    // `selecionado` é a prop que abre a ficha: se a troca veio do card e a
    // ficha for aberta em seguida, ela precisa nascer já com o valor novo.
    setSelecionado((atual) =>
      atual && atual.id === clienteId
        ? {
            ...atual,
            etiqueta_id: nova?.id ?? null,
            etiquetas_cliente: nova ? { nome: nova.nome, cor: nova.cor } : null,
          }
        : atual
    );
  }

  // Nova etiqueta vai pro fim da ordem (maior `ordem` atual + 1) — mesma
  // convenção de criarCategoria em GerenciarServicos.js. A cor sempre tem
  // valor (o seletor nasce em violeta), então nunca grava null aqui — cor
  // nula só existe nas etiquetas criadas ANTES desta troca, e o
  // SeletorEtiquetaRapido as trata como violeta.
  //
  // A coluna `emoji` continua existindo no banco, mas não é mais lida nem
  // escrita por nenhum ponto do app.
  async function criarEtiqueta(e) {
    e.preventDefault();
    const nome = novoNomeEtiqueta.trim();
    if (!nome) return;

    setSalvandoEtiqueta(true);
    setErroCriarEtiqueta("");
    const proximaOrdem = etiquetas.reduce((max, et) => Math.max(max, et.ordem), -1) + 1;
    const { data, error } = await supabase
      .from("etiquetas_cliente")
      .insert({
        estabelecimento_id: estabelecimento.id,
        nome,
        cor: novaCorEtiqueta,
        ordem: proximaOrdem,
        ativa: true,
      })
      .select("id, nome, emoji, cor, ordem, ativa")
      .single();

    setSalvandoEtiqueta(false);
    if (error) {
      setErroCriarEtiqueta(error.message);
      return;
    }
    setEtiquetas((atuais) => [...atuais, data]);
    setNovoNomeEtiqueta("");
    setNovaCorEtiqueta(COR_ETIQUETA_PADRAO);
    setCriandoEtiqueta(false);
  }

  function abrirRenomearEtiqueta(etiqueta) {
    setEtiquetaEditandoId(etiqueta.id);
    setNomeEdicaoEtiqueta(etiqueta.nome);
    // Etiqueta antiga sem cor abre já com o violeta selecionado — que é como
    // ela vinha sendo exibida.
    setCorEdicaoEtiqueta(etiqueta.cor ?? COR_ETIQUETA_PADRAO);
    setErroAcaoEtiqueta("");
  }

  async function salvarRenomeEtiqueta(etiqueta) {
    const nome = nomeEdicaoEtiqueta.trim();
    const cor = corEdicaoEtiqueta;
    if (!nome) return;
    if (nome === etiqueta.nome && cor === (etiqueta.cor ?? COR_ETIQUETA_PADRAO)) {
      setEtiquetaEditandoId(null);
      return;
    }

    setOcupadoEtiqueta(true);
    setErroAcaoEtiqueta("");
    const { data: linhas, error } = await supabase
      .from("etiquetas_cliente")
      .update({ nome, cor })
      .eq("id", etiqueta.id)
      .select("id");

    setOcupadoEtiqueta(false);
    if (error || !linhas?.length) {
      setErroAcaoEtiqueta(mensagemFalhaSalvar(error));
      return;
    }
    setEtiquetas((atuais) =>
      atuais.map((et) => (et.id === etiqueta.id ? { ...et, nome, cor } : et))
    );
    setEtiquetaEditandoId(null);

    // A lista de clientes carrega o nome/cor embedados: renomear a etiqueta
    // sem patchar aqui deixaria os badges com o texto e a cor antigos até o
    // refetch.
    setClientes((atuais) =>
      atuais.map((c) =>
        c.etiqueta_id === etiqueta.id ? { ...c, etiquetas_cliente: { nome, cor } } : c
      )
    );
  }

  // Reordena trocando com o vizinho e reescrevendo `ordem` de todas as
  // alteradas — mesmo template de moverCategoria (GerenciarServicos.js:1186),
  // incluindo o lote sem transação com `.select()` por update: um deles
  // filtrado pelo RLS volta com error null e 0 linhas, e sem a checagem a
  // ordem do banco ficaria furada com a tela mostrando a troca já feita.
  async function moverEtiqueta(etiqueta, direcao) {
    const ordenadas = [...etiquetas].sort((a, b) => a.ordem - b.ordem);
    const i = ordenadas.findIndex((et) => et.id === etiqueta.id);
    const j = i + direcao;
    if (j < 0 || j >= ordenadas.length) return;

    const reordenadas = [...ordenadas];
    [reordenadas[i], reordenadas[j]] = [reordenadas[j], reordenadas[i]];
    const comNovaOrdem = reordenadas.map((et, indice) => ({ ...et, ordem: indice + 1 }));

    const ordemOriginalPorId = new Map(ordenadas.map((et) => [et.id, et.ordem]));
    const alteradas = comNovaOrdem.filter((et) => ordemOriginalPorId.get(et.id) !== et.ordem);

    setOcupadoEtiqueta(true);
    setErroAcaoEtiqueta("");

    const resultados = await Promise.all(
      alteradas.map((et) =>
        supabase
          .from("etiquetas_cliente")
          .update({ ordem: et.ordem })
          .eq("id", et.id)
          .select("id")
      )
    );

    setOcupadoEtiqueta(false);

    const falha = resultados.find((r) => r.error || !r.data?.length);
    if (falha) {
      setErroAcaoEtiqueta(
        `${mensagemFalhaSalvar(falha.error)} — recarregue a página para garantir consistência com o banco.`
      );
      return;
    }

    const novaOrdemPorId = new Map(comNovaOrdem.map((et) => [et.id, et.ordem]));
    setEtiquetas((atuais) =>
      [...atuais.map((et) =>
        novaOrdemPorId.has(et.id) ? { ...et, ordem: novaOrdemPorId.get(et.id) } : et
      )].sort((a, b) => a.ordem - b.ordem)
    );
  }

  // Soft delete (ativa=false) e reativação, no MESMO handler — nunca DELETE
  // físico: os clientes já marcados guardam a FK, e apagar a linha derrubaria
  // o rótulo do histórico deles. Desativar só tira a etiqueta das escolhas
  // novas (o popover lê `ativa=true`).
  async function alternarAtivaEtiqueta(etiqueta, ativa) {
    setOcupadoEtiqueta(true);
    setErroAcaoEtiqueta("");
    const { data: linhas, error } = await supabase
      .from("etiquetas_cliente")
      .update({ ativa })
      .eq("id", etiqueta.id)
      .select("id");

    setOcupadoEtiqueta(false);
    if (error || !linhas?.length) {
      setErroAcaoEtiqueta(mensagemFalhaSalvar(error));
      setEtiquetaParaDesativar(null);
      return;
    }
    setEtiquetas((atuais) =>
      atuais.map((et) => (et.id === etiqueta.id ? { ...et, ativa } : et))
    );
    setEtiquetaParaDesativar(null);
  }

  const etiquetasOrdenadas = useMemo(
    () => [...etiquetas].sort((a, b) => a.ordem - b.ordem),
    [etiquetas]
  );

  // Nome + situação de agenda + etiqueta, os três combinados em AND numa
  // passada só. Tudo client-side sobre a lista já carregada.
  const clientesFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return clientes.filter((c) => {
      if (termo && !c.nome?.toLowerCase().includes(termo)) return false;

      if (filtroStatus !== "todos") {
        // Mesma chave do badge do card: dígitos do whatsapp contra o Set de
        // buscarConfirmadosPorTelefones. Enquanto essa busca não volta o Set
        // está vazio e todo mundo conta como "sem agenda" — exatamente o que
        // a tag mostra nesse mesmo instante, então filtro e badge nunca
        // aparecem em desacordo na tela.
        const agendado = telefonesAgendados.has(
          String(c.whatsapp ?? "").replace(/\D/g, "")
        );
        if (filtroStatus === "agendado" ? !agendado : agendado) return false;
      }

      // "Sem etiqueta" é o complemento da taxonomia, não um id: testa a
      // AUSÊNCIA (null do banco, ou undefined se a coluna não vier no
      // select) em vez de comparar com alguma etiqueta.
      if (filtroEtiqueta === ETIQUETA_NENHUMA) {
        if (c.etiqueta_id != null) return false;
      } else if (
        // Comparação pelo id cru: uma etiqueta DESATIVADA continua marcando
        // quem já foi marcado (soft delete, ver alternarAtivaEtiqueta), e
        // filtrar por ela precisa funcionar. Cliente sem etiqueta tem
        // etiqueta_id null, que nunca casa com um id escolhido.
        filtroEtiqueta !== ETIQUETA_TODAS &&
        String(c.etiqueta_id) !== filtroEtiqueta
      ) {
        return false;
      }

      return true;
    });
  }, [clientes, busca, filtroStatus, filtroEtiqueta, telefonesAgendados]);

  // Há algum recorte ativo? Decide só o TEXTO da lista vazia: sem filtro, o
  // salão não tem cliente nenhum cadastrado; com filtro, tem clientes mas
  // nenhum casa com o que está selecionado — e a dona precisa saber a
  // diferença pra não achar que perdeu a base.
  const algumFiltroAtivo =
    busca.trim() !== "" ||
    filtroStatus !== "todos" ||
    filtroEtiqueta !== ETIQUETA_TODAS;

  if (carregando) {
    return (
      <p className="rounded-lg bg-card px-4 py-3 text-sm text-body shadow-sm ring-1 ring-border">
        Carregando clientes...
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

  if (selecionado) {
    return (
      <DetalheCliente
        cliente={selecionado}
        estabelecimento={estabelecimento}
        estabelecimentoId={estabelecimento.id}
        msgContatoAdmin={estabelecimento.msg_contato_admin}
        onVoltar={() => setSelecionado(null)}
        onAgendarPara={onAgendarPara}
        onCancelarAgendamento={onCancelarAgendamento}
        ultimoCancelamento={ultimoCancelamento}
      />
    );
  }

  return (
    <>
      {/* Bloco "Etiquetas": CRUD da taxonomia (tabela `etiquetas_cliente`),
          acordeão fechado por padrão — é configuração, mexida de vez em
          quando, então não pode empurrar a busca e a lista pra baixo no uso
          diário. Mesmo lugar estrutural que as Categorias ocupam dentro da
          aba Serviços: a taxonomia mora junto do que ela classifica, sem
          virar uma aba própria no menu. */}
      <section className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <CabecalhoRetratil
          titulo="Etiquetas"
          contador={carregandoEtiquetas ? undefined : etiquetas.length}
          aberto={blocoEtiquetasAberto}
          onClick={() => setBlocoEtiquetasAberto((atual) => !atual)}
        />

        {blocoEtiquetasAberto && (
          <div className="mt-3 space-y-3">
            {carregandoEtiquetas ? (
              <p className="text-sm text-body">Carregando etiquetas...</p>
            ) : (
              <>
                {erroAcaoEtiqueta && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                    {erroAcaoEtiqueta}
                  </p>
                )}

                {etiquetasOrdenadas.length === 0 ? (
                  <p className="text-sm text-body">Nenhuma etiqueta cadastrada ainda.</p>
                ) : (
                  <ul className="space-y-2">
                    {etiquetasOrdenadas.map((etiqueta, indice) => (
                      <li
                        key={etiqueta.id}
                        className={`rounded-lg px-3 py-2 ring-1 ring-border ${
                          etiqueta.ativa ? "bg-surface" : "bg-surface opacity-60"
                        }`}
                      >
                        {etiquetaEditandoId === etiqueta.id ? (
                          /* Renomear inline, na própria linha (mesmo padrão do
                             renomear-categoria em GerenciarServicos.js). A
                             paleta fica na linha de baixo: 8 swatches numa
                             linha só não caberiam ao lado do nome + 3 botões
                             sem quebrar feio no mobile. */
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={nomeEdicaoEtiqueta}
                                onChange={(e) => setNomeEdicaoEtiqueta(e.target.value)}
                                aria-label="Nome da etiqueta"
                                className="min-w-0 flex-1 rounded-lg border border-border px-3 py-1.5 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                              />
                              <button
                                type="button"
                                onClick={() => salvarRenomeEtiqueta(etiqueta)}
                                disabled={ocupadoEtiqueta || !nomeEdicaoEtiqueta.trim()}
                                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Salvar
                              </button>
                              <button
                                type="button"
                                onClick={() => setEtiquetaEditandoId(null)}
                                className="rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                              >
                                Cancelar
                              </button>
                            </div>
                            <PaletaCorEtiqueta
                              valor={corEdicaoEtiqueta}
                              onChange={setCorEdicaoEtiqueta}
                              disabled={ocupadoEtiqueta}
                            />
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Nome + selo "desativada" formam um grupo só.
                                Sem flex-wrap aqui de propósito: num container
                                que quebra, o nome longo pularia de linha em vez
                                de truncar e deixaria o ponto colorido sozinho.
                                Quem absorve a falta de espaço é o truncate,
                                mas só até o piso de 10rem: abaixo disso o nome
                                sumiria atrás do selo, então quem quebra pra
                                linha de baixo é a barra de ações — inteira. */}
                            <div className="flex min-w-[10rem] flex-1 items-center gap-2">
                              {/* O ponto colorido é a única pista da cor nesta
                                  lista — aqui a etiqueta não é mostrada como
                                  badge. */}
                              <span
                                aria-hidden="true"
                                className={`h-3 w-3 shrink-0 rounded-full ${corEtiqueta(etiqueta.cor).swatch}`}
                              />
                              <span className="min-w-0 truncate text-sm font-medium text-heading">
                                {etiqueta.nome}
                              </span>

                              {!etiqueta.ativa && (
                                <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-xs font-medium text-body ring-1 ring-border">
                                  desativada
                                </span>
                              )}
                            </div>

                            {/* Barra de ações: sempre os mesmos 4 controles,
                                etiqueta ativa ou não. */}
                            <div className="flex shrink-0 items-center gap-2">
                              {/* Mover para cima/baixo: desabilitado nas pontas,
                                  mesmo comportamento do reordenar de categorias. */}
                              <button
                                type="button"
                                onClick={() => moverEtiqueta(etiqueta, -1)}
                                disabled={ocupadoEtiqueta || indice === 0}
                                aria-label={`Mover ${etiqueta.nome} para cima`}
                                className="shrink-0 rounded-lg p-1.5 text-body transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <ChevronUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moverEtiqueta(etiqueta, 1)}
                                disabled={
                                  ocupadoEtiqueta || indice === etiquetasOrdenadas.length - 1
                                }
                                aria-label={`Mover ${etiqueta.nome} para baixo`}
                                className="shrink-0 rounded-lg p-1.5 text-body transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <ChevronDown className="h-4 w-4" />
                              </button>

                              <button
                                type="button"
                                onClick={() => abrirRenomearEtiqueta(etiqueta)}
                                disabled={ocupadoEtiqueta}
                                className="shrink-0 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Editar
                              </button>

                              {etiqueta.ativa ? (
                                <button
                                  type="button"
                                  onClick={() => setEtiquetaParaDesativar(etiqueta)}
                                  disabled={ocupadoEtiqueta}
                                  className="shrink-0 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Desativar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => alternarAtivaEtiqueta(etiqueta, true)}
                                  disabled={ocupadoEtiqueta}
                                  className="shrink-0 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Reativar
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {criandoEtiqueta ? (
                  <form onSubmit={criarEtiqueta} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={novoNomeEtiqueta}
                        onChange={(e) => setNovoNomeEtiqueta(e.target.value)}
                        aria-label="Nome da etiqueta"
                        placeholder="Nome da etiqueta"
                        autoFocus
                        className="min-w-0 flex-1 rounded-lg border border-border px-3 py-1.5 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                      />
                      <button
                        type="submit"
                        disabled={salvandoEtiqueta || !novoNomeEtiqueta.trim()}
                        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Criar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCriandoEtiqueta(false);
                          setNovoNomeEtiqueta("");
                          setNovaCorEtiqueta(COR_ETIQUETA_PADRAO);
                          setErroCriarEtiqueta("");
                        }}
                        className="rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface"
                      >
                        Cancelar
                      </button>
                    </div>
                    <PaletaCorEtiqueta
                      valor={novaCorEtiqueta}
                      onChange={setNovaCorEtiqueta}
                      disabled={salvandoEtiqueta}
                    />
                    {erroCriarEtiqueta && (
                      <p className="text-sm text-red-700">{erroCriarEtiqueta}</p>
                    )}
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCriandoEtiqueta(true)}
                    className="rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-border transition hover:bg-surface"
                  >
                    Nova etiqueta
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <div className="mb-4">
        <label htmlFor="busca-cliente" className="sr-only">
          Buscar cliente
        </label>
        <input
          id="busca-cliente"
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome..."
          className="w-full rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
        />

        {/* Faixa de filtros, sob a busca e DENTRO do mesmo bloco: os três
            recortes (nome, situação, etiqueta) combinam em AND, então ficam
            juntos em vez de espalhados pela tela.

            Situação como chips (mesmo padrão do filtro de Observações da
            ficha, mais acima neste arquivo): três opções fixas e curtas,
            cabem numa linha. Etiqueta como <select> (mesmo padrão do filtro
            de categoria da aba Histórico, em app/[salon]/admin/page.js):
            quantas etiquetas existem é a dona quem decide, e uma fila de
            chips estouraria a largura no celular. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {FILTROS_STATUS_CLIENTE.map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              aria-pressed={filtroStatus === opcao.id}
              onClick={() => setFiltroStatus(opcao.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                filtroStatus === opcao.id
                  ? "bg-primary text-white ring-primary"
                  : "bg-card text-body ring-border hover:bg-surface"
              }`}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <label htmlFor="filtro-etiqueta-cliente" className="sr-only">
            Filtrar por etiqueta
          </label>
          <select
            id="filtro-etiqueta-cliente"
            value={filtroEtiqueta}
            onChange={(e) => setFiltroEtiqueta(e.target.value)}
            className="w-full rounded-lg bg-card px-3 py-2 text-sm font-medium text-heading shadow-sm ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-border"
          >
            <option value={ETIQUETA_TODAS}>Todas as etiquetas</option>
            {/* Logo abaixo de "Todas" e ANTES das etiquetas reais: é um
                recorte sobre a lista inteira, da mesma natureza do de cima,
                e não mais um item da taxonomia. */}
            <option value={ETIQUETA_NENHUMA}>Sem etiqueta</option>
            {/* Desativadas entram como opção DE PROPÓSITO: elas continuam
                marcando quem já foi marcado (ver o modal de desativar), e sem
                isso esses clientes ficariam inalcançáveis pelo filtro. O
                sufixo avisa que a etiqueta não aceita mais marcações novas. */}
            {etiquetasOrdenadas.map((etiqueta) => (
              <option key={etiqueta.id} value={String(etiqueta.id)}>
                {etiqueta.ativa ? etiqueta.nome : `${etiqueta.nome} (desativada)`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {clientesFiltrados.length === 0 ? (
        <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-body shadow-sm ring-1 ring-border">
          {algumFiltroAtivo
            ? "Nenhum cliente encontrado com esse filtro."
            : "Nenhum cliente encontrado."}
        </p>
      ) : (
        <ul className="space-y-3">
          {clientesFiltrados.map((cliente) => (
            <li key={cliente.id}>
              {/* O card é um <div>, não um <button>: o badge de etiqueta é
                  interativo (abre o popover) e um <button> dentro de outro é
                  HTML inválido — o React reclama na hidratação. A zona
                  clicável que abre a ficha virou um <button> IRMÃO do bloco de
                  badges, cobrindo nome + WhatsApp; as classes de card (e o
                  hover) subiram pro <div> pra que o visual não mude. */}
              <div className="flex w-full items-center justify-between gap-3 rounded-2xl bg-card p-4 text-left shadow-sm ring-1 ring-border transition hover:bg-surface">
                <button
                  type="button"
                  onClick={() => setSelecionado(cliente)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="min-w-0 truncate font-medium text-heading">
                    {cliente.nome}
                  </p>
                  <p className="mt-0.5 text-sm text-body">{cliente.whatsapp}</p>
                </button>

                <span className="flex shrink-0 items-center gap-1.5">
                  {/* Tem algo confirmado ainda no futuro? Regra em
                      ehAgendamentoConfirmadoFuturo (lib/particao), a MESMA
                      que a aba Histórico do /admin aplica sobre os
                      agendamentos já carregados — as duas telas nunca
                      discordam. Ao contrário das tags abaixo, esta aparece
                      SEMPRE (verde ou cinza). */}
                  {telefonesAgendados.has(
                    String(cliente.whatsapp ?? "").replace(/\D/g, "")
                  ) ? (
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">
                      Agendado
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-body ring-1 ring-border">
                      Sem agenda
                    </span>
                  )}
                  {ehAniversarianteDoMes(cliente.nascimento) && (
                    <span className="rounded-full bg-pink-50 px-2.5 py-0.5 text-xs font-medium text-pink-700 ring-1 ring-pink-100">
                      🎂 Aniversário
                    </span>
                  )}
                  {/* Etiqueta: badge violeta quando houver, chip âmbar "Sem
                      etiqueta" quando não. Fica FORA do botão que abre a
                      ficha (ver o <div> do card acima), então clicar no
                      badge abre só o popover. */}
                  <SeletorEtiquetaRapido
                    estabelecimentoId={estabelecimento.id}
                    clienteId={cliente.id}
                    etiqueta={cliente.etiquetas_cliente ?? null}
                    onEtiquetaAlterada={(nova) =>
                      patchEtiquetaDoCliente(cliente.id, nova)
                    }
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Confirmação da desativação. Soft delete (ativa=false): o texto diz
          explicitamente o que acontece com quem já usa a etiqueta, porque o
          botão "Desativar" ao lado de uma lista dá a entender que some tudo. */}
      {etiquetaParaDesativar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-desativar-etiqueta"
          className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 px-4"
          onClick={() => setEtiquetaParaDesativar(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="titulo-desativar-etiqueta" className="text-lg font-semibold text-heading">
              Desativar etiqueta
            </h2>
            <p className="mt-2 text-sm text-body">
              Tem certeza que deseja desativar{" "}
              <span className="font-medium text-heading">
                {etiquetaParaDesativar.nome}
              </span>
              ? Ela deixa de aparecer nas escolhas, mas os clientes que já estão
              marcados com ela continuam mostrando a etiqueta. Dá pra reativar
              depois.
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => alternarAtivaEtiqueta(etiquetaParaDesativar, false)}
                disabled={ocupadoEtiqueta}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Desativar etiqueta
              </button>
              <button
                type="button"
                onClick={() => setEtiquetaParaDesativar(null)}
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
