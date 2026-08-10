"use client";

// Persistência do wizard público (IdentificacaoCliente -> CadastroCliente ->
// FormularioAnamnese -> FormularioAgendamento, mais o clienteIdentificado
// guardado em app/[salon]/page.js) em sessionStorage — sobrevive a um reload
// REAL da página, cenário do navegador do WhatsApp ao voltar de segundo
// plano no celular (minimizar o app fecha a aba; reabrir recarrega do zero).
//
// Uma chave só por salão+aba (`agendar:{slug}`), com uma FATIA por etapa
// (ex.: "identificacao", "cadastroCliente", "anamnese", "agendamento",
// "clienteIdentificado") — cada componente lê/escreve só a fatia dele via
// lerFatia/salvarFatia/limparFatia, sem pisar nas dos outros. Quem decide
// REVALIDAR contra o banco ao restaurar (serviço ainda ativo? horário ainda
// livre? modelo de anamnese ainda é o mesmo?) é cada componente — este
// módulo só guarda e devolve o que foi salvo, cru, sem validar nada.
//
// Expira sozinho: passadas 2h desde o ÚLTIMO save, lerFatia descarta tudo e
// devolve null — nunca tenta restaurar uma sessão velha.

const EXPIRA_MS = 2 * 60 * 60 * 1000;

function chave(slug) {
  return `agendar:${slug}`;
}

// Lê o objeto inteiro (todas as fatias), já descartando se expirado ou
// corrompido (JSON inválido, sessionStorage indisponível). null = nada
// válido salvo.
function lerEstado(slug) {
  if (typeof window === "undefined" || !slug) return null;
  try {
    const bruto = window.sessionStorage.getItem(chave(slug));
    if (!bruto) return null;
    const estado = JSON.parse(bruto);
    if (!estado?.atualizadoEm || Date.now() - estado.atualizadoEm > EXPIRA_MS) {
      window.sessionStorage.removeItem(chave(slug));
      return null;
    }
    return estado;
  } catch {
    return null;
  }
}

function salvarEstado(slug, estado) {
  if (typeof window === "undefined" || !slug) return;
  try {
    const agora = Date.now();
    window.sessionStorage.setItem(
      chave(slug),
      JSON.stringify({
        ...estado,
        criadoEm: estado.criadoEm ?? agora,
        atualizadoEm: agora,
      })
    );
  } catch {
    // sessionStorage indisponível (modo privado, quota etc.) — o fluxo
    // segue funcionando sem persistência, só sem sobreviver a um reload.
  }
}

// Lê só uma fatia nomeada (ex.: "agendamento"). null = nada válido salvo
// (ausente, expirado ou corrompido).
export function lerFatia(slug, nomeFatia) {
  return lerEstado(slug)?.[nomeFatia] ?? null;
}

// Grava/mescla uma fatia nomeada, preservando as demais.
export function salvarFatia(slug, nomeFatia, valor) {
  const atual = lerEstado(slug) ?? {};
  salvarEstado(slug, { ...atual, [nomeFatia]: valor });
}

// Remove só a fatia nomeada, preservando as demais (ex.: etapa concluída com
// sucesso — não deixa rascunho velho disponível pra próxima visita/etapa).
export function limparFatia(slug, nomeFatia) {
  const atual = lerEstado(slug);
  if (!atual) return;
  const { [nomeFatia]: _removida, ...resto } = atual;
  salvarEstado(slug, resto);
}
