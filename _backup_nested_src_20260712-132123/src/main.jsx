import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

import { registerSW } from "virtual:pwa-register";

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