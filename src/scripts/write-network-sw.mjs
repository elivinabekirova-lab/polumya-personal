import { writeFileSync, existsSync } from "node:fs";

if (!existsSync("dist")) {
  throw new Error("Папка dist не знайдена. Спочатку має виконатися vite build.");
}

const serviceWorker = `
const VERSION = "${Date.now()}";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      await self.clients.claim();

      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });

      for (const client of windows) {
        try {
          await client.navigate(client.url);
        } catch {}
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() =>
        fetch("/index.html", { cache: "no-store" })
      )
    );
    return;
  }

  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
`;

writeFileSync("dist/sw.js", serviceWorker, "utf8");
console.log("✅ Service Worker очищає старий кеш і завжди бере нову версію");
