"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Busca um cliente DIFERENTE do que está sendo editado agora, já cadastrado
// com esse WhatsApp neste estabelecimento. `idAtual` é o id do registro em
// edição (clienteId do CadastroCliente, ou clienteEncontrado?.id do cadastro
// simples — null quando é um cadastro novo, aí qualquer achado é conflito).
// Devolve { cliente, erro }: `cliente` é o registro encontrado (pronto pra
// virar clienteInicial via onIdentificado/onCadastrado) ou null quando o
// número está livre ou pertence ao próprio registro em edição; `erro` é a
// mensagem de tela pra quando a CHECAGEM em si não pôde ser feita.
//
// Os dois casos precisam ser distintos: a RPC que falha (rede, timeout)
// também devolve data null, e tratar isso como "número livre" liberava o
// INSERT/UPDATE que esta função existe justamente pra proteger — duplicando
// um cliente que já estava lá. Checagem falhou, ninguém grava nada.
export async function buscarClienteConflitante(estabelecimentoId, digitos, idAtual) {
  const { data, error } = await supabase.rpc("cliente_buscar_por_whatsapp", {
    p_estabelecimento_id: estabelecimentoId,
    p_whatsapp: digitos,
  });

  // .rpc() reporta erro do mesmo jeito que .from().select(): { data, error }.
  if (error) return { cliente: null, erro: MSG_CHECAGEM_INDISPONIVEL };

  const encontrado = data && data.length > 0 ? data[0] : null;
  if (!encontrado) return { cliente: null, erro: null };
  if (idAtual && encontrado.id === idAtual) return { cliente: null, erro: null };
  return { cliente: encontrado, erro: null };
}

// Checagem de WhatsApp já cadastrado, com trava progressiva — reutilizada
// pelo completarEndereco (CadastroCliente) e pelo cadastro simples
// (IdentificacaoCliente), os dois únicos formulários com campo de WhatsApp
// editável. Ver ModalConflitoWhatsapp para a UI que consome este hook.
//
// Uso: no handleSubmit do formulário, DEPOIS que os dois campos de WhatsApp
// já baterem entre si e ANTES do INSERT/UPDATE, chamar
// `await verificar(estabelecimentoId, digitos, idAtual)`. Devolve
// { bloquear, erro }: bloquear=true manda abortar o submit — ou porque achou
// conflito (o hook já abriu o modal certo, e erro vem null) ou porque a
// checagem falhou (erro traz a mensagem, que o formulário mostra no espaço
// de erro dele, já que o modal não cobre esse caso). bloquear=false = número
// livre, segue o fluxo normal.
export function useConflitoWhatsapp() {
  const [clienteConflitante, setClienteConflitante] = useState(null);
  const [modalContato, setModalContato] = useState(false);
  // Tentativas por número digitado (não por sessão inteira): trocar de
  // número recomeça do zero; voltar a insistir no mesmo número retoma a
  // contagem. Nunca persiste em banco — só estado do componente.
  const [tentativas, setTentativas] = useState({});

  async function verificar(estabelecimentoId, digitos, idAtual) {
    const { cliente, erro } = await buscarClienteConflitante(
      estabelecimentoId,
      digitos,
      idAtual
    );
    if (erro) return { bloquear: true, erro };
    if (!cliente) return { bloquear: false, erro: null };
    setClienteConflitante({ ...cliente, _digitos: digitos });
    return { bloquear: true, erro: null };
  }

  // "Sim, sou eu" no modal de conflito: entrega o cliente encontrado pra
  // quem chamou, no mesmo formato de onIdentificado/onCadastrado — pula pro
  // agendamento dele, sem gravar nada do formulário atual.
  function confirmarConflito(onIdentificado, telefoneExibido) {
    onIdentificado({
      id: clienteConflitante.id,
      nome: clienteConflitante.nome,
      telefone: telefoneExibido,
      clienteNovo: false,
    });
    setClienteConflitante(null);
  }

  // "Não" no modal de conflito: fecha e incrementa a tentativa DESSE número.
  // Na 3ª vez, troca pro modal de "fale com a gente" em vez de deixar
  // insistir de novo.
  function negarConflito() {
    const digitos = clienteConflitante?._digitos;
    setClienteConflitante(null);
    if (!digitos) return;

    setTentativas((atual) => {
      const proxima = (atual[digitos] ?? 0) + 1;
      if (proxima >= 3) setModalContato(true);
      return { ...atual, [digitos]: proxima };
    });
  }

  function fecharModalContato() {
    setModalContato(false);
  }

  return {
    clienteConflitante,
    modalContato,
    verificar,
    confirmarConflito,
    negarConflito,
    fecharModalContato,
  };
}

// Mensagem genérica de número duplicado, quando não se sabe (ou não dá pra
// citar) o nome do dono do número. Quem fez a pré-checagem com
// `buscarClienteConflitante` antes de gravar tem o nome em mãos e monta uma
// mensagem melhor.
export const MSG_WHATSAPP_DUPLICADO = "Esse WhatsApp já pertence a outro cliente.";

// Texto de tela pra quando a checagem de duplicidade não pôde ser feita (a
// RPC `cliente_buscar_por_whatsapp` fora do ar, rede caída). Não é "número
// livre" nem "número ocupado": é "não sei", e nesse estado nada é gravado.
export const MSG_CHECAGEM_INDISPONIVEL =
  "Não foi possível verificar seu cadastro agora. Tente novamente.";

// Texto de tela para uma falha da RPC `atualizar_whatsapp_cliente`. Nunca
// devolve `error.message` cru: o UNIQUE (estabelecimento_id, whatsapp) de
// `clientes` vaza de dentro da função SECURITY DEFINER como
// "duplicate key value violates unique constraint ...", que não diz nada pra
// quem está na tela. Usar sempre que a RPC voltar erro — inclusive depois de
// uma pré-checagem, como rede de segurança pra corrida entre a checagem e o
// save.
export function mensagemErroTrocaWhatsapp(error) {
  // 23505 = unique_violation. O teste por texto cobre o caso de o código não
  // chegar intacto até aqui (repasse por outra camada); "unique constraint"
  // no message só aparece nessa mesma violação, então não há falso positivo.
  const ehDuplicado =
    error?.code === "23505" ||
    String(error?.message ?? "").toLowerCase().includes("unique constraint");

  if (ehDuplicado) return MSG_WHATSAPP_DUPLICADO;

  return "Não foi possível alterar o WhatsApp. Tente de novo.";
}
