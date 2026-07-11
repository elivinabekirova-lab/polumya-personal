import { supabase } from "./supabase.js";

const VAPID_PUBLIC_KEY = "BIlDEhw_ERRznX4Nuld5TX8WeVxiyYPTsRg8IOMRd0A2k-NXL48X7rWJABPO-7bxzEdGsliqRC7-9t0eVqAYtJc";
const LOCAL_KEY_PREFIX = "flame:push-enabled:";

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const raw = window.atob(base64);

  return Uint8Array.from(
    [...raw].map((character) => character.charCodeAt(0))
  );
}

export function isPushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isReminderEnabled(employeeId) {
  return (
    window.localStorage.getItem(
      LOCAL_KEY_PREFIX + employeeId
    ) === "true"
  );
}

export async function enableShiftReminder(employee) {
  if (!isPushSupported()) {
    throw new Error(
      "На iPhone спочатку додай застосунок на початковий екран, відкрий його через іконку та повтори."
    );
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error(
      "Сповіщення не дозволені. Дозволь їх у налаштуваннях телефону."
    );
  }

  const registration = await navigator.serviceWorker.register(
    "/sw.js",
    { scope: "/" }
  );

  await navigator.serviceWorker.ready;

  let subscription =
    await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey:
        urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }

  const payload = {
    endpoint: subscription.endpoint,
    employee_id: employee.id,
    employee_name: employee.name,
    subscription: subscription.toJSON(),
    timezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "Europe/Kyiv",
    enabled: true,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(payload, { onConflict: "endpoint" });

  if (error) throw error;

  window.localStorage.setItem(
    LOCAL_KEY_PREFIX + employee.id,
    "true"
  );

  return true;
}

export async function disableShiftReminder(employeeId) {
  const registration =
    await navigator.serviceWorker.getRegistration("/");

  const subscription =
    await registration?.pushManager.getSubscription();

  if (subscription) {
    await supabase
      .from("push_subscriptions")
      .update({
        enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq("endpoint", subscription.endpoint);

    await subscription.unsubscribe();
  }

  window.localStorage.removeItem(
    LOCAL_KEY_PREFIX + employeeId
  );
}
