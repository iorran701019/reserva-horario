import { supabase } from "@/lib/supabaseClient";

// preco_centavos -> "R$ 35,00" (mesma convenção do resto do projeto).
function formatarPreco(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// "Pergunta: resposta" de uma linha de agendamento_respostas — a opção
// escolhida (+ ajuste de preço, quando != 0) ou o texto livre digitado. Ex.:
// "Unha extra longa: Sim (+R$ 15,00)" ou "Método: Molde F1". null quando a
// linha não tem o texto da pergunta resolvido (join falhou/pergunta apagada).
function formatarResposta(linha) {
  const pergunta = linha.servico_perguntas?.texto;
  if (!pergunta) return null;

  if (linha.texto_livre != null) {
    return `${pergunta}: ${linha.texto_livre}`;
  }

  const opcao = linha.servico_pergunta_opcoes;
  if (!opcao) return null;
  const ajuste = opcao.ajuste_preco_centavos;
  const sufixoPreco = ajuste ? ` (${ajuste > 0 ? "+" : ""}${formatarPreco(ajuste)})` : "";
  return `${pergunta}: ${opcao.label}${sufixoPreco}`;
}

// Busca as respostas do popup de perguntas (ver o popup de perguntas do
// serviço em components/FormularioAgendamento) de um ou mais agendamentos,
// já com o texto da pergunta e o label da opção resolvidos via join
// (servico_perguntas/servico_pergunta_opcoes) e formatados prontos pra
// exibir. Devolve um Map agendamento_id -> string[] — reaproveitado nos três
// lugares do admin que mostram o nome do serviço de um agendamento (card de
// Pendentes, modal de Detalhes, ficha do cliente). Agendamento sem nenhuma
// resposta (serviço sem perguntas) simplesmente não entra no Map. Erro de
// consulta devolve um Map vazio — quem chama já trata "sem resposta" como
// "não mostra nada extra", então uma falha aqui não quebra a tela.
export async function buscarRespostasPorAgendamento(agendamentoIds) {
  const ids = [...new Set((agendamentoIds ?? []).filter((id) => id != null))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("agendamento_respostas")
    .select(
      "agendamento_id, texto_livre, servico_perguntas(texto), servico_pergunta_opcoes(label, ajuste_preco_centavos)"
    )
    .in("agendamento_id", ids);

  if (error) return new Map();

  const mapa = new Map();
  for (const linha of data ?? []) {
    const texto = formatarResposta(linha);
    if (!texto) continue;
    const lista = mapa.get(linha.agendamento_id) ?? [];
    lista.push(texto);
    mapa.set(linha.agendamento_id, lista);
  }
  return mapa;
}
