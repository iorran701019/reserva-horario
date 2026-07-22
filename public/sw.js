// Service worker de push notifications do /admin. Registrado por
// components/AtivarNotificacoes.js (navigator.serviceWorker.register('/sw.js')).
// Sem cache/offline aqui — o único trabalho é receber pushes e abrir/focar a
// aba do admin do salão relevante ao clicar na notificação.

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch (erro) {
    dados = { title: "Nova notificação", body: event.data ? event.data.text() : "" };
  }

  const titulo = dados.title || "Nova notificação";
  const opcoes = {
    body: dados.body || "",
    icon: dados.icon || "/file.svg",
    data: { url: dados.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((listaClientes) => {
        const origem = self.location.origin;
        const abaExistente = listaClientes.find((c) => c.url.startsWith(origem));

        if (abaExistente) {
          if ("navigate" in abaExistente) abaExistente.navigate(url);
          return abaExistente.focus();
        }

        return clients.openWindow(url);
      })
  );
});
