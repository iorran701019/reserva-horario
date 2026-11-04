import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { autorizarGlobal } from "@/lib/apiAuth";
import HubPainelGlobal from "./HubPainelGlobal";

// Barreira do /painel-global: o HTML/JS do painel só é entregue a quem tem
// access token válido E papel 'global'. Qualquer outro caso é redirecionado
// (redirect() de Server Component, 307) para /painel-global/entrar, rota à
// parte que só renderiza a TelaSessao — o Hub fica fora do pacote dela.
//
// Regra de desenho: o servidor SÓ LÊ. Nunca renova token, nunca grava cookie
// (Server Component nem pode — ver docs de `cookies`). Token vencido ou
// dúvida → /entrar, e é o navegador (createBrowserClient) que renova o
// token sozinho e recarrega a página. Assim o servidor não disputa o refresh
// token com o navegador (rotação) e nenhuma sessão aberta cai.
//
// `searchParams` é Promise desde o Next 15 — precisa de await. Ler aqui, pela
// prop da page, evita useSearchParams (e <Suspense>) dentro do hub.

// Cookie de sessão do @supabase/ssr: `sb-<ref>-auth-token`, ou em pedaços
// `sb-<ref>-auth-token.0`, `.1`… quando o valor passa de ~3180 caracteres.
// Padrão (e não o nome montado pela URL) pra não divergir entre staging e
// produção.
const PADRAO_COOKIE = /^(sb-.+-auth-token)(?:\.(\d+))?$/;

// Teto de candidatos testados por requisição: cada um custa uma ida ao Auth do
// Supabase, e o nome do cookie vem do cliente.
const MAX_CANDIDATOS = 3;

// Junta o valor de um cookie: o nome exato tem prioridade; senão, os pedaços
// .0, .1… em ordem, até a primeira lacuna (mesma regra do combineChunks do
// @supabase/ssr).
function juntarValor(base, porNome) {
  if (porNome.has(base)) return porNome.get(base);
  let valor = "";
  for (let i = 0; porNome.has(`${base}.${i}`); i += 1) {
    valor += porNome.get(`${base}.${i}`);
  }
  return valor || null;
}

// Aceita valor com prefixo `base64-` (codificação padrão do browser client
// 0.12.0) e sem prefixo (JSON cru). Qualquer falha → null.
function extrairAccessToken(valor) {
  try {
    const texto = valor.startsWith("base64-")
      ? Buffer.from(valor.slice("base64-".length), "base64url").toString("utf8")
      : valor;
    const token = JSON.parse(texto)?.access_token;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

// Devolve { ok: true } só para papel global com token válido.
// Senão { ok: false, motivo }: "restrito" quando há token válido de quem não é
// global (403 de autorizarGlobal), "sem-sessao" em todo o resto.
async function autorizarPeloCookie() {
  const todos = (await cookies()).getAll();
  const porNome = new Map();
  const bases = [];
  for (const { name, value } of todos) {
    const m = PADRAO_COOKIE.exec(name);
    if (!m) continue;
    porNome.set(name, value);
    if (!bases.includes(m[1])) bases.push(m[1]);
  }

  let motivo = "sem-sessao";
  for (const base of bases.slice(0, MAX_CANDIDATOS)) {
    const valor = juntarValor(base, porNome);
    const token = valor && extrairAccessToken(valor);
    if (!token) continue;

    // Reaproveita a regra das rotas de API (getUser + perfis.papel com o
    // token do usuário). Ela lê o Bearer de um Request; monta-se um local,
    // sem tocar em lib/apiAuth.js. O token não sai daqui nem é logado.
    const resultado = await autorizarGlobal(
      new Request("http://localhost", { headers: { authorization: `Bearer ${token}` } })
    );
    if (resultado.ok) return { ok: true };
    if (resultado.status === 403) motivo = "restrito";
  }
  return { ok: false, motivo };
}

export default async function PainelGlobalPage({ searchParams }) {
  const { aba, recarga } = await searchParams;
  const autorizacao = await autorizarPeloCookie();

  if (!autorizacao.ok) {
    // Preserva ?aba= (a dona volta pra mesma aba), repassa a trava de reserva
    // `recarga=1` (ver TelaSessao) e o motivo. redirect() lança, então fica
    // fora de qualquer try/catch.
    const params = new URLSearchParams();
    if (typeof aba === "string" && aba) params.set("aba", aba);
    if (recarga === "1") params.set("recarga", "1");
    if (autorizacao.motivo === "restrito") params.set("motivo", "restrito");
    const qs = params.toString();
    redirect(qs ? `/painel-global/entrar?${qs}` : "/painel-global/entrar");
  }

  return <HubPainelGlobal abaInicial={typeof aba === "string" ? aba : undefined} />;
}
