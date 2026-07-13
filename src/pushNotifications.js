import { supabase } from "./supabase.js";

const reminderKey = (personId = "me") => `polumya:push-enabled:${personId}`;

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function isReminderEnabled(personId = "me") {
  return localStorage.getItem(reminderKey(personId)) === "true";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export async function enableShiftReminder(person = {}) {
  if (!isPushSupported()) {
    throw new Error("Сповіщення не підтримуються. На iPhone відкрий застосунок з іконки на головному екрані.");
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) throw new Error("Не налаштовано ключ сповіщень");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Дозвіл на сповіщення не надано");

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const { data, error } = await supabase.functions.invoke("register-push", {
    body: {
      action: "upsert",
      employeeId: String(person.id || person.userId || "device"),
      employeeName: String(person.name || "Працівник"),
      point: String(person.point || ""),
      subscription: subscription.toJSON(),
    },
  });

  if (error || !data?.ok) {
    throw new Error(data?.error || error?.message || "Не вдалося зареєструвати телефон");
  }

  localStorage.setItem(reminderKey(person.id || person.userId), "true");
  return true;
}

export async function disableShiftReminder(personId = "me") {
  if (isPushSupported()) {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await supabase.functions.invoke("register-push", {
        body: { action: "disable", endpoint: subscription.endpoint },
      });
    }
  }
  localStorage.removeItem(reminderKey(personId));
  return true;
}
