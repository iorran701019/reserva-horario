"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessaoAdmin } from "@/hooks/useSessaoAdmin";
import AbaCrm, { VISOES_CRM } from "./crm/AbaCrm";
import AbaAgenda from "./AbaAgenda";
import AbaAuditoria from "./AbaAuditoria";
import AbaFinanceiro from "./AbaFinanceiro";
import AbaSeguranca from "./AbaSeguranca";
import MenuSuspenso from "./MenuSuspenso";
import TelaSessao, { limparTrava } from "./TelaSessao";

// Shell único do /painel-global: guarda de acesso (login + papel 'global'),
// e a barra de navegação (dois menus suspensos) entre as três abas. CRM, Agenda e
// Auditoria não repetem NADA disso — chegar a qualquer uma delas já significa
// sessão válida com papel 'global'.
//
// CRM é a aba padrão: é o que abre ao entrar no painel, sem navegação extra.
const ABAS = [
  { id: "crm", rotulo: "CRM" },
  { id: "agenda", rotulo: "Agenda" },
  { id: "auditoria", rotulo: "Auditoria" },
  { id: "financeiro", rotulo: "Financeiro" },
  { id: "seguranca", rotulo: "Segurança" },
];

const ABA_PADRAO = "crm";

// Largura máxima por aba: o CRM (quadro de colunas) precisa da tela inteira,
// a Auditoria mantém a coluna estreita que sempre teve, a Agenda fica no meio
// (o calendário se vira em qualquer largura). Cada aba já centraliza o próprio
// conteúdo, então isto vale só pro cabeçalho/nav ficarem alinhados com ela.
const LARGURA_ABA = {
  crm: "max-w-7xl",
  agenda: "max-w-5xl",
  auditoria: "max-w-2xl",
  financeiro: "max-w-5xl",
  seguranca: "max-w-2xl",
};

export default function HubPainelGlobal({ abaInicial }) {
  const router = useRouter();

  // Sem `salon`: useSessaoAdmin não redireciona sozinho quando não há sessão
  // (ver hooks/useSessaoAdmin.js) — esta página decide o que renderizar em
  // cada estado, sem sair do próprio /painel-global.
  const { autenticado, perfil } = useSessaoAdmin();

  // Chegar ao painel encerra a ida e volta da TelaSessao: limpa a marca do
  // sessionStorage e o `recarga=1` da URL (trava de reserva), sem recarregar.
  useEffect(() => {
    limparTrava();
    const url = new URL(window.location.href);
    if (!url.searchParams.has("recarga")) return;
    url.searchParams.delete("recarga");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  // `abaInicial` vem do ?aba= lido no servidor (ver page.js) — é o que faz o
  // redirect de /painel-global/crm cair direto na aba certa. Valor
  // desconhecido cai no padrão, sem tela de erro.
  const [aba, setAba] = useState(
    ABAS.some((item) => item.id === abaInicial) ? abaInicial : ABA_PADRAO
  );

  // Sub-navegação do CRM mora aqui, e não na AbaCrm, porque o menu da direita
  // (na barra do shell) é quem troca a visão e abre o "+ Novo lead".
  const [visaoCrm, setVisaoCrm] = useState("quadro");
  const [novoLeadAberto, setNovoLeadAberto] = useState(false);
  const [perdidosCrm, setPerdidosCrm] = useState(null);
  // Filtro de cidade do CRM: o botão fica na barra (não empurra a grade do
  // Quadro), o painel com os chips é da AbaCrm. Não persiste entre sessões.
  const [cidadesFiltroCrm, setCidadesFiltroCrm] = useState([]);
  const [filtroCidadeAberto, setFiltroCidadeAberto] = useState(false);
  const fecharFiltroCidade = useCallback(() => setFiltroCidadeAberto(false), []);

  const autorizado = perfil?.papel === "global";

  function trocarAba(id) {
    setAba(id);
    // URL acompanha a aba (link compartilhável e voltar do navegador). Não é
    // a fonte da verdade do render — `aba` é —, então basta um replace.
    router.replace(`/painel-global?aba=${id}`, { scroll: false });
  }

  // "Sair" saiu da UI temporariamente (reforma da barra compacta); quando
  // voltar, é supabase.auth.signOut() — o onAuthStateChange cuida do resto.

  // Ainda verificando a sessão (getSession inicial não voltou).
  if (autenticado === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  // Sem sessão (nunca houve, ou caiu em outra aba): o login mora na
  // TelaSessao, que não depende do hub. Entrando, ela volta a /painel-global e
  // o servidor (ver page.js) libera o painel.
  if (autenticado === false) {
    return <TelaSessao motivo="sem-sessao" />;
  }

  // Autenticado, mas o perfil ainda não voltou (undefined) — mesma tela de
  // carregamento de cima, não "Acesso restrito.": senão uma conta 'global'
  // genuína vê um flash de acesso negado entre o login e o perfil chegar.
  if (perfil === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <p className="text-sm text-body">Carregando...</p>
      </main>
    );
  }

  // Perfil já resolvido, mas sem papel 'global' — inclui conta órfã
  // (perfil null). Sem redirect, só troca de tela.
  if (!autorizado) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <h1 className="text-2xl font-bold text-heading">Acesso restrito.</h1>
        </div>
      </main>
    );
  }

  // Menu da direita: só existe onde há sub-navegação. Agenda não tem nenhuma,
  // e as sub-abas da Auditoria (com o seletor de salão) ficam dentro do
  // próprio conteúdo — então, fora do CRM, o menu é omitido.
  // "Perdidos (n)" no item e, quando é a visão ativa, no botão também. A
  // contagem chega da AbaCrm depois de carregar os leads.
  const rotuloVisaoCrm = (v) =>
    v.id === "perdidos" && perdidosCrm !== null ? `${v.rotulo} (${perdidosCrm})` : v.rotulo;

  const menuDireita =
    aba === "crm" ? (
      <MenuSuspenso
        alinhar="direita"
        rotulo={rotuloVisaoCrm(VISOES_CRM.find((v) => v.id === visaoCrm))}
        itens={[
          { id: "novo-lead", rotulo: "+ Novo lead", onSelecionar: () => setNovoLeadAberto(true) },
          ...VISOES_CRM.map((v) => ({
            id: v.id,
            rotulo: rotuloVisaoCrm(v),
            ativo: v.id === visaoCrm,
            onSelecionar: () => setVisaoCrm(v.id),
          })),
        ]}
      />
    ) : null;

  return (
    <main className="min-h-screen bg-surface px-4 py-3">
      <nav className={`hub-barra mx-auto flex gap-2 ${LARGURA_ABA[aba]}`}>
        {/* Rótulo fixo de propósito: a seção ativa aparece no destaque do item. */}
        <MenuSuspenso
          rotulo="Painel Global"
          itens={ABAS.map((item) => ({
            id: item.id,
            rotulo: item.rotulo,
            ativo: aba === item.id,
            onSelecionar: () => trocarAba(item.id),
          }))}
        />
        {aba === "crm" && visaoCrm !== "tipos" && (
          <button
            type="button"
            data-filtro-cidade-botao
            onClick={() => setFiltroCidadeAberto((a) => !a)}
            aria-expanded={filtroCidadeAberto}
            title="Filtrar por cidade"
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ring-1 transition ${
              cidadesFiltroCrm.length
                ? "bg-primary text-white ring-primary"
                : "bg-card text-heading ring-border hover:ring-primary/40"
            }`}
          >
            {cidadesFiltroCrm.length ? `Cidades (${cidadesFiltroCrm.length})` : "Cidades"}
          </button>
        )}
        {menuDireita}
      </nav>

      {/* Uma aba por vez, sem montar as outras: cada uma carrega os próprios
          dados no mount, e manter as três vivas dispararia query à toa. */}
      {aba === "crm" && (
        <AbaCrm
          visao={visaoCrm}
          novoLeadAberto={novoLeadAberto}
          onFecharNovoLead={() => setNovoLeadAberto(false)}
          onContagemPerdidos={setPerdidosCrm}
          cidadesFiltro={cidadesFiltroCrm}
          onCidadesFiltro={setCidadesFiltroCrm}
          filtroCidadeAberto={filtroCidadeAberto}
          onFecharFiltroCidade={fecharFiltroCidade}
        />
      )}
      {aba === "agenda" && (
        <div className="mx-auto max-w-5xl">
          <AbaAgenda />
        </div>
      )}
      {aba === "auditoria" && <AbaAuditoria />}
      {aba === "financeiro" && <AbaFinanceiro />}
      {aba === "seguranca" && <AbaSeguranca />}
    </main>
  );
}
