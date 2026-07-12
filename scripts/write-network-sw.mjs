import { writeFileSync, existsSync } from "node:fs";

if (!existsSync("dist")) throw new Error("Папка dist не знайдена");

const serviceWorker = `
const VERSION = "${Date.now()}";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "Нове оголошення" }; }

  const title = payload.title || "Полум’я та Підгір’я";
  const options = {
    body: payload.body || "Нове оголошення для персоналу",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/notification-icon.svg",
    tag: payload.tag || "polumya-announcement",
    renotify: true,
    silent: false,
    vibrate: [250, 120, 250, 120, 400],
    data: { url: payload.url || "/?section=announcements" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.navigate(targetUrl).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => fetch("/index.html", { cache: "no-store" })));
    return;
  }
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
`;

writeFileSync("dist/sw.js", serviceWorker, "utf8");
console.log("✅ Service Worker: push, звук та оновлення увімкнено");
