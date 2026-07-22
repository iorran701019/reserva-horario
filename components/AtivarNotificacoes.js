"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

// Item fixo do drawer do admin (ver app/[salon]/admin/page.js) que liga push
// notifications neste dispositivo/navegador. Só renderiza se o navegador
// suporta Service Worker + Push API — sem isso não há o que oferecer (ex.:
// Safari iOS fora de PWA instalada, navegadores antigos).
//
// Fluxo ao clicar: registra o sw (public/sw.js) → pede permissão de
// notificação → assina o push com a VAPID public key → salva a inscrição em
// `push_subscriptions`, usando o endpoint (UNIQUE) como chave de conflito
// pra não duplicar linha se o navegador já tinha uma assinatura.
//
// Props:
//   estabelecimento – { id } do salão ativo no admin (ver buscarEstabelecimento).

// Converte a VAPID public key (base64url) pro Uint8Array que
// pushManager.subscribe espera em applicationServerKey. Conversão padrão do
// ecossistema Web Push.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function AtivarNotificacoes({ estabelecimento }) {
  const [suportado, setSuportado] = useState(false);
  const [inscrito, setInscrito] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = "serviceWorker" in navigator && "PushManager" in window;
    setSuportado(ok);
    if (!ok) return;

    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((registro) => registro?.pushManager.getSubscription())
      .then(async (assinatura) => {
        if (!assinatura) {
          setInscrito(false);
          return;
        }
        // Uma subscription local no navegador não garante que ela foi
        // salva no Supabase (o upsert pode ter falhado antes). Só marca
        // como ativado se existir a linha correspondente no banco.
        const { data } = await supabase
          .from("push_subscriptions")
          .select("id")
          .eq("endpoint", assinatura.endpoint)
          .eq("ativo", true)
          .maybeSingle();
        setInscrito(!!data);
      })
      .catch(() => setInscrito(false));
  }, []);

  async function ativar() {
    setMensagem("");
    setCarregando(true);
    try {
      const registro = await navigator.serviceWorker.register("/sw.js");

      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setMensagem(
          "Permissão não concedida. Você pode ativar depois nas configurações de notificação do navegador."
        );
        return;
      }

      const assinatura = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        ),
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const json = assinatura.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          endpoint: json.endpoint,
          chave_p256dh: json.keys.p256dh,
          chave_auth: json.keys.auth,
          perfil_id: user?.id,
          estabelecimento_id: estabelecimento?.id,
          ativo: true,
        },
        { onConflict: "endpoint" }
      );
      if (error) {
        setMensagem("Não foi possível salvar a inscrição, tente novamente.");
        return;
      }

      setInscrito(true);
    } catch (erro) {
      setMensagem("Não foi possível ativar as notificações agora. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  if (!suportado) return null;

  return (
    <div className="border-t border-border p-2">
      <button
        type="button"
        onClick={inscrito ? undefined : ativar}
        disabled={carregando || inscrito}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition ${
          inscrito
            ? "cursor-default text-green-600"
            : "text-body hover:bg-surface hover:text-heading disabled:opacity-60"
        }`}
      >
        {inscrito ? (
          <BellRing className="h-5 w-5 shrink-0" />
        ) : (
          <Bell className="h-5 w-5 shrink-0" />
        )}
        {inscrito
          ? "Notificações ativadas ✓"
          : carregando
          ? "Ativando…"
          : "Ativar notificações neste dispositivo"}
      </button>
      {mensagem && <p className="px-3 pb-2 text-xs text-body">{mensagem}</p>}
    </div>
  );
}
