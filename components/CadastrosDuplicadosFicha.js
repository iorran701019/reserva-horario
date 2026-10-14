"use client";

// Seção "Cadastros duplicados" da ficha do cliente (DetalheCliente). Só
// renderiza (nem título) se o cliente estiver em algum destes estados:
//   a) Em conflito: a regra de duplicidade (acharPossiveisDuplicados) acha
//      outro cadastro e não há decisão registrada → "Resolver" abre o
//      ModalResolverDuplicidade. Respeita o interruptor da dona
//      (aviso_possivel_duplicidade_ativo), como a caixa dos Pendentes.
//   b) Juntado: este cliente é o mantido de uma união ativa (ListaUnioes) →
//      "Desfazer".
//   c) Mantido separado: par em clientes_dispensadas → "Resolver novamente"
//      (abre o mesmo popup do Resolver, com as duas opções).
// Um par nunca aparece em dois estados: (a) exclui as dispensadas pela própria
// regra, e o absorvido de (b) está na lixeira (fora da lista de clientes).
// Uniões desfeitas não aparecem. O estado mostrado vem sempre do banco, relido
// depois de cada ação.
//
// Props:
//   estabelecimento   – registro do salão (id, fidelidade_ativa, interruptor).
//   cliente           – { id, nome, whatsapp } da ficha.
//   anamneseAtiva     – existe modelo de anamnese ativo (null = resolvendo).
//   msgContatoAdmin   – texto-base do WhatsApp para o cadastro do par.
//   onAlterado        – () => void, DEPOIS de resolver/desfazer (quem monta
//                       refaz resumo, agendamentos etc.).
//   onSaiuDaLista     – () => void, se depois da releitura este cadastro
//                       deixou de existir (foi o absorvido de uma junção).
import { useEffect, useRef, useState } from "react";
import ListaUnioes from "@/components/ListaUnioes";
import ModalResolverDuplicidade from "@/components/ModalResolverDuplicidade";
import IconeWhatsApp from "@/components/IconeWhatsApp";
import {
  buscarClientesParaDuplicidade,
  buscarDispensadasDuplicidade,
} from "@/lib/clientesAdmin";
import { acharPossiveisDuplicados } from "@/lib/duplicidadeCliente";
import {
  formatarWhatsappExibicao,
  linkWhatsApp,
  MENSAGEM_CONTATO_CLIENTE_ADMIN,
} from "@/lib/whatsapp";

function PilulaWhatsapp({ cadastro, msgContatoAdmin }) {
  if (!cadastro.whatsapp) return null;
  return (
    <a
      href={linkWhatsApp(
        cadastro.whatsapp,
        MENSAGEM_CONTATO_CLIENTE_ADMIN(cadastro, msgContatoAdmin)
      )}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200 transition hover:bg-green-100"
    >
      <IconeWhatsApp className="h-3.5 w-3.5" />
      {formatarWhatsappExibicao(cadastro.whatsapp) ?? cadastro.whatsapp}
    </a>
  );
}

export default function CadastrosDuplicadosFicha({
  estabelecimento,
  cliente,
  anamneseAtiva,
  msgContatoAdmin,
  onAlterado,
  onSaiuDaLista,
}) {
  const [clientes, setClientes] = useState(null); // null = carregando
  const [dispensadas, setDispensadas] = useState(null);
  const [versaoUnioes, setVersaoUnioes] = useState(0);
  const [contagemUnioes, setContagemUnioes] = useState(0);
  const [resolvendo, setResolvendo] = useState(null); // id do outro cadastro

  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // Relê clientes e dispensadas. Devolve a lista nova (ou null se desmontou)
  // para quem precisa conferir se este cadastro ainda existe.
  async function recarregar() {
    const [lista, pares] = await Promise.all([
      buscarClientesParaDuplicidade(estabelecimento.id),
      buscarDispensadasDuplicidade(estabelecimento.id),
    ]);
    if (!montadoRef.current) return null;
    setClientes(lista);
    setDispensadas(pares);
    return lista;
  }

  useEffect(() => {
    setClientes(null);
    setDispensadas(null);
    recarregar();
  }, [estabelecimento.id, cliente.id, cliente.nome, cliente.whatsapp]);

  // Depois de qualquer ação concluída no banco: relê as três fontes e avisa a
  // ficha/página. `releituraUnioes` = a lista de uniões precisa ser relida por
  // aqui (o Desfazer da própria ListaUnioes já faz isso sozinho).
  async function aposAcao({ releituraUnioes }) {
    if (releituraUnioes) setVersaoUnioes((v) => v + 1);
    const lista = await recarregar();
    onAlterado?.();
    if (lista && lista.length > 0 && !lista.some((c) => c.id === cliente.id)) {
      onSaiuDaLista?.();
    }
  }

  const avisoAtivo = estabelecimento?.aviso_possivel_duplicidade_ativo !== false;

  const conflitos =
    avisoAtivo && clientes && dispensadas
      ? acharPossiveisDuplicados({
          id: cliente.id,
          nome: cliente.nome,
          telefone: cliente.whatsapp,
          clientes,
          dispensadas,
        })
      : [];

  // Pares dispensados que envolvem este cliente; o outro lado precisa estar
  // na lista (fora da lixeira) para ter nome e número.
  const separados = [];
  if (clientes && dispensadas) {
    const proprio = String(cliente.id);
    for (const chave of dispensadas) {
      const [a, b] = chave.split(":");
      if (a !== proprio && b !== proprio) continue;
      const outroId = a === proprio ? b : a;
      const outro = clientes.find((c) => String(c.id) === outroId);
      if (outro) separados.push(outro);
    }
  }

  const temConteudo =
    conflitos.length > 0 || separados.length > 0 || contagemUnioes > 0;

  return (
    <>
      {/* ListaUnioes fica sempre montada: só ela sabe se há união ativa, e o
          popup de resultado do Desfazer vive dentro dela. */}
      <div className={temConteudo ? "rounded-xl bg-surface p-3 ring-1 ring-border" : undefined}>
        {temConteudo && (
          <h3 className="text-sm font-semibold text-heading">Cadastros duplicados</h3>
        )}

        <div className={temConteudo ? "mt-2 space-y-2" : undefined}>
          {conflitos.map((outro) => (
            <div
              key={`conflito-${outro.id}`}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border"
            >
              <div className="min-w-[10rem] flex-1">
                <p className="break-words text-body">
                  Também cadastrado como{" "}
                  <span className="font-medium text-heading">{outro.nome}</span>
                </p>
                <div className="mt-1">
                  <PilulaWhatsapp cadastro={outro} msgContatoAdmin={msgContatoAdmin} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResolvendo(outro.id)}
                disabled={anamneseAtiva === null}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Resolver
              </button>
            </div>
          ))}

          <ListaUnioes
            estabelecimentoId={estabelecimento.id}
            mantidoId={cliente.id}
            versao={versaoUnioes}
            onContagem={setContagemUnioes}
            onDesfeita={() => aposAcao({ releituraUnioes: false })}
          />

          {separados.map((outro) => (
            <div
              key={`separado-${outro.id}`}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border"
            >
              <div className="min-w-[10rem] flex-1">
                <p className="break-words text-body">
                  Você marcou este cadastro como diferente de{" "}
                  <span className="font-medium text-heading">{outro.nome}</span>
                </p>
                <div className="mt-1">
                  <PilulaWhatsapp cadastro={outro} msgContatoAdmin={msgContatoAdmin} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResolvendo(outro.id)}
                disabled={anamneseAtiva === null}
                className="shrink-0 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-body ring-1 ring-border transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
              >
                Resolver novamente
              </button>
            </div>
          ))}
        </div>
      </div>

      {resolvendo != null && anamneseAtiva !== null && (
        <ModalResolverDuplicidade
          estabelecimentoId={estabelecimento.id}
          fidelidadeAtiva={estabelecimento.fidelidade_ativa === true}
          anamneseAtiva={anamneseAtiva}
          idA={cliente.id}
          idB={resolvendo}
          onConcluido={async () => {
            setResolvendo(null);
            await aposAcao({ releituraUnioes: true });
          }}
          onFechar={() => setResolvendo(null)}
          onWhatsapp={(nome, telefone) => {
            window.open(
              linkWhatsApp(
                telefone,
                MENSAGEM_CONTATO_CLIENTE_ADMIN({ nome }, msgContatoAdmin)
              ),
              "_blank",
              "noopener,noreferrer"
            );
          }}
        />
      )}
    </>
  );
}
