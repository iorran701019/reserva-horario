import { redirect } from "next/navigation";

// O CRM virou aba do hub (ver ../HubPainelGlobal). Esta rota fica só como
// redirect: o link /painel-global/crm circulou por aí (header antigo do
// painel, favorito, conversa) e quebrar não custa menos do que estas 3 linhas.
export default function CrmRedirect() {
  redirect("/painel-global?aba=crm");
}
