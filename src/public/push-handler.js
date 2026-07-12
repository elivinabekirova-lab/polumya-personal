self.addEventListener("push", (event) => {
  let data = {
    title: "Полум’я та Підгір’я",
    body: "Не забудь відмітити свою зміну.",
    url: "/"
  };

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch {
    // Використовуємо стандартний текст.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/notification-icon.svg",
      badge: "/notification-icon.svg",
      tag: "daily-shift-reminder",
      renotify: false,
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((windows) => {
      const existing = windows.find((client) =>
        client.url.includes(self.location.origin)
      );

      if (existing) {
        existing.focus();
        return existing.navigate(targetUrl);
      }

      return clients.openWindow(targetUrl);
    })
  );
});
