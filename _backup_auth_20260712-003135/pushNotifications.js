const REMINDER_KEY = "polumya:shift-reminder-enabled";

export function isPushSupported() {
  return (
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

export function isReminderEnabled() {
  return localStorage.getItem(REMINDER_KEY) === "true";
}

export async function enableShiftReminder() {
  if (!isPushSupported()) {
    throw new Error("Сповіщення не підтримуються на цьому пристрої");
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("Дозвіл на сповіщення не надано");
  }

  localStorage.setItem(REMINDER_KEY, "true");
  return true;
}

export async function disableShiftReminder() {
  localStorage.removeItem(REMINDER_KEY);
  return true;
}
