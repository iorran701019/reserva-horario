import TelaSessao from "../TelaSessao";

// Rota separada de /painel-global de propósito: o import estático do Hub em
// painel-global/page.js põe o Hub no pacote DAQUELA rota, mesmo quando ele não
// é renderizado. Aqui só entra a TelaSessao (React + lib/supabaseClient) — nada
// que importe o Hub, as abas, useSessaoAdmin ou lib/perfil.
//
// Quem chega aqui foi mandado por painel-global/page.js (servidor, sem sessão
// liberada). `motivo=restrito` = token válido, papel não global.
export default async function EntrarPainelGlobalPage({ searchParams }) {
  const { motivo } = await searchParams;

  return <TelaSessao motivo={motivo === "restrito" ? "restrito" : "sem-sessao"} />;
}
