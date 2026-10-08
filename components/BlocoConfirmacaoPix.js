"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatarPreco } from "@/lib/preco";
import { montarResumoAgendamento } from "@/lib/data";
import { comprimirImagem } from "@/lib/comprimirImagem";

// Bucket PRIVADO (anon só faz INSERT; leitura é só do lado autenticado, no
// /admin). Por isso o que gravamos em agendamentos.comprovante_pix_url é o
// CAMINHO dentro do bucket, não uma URL: signed URL expira, e uma URL morta
// gravada na linha seria pior que nenhuma. Quem precisa exibir gera a signed
// url na hora (ver createSignedUrl em app/[salon]/admin/page.js).
export const BUCKET_COMPROVANTES = "comprovantes-pix";

// O caminho do arquivo NÃO é mais montado aqui. Quem decide
// '<id>/comprovante.<extensao>' — e a extensão, de uma lista fechada — é a
// rota app/api/agendamentos/comprovante-upload, que assina o upload com o
// service role. O navegador não escolhe mais nem o caminho nem o tipo: é o que
// permitiu tirar do bucket privado as policies anon de INSERT/UPDATE/SELECT,
// que na prática deixavam qualquer anônimo gravar em qualquer caminho e ler o
// comprovante de todas as clientes.
const ROTA_ASSINAR_UPLOAD = "/api/agendamentos/comprovante-upload";

// Mensagem padrão de falha de anexo: o comprovante é opcional, então todo erro
// que não tem uma explicação melhor cai nela — e em nenhum caso trava o fluxo.
const ERRO_ANEXO_GENERICO =
  "Não foi possível enviar o comprovante. Você pode enviá-lo pelo WhatsApp.";

// Bloco âmbar do sinal de reserva: valor, chave Pix copiável, upload do
// comprovante e o checkbox "enviei o comprovante". Fonte ÚNICA desse bloco —
// era duplicado entre a etapa "dados" do FormularioAgendamento (wizard,
// gateado por precisaSinal) e o ConfirmacaoSinal (cliente que volta depois
// pelo PainelCliente).
//
// É AQUI que o agendamento sai de "aguardando_sinal" e vira "pendente": tanto
// marcar a caixa quanto concluir o upload do comprovante já disparam esse
// update sozinhos (ver marcarPendente). Não existe mais um botão "Confirmar"
// em tela pra isso — a cliente que declarou o pagamento (de um jeito ou de
// outro) já entregou o que dependia dela.
//
// Props:
//   estabelecimento – { sinal_valor_centavos, sinal_chave_pix } do salão.
//   valorCentavos   – valor do sinal DESTE agendamento, já resolvido pelo pai
//                     (resolverSinal, lib/sinalRegra.js): uma regra especial de
//                     serviço ou de período pode cobrar um número diferente do
//                     `sinal_valor_centavos` do salão. Omitido, cai no valor do
//                     salão — que é o mesmo número sempre que não há regra
//                     especial valendo, ou seja, o comportamento de antes.
//   agendamentoId   – linha em `agendamentos` a marcar como pendente e a que
//                     o comprovante pertence. No wizard é a reserva já
//                     gravada ao entrar em "dados"; null desabilita o upload
//                     e o checkbox, o resto do bloco segue.
//   nomeCliente / servicoNome / data / horario – resumo em uma linha na caixa
//                     cinza ACIMA do bloco âmbar, pra cliente conferir O QUE
//                     está pagando antes de mandar o Pix (mesma caixa que o
//                     wizard usava pro "Agendando para", que saiu daqui em
//                     diante). TODOS opcionais e independentes: o que
//                     não vier some da linha (nada de "undefined" em tela), e
//                     sem nenhum deles a linha inteira não é renderizada.
//                     `data` é o ISO cru ("YYYY-MM-DD"), formatado aqui.
//   nomeProfissionalContato – mesmo nome do botão fixo ContatoDono.
//   sinalDeclarado / onSinalDeclaradoChange – checkbox CONTROLADO pelo pai
//                     (o wizard ainda lê esse valor no submit final dele).
//   jaPendente      – true quando o agendamento JÁ está em "pendente" (a
//                     cliente voltou a esta tela depois de declarar): evita
//                     reescrever pendente_desde e reiniciar a janela de
//                     protocolo a cada novo comprovante.
//   onStatusMudou   – chamado (sem args) logo após o update de status dar
//                     certo, pro pai trocar de tela (ver app/[salon]/page.js).
//   onComprovanteEnviado – (caminho, enviadoEm) após o upload + update darem
//                     certo; opcional, pro pai refletir na UI dele.
export default function BlocoConfirmacaoPix({
  estabelecimento,
  agendamentoId,
  nomeCliente = "",
  servicoNome = "",
  data = "",
  horario = "",
  nomeProfissionalContato = "a equipe",
  valorCentavos = undefined,
  sinalDeclarado,
  onSinalDeclaradoChange,
  jaPendente = false,
  onStatusMudou,
  onComprovanteEnviado,
}) {
  // `??` e não `||`: um sinal de R$ 0,00 configurado é um número válido, e
  // `||` o trocaria em silêncio pelo valor do salão.
  const valorExibido = valorCentavos ?? estabelecimento.sinal_valor_centavos;

  const [chavePixCopiada, setChavePixCopiada] = useState(false);
  const [enviandoComprovante, setEnviandoComprovante] = useState(false);
  const [nomeComprovante, setNomeComprovante] = useState("");
  const [erroComprovante, setErroComprovante] = useState("");
  // Erro do update de status (marcarPendente). Separado do erro do
  // comprovante de propósito: um anexo que não subiu é contornável pelo
  // WhatsApp, mas o status que não mudou trava a solicitação — e é o único
  // dos dois que oferece "Tentar novamente".
  const [erroStatus, setErroStatus] = useState("");
  const [marcandoPendente, setMarcandoPendente] = useState(false);
  // Id do agendamento que ESTE componente já marcou como pendente. Guardado
  // como id (não booleano) porque no wizard o `agendamentoId` troca sem
  // desmontar o bloco: trocar de horário cancela a reserva e cria outra, e a
  // nova precisa ser marcada de novo. Ref, não state: só serve pra decidir se
  // o próximo update deve rodar, nunca muda o que está na tela.
  const marcadoPendenteParaRef = useRef(jaPendente ? agendamentoId : null);
  // Dois inputs de arquivo separados, um por tipo, em vez de um só com
  // accept="image/*,application/pdf": no Android (confirmado em POCO X7, e o
  // padrão se repete em outros Xiaomi/MIUI) o accept misto faz o seletor
  // nativo esconder a Galeria/Fotos e oferecer só Câmera e Arquivos. Com
  // accept="image/*" sozinho o seletor de fotos volta. Escondidos e
  // disparados por .click() nos dois botões visíveis — o input nativo não é
  // estilizável e destoaria do bloco.
  const inputImagemRef = useRef(null);
  const inputPdfRef = useRef(null);

  // Leva o agendamento de "aguardando_sinal" pra "pendente" — o único write
  // de status do fluxo público do sinal. Chamado pelos DOIS gestos que
  // significam "paguei e avisei": marcar a caixa e concluir o upload do
  // comprovante.
  //
  // pendente_desde marca a ENTRADA em pendente: é dele que a régua de telas
  // de app/[salon]/page.js tira a janela em que a cliente ainda vê a tela de
  // protocolo em vez do painel. Por isso não é reescrito quando o
  // agendamento já estava pendente (segundo comprovante, por exemplo) — só
  // quando de fato entra no status.
  //
  // Devolve true/false em vez de lançar: quem chama decide o que fazer com a
  // falha (o upload, por exemplo, já subiu o arquivo e não deve desfazer
  // nada). Nunca desfaz o checkbox nem apaga o comprovante — a cliente segue
  // com o gesto dela registrado em tela e um "Tentar novamente" à mão.
  //
  // `sinal_valor_centavos` NÃO viaja mais daqui. Quem grava é a própria
  // `agendamento_declarar_sinal`, lendo o valor do estabelecimento dentro da
  // função (ver sql/rpcs_agendamento_publico.sql): mandar o número do
  // navegador deixava um anônimo escolher o valor gravado num campo que
  // alimenta o card de Relatórios. A função também preserva o valor que a
  // linha já tiver — o da cobrança AbacatePay ou o herdado numa remarcação.
  async function marcarPendente() {
    if (!agendamentoId) return false;
    if (marcadoPendenteParaRef.current === agendamentoId) return true;

    setErroStatus("");
    setMarcandoPendente(true);

    // `false` da RPC no lugar do antigo `.select("id")` com zero linhas: sem
    // essa checagem a tela seguiria pra confirmação com o protocolo de 24h
    // que nunca começou a contar. Um false é falha, igual a um erro de rede.
    const { data: declarado, error } = await supabase.rpc(
      "agendamento_declarar_sinal",
      { p_id: agendamentoId }
    );

    setMarcandoPendente(false);

    if (error || declarado !== true) {
      setErroStatus(
        "Não foi possível registrar o envio do comprovante. Verifique sua conexão e tente de novo."
      );
      return false;
    }

    marcadoPendenteParaRef.current = agendamentoId;
    onStatusMudou?.();
    return true;
  }

  // Marcar a caixa É a confirmação: avisa o pai (o wizard ainda usa esse
  // valor no submit dele) e já grava. Desmarcar não desfaz o update — o
  // status não volta atrás sozinho; quem reabre uma solicitação é o salão.
  async function handleSinalDeclaradoChange(marcado) {
    onSinalDeclaradoChange?.(marcado);
    if (!marcado) return;
    await marcarPendente();
  }

  // Linha de resumo do topo: "Nome · Serviço · 27/08 · quarta-feira às
  // 14:00" (ver montarResumoAgendamento em lib/data.js, compartilhada com a
  // etapa "dados" do wizard). SEM profissionalNome de propósito: quem atende
  // não é informação do fluxo público — a cliente pode nem ter escolhido
  // (encaixe automático), e o /admin é o único que mostra esse trecho.
  const resumo = montarResumoAgendamento({
    nomeCliente,
    servicoNome,
    data,
    horario,
  });

  async function copiarChavePix() {
    try {
      await navigator.clipboard.writeText(estabelecimento.sinal_chave_pix ?? "");
      setChavePixCopiada(true);
      setTimeout(() => setChavePixCopiada(false), 2000);
    } catch {
      // Clipboard indisponível (permissão negada, contexto não seguro etc.):
      // a chave já está visível na tela pra copiar manualmente.
    }
  }

  // Falha de upload NUNCA trava o fluxo: o comprovante é um anexo opcional, e
  // a cliente continua podendo marcar a caixa. Por isso todo erro aqui vira só
  // uma mensagem avisando que o anexo não foi (e sugerindo mandar pelo
  // WhatsApp), sem mexer no checkbox nem no status.
  //
  // Já o upload que DÁ CERTO conta como declaração de pagamento: chama
  // marcarPendente logo depois de gravar o caminho na linha (ver
  // marcarPendente). Se esse segundo update falhar, o comprovante enviado
  // continua em tela e no banco — a cliente só vê o "Tentar novamente" do
  // erro de status, sem perder o arquivo que já subiu.
  async function handleComprovanteChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setErroComprovante("");

    if (!agendamentoId) {
      setErroComprovante(
        "Não foi possível anexar o comprovante agora. Você pode enviá-lo pelo WhatsApp."
      );
      return;
    }

    setEnviandoComprovante(true);

    // Imagem passa pelo canvas (foto de celular costuma ter vários MB); PDF
    // sobe como veio. Falha de compressão devolve o original, nunca lança.
    const arquivo = await comprimirImagem(file);

    // Passo NOVO antes do upload: pedir pro servidor o caminho e o token
    // assinado. Vai o type e o name do arquivo COMPRIMIDO (não do original):
    // comprimirImagem devolve JPEG quando comprime, e é a extensão do retorno
    // que tem que bater com o que sobe. O `name` é o fallback do Android que
    // manda `type` vazio (arquivo escolhido num gerenciador de arquivos).
    let autorizacao;
    try {
      const resposta = await fetch(ROTA_ASSINAR_UPLOAD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agendamentoId,
          contentType: arquivo.type,
          nomeArquivo: arquivo.name,
        }),
      });

      if (!resposta.ok) {
        setEnviandoComprovante(false);
        // Os dois únicos erros com explicação própria. 409 é o estado da
        // reserva (já confirmada, cancelada, salão inativo): insistir em
        // anexar não resolve, falar com o salão sim. 400 é o arquivo: a
        // cliente escolheu algo que não é foto nem PDF e pode tentar de novo
        // com outro. Qualquer outro status cai no genérico de sempre.
        setErroComprovante(
          resposta.status === 409
            ? "Esta reserva não aceita mais o envio de comprovante. Fale com o salão pelo WhatsApp."
            : resposta.status === 400
              ? "Envie uma foto (JPG, PNG) ou um PDF do comprovante."
              : ERRO_ANEXO_GENERICO
        );
        return;
      }

      autorizacao = await resposta.json();
    } catch {
      setEnviandoComprovante(false);
      setErroComprovante(ERRO_ANEXO_GENERICO);
      return;
    }

    const { caminho, token, contentType } = autorizacao ?? {};

    if (!caminho || !token) {
      setEnviandoComprovante(false);
      setErroComprovante(ERRO_ANEXO_GENERICO);
      return;
    }

    // `upsert` NÃO entra aqui: no uploadToSignedUrl a opção é ignorada — quem
    // carrega a permissão de sobrescrever é o token (ver a rota). O
    // contentType cai no canônico devolvido pela rota quando o navegador não
    // soube dizer o tipo, que é o caso do Android acima — e é também o que o
    // allowed_mime_types do bucket vai conferir.
    const { error: erroUpload } = await supabase.storage
      .from(BUCKET_COMPROVANTES)
      .uploadToSignedUrl(caminho, token, arquivo, {
        contentType: arquivo.type || contentType,
      });

    if (erroUpload) {
      setEnviandoComprovante(false);
      setErroComprovante(ERRO_ANEXO_GENERICO);
      return;
    }

    // Mesmo motivo do `false` em marcarPendente: o arquivo até subiu no
    // bucket, mas se a linha não recebeu o caminho ninguém no /admin vai
    // achar o comprovante — não pode passar por enviado.
    //
    // A RPC valida que `caminho` segue o padrão '<id>/comprovante.<ext>' pro
    // ESTE agendamento; qualquer outro valor volta false sem gravar. Virou
    // segunda trava em vez de única: o caminho que chega aqui já foi montado
    // pela rota que assinou o upload, e não mais pelo navegador. Quem
    // carimba `comprovante_pix_enviado_em` agora é o now() do banco — o
    // `enviadoEm` local abaixo serve só pro callback da tela, que é
    // informativo.
    const { data: anexado, error: erroUpdate } = await supabase.rpc(
      "agendamento_anexar_comprovante",
      { p_id: agendamentoId, p_caminho: caminho }
    );

    const enviadoEm = new Date().toISOString();

    setEnviandoComprovante(false);

    if (erroUpdate || anexado !== true) {
      setErroComprovante(
        "Não foi possível salvar o comprovante. Você pode enviá-lo pelo WhatsApp."
      );
      return;
    }

    setNomeComprovante(file.name);
    onComprovanteEnviado?.(caminho, enviadoEm);

    // Comprovante no lugar = pagamento declarado. Marca a caixa junto (o
    // wizard lê esse valor no submit) e muda o status.
    onSinalDeclaradoChange?.(true);
    await marcarPendente();
  }

  return (
    // Fragmento, não um wrapper: o resumo é uma caixa cinza IRMÃ do bloco
    // âmbar, não parte dele — o âmbar é só o aviso do Pix. Os dois pais
    // (wizard e ConfirmacaoSinal) empilham por space-y no container deles, que
    // é o que separa as duas caixas.
    <>
      {resumo && (
        <p className="rounded-lg bg-surface px-3 py-2 text-sm text-body">
          {resumo}
        </p>
      )}

      <div className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <div>
          <p className="text-base font-medium text-amber-800">
            {`Este agendamento exige um sinal de ${formatarPreco(valorExibido)} via Pix para confirmar a reserva.`}
          </p>
          <p className="mt-1 text-base font-medium text-amber-800">
            {`Anexe o comprovante abaixo ou aperte o botão verde do WhatsApp${nomeProfissionalContato === "a equipe" ? "" : ` com o nome ${nomeProfissionalContato}`} e envie o comprovante do Pix.`}
          </p>
          <p className="mt-1 text-base font-medium text-amber-800">
            O profissional irá confirmar seu agendamento.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 ring-1 ring-border">
          <span className="min-w-0 flex-1 truncate text-sm text-on-card">
            {estabelecimento.sinal_chave_pix}
          </span>
          <button
            type="button"
            onClick={copiarChavePix}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition hover:bg-primary-hover"
          >
            {chavePixCopiada ? "Copiado!" : "Copiar chave"}
          </button>
        </div>

        {/* Upload do comprovante. Dois botões, um por tipo de arquivo, cada um
            disparando o SEU input escondido (ver inputImagemRef/inputPdfRef):
            os dois caem no mesmo handleComprovanteChange, o que muda é só o
            accept do seletor nativo. Reenviar é permitido (upsert no mesmo
            caminho) — a cliente que mandou o print errado só escolhe outro
            arquivo. */}
        <div className="rounded-lg bg-card px-3 py-2 ring-1 ring-border">
          <input
            ref={inputImagemRef}
            type="file"
            accept="image/*"
            onChange={handleComprovanteChange}
            disabled={enviandoComprovante}
            className="hidden"
          />
          <input
            ref={inputPdfRef}
            type="file"
            accept="application/pdf"
            onChange={handleComprovanteChange}
            disabled={enviandoComprovante}
            className="hidden"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputImagemRef.current?.click()}
              disabled={enviandoComprovante}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviandoComprovante ? "Enviando..." : "Enviar print/foto"}
            </button>
            <button
              type="button"
              onClick={() => inputPdfRef.current?.click()}
              disabled={enviandoComprovante}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Enviar PDF
            </button>
          </div>

          <p className="mt-1.5 min-w-0 truncate text-sm text-on-card">
            {nomeComprovante || "Imagem ou PDF (opcional)"}
          </p>

          {nomeComprovante && !erroComprovante && (
            <p className="mt-1.5 text-sm text-green-700">
              Comprovante anexado com sucesso.
            </p>
          )}
          {erroComprovante && (
            <p className="mt-1.5 text-sm text-red-700">{erroComprovante}</p>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm text-amber-900">
          <input
            type="checkbox"
            checked={sinalDeclarado}
            onChange={(e) => handleSinalDeclaradoChange(e.target.checked)}
            disabled={!agendamentoId || marcandoPendente}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
          />
          Enviei o comprovante pelo WhatsApp
        </label>

        {/* Erro do update de status — o único dos dois erros deste bloco que
            precisa de retentativa em tela: sem ele o agendamento continua em
            "aguardando_sinal" e a solicitação não chega pro salão. O gesto da
            cliente (caixa marcada, comprovante anexado) fica intacto. */}
        {erroStatus && (
          <div className="rounded-lg bg-red-50 px-3 py-2 ring-1 ring-red-100">
            <p className="text-sm text-red-700">{erroStatus}</p>
            <button
              type="button"
              onClick={marcarPendente}
              disabled={marcandoPendente}
              className="mt-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {marcandoPendente ? "Enviando..." : "Tentar novamente"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
