"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Busca um cliente DIFERENTE do que está sendo editado agora, já cadastrado
// com esse WhatsApp neste estabelecimento. `idAtual` é o id do registro em
// edição (clienteId do CadastroCliente, ou clienteEncontrado?.id do cadastro
// simples — null quando é um cadastro novo, aí qualquer achado é conflito).
// Devolve o registro encontrado (pronto pra virar clienteInicial via
// onIdentificado/onCadastrado) ou null se o número está livre ou pertence ao
// próprio registro em edição.
export async function buscarClienteConflitante(estabelecimentoId, digitos, idAtual) {
  const { data } = await supabase
    .from("clientes")
    .select("id, nome")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("whatsapp", digitos)
    .limit(1);

  const encontrado = data && data.length > 0 ? data[0] : null;
  if (!encontrado) return null;
  if (idAtual && encontrado.id === idAtual) return null;
  return encontrado;
}

// Checagem de WhatsApp já cadastrado, com trava progressiva — reutilizada
// pelo completarEndereco (CadastroCliente) e pelo cadastro simples
// (IdentificacaoCliente), os dois únicos formulários com campo de WhatsApp
// editável. Ver ModalConflitoWhatsapp para a UI que consome este hook.
//
// Uso: no handleSubmit do formulário, DEPOIS que os dois campos de WhatsApp
// já baterem entre si e ANTES do INSERT/UPDATE, chamar
// `await verificar(estabelecimentoId, digitos, idAtual)`. true = achou
// conflito (o hook já abriu o modal certo; o formulário deve abortar o
// submit); false = número livre, segue o fluxo normal.
export function useConflitoWhatsapp() {
  const [clienteConflitante, setClienteConflitante] = useState(null);
  const [modalContato, setModalContato] = useState(false);
  // Tentativas por número digitado (não por sessão inteira): trocar de
  // número recomeça do zero; voltar a insistir no mesmo número retoma a
  // contagem. Nunca persiste em banco — só estado do componente.
  const [tentativas, setTentativas] = useState({});

  async function verificar(estabelecimentoId, digitos, idAtual) {
    const encontrado = await buscarClienteConflitante(estabelecimentoId, digitos, idAtual);
    if (!encontrado) return false;
    setClienteConflitante({ ...encontrado, _digitos: digitos });
    return true;
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
