const reminderKey = (personId = "me") => `polumya:shift-reminder:${personId}`;
export function isPushSupported() { return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator; }
export function isReminderEnabled(personId = "me") { return localStorage.getItem(reminderKey(personId)) === "true"; }
export async function enableShiftReminder(person = {}) {
  if (!isPushSupported()) throw new Error("Сповіщення не підтримуються на цьому пристрої");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Дозвіл на сповіщення не надано");
  localStorage.setItem(reminderKey(person.id), "true");
  return true;
}
export async function disableShiftReminder(personId = "me") { localStorage.removeItem(reminderKey(personId)); return true; }
