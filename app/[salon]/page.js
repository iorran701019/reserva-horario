"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { MapPin } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { linkWhatsApp } from "@/lib/whatsapp";
import { buscarEstabelecimento } from "@/lib/estabelecimento";
import { buscarTema } from "@/lib/temas";
import { precisaAnamnese } from "@/lib/anamnese";
import { buscarAgendamentosAtivos } from "@/lib/agendamentosCliente";
import Hero from "@/components/Hero";
import ContatoDono from "@/components/ContatoDono";
import IdentificacaoCliente from "@/components/IdentificacaoCliente";
import FormularioAnamnese from "@/components/FormularioAnamnese";
import PainelCliente from "@/components/PainelCliente";
import FormularioAgendamento, {
  formatarData,
} from "@/components/FormularioAgendamento";

// Página pública de agendamento. A lógica do wizard (serviço, slots, ocupados,
// validação, insert) mora em FormularioAgendamento; aqui ficam só o layout e a
// tela de confirmação. O insert NÃO passa `status`, então o banco aplica o
// default "pendente" — comportamento histórico do fluxo público.
//
// Multi-tenant pela rota dinâmica /[salon]: o slug vem do PATH (useParams) e
// resolvemos o estabelecimento ANTES de montar o wizard. Slug inexistente cai
// em "Salão não encontrado". O nome e o WhatsApp da tela saem de estab.nome /
// estab.whatsapp.
export default function AgendarPage() {
  // Slug do salão no path (/[salon]). Fonte única do tenant nesta página.
  const { salon } = useParams();

  // Estabelecimento resolvido pelo slug do path: undefined = ainda resolvendo;
  // null = slug inexistente/inativo; objeto = encontrado.
  const [estabelecimento, setEstabelecimento] = useState(undefined);

  // Resumo do agendamento concluído (null = ainda no formulário). Os dados vêm
  // do callback onSucesso; ao desmontar/remontar o formulário, ele zera sozinho.
  const [resumo, setResumo] = useState(null);

  // Cliente identificado pela IdentificacaoCliente (null = ainda não passou por
  // ela). Persiste entre agendamentos da mesma visita, então um novo
  // agendamento (após "Fazer novo agendamento") não pede o WhatsApp de novo.
  const [clienteIdentificado, setClienteIdentificado] = useState(null);

  // null = ainda checando (ou cliente ainda não identificado); true = precisa
  // preencher a anamnese antes do wizard; false = anamnese em dia, segue
  // direto pro FormularioAgendamento. Verificado assim que o cliente é
  // identificado (novo cadastro OU já existente com anamnese vencida).
  const [anamneseNecessaria, setAnamneseNecessaria] = useState(null);

  // Agendamentos ativos do cliente identificado (null = ainda não checado;
  // array = carregado). Se houver algum, o PainelCliente aparece antes do
  // wizard. modoNovoAgendamento força o fluxo normal mesmo com agendamentos
  // ativos, quando o cliente escolhe "Novo agendamento" no painel.
  const [agendamentosAtivos, setAgendamentosAtivos] = useState(null);
  const [modoNovoAgendamento, setModoNovoAgendamento] = useState(false);

  // Serviço de manutenção escolhido no card de sugestão do PainelCliente
  // (null = fluxo normal). Repassado como `servicoInicial` pro
  // FormularioAgendamento pular a etapa de escolha de serviço.
  const [servicoManutencao, setServicoManutencao] = useState(null);

  // Incrementado ao "Fazer novo agendamento" pra forçar o useEffect abaixo a
  // rebuscar mesmo com clienteIdentificado/estabelecimento.id inalterados.
  const [agendamentosVersao, setAgendamentosVersao] = useState(0);

  // Profissional ativo de menor id, usado como "responsável" tanto no botão
  // fixo ContatoDono quanto no texto do bloco de sinal do
  // FormularioAgendamento — buscado uma única vez aqui pra não duplicar a
  // query nos dois lugares. null = carregando ou nenhum ativo (cai em "a
  // equipe").
  const [nomeProfissionalContato, setNomeProfissionalContato] = useState(null);

  useEffect(() => {
    if (!clienteIdentificado) return;
    let ativo = true;
    precisaAnamnese(clienteIdentificado.id, estabelecimento?.id).then(
      (necessaria) => {
        if (ativo) setAnamneseNecessaria(necessaria);
      }
    );
    return () => {
      ativo = false;
    };
  }, [clienteIdentificado, estabelecimento?.id]);

  useEffect(() => {
    if (!clienteIdentificado || !estabelecimento?.id) return;
    let ativo = true;
    buscarAgendamentosAtivos(
      estabelecimento.id,
      clienteIdentificado.telefone.replace(/\D/g, "")
    ).then((lista) => {
      if (ativo) setAgendamentosAtivos(lista);
    });
    return () => {
      ativo = false;
    };
  }, [clienteIdentificado, estabelecimento?.id, agendamentosVersao]);

  // Resolve o estabelecimento pelo slug do path ao montar (ou se o slug mudar).
  useEffect(() => {
    let ativo = true;
    buscarEstabelecimento(salon).then((estab) => {
      if (ativo) setEstabelecimento(estab);
    });
    return () => {
      ativo = false;
    };
  }, [salon]);

  // Busca o profissional ativo de menor id assim que o estabelecimento
  // resolve, pra alimentar ContatoDono e o texto do bloco de sinal.
  useEffect(() => {
    if (!estabelecimento?.id) return;
    let ativo = true;
    supabase
      .from("profissionais")
      .select("nome")
      .eq("estabelecimento_id", estabelecimento.id)
      .eq("ativo", true)
      .order("id", { ascending: true })
      .limit(1)
      .then(({ data }) => {
        if (ativo) setNomeProfissionalContato(data?.[0]?.nome ?? null);
      });
    return () => {
      ativo = false;
    };
  }, [estabelecimento?.id]);

  const nomeContatoExibido = nomeProfissionalContato ?? "a equipe";

  // Foca o título da confirmação ao montar — leitores de tela anunciam o status.
  const tituloConfirmacaoRef = useRef(null);
  useEffect(() => {
    if (resumo) tituloConfirmacaoRef.current?.focus();
  }, [resumo]);

  // Enquanto resolve o estabelecimento, segura a tela (evita piscar o wizard).
  if (estabelecimento === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  // Slug inexistente ou salão inativo: mensagem clara, sem wizard.
  if (estabelecimento === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h1 className="text-2xl font-bold text-heading">Salão não encontrado</h1>
          <p className="mt-2 text-sm text-body">
            Verifique o link de agendamento e tente novamente.
          </p>
        </div>
      </main>
    );
  }

  // Tema por salão (lib/temas.js), gate único pra árvore INTEIRA da página:
  // sobrescrevemos aqui as CSS custom properties que os componentes já leem
  // via classe Tailwind (bg-primary, hover:bg-primary-hover, text-heading,
  // ring-border/border-border) + as duas usadas pro texto/borda secundários
  // (text-body, text-muted — calendário, "Voltar", histórico). Qualquer
  // componente descendente que já usa esses tokens herda a cor certa
  // automaticamente — não precisa (nem deve) ler `tema` sozinho pra isso.
  // Sem tema.personalizado (todo o resto, incl. um 3º tenant sem identidade
  // própria), nada é sobrescrito e a paleta marrom global segue intacta.
  const tema = buscarTema(estabelecimento.slug);
  const temaAtivo = tema?.personalizado ? tema : null;
  const estiloTemaRaiz = temaAtivo
    ? {
        ...(temaAtivo.bgBody ? { backgroundColor: temaAtivo.bgBody } : {}),
        "--color-primary": temaAtivo.botao,
        "--color-primary-hover": temaAtivo.botaoHover,
        "--color-heading": temaAtivo.textoPrincipal,
        "--color-border": temaAtivo.bordaHeader,
        "--color-body": temaAtivo.textoSecundario,
        "--color-muted": temaAtivo.textoSecundario,
        "--color-surface": temaAtivo.bgBody,
        "--color-card": temaAtivo.bgHeader,
      }
    : undefined;

  if (resumo) {
    const { form, servico, horario } = resumo;
    return (
      <main
        className="flex min-h-screen flex-col bg-surface"
        style={estiloTemaRaiz}
      >
        <Hero compacto nome={estabelecimento.nome} slug={estabelecimento.slug} />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div
          role="status"
          className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border"
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
            className="mt-6 text-2xl font-bold text-heading outline-none"
          >
            Solicitação enviada!
          </h1>
          <p className="mt-2 text-sm text-body">
            Recebemos seu agendamento. Em breve o estabelecimento confirma seu horário.
          </p>

          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            Aguardando confirmação
          </span>

          <dl className="mt-6 space-y-3 rounded-xl bg-surface p-4 text-left text-sm ring-1 ring-border">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-body">Serviço</dt>
              <dd className="font-medium text-heading">
                {servico?.nome}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-body">Data</dt>
              <dd className="font-medium text-heading">{formatarData(form.data)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-body">Horário</dt>
              <dd className="font-medium text-heading">{horario}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-body">Nome</dt>
              <dd className="font-medium text-heading">{form.nome}</dd>
            </div>
          </dl>

          {estabelecimento.link_localizacao && (
            <a
              href={estabelecimento.link_localizacao}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-card px-4 py-2.5 font-medium text-body ring-1 ring-border transition hover:bg-surface"
            >
              <MapPin className="h-5 w-5" aria-hidden="true" />
              Ver localização
            </a>
          )}

          <button
            type="button"
            onClick={() => {
              setResumo(null);
              setModoNovoAgendamento(false);
              setServicoManutencao(null);
              setAgendamentosAtivos(null);
              setAgendamentosVersao((v) => v + 1);
            }}
            className={`w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover ${
              estabelecimento.link_localizacao ? "mt-3" : "mt-6"
            }`}
          >
            Fazer novo agendamento
          </button>

          <a
            href={linkWhatsApp(
              estabelecimento.whatsapp,
              `Olá! Acabei de solicitar um agendamento de ${servico?.nome} para ${formatarData(form.data)} às ${horario}. Meu nome é ${form.nome}.`
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-card px-4 py-2.5 font-medium text-green-700 ring-1 ring-green-600 transition hover:bg-green-50"
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
        </div>
        <ContatoDono estabelecimento={estabelecimento} nome={nomeContatoExibido} />
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-surface"
      style={estiloTemaRaiz}
    >
      <Hero nome={estabelecimento.nome} slug={estabelecimento.slug} />
      <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-heading">Agende seu horário</h1>
          <p className="mt-1 text-sm text-body">
            Em poucos passos.
          </p>
        </header>

        {/* Antes do wizard: identifica o cliente pelo WhatsApp e, se a
            anamnese estiver vencida (ou nunca ter sido preenchida), cobra ela
            também. Só então monta o FormularioAgendamento, já com
            clienteInicial preenchido — a etapa "dados" dele vira um resumo em
            vez de pedir nome/WhatsApp de novo. */}
        {!clienteIdentificado ? (
          <IdentificacaoCliente
            estabelecimentoId={estabelecimento.id}
            cadastroCompleto={Boolean(estabelecimento.cadastro_completo)}
            estabelecimentoWhatsapp={estabelecimento.whatsapp}
            nomeContato={nomeContatoExibido}
            onIdentificado={setClienteIdentificado}
          />
        ) : agendamentosAtivos === null ? (
          <p className="text-sm text-body">Carregando...</p>
        ) : agendamentosAtivos.length > 0 && !modoNovoAgendamento ? (
          <PainelCliente
            estabelecimento={estabelecimento}
            cliente={clienteIdentificado}
            onNovoAgendamento={(servico) => {
              setServicoManutencao(servico ?? null);
              setModoNovoAgendamento(true);
            }}
            nomeProfissionalContato={nomeContatoExibido}
          />
        ) : anamneseNecessaria === null ? (
          <p className="text-sm text-body">Carregando...</p>
        ) : anamneseNecessaria ? (
          <FormularioAnamnese
            estabelecimentoId={estabelecimento.id}
            clienteId={clienteIdentificado.id}
            onConcluido={() => setAnamneseNecessaria(false)}
          />
        ) : (
          // Sem prop `status`: o insert mantém o default "pendente" do banco.
          <FormularioAgendamento
            estabelecimento={estabelecimento}
            clienteInicial={clienteIdentificado}
            clienteEhNovo={clienteIdentificado?.clienteNovo ?? false}
            nomeProfissionalContato={nomeContatoExibido}
            servicoInicial={servicoManutencao}
            onSucesso={(dados) => setResumo(dados)}
          />
        )}
      </div>
      <ContatoDono estabelecimento={estabelecimento} nome={nomeContatoExibido} />
    </main>
  );
}
