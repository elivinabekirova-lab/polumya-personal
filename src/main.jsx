import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

import { registerSW } from "virtual:pwa-register";

const PWA_RESET_VERSION = "polumya-reset-v3";

async function resetOldPwaOnce() {
  if (!("serviceWorker" in navigator)) return;

  if (localStorage.getItem(PWA_RESET_VERSION) === "done") {
    return;
  }

  try {
    const registrations =
      await navigator.serviceWorker.getRegistrations();

    await Promise.all(
      registrations.map((registration) =>
        registration.unregister()
      )
    );

    if ("caches" in window) {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames.map((cacheName) =>
          caches.delete(cacheName)
        )
      );
    }

    localStorage.setItem(PWA_RESET_VERSION, "done");

    window.location.replace(
      window.location.origin +
      window.location.pathname +
      "?updated=" +
      Date.now()
    );
  } catch (error) {
    console.error("PWA reset error", error);
  }
}

resetOldPwaOnce();


const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;

    registration.update();

    setInterval(() => {
      registration.update();
    }, 60 * 1000);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        registration.update();
      }
    });
  },
  onNeedRefresh() {
    updateSW(true);
  }
});

let reloading = false;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    }
  );
}


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)