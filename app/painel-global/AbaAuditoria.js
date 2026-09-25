"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { mensagemFalhaSalvar } from "@/lib/erroSalvar";

// Aba "Auditoria" do hub (ver HubPainelGlobal): as configurações que não têm
// (ainda) lugar no /admin do próprio salão e por isso só o papel 'global'
// ajusta — cadastro do cliente, modelo de anamnese e granularidade.
// Diferente das outras abas do hub, esta NÃO é do tenant comercial: tem
// seletor de salão próprio e opera sobre qualquer estabelecimento ativo.
// A guarda de sessão/papel e o "Sair" vivem no shell — este componente só
// renderiza quando o acesso já foi liberado.
//
// "Alertas" é a ÚNICA sub-aba que não usa o <select> de salão: ela mostra
// todos os salões de uma vez numa tabela, com carregamento próprio (ver
// linhasAlertas). Por isso o seletor é escondido nela, e a coluna fica mais
// larga (ver larguraConteudo) — a tabela não cabe nos max-w-2xl das outras.
const ABAS = [
  { id: "cadastro", rotulo: "Cadastro" },
  { id: "anamnese", rotulo: "Anamnese" },
  { id: "horarios", rotulo: "Horários" },
  { id: "alertas", rotulo: "Alertas" },
];

// `pular_perguntas_adicionais_admin` cobre só o popup de manutenção e as
// perguntas do serviço no /admin (mudam preço, duração e serviço). Os alertas
// de serviço e de categoria (alerta_mensagem) NÃO dependem dela: são texto pra
// cliente e nunca aparecem no /admin.
//
// Colunas booleanas de `estabelecimentos` editáveis na tabela da sub-aba
// "Alertas" — uma por switch, na ordem em que aparecem. São as MESMAS colunas
// que o /admin do próprio salão lê (as duas primeiras em GerenciarServicos,
// via TOGGLES_OCULTACAO), então o que muda aqui já aparece lá.
const FLAGS_ALERTAS = [
  {
    coluna: "pular_perguntas_adicionais_admin",
    rotulo: "Pular perguntas adicionais (admin)",
  },
  { coluna: "ocultar_preco_servicos", rotulo: "Ocultar preço" },
  { coluna: "ocultar_duracao_servicos", rotulo: "Ocultar duração" },
];

// Catálogo só-leitura dos avisos que NÃO têm controle nenhum hoje: texto
// craftado direto no JSX, ou coluna sem tela pra editar. Existe pra que o
// painel global mostre o mapa inteiro, não só a parte configurável — sem
// toggle e sem link de edição de propósito: mexer em qualquer um destes é
// mudança de código, não de configuração. Mantido à mão (não há catálogo de
// strings no projeto); ao mexer nos avisos, atualizar aqui também.
const CATALOGO_SEM_CONTROLE = [
  {
    id: "publico",
    rotulo: "Fluxo público",
    itens: [
      {
        nome: "Confirmar manutenção",
        descricao:
          "Pergunta se a cliente já está com alongamento ou gel ao tocar um serviço com eh_manutencao (FormularioAgendamento).",
      },
      {
        nome: "Sinal Pix (manual)",
        descricao:
          "Aviso âmbar com o valor do sinal, a chave Pix e o checkbox de comprovante (BlocoConfirmacaoPix).",
      },
      {
        nome: "Sinal Pix (AbacatePay)",
        descricao:
          "QR Code, código copiável e o alerta vermelho de reserva cancelada ou expirada (BlocoQrCodeAbacatePay).",
      },
      {
        nome: "Cancelamento pela cliente",
        descricao:
          "Confirmação antes de cancelar, nos quatro botões de cancelar do público (ModalConfirmarCancelamento).",
      },
      {
        nome: "Prazo mínimo entre agendamentos",
        descricao:
          "Avisa que já existe agendamento próximo e oferece três saídas (ModalPrazoMinimo); aparece também no /admin.",
      },
      {
        nome: "WhatsApp em conflito",
        descricao:
          "Número já associado a outro cadastro, com botão pra falar com o salão (ModalConflitoWhatsapp).",
      },
      {
        nome: "Alteração de WhatsApp",
        descricao:
          "Avisa que a troca também atualiza o histórico de agendamentos vinculado (ModalAlterarWhatsapp).",
      },
      {
        nome: "Valor cheio da manutenção",
        descricao:
          "Explica que a manutenção passou do prazo e a cobrança será a do serviço completo (FormularioAgendamento).",
      },
      {
        nome: "Avisos inline do wizard",
        descricao:
          "Sem serviço, profissional ou horário disponível, horário já tomado, falhas de reserva e o único window.alert do app.",
      },
      {
        nome: "Prazo de cancelamento expirado",
        descricao:
          "No painel da cliente, avisa que o prazo passou e oferece contato com o salão (PainelCliente).",
      },
      {
        nome: "Faixa de demonstração",
        descricao:
          "Tarja âmbar no topo, com texto fixo em lib/temas.js (avisoTopo); hoje só no tenant acolhe.",
      },
      {
        nome: "Anamnese",
        descricao:
          "Validações e aceite de termos do formulário; o conteúdo vem de anamnese_modelos, editável na sub-aba Anamnese.",
      },
    ],
  },
  {
    id: "admin",
    rotulo: "Admin",
    itens: [
      {
        nome: "Fora da janela de agendamento",
        descricao:
          "Confirma agendamento fora da janela; o mesmo texto está duplicado na aba Agendar e na aba Pendentes.",
      },
      {
        nome: "Dia com restrição de agenda",
        descricao:
          "Avisa que o dia é restrito a uma etiqueta que este cliente não tem (FormularioAgendamento, modoLivre).",
      },
      {
        nome: "Confirmar sem notificar",
        descricao:
          "Zona pequena do botão dividido; texto também duplicado entre a aba Agendar e a aba Pendentes.",
      },
      {
        nome: "Cancelar agendamento (admin)",
        descricao:
          "Confirmação com o nome do cliente antes de cancelar e disparar a mensagem de WhatsApp.",
      },
      {
        nome: "Gate de etiqueta",
        descricao:
          '"Cliente sem etiqueta" ou "Cliente Nova, já no 2º serviço" antes de confirmar; sem X, fundo nem Esc.',
      },
      {
        nome: "Virada de mês",
        descricao:
          "Popup diário avisando que o mês não tem status na agenda e ninguém consegue agendar nele.",
      },
      {
        nome: "Banner Agenda por mês",
        descricao:
          "Cartão clicável na aba Painel, com uma pílula por mês do alcance (verde, amarelo ou cinza).",
      },
      {
        nome: "Cliente com pendente",
        descricao:
          "Avisa que a cliente já tem agendamento aguardando confirmação antes de abrir o wizard (ModalClientePendente).",
      },
      {
        nome: "Badges de Pix no card pendente",
        descricao:
          "Quatro ramos mutuamente exclusivos sobre o estado do sinal, do gateway ao “não cobrado”.",
      },
      {
        nome: "Sinal não cobrado",
        descricao:
          "Alerta vermelho em Regras de negócio quando falta a chave Pix ou a conta AbacatePay conectada.",
      },
      {
        nome: "Reduzir janela de agendamento",
        descricao:
          "Avisa quantos agendamentos confirmados ficam além da nova data antes de aplicar a redução.",
      },
      {
        nome: "Modais da aba Serviços",
        descricao:
          "Prazo em conflito, desativar, excluir permanentemente, apagar categoria, vínculo da manutenção, excluir pergunta.",
      },
      {
        nome: "Modais da aba Profissionais",
        descricao:
          "Excluir datas avulsas, bloquear o dia inteiro (apagando liberações) e desativar profissional.",
      },
      {
        nome: "Modais de clientes e agenda",
        descricao:
          "Desativar etiqueta, trocar profissional, alterar data e vincular cliente importado do Google Calendar.",
      },
      {
        nome: "Confirmações nativas do navegador",
        descricao:
          "Três window.confirm fora do padrão visual: remover foto (duas telas) e troca de tipo de horário.",
      },
    ],
  },
];

// Modelo novo, ainda não gravado em anamnese_modelos (id null é o sinal pro
// handleSalvarModelo decidir entre INSERT e UPDATE).
const MODELO_ANAMNESE_VAZIO = {
  id: null,
  titulo: "",
  ativo: false,
  preenchidoPor: "cliente",
  secoes: [],
  declaracoes: [],
};

// Chave de statusFlags/erroFlags: o par (salão, coluna). A mesma flag aparece
// em todas as linhas da tabela, então o "Salvo ✓" precisa saber QUAL linha.
function chaveFlag(id, coluna) {
  return `${id}-${coluna}`;
}

export default function AbaAuditoria() {
  const [estabelecimentos, setEstabelecimentos] = useState([]);
  const [estabelecimentoId, setEstabelecimentoId] = useState("");
  const [aba, setAba] = useState("cadastro");

  // Aba Cadastro: valor atual de cadastro_completo do salão selecionado.
  // undefined = carregando (ou nenhum salão selecionado ainda).
  const [cadastroCompleto, setCadastroCompleto] = useState(undefined);
  const [statusCadastro, setStatusCadastro] = useState("");
  const [erroCadastro, setErroCadastro] = useState("");

  // Sub-opção de cadastro completo: exigir_endereco. Só faz sentido quando
  // cadastroCompleto === true; mesmo padrão undefined = carregando.
  const [exigirEndereco, setExigirEndereco] = useState(undefined);
  const [statusEndereco, setStatusEndereco] = useState("");
  const [erroEndereco, setErroEndereco] = useState("");

  // Mesmo padrão de exigirEndereco: sub-opções independentes de cadastro
  // completo, cada uma com seu próprio status/erro.
  const [exigirContatoEmergencia, setExigirContatoEmergencia] = useState(undefined);
  const [statusContatoEmergencia, setStatusContatoEmergencia] = useState("");
  const [erroContatoEmergencia, setErroContatoEmergencia] = useState("");

  const [exigirInstagram, setExigirInstagram] = useState(undefined);
  const [statusInstagram, setStatusInstagram] = useState("");
  const [erroInstagram, setErroInstagram] = useState("");

  // Aba Anamnese: modelo único do salão selecionado (no máximo 1 linha em
  // anamnese_modelos, mas sem constraint no banco — se vier mais de uma, usa
  // a primeira). id null = modelo novo, ainda não gravado (form começa
  // vazio).
  const [modeloAnamnese, setModeloAnamnese] = useState(MODELO_ANAMNESE_VAZIO);
  const [carregandoModelo, setCarregandoModelo] = useState(false);
  const [statusModelo, setStatusModelo] = useState("");
  const [erroModelo, setErroModelo] = useState("");

  // Aba Horários: granularidade_min do salão selecionado. undefined =
  // carregando (ou nenhum salão selecionado ainda).
  const [granularidadeMin, setGranularidadeMin] = useState(undefined);
  const [statusGranularidade, setStatusGranularidade] = useState("");
  const [erroGranularidade, setErroGranularidade] = useState("");

  // Sub-aba Alertas: uma linha por salão ATIVO, com as três flags, o aviso de
  // regras e a contagem de serviços com alerta. undefined = carregando (mesmo
  // significado das outras sub-abas), array = pronto. Não depende de
  // `estabelecimentoId`: esta sub-aba mostra todos os salões de uma vez.
  const [linhasAlertas, setLinhasAlertas] = useState(undefined);
  const [erroLinhasAlertas, setErroLinhasAlertas] = useState("");

  // status/erro por PAR (salão, coluna), não por coluna: a mesma flag existe
  // em todas as linhas da tabela, e o "Salvo ✓" tem que aparecer só na que
  // foi tocada. Chave = `${id}-${coluna}` (ver chaveFlag).
  const [statusFlags, setStatusFlags] = useState({});
  const [erroFlags, setErroFlags] = useState({});

  // Grupo aberto do catálogo só-leitura ("publico" | "admin" | null). Um por
  // vez, mesmo padrão de alternarBloco em ConfiguracoesSalao.js.
  const [grupoCatalogoAberto, setGrupoCatalogoAberto] = useState(null);

  // Lista de salões ativos pro seletor. Sem guarda de papel: o shell só monta
  // esta aba depois de confirmar 'global', então chegar aqui já é permissão.
  useEffect(() => {
    let ativo = true;

    (async () => {
      const { data } = await supabase
        .from("estabelecimentos")
        .select("id, slug, nome")
        .eq("ativo", true)
        .order("nome");
      if (ativo) setEstabelecimentos(data ?? []);
    })();

    return () => {
      ativo = false;
    };
  }, []);

  // Carga da sub-aba Alertas: dispara na PRIMEIRA entrada nela e só — o
  // `linhasAlertas !== undefined` abaixo é o que impede um refetch a cada
  // troca de sub-aba (e o que faz o efeito ser inócuo nas outras três).
  // Depois disso quem mantém a tabela em dia é o update otimista de
  // salvarFlagAlerta, não uma releitura.
  //
  // Duas queries em PARALELO, nunca uma por salão: agregados do PostgREST
  // estão desabilitados neste projeto (`select=...,count()` devolve PGRST123),
  // então a contagem de serviços com alerta é feita aqui no cliente. A
  // segunda query traz só `estabelecimento_id` — uma linha por serviço COM
  // alerta, não por serviço.
  useEffect(() => {
    if (aba !== "alertas" || linhasAlertas !== undefined) return;

    let ativo = true;

    (async () => {
      setErroLinhasAlertas("");

      const [saloes, alertas] = await Promise.all([
        supabase
          .from("estabelecimentos")
          .select(
            "id, nome, slug, pular_perguntas_adicionais_admin, ocultar_preco_servicos, ocultar_duracao_servicos, aviso_regras_agendamento"
          )
          .eq("ativo", true)
          .order("nome"),
        supabase
          .from("servicos")
          .select("estabelecimento_id")
          .not("alerta_mensagem", "is", null)
          .eq("ativo", true),
      ]);

      if (!ativo) return;

      if (saloes.error || alertas.error) {
        setErroLinhasAlertas(
          `Não foi possível carregar: ${mensagemFalhaSalvar(saloes.error ?? alertas.error)}`
        );
        // Fica em undefined de propósito: sem linha nenhuma pra mostrar, e
        // reentrar na sub-aba tenta de novo.
        return;
      }

      const porSalao = (alertas.data ?? []).reduce((acc, servico) => {
        acc[servico.estabelecimento_id] = (acc[servico.estabelecimento_id] ?? 0) + 1;
        return acc;
      }, {});

      setLinhasAlertas(
        (saloes.data ?? []).map((salao) => ({
          id: salao.id,
          nome: salao.nome,
          slug: salao.slug,
          pular_perguntas_adicionais_admin: Boolean(salao.pular_perguntas_adicionais_admin),
          ocultar_preco_servicos: Boolean(salao.ocultar_preco_servicos),
          ocultar_duracao_servicos: Boolean(salao.ocultar_duracao_servicos),
          // Só o preenchido/vazio interessa na tabela — o texto em si é
          // editável no /admin do próprio salão, não aqui.
          avisoPreenchido: Boolean(salao.aviso_regras_agendamento),
          alertasAtivos: porSalao[salao.id] ?? 0,
        }))
      );
    })();

    return () => {
      ativo = false;
    };
  }, [aba, linhasAlertas]);

  // Busca o cadastro_completo do salão selecionado sempre que a seleção muda.
  // Começa zerando pra undefined/""/"" ANTES de checar se há id — isso cobre
  // tanto "carregando o novo valor" quanto "limpa Salvo./erro do salão
  // anterior" (mesmo efeito cuida das duas coisas).
  useEffect(() => {
    let ativo = true;

    (async () => {
      setCadastroCompleto(undefined);
      setStatusCadastro("");
      setErroCadastro("");
      setExigirEndereco(undefined);
      setStatusEndereco("");
      setErroEndereco("");
      setExigirContatoEmergencia(undefined);
      setStatusContatoEmergencia("");
      setErroContatoEmergencia("");
      setExigirInstagram(undefined);
      setStatusInstagram("");
      setErroInstagram("");

      if (!estabelecimentoId) return;

      const { data, error } = await supabase
        .from("estabelecimentos")
        .select(
          "cadastro_completo, exigir_endereco, exigir_contato_emergencia, exigir_instagram"
        )
        .eq("id", estabelecimentoId)
        .single();

      if (!ativo) return;

      if (error) {
        setErroCadastro(error.message);
        return;
      }
      setCadastroCompleto(Boolean(data?.cadastro_completo));
      setExigirEndereco(Boolean(data?.exigir_endereco));
      setExigirContatoEmergencia(Boolean(data?.exigir_contato_emergencia));
      setExigirInstagram(Boolean(data?.exigir_instagram));
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimentoId]);

  // "Salvo ✓" some sozinho depois de um tempo — mesmo padrão do toggle
  // escolha_profissional em ConfiguracoesSalao.js.
  useEffect(() => {
    if (statusCadastro !== "salvo") return;
    const t = setTimeout(() => setStatusCadastro(""), 2500);
    return () => clearTimeout(t);
  }, [statusCadastro]);

  // "Salvo ✓" some sozinho depois de um tempo — mesmo padrão de cima.
  useEffect(() => {
    if (statusEndereco !== "salvo") return;
    const t = setTimeout(() => setStatusEndereco(""), 2500);
    return () => clearTimeout(t);
  }, [statusEndereco]);

  // "Salvo ✓" some sozinho depois de um tempo — mesmo padrão de cima.
  useEffect(() => {
    if (statusContatoEmergencia !== "salvo") return;
    const t = setTimeout(() => setStatusContatoEmergencia(""), 2500);
    return () => clearTimeout(t);
  }, [statusContatoEmergencia]);

  // "Salvo ✓" some sozinho depois de um tempo — mesmo padrão de cima.
  useEffect(() => {
    if (statusInstagram !== "salvo") return;
    const t = setTimeout(() => setStatusInstagram(""), 2500);
    return () => clearTimeout(t);
  }, [statusInstagram]);

  // Busca o modelo de anamnese do salão selecionado. Limpa o form pro
  // estado vazio ANTES de checar se há id — mesma disciplina do efeito de
  // cadastro logo acima, cobrindo tanto "carregando" quanto "troquei de
  // salão, esquece o formulário anterior".
  useEffect(() => {
    let ativo = true;

    (async () => {
      setModeloAnamnese(MODELO_ANAMNESE_VAZIO);
      setStatusModelo("");
      setErroModelo("");

      if (!estabelecimentoId) return;

      setCarregandoModelo(true);

      const { data, error } = await supabase
        .from("anamnese_modelos")
        .select("*")
        .eq("estabelecimento_id", estabelecimentoId);

      if (!ativo) return;
      setCarregandoModelo(false);

      if (error) {
        setErroModelo(error.message);
        return;
      }

      // Sem constraint no banco garantindo no máximo 1 linha — usa a
      // primeira se vier mais de uma, em vez de quebrar.
      const linha = data?.[0];
      if (linha) {
        setModeloAnamnese({
          id: linha.id,
          titulo: linha.titulo ?? "",
          ativo: Boolean(linha.ativo),
          preenchidoPor: linha.preenchido_por ?? "cliente",
          secoes: linha.secoes ?? [],
          declaracoes: linha.declaracoes ?? [],
        });
      }
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimentoId]);

  // "Salvo ✓" some sozinho depois de um tempo — mesmo padrão de cima.
  useEffect(() => {
    if (statusModelo !== "salvo") return;
    const t = setTimeout(() => setStatusModelo(""), 2500);
    return () => clearTimeout(t);
  }, [statusModelo]);

  // Busca o granularidade_min do salão selecionado — mesmo padrão do efeito
  // de cadastro_completo acima (zera antes de checar se há id).
  useEffect(() => {
    let ativo = true;

    (async () => {
      setGranularidadeMin(undefined);
      setStatusGranularidade("");
      setErroGranularidade("");

      if (!estabelecimentoId) return;

      const { data, error } = await supabase
        .from("estabelecimentos")
        .select("granularidade_min")
        .eq("id", estabelecimentoId)
        .single();

      if (!ativo) return;

      if (error) {
        setErroGranularidade(error.message);
        return;
      }
      setGranularidadeMin(Number(data?.granularidade_min) || 30);
    })();

    return () => {
      ativo = false;
    };
  }, [estabelecimentoId]);

  // "Salvo ✓" some sozinho depois de um tempo — mesmo padrão de cima.
  useEffect(() => {
    if (statusGranularidade !== "salvo") return;
    const t = setTimeout(() => setStatusGranularidade(""), 2500);
    return () => clearTimeout(t);
  }, [statusGranularidade]);

  // "Salvo ✓" da tabela de Alertas: mesmo padrão dos de cima, só que varre o
  // mapa inteiro em vez de um campo — apaga de uma vez todas as chaves que
  // estão em "salvo". Dois switches tocados em sequência compartilham o mesmo
  // timer (o efeito reroda e o anterior é limpo), o que só atrasa o sumiço do
  // primeiro; nada fica preso em tela.
  useEffect(() => {
    const salvos = Object.keys(statusFlags).filter((k) => statusFlags[k] === "salvo");
    if (salvos.length === 0) return;

    const t = setTimeout(() => {
      setStatusFlags((atual) => {
        const proximo = { ...atual };
        salvos.forEach((k) => {
          if (proximo[k] === "salvo") delete proximo[k];
        });
        return proximo;
      });
    }, 2500);

    return () => clearTimeout(t);
  }, [statusFlags]);

  function alterarTituloModelo(valor) {
    setModeloAnamnese((atual) => ({ ...atual, titulo: valor }));
  }

  function selecionarAtivoModelo(valor) {
    setModeloAnamnese((atual) => ({ ...atual, ativo: valor }));
  }

  function selecionarPreenchidoPorModelo(valor) {
    setModeloAnamnese((atual) => ({ ...atual, preenchidoPor: valor }));
  }

  function adicionarDeclaracao() {
    setModeloAnamnese((atual) => ({
      ...atual,
      declaracoes: [...atual.declaracoes, ""],
    }));
  }

  function removerDeclaracao(indice) {
    setModeloAnamnese((atual) => ({
      ...atual,
      declaracoes: atual.declaracoes.filter((_, i) => i !== indice),
    }));
  }

  function alterarDeclaracao(indice, valor) {
    setModeloAnamnese((atual) => ({
      ...atual,
      declaracoes: atual.declaracoes.map((d, i) => (i === indice ? valor : d)),
    }));
  }

  // Reordenação local (troca de posição no array) — o array inteiro só vai
  // pro banco no clique de "Salvar", não há `ordem` persistida por item.
  function moverDeclaracao(indice, direcao) {
    setModeloAnamnese((atual) => {
      const alvo = indice + direcao;
      if (alvo < 0 || alvo >= atual.declaracoes.length) return atual;
      const declaracoes = [...atual.declaracoes];
      [declaracoes[indice], declaracoes[alvo]] = [declaracoes[alvo], declaracoes[indice]];
      return { ...atual, declaracoes };
    });
  }

  function adicionarSecao() {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: [...atual.secoes, { titulo: "", perguntas: [] }],
    }));
  }

  function removerSecao(indiceSecao) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.filter((_, i) => i !== indiceSecao),
    }));
  }

  function alterarTituloSecao(indiceSecao, valor) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.map((s, i) => (i === indiceSecao ? { ...s, titulo: valor } : s)),
    }));
  }

  function moverSecao(indiceSecao, direcao) {
    setModeloAnamnese((atual) => {
      const alvo = indiceSecao + direcao;
      if (alvo < 0 || alvo >= atual.secoes.length) return atual;
      const secoes = [...atual.secoes];
      [secoes[indiceSecao], secoes[alvo]] = [secoes[alvo], secoes[indiceSecao]];
      return { ...atual, secoes };
    });
  }

  function adicionarPergunta(indiceSecao) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.map((s, i) =>
        i === indiceSecao ? { ...s, perguntas: [...s.perguntas, ""] } : s
      ),
    }));
  }

  function removerPergunta(indiceSecao, indicePergunta) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.map((s, i) =>
        i === indiceSecao
          ? { ...s, perguntas: s.perguntas.filter((_, j) => j !== indicePergunta) }
          : s
      ),
    }));
  }

  function alterarPergunta(indiceSecao, indicePergunta, valor) {
    setModeloAnamnese((atual) => ({
      ...atual,
      secoes: atual.secoes.map((s, i) =>
        i === indiceSecao
          ? {
              ...s,
              perguntas: s.perguntas.map((p, j) => (j === indicePergunta ? valor : p)),
            }
          : s
      ),
    }));
  }

  function moverPergunta(indiceSecao, indicePergunta, direcao) {
    setModeloAnamnese((atual) => {
      const secao = atual.secoes[indiceSecao];
      const alvo = indicePergunta + direcao;
      if (alvo < 0 || alvo >= secao.perguntas.length) return atual;
      const perguntas = [...secao.perguntas];
      [perguntas[indicePergunta], perguntas[alvo]] = [perguntas[alvo], perguntas[indicePergunta]];
      return {
        ...atual,
        secoes: atual.secoes.map((s, i) => (i === indiceSecao ? { ...s, perguntas } : s)),
      };
    });
  }

  // Salva título/ativo/declarações/seções do modelo. Sem id ainda (nenhuma
  // linha veio da busca) faz INSERT. Com id faz UPDATE dos campos deste
  // formulário. Seções com título vazio e zero perguntas são descartadas
  // por inteiro; dentro das seções mantidas, perguntas em branco são
  // filtradas (mesmo padrão de trim+filter usado em declaracoes).
  async function handleSalvarModelo() {
    setStatusModelo("salvando");
    setErroModelo("");

    const payload = {
      titulo: modeloAnamnese.titulo.trim(),
      ativo: modeloAnamnese.ativo,
      preenchido_por: modeloAnamnese.preenchidoPor,
      declaracoes: modeloAnamnese.declaracoes.map((d) => d.trim()).filter((d) => d !== ""),
      secoes: modeloAnamnese.secoes
        .map((s) => ({
          titulo: s.titulo.trim(),
          perguntas: s.perguntas.map((p) => p.trim()).filter((p) => p !== ""),
        }))
        .filter((s) => s.titulo !== "" || s.perguntas.length > 0),
    };

    if (modeloAnamnese.id == null) {
      const { data, error } = await supabase
        .from("anamnese_modelos")
        .insert({ estabelecimento_id: estabelecimentoId, ...payload })
        .select("id")
        .single();

      if (error) {
        setStatusModelo("");
        setErroModelo(error.message);
        return;
      }

      setModeloAnamnese((atual) => ({ ...atual, id: data.id }));
      setStatusModelo("salvo");
      return;
    }

    const { data: linhas, error } = await supabase
      .from("anamnese_modelos")
      .update(payload)
      .eq("id", modeloAnamnese.id)
      .select("id");

    if (error || !linhas?.length) {
      setStatusModelo("");
      setErroModelo(mensagemFalhaSalvar(error));
      return;
    }

    setStatusModelo("salvo");
  }

  // Clique na opção diferente da atual grava na hora — sem botão "Salvar"
  // separado, mesma filosofia do toggle escolha_profissional. Em erro,
  // reverte a seleção visual pro valor anterior (mesmo padrão do toggle de
  // ConfiguracoesSalao.js).
  async function salvarCadastroCompleto(novoValor) {
    if (novoValor === cadastroCompleto) return;

    const anterior = cadastroCompleto;
    setCadastroCompleto(novoValor);
    setStatusCadastro("salvando");
    setErroCadastro("");

    const { data: linhas, error } = await supabase
      .from("estabelecimentos")
      .update({ cadastro_completo: novoValor })
      .eq("id", estabelecimentoId)
      .select("id");

    if (error || !linhas?.length) {
      setCadastroCompleto(anterior);
      setStatusCadastro("");
      setErroCadastro(`Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
      return;
    }

    setStatusCadastro("salvo");
  }

  // Mesmo padrão de salvarCadastroCompleto: optimistic update com rollback
  // em erro, grava direto no clique (sem botão "Salvar" separado).
  async function salvarExigirEndereco(novoValor) {
    if (novoValor === exigirEndereco) return;

    const anterior = exigirEndereco;
    setExigirEndereco(novoValor);
    setStatusEndereco("salvando");
    setErroEndereco("");

    const { data: linhas, error } = await supabase
      .from("estabelecimentos")
      .update({ exigir_endereco: novoValor })
      .eq("id", estabelecimentoId)
      .select("id");

    if (error || !linhas?.length) {
      setExigirEndereco(anterior);
      setStatusEndereco("");
      setErroEndereco(`Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
      return;
    }

    setStatusEndereco("salvo");
  }

  // Mesmo padrão de salvarExigirEndereco: optimistic update com rollback em
  // erro, grava direto no clique (sem botão "Salvar" separado).
  async function salvarExigirContatoEmergencia(novoValor) {
    if (novoValor === exigirContatoEmergencia) return;

    const anterior = exigirContatoEmergencia;
    setExigirContatoEmergencia(novoValor);
    setStatusContatoEmergencia("salvando");
    setErroContatoEmergencia("");

    const { data: linhas, error } = await supabase
      .from("estabelecimentos")
      .update({ exigir_contato_emergencia: novoValor })
      .eq("id", estabelecimentoId)
      .select("id");

    if (error || !linhas?.length) {
      setExigirContatoEmergencia(anterior);
      setStatusContatoEmergencia("");
      setErroContatoEmergencia(`Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
      return;
    }

    setStatusContatoEmergencia("salvo");
  }

  // Mesmo padrão de salvarExigirEndereco: optimistic update com rollback em
  // erro, grava direto no clique (sem botão "Salvar" separado).
  async function salvarExigirInstagram(novoValor) {
    if (novoValor === exigirInstagram) return;

    const anterior = exigirInstagram;
    setExigirInstagram(novoValor);
    setStatusInstagram("salvando");
    setErroInstagram("");

    const { data: linhas, error } = await supabase
      .from("estabelecimentos")
      .update({ exigir_instagram: novoValor })
      .eq("id", estabelecimentoId)
      .select("id");

    if (error || !linhas?.length) {
      setExigirInstagram(anterior);
      setStatusInstagram("");
      setErroInstagram(`Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
      return;
    }

    setStatusInstagram("salvo");
  }

  // Mesma filosofia do toggle escolha_profissional / salvarCadastroCompleto:
  // grava direto na seleção, sem botão "Salvar", com rollback em erro.
  async function salvarGranularidadeMin(novoValor) {
    if (novoValor === granularidadeMin) return;

    const anterior = granularidadeMin;
    setGranularidadeMin(novoValor);
    setStatusGranularidade("salvando");
    setErroGranularidade("");

    const { data: linhas, error } = await supabase
      .from("estabelecimentos")
      .update({ granularidade_min: novoValor })
      .eq("id", estabelecimentoId)
      .select("id");

    if (error || !linhas?.length) {
      setGranularidadeMin(anterior);
      setStatusGranularidade("");
      setErroGranularidade(`Não foi possível salvar: ${mensagemFalhaSalvar(error)}`);
      return;
    }

    setStatusGranularidade("salvo");
  }

  // Mesmo padrão de salvarCadastroCompleto (optimistic update com rollback em
  // erro, grava direto no clique), com uma diferença: o valor anterior e o
  // rollback vivem DENTRO de `linhasAlertas`, porque é a tabela que desenha o
  // switch — não há um state por flag como nas outras sub-abas. Por isso
  // `anterior` é lido da linha, e o rollback regrava a linha inteira.
  //
  // O `.select("id")` no fim é obrigatório, igual às demais: sem ele um UPDATE
  // barrado por RLS volta sem `error` e com zero linhas, e a tabela mentiria
  // "Salvo ✓" com o switch já virado.
  async function salvarFlagAlerta(id, coluna, novoValor) {
    const linha = (linhasAlertas ?? []).find((l) => l.id === id);
    if (!linha || linha[coluna] === novoValor) return;

    const anterior = linha[coluna];
    const chave = chaveFlag(id, coluna);

    const aplicar = (valor) =>
      setLinhasAlertas((atual) =>
        (atual ?? []).map((l) => (l.id === id ? { ...l, [coluna]: valor } : l))
      );

    aplicar(novoValor);
    setStatusFlags((atual) => ({ ...atual, [chave]: "salvando" }));
    setErroFlags((atual) => ({ ...atual, [chave]: "" }));

    const { data: linhas, error } = await supabase
      .from("estabelecimentos")
      .update({ [coluna]: novoValor })
      .eq("id", id)
      .select("id");

    if (error || !linhas?.length) {
      aplicar(anterior);
      setStatusFlags((atual) => ({ ...atual, [chave]: "" }));
      setErroFlags((atual) => ({
        ...atual,
        [chave]: `Não foi possível salvar: ${mensagemFalhaSalvar(error)}`,
      }));
      return;
    }

    setStatusFlags((atual) => ({ ...atual, [chave]: "salvo" }));
  }

  return (
    <>
      <div className={`mx-auto ${aba === "alertas" ? "max-w-5xl" : "max-w-2xl"}`}>
        {/* O seletor de salão não existe na sub-aba Alertas: lá a tabela já
            mostra todos os salões, e um "salão atual" só confundiria. */}
        {aba !== "alertas" && (
        <div className="mb-6">
          <label htmlFor="estabelecimento" className="mb-1 block text-sm font-medium text-body">
            Salão
          </label>
          <select
            id="estabelecimento"
            value={estabelecimentoId}
            onChange={(e) => setEstabelecimentoId(e.target.value)}
            className="w-full rounded-lg bg-card px-3 py-2 text-sm font-medium text-heading shadow-sm ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-border"
          >
            <option value="">Selecione um salão</option>
            {estabelecimentos.map((estab) => (
              <option key={estab.id} value={estab.id}>
                {estab.nome}
              </option>
            ))}
          </select>
        </div>
        )}

        <div className="mb-4 flex gap-2">
          {ABAS.map((item) => {
            const ativa = aba === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAba(item.id)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  ativa
                    ? "bg-primary text-white"
                    : "bg-card text-body ring-1 ring-border hover:text-heading"
                }`}
              >
                {item.rotulo}
              </button>
            );
          })}
        </div>

        {aba === "cadastro" && (
          <>
            {!estabelecimentoId ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-sm text-body">Selecione um salão para configurar.</p>
              </div>
            ) : (
              <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <p className="text-sm font-medium text-heading">
                  Tipo de cadastro do cliente
                </p>
                <p className="mt-1 text-xs text-muted">
                  Define se o fluxo público pede só nome e WhatsApp, ou o
                  cadastro completo (endereço, nascimento etc.).
                </p>

                {cadastroCompleto === undefined ? (
                  <p className="mt-3 text-xs text-muted">Carregando...</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={cadastroCompleto === false}
                      onClick={() => salvarCadastroCompleto(false)}
                      disabled={statusCadastro === "salvando"}
                      className={`block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        cadastroCompleto === false
                          ? "bg-primary text-white"
                          : "bg-surface text-body ring-1 ring-border hover:text-heading"
                      }`}
                    >
                      Cadastro rápido (nome + WhatsApp)
                    </button>

                    <button
                      type="button"
                      role="radio"
                      aria-checked={cadastroCompleto === true}
                      onClick={() => salvarCadastroCompleto(true)}
                      disabled={statusCadastro === "salvando"}
                      className={`block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        cadastroCompleto === true
                          ? "bg-primary text-white"
                          : "bg-surface text-body ring-1 ring-border hover:text-heading"
                      }`}
                    >
                      Cadastro completo (endereço, nascimento, etc.)
                    </button>

                    {cadastroCompleto === true && (
                      <div className="ml-4 rounded-lg border-l-2 border-border bg-surface p-3 pl-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <label
                              htmlFor="toggle-exigir-endereco"
                              className="block text-sm font-medium text-heading"
                            >
                              Endereço completo
                            </label>
                            <p className="mt-1 text-xs text-muted">
                              Ligado: pede CEP, endereço, número, bairro,
                              cidade, estado.
                            </p>
                          </div>

                          {exigirEndereco === undefined ? (
                            <p className="shrink-0 text-xs text-muted">Carregando...</p>
                          ) : (
                            <button
                              id="toggle-exigir-endereco"
                              type="button"
                              role="switch"
                              aria-checked={exigirEndereco}
                              onClick={() => salvarExigirEndereco(!exigirEndereco)}
                              disabled={statusEndereco === "salvando"}
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                exigirEndereco ? "bg-primary" : "bg-border"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                  exigirEndereco ? "translate-x-5" : "translate-x-0.5"
                                }`}
                              />
                            </button>
                          )}
                        </div>

                        {statusEndereco === "salvando" && (
                          <p className="mt-2 text-xs text-muted">Salvando…</p>
                        )}
                        {statusEndereco === "salvo" && !erroEndereco && (
                          <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
                        )}
                        {erroEndereco && (
                          <p className="mt-2 text-xs text-red-600">{erroEndereco}</p>
                        )}
                      </div>
                    )}

                    {cadastroCompleto === true && (
                      <div className="ml-4 rounded-lg border-l-2 border-border bg-surface p-3 pl-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <label
                              htmlFor="toggle-exigir-contato-emergencia"
                              className="block text-sm font-medium text-heading"
                            >
                              Contato de emergência
                            </label>
                            <p className="mt-1 text-xs text-muted">
                              Campo opcional de WhatsApp de emergência,
                              independente do endereço.
                            </p>
                          </div>

                          {exigirContatoEmergencia === undefined ? (
                            <p className="shrink-0 text-xs text-muted">Carregando...</p>
                          ) : (
                            <button
                              id="toggle-exigir-contato-emergencia"
                              type="button"
                              role="switch"
                              aria-checked={exigirContatoEmergencia}
                              onClick={() =>
                                salvarExigirContatoEmergencia(!exigirContatoEmergencia)
                              }
                              disabled={statusContatoEmergencia === "salvando"}
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                exigirContatoEmergencia ? "bg-primary" : "bg-border"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                  exigirContatoEmergencia
                                    ? "translate-x-5"
                                    : "translate-x-0.5"
                                }`}
                              />
                            </button>
                          )}
                        </div>

                        {statusContatoEmergencia === "salvando" && (
                          <p className="mt-2 text-xs text-muted">Salvando…</p>
                        )}
                        {statusContatoEmergencia === "salvo" && !erroContatoEmergencia && (
                          <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
                        )}
                        {erroContatoEmergencia && (
                          <p className="mt-2 text-xs text-red-600">{erroContatoEmergencia}</p>
                        )}
                      </div>
                    )}

                    {cadastroCompleto === true && (
                      <div className="ml-4 rounded-lg border-l-2 border-border bg-surface p-3 pl-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <label
                              htmlFor="toggle-exigir-instagram"
                              className="block text-sm font-medium text-heading"
                            >
                              Instagram
                            </label>
                            <p className="mt-1 text-xs text-muted">
                              Campo opcional de Instagram do cliente.
                            </p>
                          </div>

                          {exigirInstagram === undefined ? (
                            <p className="shrink-0 text-xs text-muted">Carregando...</p>
                          ) : (
                            <button
                              id="toggle-exigir-instagram"
                              type="button"
                              role="switch"
                              aria-checked={exigirInstagram}
                              onClick={() => salvarExigirInstagram(!exigirInstagram)}
                              disabled={statusInstagram === "salvando"}
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                exigirInstagram ? "bg-primary" : "bg-border"
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                  exigirInstagram ? "translate-x-5" : "translate-x-0.5"
                                }`}
                              />
                            </button>
                          )}
                        </div>

                        {statusInstagram === "salvando" && (
                          <p className="mt-2 text-xs text-muted">Salvando…</p>
                        )}
                        {statusInstagram === "salvo" && !erroInstagram && (
                          <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
                        )}
                        {erroInstagram && (
                          <p className="mt-2 text-xs text-red-600">{erroInstagram}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {statusCadastro === "salvando" && (
                  <p className="mt-2 text-xs text-muted">Salvando…</p>
                )}
                {statusCadastro === "salvo" && !erroCadastro && (
                  <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
                )}
                {erroCadastro && (
                  <p className="mt-2 text-xs text-red-600">{erroCadastro}</p>
                )}
              </section>
            )}
          </>
        )}

        {aba === "anamnese" && (
          <>
            {!estabelecimentoId ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-sm text-body">Selecione um salão para configurar.</p>
              </div>
            ) : carregandoModelo ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-xs text-muted">Carregando...</p>
              </div>
            ) : (
              <section className="space-y-5 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <div>
                  <p className="mb-2 text-sm font-medium text-heading">
                    Anamnese existe nesse salão?
                  </p>

                  <div className="space-y-2">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={modeloAnamnese.ativo === true}
                      onClick={() => selecionarAtivoModelo(true)}
                      className={`block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold transition ${
                        modeloAnamnese.ativo === true
                          ? "bg-primary text-white"
                          : "bg-surface text-body ring-1 ring-border hover:text-heading"
                      }`}
                    >
                      Sim, esse salão usa anamnese
                    </button>

                    <button
                      type="button"
                      role="radio"
                      aria-checked={modeloAnamnese.ativo === false}
                      onClick={() => selecionarAtivoModelo(false)}
                      className={`block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold transition ${
                        modeloAnamnese.ativo === false
                          ? "bg-primary text-white"
                          : "bg-surface text-body ring-1 ring-border hover:text-heading"
                      }`}
                    >
                      Não, esse salão não usa anamnese
                    </button>
                  </div>
                </div>

                {modeloAnamnese.ativo === true && (
                  <div className="ml-4 space-y-5 rounded-lg border-l-2 border-border bg-surface p-3 pl-4">
                    <div>
                      <p className="mb-2 text-sm font-medium text-heading">Quem preenche?</p>

                      <div className="space-y-2">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={modeloAnamnese.preenchidoPor === "cliente"}
                          onClick={() => selecionarPreenchidoPorModelo("cliente")}
                          className={`block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold transition ${
                            modeloAnamnese.preenchidoPor === "cliente"
                              ? "bg-primary text-white"
                              : "bg-card text-body ring-1 ring-border hover:text-heading"
                          }`}
                        >
                          Cliente, no /agendar
                        </button>

                        <button
                          type="button"
                          role="radio"
                          aria-checked={modeloAnamnese.preenchidoPor === "dona"}
                          onClick={() => selecionarPreenchidoPorModelo("dona")}
                          className={`block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold transition ${
                            modeloAnamnese.preenchidoPor === "dona"
                              ? "bg-primary text-white"
                              : "bg-card text-body ring-1 ring-border hover:text-heading"
                          }`}
                        >
                          A dona, pelo /admin
                        </button>
                      </div>

                      <p className="mt-2 text-xs text-muted">
                        Por enquanto isso só grava a preferência — o /agendar ainda
                        pede anamnese ao cliente sempre que vencida, e o formulário
                        pra dona preencher no /admin ainda não existe. Em breve.
                      </p>
                    </div>

                    <div>
                      <label htmlFor="titulo-anamnese" className="mb-1 block text-sm font-medium text-body">
                        Título
                      </label>
                      <input
                        id="titulo-anamnese"
                        type="text"
                        value={modeloAnamnese.titulo}
                        onChange={(e) => alterarTituloModelo(e.target.value)}
                        placeholder="Ex.: Ficha de anamnese"
                        className="w-full rounded-lg border border-border px-3 py-2 text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                      />
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium text-heading">Declarações</p>

                      {modeloAnamnese.declaracoes.length === 0 && (
                        <p className="mb-2 text-xs text-muted">Nenhuma declaração ainda.</p>
                      )}

                      <div className="space-y-2">
                        {modeloAnamnese.declaracoes.map((declaracao, indice) => (
                          <div key={indice} className="flex items-start gap-2">
                            <div className="flex shrink-0 flex-col pt-0.5">
                              <button
                                type="button"
                                onClick={() => moverDeclaracao(indice, -1)}
                                disabled={indice === 0}
                                aria-label="Mover para cima"
                                className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => moverDeclaracao(indice, 1)}
                                disabled={indice === modeloAnamnese.declaracoes.length - 1}
                                aria-label="Mover para baixo"
                                className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                ▼
                              </button>
                            </div>

                            <textarea
                              value={declaracao}
                              onChange={(e) => alterarDeclaracao(indice, e.target.value)}
                              rows={2}
                              className="w-full flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                            />

                            <button
                              type="button"
                              onClick={() => removerDeclaracao(indice)}
                              className="shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                            >
                              Remover
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={adicionarDeclaracao}
                        className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                      >
                        Adicionar declaração
                      </button>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium text-heading">Seções</p>

                      {modeloAnamnese.secoes.length === 0 && (
                        <p className="mb-2 text-xs text-muted">Nenhuma seção ainda.</p>
                      )}

                      <div className="space-y-4">
                        {modeloAnamnese.secoes.map((secao, indiceSecao) => (
                          <div key={indiceSecao} className="rounded-lg border border-border p-3">
                            <div className="flex items-start gap-2">
                              <div className="flex shrink-0 flex-col pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => moverSecao(indiceSecao, -1)}
                                  disabled={indiceSecao === 0}
                                  aria-label="Mover seção para cima"
                                  className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moverSecao(indiceSecao, 1)}
                                  disabled={indiceSecao === modeloAnamnese.secoes.length - 1}
                                  aria-label="Mover seção para baixo"
                                  className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  ▼
                                </button>
                              </div>

                              <input
                                type="text"
                                value={secao.titulo}
                                onChange={(e) => alterarTituloSecao(indiceSecao, e.target.value)}
                                placeholder="Título da seção"
                                className="w-full flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                              />

                              <button
                                type="button"
                                onClick={() => removerSecao(indiceSecao)}
                                className="shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                              >
                                Remover
                              </button>
                            </div>

                            <div className="mt-2 space-y-2 border-l-2 border-border pl-4">
                              {secao.perguntas.map((pergunta, indicePergunta) => (
                                <div key={indicePergunta} className="flex items-start gap-2">
                                  <div className="flex shrink-0 flex-col pt-0.5">
                                    <button
                                      type="button"
                                      onClick={() => moverPergunta(indiceSecao, indicePergunta, -1)}
                                      disabled={indicePergunta === 0}
                                      aria-label="Mover pergunta para cima"
                                      className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => moverPergunta(indiceSecao, indicePergunta, 1)}
                                      disabled={indicePergunta === secao.perguntas.length - 1}
                                      aria-label="Mover pergunta para baixo"
                                      className="px-1.5 py-0.5 text-lg leading-none text-body transition hover:text-heading disabled:cursor-not-allowed disabled:opacity-30"
                                    >
                                      ▼
                                    </button>
                                  </div>

                                  <input
                                    type="text"
                                    value={pergunta}
                                    onChange={(e) =>
                                      alterarPergunta(indiceSecao, indicePergunta, e.target.value)
                                    }
                                    className="w-full flex-1 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                                  />

                                  <button
                                    type="button"
                                    onClick={() => removerPergunta(indiceSecao, indicePergunta)}
                                    className="shrink-0 rounded-lg bg-card px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50"
                                  >
                                    Remover
                                  </button>
                                </div>
                              ))}

                              <button
                                type="button"
                                onClick={() => adicionarPergunta(indiceSecao)}
                                className="rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                              >
                                Adicionar pergunta
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={adicionarSecao}
                        className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-200 transition hover:bg-blue-50"
                      >
                        Adicionar seção
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSalvarModelo}
                  disabled={statusModelo === "salvando"}
                  className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Salvar
                </button>

                {statusModelo === "salvando" && (
                  <p className="text-xs text-muted">Salvando…</p>
                )}
                {statusModelo === "salvo" && !erroModelo && (
                  <p className="text-xs font-medium text-green-600">Salvo ✓</p>
                )}
                {erroModelo && <p className="text-xs text-red-600">{erroModelo}</p>}
              </section>
            )}
          </>
        )}

        {aba === "horarios" && (
          <>
            {!estabelecimentoId ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-sm text-body">Selecione um salão para configurar.</p>
              </div>
            ) : (
              <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <label htmlFor="granularidade" className="mb-1 block text-sm font-medium text-heading">
                  Granularidade da agenda
                </label>

                {granularidadeMin === undefined ? (
                  <p className="mt-3 text-xs text-muted">Carregando...</p>
                ) : (
                  <select
                    id="granularidade"
                    value={granularidadeMin}
                    onChange={(e) => salvarGranularidadeMin(Number(e.target.value))}
                    disabled={statusGranularidade === "salvando"}
                    className="w-full rounded-lg bg-surface px-3 py-2 text-sm font-medium text-heading shadow-sm ring-1 ring-border transition focus:outline-none focus:ring-2 focus:ring-border disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value={15}>15 em 15 minutos</option>
                    <option value={30}>30 em 30 minutos</option>
                    <option value={60}>1 em 1 hora</option>
                  </select>
                )}

                <p className="mt-3 text-xs text-muted">
                  Só tem efeito para profissionais com agenda por janela
                  contínua. Profissionais com horários fixos (ex.: Laysla)
                  não usam essa configuração.
                </p>

                {statusGranularidade === "salvando" && (
                  <p className="mt-2 text-xs text-muted">Salvando…</p>
                )}
                {statusGranularidade === "salvo" && !erroGranularidade && (
                  <p className="mt-2 text-xs font-medium text-green-600">Salvo ✓</p>
                )}
                {erroGranularidade && (
                  <p className="mt-2 text-xs text-red-600">{erroGranularidade}</p>
                )}
              </section>
            )}
          </>
        )}

        {aba === "alertas" && (
          <>
            {/* Tabela de todos os salões ativos. Sem guarda de
                `estabelecimentoId`: esta sub-aba não usa o seletor. */}
            {erroLinhasAlertas ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-sm text-red-600">{erroLinhasAlertas}</p>
              </div>
            ) : linhasAlertas === undefined ? (
              <div className="rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-sm text-muted">Carregando...</p>
              </div>
            ) : (
              <section className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
                <div className="border-b border-border p-4">
                  <p className="text-sm font-medium text-heading">
                    Alertas configuráveis por salão
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Cada switch grava na mesma coluna que o /admin do próprio
                    salão lê — a mudança aparece lá na hora. As duas últimas
                    colunas são só leitura: o texto das regras e o alerta de
                    cada serviço se editam no /admin do salão.
                  </p>
                </div>

                {/* overflow-x-auto + min-w na tabela: são cinco colunas além
                    do nome. Sem o min-w a tabela ENCOLHE pra caber em vez de
                    rolar, e as células de texto quebram uma palavra por linha
                    ("0 / serviços / com / alerta / ativo"). Com ele, abaixo de
                    ~46rem a tabela rola na horizontal e cada coluna fica
                    legível. */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[46rem] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface">
                        <th scope="col" className="px-4 py-2 font-medium text-body">
                          Salão
                        </th>
                        {FLAGS_ALERTAS.map(({ coluna, rotulo }) => (
                          <th
                            key={coluna}
                            scope="col"
                            className="px-4 py-2 text-center font-medium text-body"
                          >
                            {rotulo}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="whitespace-nowrap px-4 py-2 font-medium text-body"
                        >
                          Regras de agendamento
                        </th>
                        <th
                          scope="col"
                          className="whitespace-nowrap px-4 py-2 font-medium text-body"
                        >
                          Alertas de serviço
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-border">
                      {linhasAlertas.map((linha) => (
                        <tr key={linha.id}>
                          <td className="px-4 py-3 align-top">
                            <span className="block font-medium text-heading">{linha.nome}</span>
                            <span className="block text-xs text-muted">/{linha.slug}</span>
                          </td>

                          {FLAGS_ALERTAS.map(({ coluna, rotulo }) => {
                            const chave = chaveFlag(linha.id, coluna);
                            const ligado = linha[coluna];
                            return (
                              <td key={coluna} className="px-4 py-3 align-top text-center">
                                {/* Mesmo switch role="switch" dos toggles de
                                    cadastro (ver salvarExigirEndereco): nada
                                    de componente novo. aria-label carrega o
                                    salão porque o <th> sozinho não diz qual
                                    linha é, pra quem usa leitor de tela. */}
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={ligado}
                                  aria-label={`${rotulo} — ${linha.nome}`}
                                  onClick={() => salvarFlagAlerta(linha.id, coluna, !ligado)}
                                  disabled={statusFlags[chave] === "salvando"}
                                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                    ligado ? "bg-primary" : "bg-border"
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                      ligado ? "translate-x-5" : "translate-x-0.5"
                                    }`}
                                  />
                                </button>

                                {statusFlags[chave] === "salvando" && (
                                  <p className="mt-1 text-xs text-muted">Salvando…</p>
                                )}
                                {statusFlags[chave] === "salvo" && !erroFlags[chave] && (
                                  <p className="mt-1 text-xs font-medium text-green-600">
                                    Salvo ✓
                                  </p>
                                )}
                                {erroFlags[chave] && (
                                  <p className="mt-1 text-xs text-red-600">{erroFlags[chave]}</p>
                                )}
                              </td>
                            );
                          })}

                          <td className="px-4 py-3 align-top">
                            <span
                              className={
                                linha.avisoPreenchido
                                  ? "text-xs font-medium text-heading"
                                  : "text-xs text-muted"
                              }
                            >
                              {linha.avisoPreenchido ? "preenchido" : "vazio"}
                            </span>
                          </td>

                          <td className="whitespace-nowrap px-4 py-3 align-top">
                            <span
                              className={
                                linha.alertasAtivos > 0
                                  ? "text-xs font-medium text-heading"
                                  : "text-xs text-muted"
                              }
                            >
                              {linha.alertasAtivos}{" "}
                              {linha.alertasAtivos === 1 ? "serviço" : "serviços"} com alerta
                              ativo
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Catálogo só-leitura (ver CATALOGO_SEM_CONTROLE): não tem toggle
                nem link de edição de propósito — mexer em qualquer um destes
                é mudança de código, não de configuração. Um grupo aberto por
                vez, mesmo padrão de alternarBloco em ConfiguracoesSalao.js. */}
            <div className="mt-6">
              <p className="text-sm font-medium text-heading">
                Outros alertas do sistema (sem controle ainda)
              </p>
              <p className="mt-1 text-xs text-muted">
                Texto fixo no código, ou coluna sem tela pra editar. Catálogo
                só pra consulta.
              </p>

              <div className="mt-3 space-y-2">
                {CATALOGO_SEM_CONTROLE.map((grupo) => {
                  const aberto = grupoCatalogoAberto === grupo.id;
                  return (
                    <div
                      key={grupo.id}
                      className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setGrupoCatalogoAberto((atual) =>
                            atual === grupo.id ? null : grupo.id
                          )
                        }
                        aria-expanded={aberto}
                        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                      >
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="font-semibold text-heading">{grupo.rotulo}</span>
                          <span className="text-xs text-muted">
                            {grupo.itens.length} itens
                          </span>
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-xs text-body">
                          {aberto ? "▲" : "▼"}
                        </span>
                      </button>

                      {aberto && (
                        <ul className="divide-y divide-border border-t border-border">
                          {grupo.itens.map((item) => (
                            <li key={item.nome} className="px-4 py-3">
                              <p className="text-sm font-medium text-heading">{item.nome}</p>
                              <p className="mt-0.5 text-xs text-muted">{item.descricao}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
