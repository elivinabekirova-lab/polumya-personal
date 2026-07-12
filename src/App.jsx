import { useEffect, useMemo, useRef, useState } from "react";
import {
  enableShiftReminder,
  disableShiftReminder,
  isPushSupported,
  isReminderEnabled,
} from "./pushNotifications.js";
import { supabase } from "./supabase.js";

const K_STAFF = "flame:staff";
const K_SHIFTS = "flame:shifts";
const K_SETTINGS = "flame:settings";
const K_CASH = "flame:cash";
const K_PAYOUTS = "flame:payouts";
const K_RULES = "flame:rules";
const K_ME = "flame:me";
const K_ANNOUNCEMENTS = "flame:announcements";
const K_REQUESTS = "flame:requests";
const K_PLANS = "flame:plans";
const K_CLOSED_MONTHS = "flame:closedMonths";
const K_AUDIT = "flame:audit";
const AUTH_EMAIL_DOMAIN = "staff.polumya.app";
const loginToEmail = (login) => {
  const value = String(login || "").trim().toLowerCase();
  if (value.includes("@")) return value;
  return `${value.replace(/[^a-z0-9._-]/g, "")}@${AUTH_EMAIL_DOMAIN}`;
};

const UA_LATIN = {
  а:"a",б:"b",в:"v",г:"h",ґ:"g",д:"d",е:"e",є:"ye",ж:"zh",з:"z",и:"y",і:"i",ї:"yi",й:"i",
  к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",
  ь:"",ю:"yu",я:"ya",ы:"y",э:"e",ъ:""
};
const latinLogin = (value) => String(value || "").trim().toLowerCase().split("").map((ch) => UA_LATIN[ch] ?? ch).join("").replace(/[^a-z0-9._-]+/g, ".").replace(/^\.+|\.+$/g, "") || "staff";
const generatedPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("") + "!";
};

const POINTS = ["Полум'я", "Підгір'я", "SPA"];
const PROFESSIONS = {
  "Полум'я": ["Офіціант", "Бармен", "Кухня", "Прибиральниця", "Студент"],
  "Підгір'я": ["Бармен", "Кухня"],
  SPA: ["Бармен"],
};
const PERCENT_PROFESSIONS = ["Офіціант", "Бармен", "Кухня", "Прибиральниця"];
const MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
const MONTHS_G = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const DEFAULT_ADMINS = [];

const DEFAULT_PERCENT_RULES = {
  "Полум'я": {
    waiterRate: 3.5,
    waiterBarRate: 0.5,
    waiterCleaningRate: 0.5,
    kitchenRate: 1.5,
    barRate: 3,
    cleaningRate: 0,
  },
  "Підгір'я": {
    pointRate: 5,
    kitchenShare: 30,
    hallShare: 70,
    roomServiceToHall: true,
  },
  SPA: {
    pointRate: 5,
    hookahUnitRate: 130,
  },
};


const normalizePercentRules = (input = {}) => Object.fromEntries(
  POINTS.map((point) => {
    const saved = input[point] || {};
    const isLegacyWaiterModel =
      point === "Полум'я" &&
      (saved.waiterBarShare !== undefined || saved.waiterCleaningShare !== undefined);

    return [point, {
      ...DEFAULT_PERCENT_RULES[point],
      ...saved,
      ...(isLegacyWaiterModel
        ? { waiterRate: 3.5, waiterBarRate: 0.5, waiterCleaningRate: 0.5 }
        : {}),
    }];
  })
);

const SEED = [
  ["Бармен", ["Юра", "Петро", "Назар", "Саша", "Міша"]],
  ["Офіціант", ["Іван", "Катя", "Віка", "Андрій", "Саша", "Настя"]],
  ["Кухня", ["Вася", "Леся", "Надя", "Андрій", "Діма"]],
  ["Прибиральниця", ["Леся"]],
  ["Студент", ["Наталя", "Люба", "Катя"]],
];

const DEFAULT_RULES = `ПРАВИЛА ЗАКРИТТЯ РАХУНКІВ ТА КАСИ

1. Рахунок закривається одразу після розрахунку гостя.
2. Перед закриттям звір позиції в чеку.
3. Готівку тримай окремо від власних грошей.
4. Для оплати карткою перевір успішний чек термінала.
5. Скасування у закритому чеку — тільки через адміністратора.
6. У кінці зміни звір касу з адміністратором.
7. Розбіжність понад 50 грн фіксується письмово.
8. Не залишай відкриту касу без нагляду.`;

const pad = (n) => String(n).padStart(2, "0");
const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uid = () => Math.random().toString(36).slice(2, 10);
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString("uk-UA")} ₴`;
const fmt = (n) => Number(n || 0).toLocaleString("uk-UA", { maximumFractionDigits: 1 });
const dayLabel = (key) => {
  const [, m, d] = key.split("-").map(Number);
  return `${pad(d)} ${MONTHS_G[m - 1]}`;
};

const legacyProfession = (dept) => ({
  Бар: "Бармен",
  Офіціанти: "Офіціант",
  Кухня: "Кухня",
  Прибиральниці: "Прибиральниця",
  Посудомийниці: "Студент",
}[dept] || dept || "Студент");

const normalizePerson = (person) => ({
  ...person,
  point: person.point || person.area || "Полум'я",
  profession: person.profession || legacyProfession(person.dept),
  rate: Number(person.rate) || 0,
});

const periodOf = (date) => {
  const d = date.getDate();
  const y = date.getFullYear();
  const m = date.getMonth();
  if (d >= 21) {
    const next = new Date(y, m + 1, 1);
    return { y: next.getFullYear(), m: next.getMonth(), half: 1 };
  }
  if (d <= 6) return { y, m, half: 1 };
  return { y, m, half: 2 };
};
const periodRange = (p) => p.half === 1
  ? [new Date(p.y, p.m - 1, 21), new Date(p.y, p.m, 6)]
  : [new Date(p.y, p.m, 7), new Date(p.y, p.m, 20)];
const periodDates = (p) => {
  const [start, end] = periodRange(p);
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(dk(d));
  return out;
};
const periodLabel = (p) => {
  const [s, e] = periodRange(p);
  return `${pad(s.getDate())} ${MONTHS_G[s.getMonth()]} – ${pad(e.getDate())} ${MONTHS_G[e.getMonth()]} ${e.getFullYear()}`;
};
const nextP = (p) => p.half === 1 ? { ...p, half: 2 } : (() => {
  const d = new Date(p.y, p.m + 1, 1);
  return { y: d.getFullYear(), m: d.getMonth(), half: 1 };
})();
const prevP = (p) => p.half === 2 ? { ...p, half: 1 } : (() => {
  const d = new Date(p.y, p.m - 1, 1);
  return { y: d.getFullYear(), m: d.getMonth(), half: 2 };
})();

const isPaidShift = (value) => value === 1 || value === 0.5;
const periodStats = (shifts, p) => {
  const out = {};
  periodDates(p).forEach((day) => {
    Object.entries(shifts[day] || {}).forEach(([id, value]) => {
      if (value !== 1 && value !== 0.5 && value !== "training") return;
      if (!out[id]) out[id] = { full: 0, half: 0, training: 0, total: 0 };
      if (value === 1) { out[id].full += 1; out[id].total += 1; }
      if (value === 0.5) { out[id].half += 1; out[id].total += 0.5; }
      if (value === "training") { out[id].training += 1; out[id].total += 0.5; }
    });
  });
  return out;
};

function getPointCash(cash, day, point) {
  const dayRecord = cash[day] || {};
  if (point === "Полум'я" && (dayRecord.kitchen !== undefined || dayRecord.bar !== undefined)) {
    return {
      kitchen: Number(dayRecord.kitchen) || 0,
      bar: Number(dayRecord.bar) || 0,
      total: (Number(dayRecord.kitchen) || 0) + (Number(dayRecord.bar) || 0),
      waiterCash: dayRecord.waiterCash || {},
      roomService: Number(dayRecord.roomService) || 0,
      hookahs: Number(dayRecord.hookahs) || 0,
      savedAt: dayRecord.savedAt || null,
    };
  }
  const rec = dayRecord[point] || {};
  return {
    kitchen: Number(rec.kitchen) || 0,
    bar: Number(rec.bar) || 0,
    total: Number(rec.total) || 0,
    waiterCash: rec.waiterCash || {},
    roomService: Number(rec.roomService) || 0,
    hookahs: Number(rec.hookahs) || 0,
    savedAt: rec.savedAt || null,
  };
}

function distributePool({ pool, profession, point, day, staff, shifts, perEmp, byPoint, undistributed }) {
  if (pool <= 0) return;
  const workers = staff.filter((p) => p.point === point && p.profession === profession && isPaidShift(shifts[day]?.[p.id]));
  const weight = workers.reduce((sum, p) => sum + Number(shifts[day][p.id]), 0);
  if (!weight) {
    undistributed.value += pool;
    byPoint[point].undistributed += pool;
    return;
  }
  workers.forEach((p) => {
    const share = pool * Number(shifts[day][p.id]) / weight;
    perEmp[p.id] = (perEmp[p.id] || 0) + share;
    byPoint[point].perEmp[p.id] = (byPoint[point].perEmp[p.id] || 0) + share;
    byPoint[point].total += share;
  });
}

function calculateAccrual(staffInput, shifts, cash, afterDay, rulesInput) {
  const staff = staffInput.map(normalizePerson);
  const rules = { ...DEFAULT_PERCENT_RULES, ...(rulesInput || {}) };
  const perEmp = {};
  const byPoint = Object.fromEntries(POINTS.map((point) => [point, { total: 0, undistributed: 0, perEmp: {} }]));
  const waiterDetails = {};
  const undistributed = { value: 0 };
  const undistributedDays = [];

  Object.keys(cash).sort().forEach((day) => {
    if (afterDay && day <= afterDay) return;

    POINTS.forEach((point) => {
      const c = getPointCash(cash, day, point);
      const r = { ...DEFAULT_PERCENT_RULES[point], ...(rules[point] || {}) };
      const netFactor = 0.95;

      if (point === "Полум'я") {
        let barTransfer = 0;
        let cleaningTransfer = 0;
        Object.entries(c.waiterCash || {}).forEach(([employeeId, rawCash]) => {
          const personalCash = Number(rawCash) || 0;
          if (personalCash <= 0) return;
          const person = staff.find((p) => p.id === employeeId && p.point === point && p.profession === "Офіціант");
          if (!person) return;
          const waiterPart = personalCash * (Number(r.waiterRate) || 0) / 100 * netFactor;
          const barPart = personalCash * (Number(r.waiterBarRate) || 0) / 100 * netFactor;
          const cleaningPart = personalCash * (Number(r.waiterCleaningRate) || 0) / 100 * netFactor;
          const cleanFund = waiterPart + barPart + cleaningPart;
          perEmp[employeeId] = (perEmp[employeeId] || 0) + waiterPart;
          byPoint[point].perEmp[employeeId] = (byPoint[point].perEmp[employeeId] || 0) + waiterPart;
          byPoint[point].total += waiterPart;
          barTransfer += barPart;
          cleaningTransfer += cleaningPart;
          waiterDetails[employeeId] = waiterDetails[employeeId] || { cash: 0, grossFund: 0, netToWaiter: 0, barPart: 0, cleaningPart: 0 };
          waiterDetails[employeeId].cash += personalCash;
          waiterDetails[employeeId].grossFund += cleanFund;
          waiterDetails[employeeId].netToWaiter += waiterPart;
          waiterDetails[employeeId].barPart += barPart;
          waiterDetails[employeeId].cleaningPart += cleaningPart;
        });

        const kitchenPool = c.kitchen * (Number(r.kitchenRate) || 0) / 100 * netFactor;
        const barOwnPool = c.bar * (Number(r.barRate) || 0) / 100 * netFactor;
        const cleaningOwnPool = c.kitchen * (Number(r.cleaningRate) || 0) / 100 * netFactor;
        distributePool({ pool: kitchenPool, profession: "Кухня", point, day, staff, shifts, perEmp, byPoint, undistributed });
        distributePool({ pool: barOwnPool + barTransfer, profession: "Бармен", point, day, staff, shifts, perEmp, byPoint, undistributed });
        distributePool({ pool: cleaningOwnPool + cleaningTransfer, profession: "Прибиральниця", point, day, staff, shifts, perEmp, byPoint, undistributed });
      } else if (point === "Підгір'я") {
        const totalFund = c.total * (Number(r.pointRate) || 0) / 100 * netFactor;
        const kitchenPool = totalFund * (Number(r.kitchenShare) || 0) / 100;
        const hallPool = totalFund * (Number(r.hallShare) || 0) / 100 + (Number(c.roomService) || 0);
        distributePool({ pool: kitchenPool, profession: "Кухня", point, day, staff, shifts, perEmp, byPoint, undistributed });
        distributePool({ pool: hallPool, profession: "Бармен", point, day, staff, shifts, perEmp, byPoint, undistributed });
      } else if (point === "SPA") {
        const percentPool = c.total * (Number(r.pointRate) || 0) / 100 * netFactor;
        const hookahPool = (Number(c.hookahs) || 0) * (Number(r.hookahUnitRate) || 0);
        distributePool({ pool: percentPool + hookahPool, profession: "Бармен", point, day, staff, shifts, perEmp, byPoint, undistributed });
      }

      if (byPoint[point].undistributed > 0 && !undistributedDays.includes(day)) undistributedDays.push(day);
    });
  });

  const total = Object.values(perEmp).reduce((sum, value) => sum + value, 0);
  return { perEmp, byPoint, waiterDetails, total, undistributed: undistributed.value, undistributedDays };
}

const sGet = async (key, shared = true) => {
  try {
    if (!shared) {
      const local = localStorage.getItem(key);
      return local ? JSON.parse(local) : null;
    }
    const { data, error } = await supabase.from("app_state").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
  } catch (error) {
    console.error("storage read", key, error);
    return null;
  }
};

const sSet = async (key, value, shared = true) => {
  try {
    if (!shared) {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
      return true;
    }
    const { error } = await supabase.from("app_state").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("storage write", key, error);
    return false;
  }
};

export default function App() {
  const [staff, setStaff] = useState([]);
  const [shifts, setShifts] = useState({});
  const [cash, setCash] = useState({});
  const [payouts, setPayouts] = useState([]);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [settings, setSettings] = useState({ admins: [], percentRules: DEFAULT_PERCENT_RULES });
  const [announcements, setAnnouncements] = useState([]);
  const [requests, setRequests] = useState([]);
  const [plans, setPlans] = useState({});
  const [closedMonths, setClosedMonths] = useState([]);
  const [audit, setAudit] = useState([]);
  const [me, setMe] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const pending = useRef(0);

  useEffect(() => {
    let active = true;

    const resolveProfile = async (user) => {
      if (!user) {
        if (active) { setMe(null); setAuthReady(true); setLoading(false); }
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("user_id, role, staff_id, display_name, active")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || !profile?.active) {
        await supabase.auth.signOut();
        if (active) { setMe(null); setAuthReady(true); setLoading(false); }
        return;
      }

      const sessionProfile = profile.role === "admin"
        ? { type: "admin", userId: user.id, name: profile.display_name || "Адміністратор" }
        : { type: "emp", userId: user.id, id: profile.staff_id, name: profile.display_name || "Працівник" };

      if (active) setMe(sessionProfile);

      let loadedStaff = await sGet(K_STAFF, true);
      if (!loadedStaff?.length) {
        loadedStaff = SEED.flatMap(([profession, names]) => names.map((name) => ({ id: uid(), name, point: "Полум'я", profession, rate: 0 })));
      }
      loadedStaff = loadedStaff.map(normalizePerson);
      let loadedSettings = (await sGet(K_SETTINGS, true)) || {};
      loadedSettings = {
        ...loadedSettings,
        admins: [],
        percentRules: normalizePercentRules(loadedSettings.percentRules),
      };
      if (!active) return;
      setStaff(loadedStaff);
      setShifts((await sGet(K_SHIFTS, true)) || {});
      setCash((await sGet(K_CASH, true)) || {});
      setPayouts((await sGet(K_PAYOUTS, true)) || []);
      setRules((await sGet(K_RULES, true)) || DEFAULT_RULES);
      setAnnouncements((await sGet(K_ANNOUNCEMENTS, true)) || []);
      setRequests((await sGet(K_REQUESTS, true)) || []);
      setPlans((await sGet(K_PLANS, true)) || {});
      setClosedMonths((await sGet(K_CLOSED_MONTHS, true)) || []);
      setAudit((await sGet(K_AUDIT, true)) || []);
      setSettings(loadedSettings);
      setLastSync(new Date());
      setAuthReady(true);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => resolveProfile(data.session?.user || null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveProfile(session?.user || null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const refresh = async () => {
    if (pending.current > 0) return;
    const [st, sh, ca, po, ru, se, an, rq, pl, cl, au] = await Promise.all([
      sGet(K_STAFF, true), sGet(K_SHIFTS, true), sGet(K_CASH, true), sGet(K_PAYOUTS, true), sGet(K_RULES, true), sGet(K_SETTINGS, true),
      sGet(K_ANNOUNCEMENTS, true), sGet(K_REQUESTS, true), sGet(K_PLANS, true), sGet(K_CLOSED_MONTHS, true), sGet(K_AUDIT, true),
    ]);
    if (st) setStaff(st.map(normalizePerson));
    if (sh) setShifts(sh);
    if (ca) setCash(ca);
    if (po) setPayouts(po);
    if (ru) setRules(ru);
    if (se) setSettings({ ...se, percentRules: normalizePercentRules(se.percentRules) });
    if (an) setAnnouncements(an);
    if (rq) setRequests(rq);
    if (pl) setPlans(pl);
    if (cl) setClosedMonths(cl);
    if (au) setAudit(au);
    setLastSync(new Date());
  };

  useEffect(() => {
    const timer = setInterval(refresh, 12000);
    const onVisibility = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const saveShared = async (key, next, setter) => {
    pending.current += 1;
    setSaveStatus({ state: "saving" });
    setter(next);
    const ok = await sSet(key, next, true);
    setSaveStatus({ state: ok ? "saved" : "error" });
    pending.current -= 1;
    if (ok) setLastSync(new Date());
    return ok;
  };

  const writeShift = async (day, id, value) => {
    const latest = (await sGet(K_SHIFTS, true)) || shifts;
    const rec = { ...(latest[day] || {}) };
    if (value == null) delete rec[id]; else rec[id] = value;
    const next = { ...latest };
    if (Object.keys(rec).length) next[day] = rec; else delete next[day];
    return saveShared(K_SHIFTS, next, setShifts);
  };

  const writeCash = async (day, point, entry) => {
    const latest = (await sGet(K_CASH, true)) || cash;
    const currentDay = { ...(latest[day] || {}) };
    if (currentDay.kitchen !== undefined || currentDay.bar !== undefined) {
      currentDay["Полум'я"] = {
        kitchen: Number(currentDay.kitchen) || 0,
        bar: Number(currentDay.bar) || 0,
        waiterCash: currentDay.waiterCash || {},
        savedAt: currentDay.savedAt || new Date().toISOString(),
      };
      delete currentDay.kitchen;
      delete currentDay.bar;
      delete currentDay.waiterCash;
      delete currentDay.savedAt;
    }
    currentDay[point] = { ...entry, savedAt: new Date().toISOString() };
    const next = { ...latest, [day]: currentDay };
    return saveShared(K_CASH, next, setCash);
  };

  const saveStaff = (next) => saveShared(K_STAFF, next.map(normalizePerson), setStaff);
  const saveSettings = (next) => saveShared(K_SETTINGS, next, setSettings);
  const saveRules = (next) => saveShared(K_RULES, next, setRules);
  const saveAnnouncements = (next) => saveShared(K_ANNOUNCEMENTS, next, setAnnouncements);
  const saveRequests = (next) => saveShared(K_REQUESTS, next, setRequests);
  const savePlans = (next) => saveShared(K_PLANS, next, setPlans);
  const saveClosedMonths = (next) => saveShared(K_CLOSED_MONTHS, next, setClosedMonths);
  const addAudit = async (action, details = "") => {
    const record = { id: uid(), ts: new Date().toISOString(), admin: me?.name || "Система", action, details };
    const latest = (await sGet(K_AUDIT, true)) || audit;
    const next = [...latest, record].slice(-300);
    return saveShared(K_AUDIT, next, setAudit);
  };
  const addPayout = async (record) => {
    const latest = (await sGet(K_PAYOUTS, true)) || payouts;
    return saveShared(K_PAYOUTS, [...latest, record], setPayouts);
  };
  const logout = async () => {
    await supabase.auth.signOut();
    setMe(null);
  };

  const lastPayoutDay = payouts.length ? [...payouts].map((p) => p.upTo).sort().at(-1) : null;

  if (loading || !authReady) return <Shell><Centered>Завантажуємо дані…</Centered></Shell>;
  if (!me) return <Shell><AuthLogin /></Shell>;
  if (me.type === "emp") {
    const person = staff.find((p) => p.id === me.id);
    if (!person) return <Shell><Centered>Працівника не знайдено. Вийди та зайди знову.</Centered></Shell>;
    return <Shell><EmployeeView person={person} staff={staff} shifts={shifts} cash={cash} payouts={payouts} settings={settings} rules={rules} announcements={announcements} requests={requests} saveRequests={saveRequests} writeShift={writeShift} onLogout={logout} lastPayoutDay={lastPayoutDay} saveStatus={saveStatus} lastSync={lastSync} onRefresh={refresh} /></Shell>;
  }
  return <Shell><AdminView me={me} staff={staff} shifts={shifts} cash={cash} payouts={payouts} settings={settings} rules={rules} announcements={announcements} requests={requests} plans={plans} closedMonths={closedMonths} audit={audit} writeShift={writeShift} writeCash={writeCash} saveStaff={saveStaff} saveSettings={saveSettings} saveRules={saveRules} saveAnnouncements={saveAnnouncements} saveRequests={saveRequests} savePlans={savePlans} saveClosedMonths={saveClosedMonths} addAudit={addAudit} addPayout={addPayout} onLogout={logout} lastPayoutDay={lastPayoutDay} saveStatus={saveStatus} lastSync={lastSync} onRefresh={refresh} /></Shell>;
}

function Shell({ children }) {
  return <div style={S.page}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Alegreya:wght@500;700&family=Inter:wght@400;500;600;700&display=swap');
      *{box-sizing:border-box} body{margin:0;background:#171512} button,input,textarea,select{font-family:inherit}
      button{cursor:pointer} button:disabled{cursor:not-allowed} input::placeholder,textarea::placeholder{color:#d8d0c4;opacity:.85}
      select option{background:#1c1a17;color:#fff} ::-webkit-scrollbar{height:8px;width:8px} ::-webkit-scrollbar-thumb{background:#49443c;border-radius:5px}
      .finance-report,.waiter-report{border:1px solid #3b3730;border-radius:12px;overflow:hidden;background:#1d1b18}
      .finance-report-head,.finance-report-row{display:grid;grid-template-columns:1.05fr repeat(5,minmax(110px,1fr));align-items:center}
      .finance-report-head{background:#2a2722;color:#eee7dc;font-size:12px;font-weight:700}
      .finance-report-head span,.finance-report-row>div{padding:12px;border-right:1px solid #3b3730}
      .finance-report-row{border-top:1px solid #3b3730}
      .finance-report-row small{display:none;color:#cfc7bb;font-size:11px;margin-bottom:4px}
      .finance-report-row b{display:block;color:#fff}
      .finance-title{font-family:Alegreya,serif;font-size:18px;font-weight:700}
      .waiter-report-head,.waiter-report-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:center;padding:12px 14px}
      .waiter-report-head{background:#2a2722;color:#eee7dc;font-size:12px;font-weight:700}
      .waiter-report-row{border-top:1px solid #3b3730}
      .waiter-report-row b{text-align:right}
      @media(max-width:720px){
        .finance-report-head{display:none}
        .finance-report{border:0;background:transparent;display:grid;gap:10px}
        .finance-report-row{grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid #3b3730;border-radius:12px;background:#1d1b18;overflow:hidden}
        .finance-report-row>div{border-right:0;border-bottom:1px solid #3b3730;padding:11px}
        .finance-report-row>div:nth-last-child(-n+2){border-bottom:0}
        .finance-title{grid-column:1/-1;background:#2a2722;border-bottom:1px solid #3b3730!important}
        .finance-report-row small{display:block}
        .waiter-report-head{display:none}
        .waiter-report-row{grid-template-columns:1fr auto;gap:6px 12px}
        .waiter-report-row span{font-weight:700}
        .waiter-report-row b:nth-child(2)::before{content:'Каса: ';color:#cfc7bb;font-weight:400}
        .waiter-report-row b:nth-child(3){grid-column:1/-1;text-align:left}
        .waiter-report-row b:nth-child(3)::before{content:'Нараховано: ';color:#cfc7bb;font-weight:400}
      }
    `}</style>
    {children}
  </div>;
}
function Centered({ children }) { return <div style={{ textAlign: "center", marginTop: 90, color: "#fff" }}>{children}</div>; }
function Brand({ small = false }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <span style={{ fontSize: small ? 22 : 29 }}>🔥</span>
    <span style={{ fontFamily: "Alegreya,serif", fontSize: small ? 20 : 27, fontWeight: 700, color: "#fff" }}>Полум'я та Підгір'я</span>
  </div>;
}

function AuthLogin() {
  const [mode, setMode] = useState("checking");
  const [login, setLogin] = useState("");
  const [pass, setPass] = useState("");
  const [displayName, setDisplayName] = useState("Еля");
  const [confirmPass, setConfirmPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setMode("login");
  }, []);

  const enter = async () => {
    const cleanLogin = String(login || "").trim().toLowerCase();

    if (!cleanLogin || !pass) {
      setError("Введи логін і пароль");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const email = cleanLogin.includes("@")
        ? cleanLogin
        : loginToEmail(cleanLogin);

      const { data, error: authError } =
        await supabase.auth.signInWithPassword({
          email,
          password: pass,
        });

      if (authError) {
        throw authError;
      }

      if (!data?.session || !data?.user) {
        throw new Error("Supabase не створив сесію входу");
      }

      setError("");
    } catch (loginError) {
      console.error("Помилка входу:", loginError);

      const message = String(
        loginError?.message || "Не вдалося виконати вхід"
      );

      if (
        message.toLowerCase().includes("invalid login credentials")
      ) {
        setError("Невірний логін або пароль");
      } else if (
        message.toLowerCase().includes("failed to fetch") ||
        message.toLowerCase().includes("network")
      ) {
        setError("Немає зв’язку із сервером. Перевір інтернет і повтори.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const createFirstAdmin = async () => {
    const cleanLogin = String(login || "").trim().toLowerCase();
    if (!displayName.trim()) { setError("Введи своє ім’я"); return; }
    if (!cleanLogin) { setError("Придумай логін"); return; }
    if (pass.length < 8) { setError("Пароль має містити щонайменше 8 символів"); return; }
    if (pass !== confirmPass) { setError("Паролі не збігаються"); return; }

    setBusy(true); setError("");
    const { data, error: fnError } = await supabase.functions.invoke("bootstrap-admin", {
      body: {
        action: "create",
        login: cleanLogin,
        password: pass,
        displayName: displayName.trim(),
      },
    });
    if (fnError || !data?.ok) {
      setError(data?.error || fnError?.message || "Не вдалося створити адміністратора");
      setBusy(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: data.email || loginToEmail(cleanLogin),
      password: pass,
    });
    if (authError) {
      setError("Адміністратора створено. Спробуй увійти під щойно створеними даними.");
      setMode("login");
    }
    setBusy(false);
  };

  if (mode === "checking") {
    return <main style={{ maxWidth: 460, margin: "0 auto", paddingTop: 70 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}><Brand /></div>
      <div style={S.card}><Centered>Перевіряємо налаштування…</Centered></div>
    </main>;
  }

  if (mode === "setup") {
    return <main style={{ maxWidth: 460, margin: "0 auto", paddingTop: 34 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Brand /></div>
      <div style={S.card}>
        <h2 style={{ ...S.h2, textAlign: "center" }}>Створення головного адміністратора</h2>
        <p style={S.subtleCenter}>Придумай власний логін і пароль. Це робиться лише один раз.</p>
        <div style={{ display: "grid", gap: 10 }}>
          <input style={{ ...S.input, width: "100%" }} placeholder="Твоє ім’я" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <input style={{ ...S.input, width: "100%" }} autoCapitalize="none" autoCorrect="off" placeholder="Придумай логін" value={login} onChange={(e) => setLogin(e.target.value)} />
          <input style={{ ...S.input, width: "100%" }} type="password" placeholder="Придумай пароль" value={pass} onChange={(e) => setPass(e.target.value)} />
          <input style={{ ...S.input, width: "100%" }} type="password" placeholder="Повтори пароль" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createFirstAdmin()} />
          <button style={S.primary} disabled={busy} onClick={createFirstAdmin}>{busy ? "Створюємо…" : "Створити адміністратора"}</button>
        </div>
        {error && <div style={S.error}>{error}</div>}
        <p style={{ ...S.hint, marginTop: 12 }}>Пароль не показується і не зберігається відкритим текстом. Після входу сесія залишиться на цьому телефоні.</p>
      </div>
    </main>;
  }

  return <main style={{ maxWidth: 460, margin: "0 auto", paddingTop: 48 }}>
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}><Brand /></div>
    <div style={S.card}>
      <h2 style={{ ...S.h2, textAlign: "center" }}>Особистий вхід</h2>
      <p style={S.subtleCenter}>Кожен працівник входить лише у свій кабінет</p>
      <div style={{ display: "grid", gap: 10 }}>
        <input style={{ ...S.input, width: "100%" }} autoCapitalize="none" autoCorrect="off" placeholder="Логін" value={login} onChange={(e) => setLogin(e.target.value)} />
        <input style={{ ...S.input, width: "100%" }} type="password" placeholder="Пароль" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enter()} />
        <button style={S.primary} disabled={busy} onClick={enter}>{busy ? "Вхід…" : "Увійти"}</button>
      </div>
      {error && <div style={S.error}>{error}</div>}
    </div>
  </main>;
}

function ShiftReminderControl({ person }) {
  const [enabled, setEnabled] = useState(() => isReminderEnabled(person.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        await disableShiftReminder(person.id);
        setEnabled(false);
        setMessage("Нагадування вимкнено");
      } else {
        await enableShiftReminder(person);
        setEnabled(true);
        setMessage("Нагадування о 12:00 увімкнено");
      }
    } catch (error) {
      setMessage(error?.message || "Не вдалося змінити нагадування");
    } finally { setBusy(false); }
  };
  return <div style={{ ...S.card, marginTop: 12 }}>
    <h3 style={S.h3}>🔔 Нагадування</h3>
    {!isPushSupported() && <p style={S.error}>На iPhone відкрий застосунок через іконку на головному екрані.</p>}
    <button style={enabled ? S.ghost : S.primary} disabled={busy} onClick={toggle}>{busy ? "Зачекай…" : enabled ? "Вимкнути нагадування" : "Увімкнути нагадування о 12:00"}</button>
    {message && <p style={S.hint}>{message}</p>}
  </div>;
}

function EmployeeView({ person, staff, shifts, cash, settings, rules, announcements, requests, saveRequests, writeShift, onLogout, lastPayoutDay, saveStatus, lastSync, onRefresh }) {
  const today = new Date();
  const todayKey = dk(today);
  const selected = shifts[todayKey]?.[person.id];
  const hasChoice = selected !== undefined;
  const [period, setPeriod] = useState(() => periodOf(today));
  const stats = useMemo(() => periodStats(shifts, period)[person.id] || { full: 0, half: 0, total: 0 }, [shifts, period, person.id]);
  const accrual = useMemo(() => calculateAccrual(staff, shifts, cash, lastPayoutDay, settings.percentRules), [staff, shifts, cash, lastPayoutDay, settings.percentRules]);
  const myPercent = accrual.perEmp[person.id] || 0;
  const choices = [
    [1, "🔥 Повна зміна"],
    [0.5, "◐ Пів зміни"],
    ["training", "🎓 Стажування"],
    ["off", "💤 Вихідний"],
  ];
  const monthPrefix = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  const monthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthValues = Array.from({ length: monthDays }, (_, i) => shifts[`${monthPrefix}-${pad(i + 1)}`]?.[person.id]);
  const monthPaid = monthValues.reduce((sum, v) => sum + (isPaidShift(v) ? Number(v) : 0), 0);
  const monthTraining = monthValues.filter((v) => v === "training").length;
  const monthCash = Object.keys(cash).filter((d) => d.startsWith(monthPrefix)).reduce((sum, day) => sum + (Number(getPointCash(cash, day, person.point).waiterCash?.[person.id]) || 0), 0);
  const activeAnnouncements = (announcements || []).filter((a) => !a.expiresAt || a.expiresAt >= todayKey);
  const myRequests = (requests || []).filter((r) => r.employeeId === person.id).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const [requestType, setRequestType] = useState("Виправлення табеля");
  const [requestText, setRequestText] = useState("");
  const sendRequest = async () => {
    if (!requestText.trim()) return;
    await saveRequests([...(requests || []), { id: uid(), employeeId: person.id, employeeName: person.name, point: person.point, type: requestType, text: requestText.trim(), status: "new", createdAt: new Date().toISOString() }]);
    setRequestText("");
  };
  const achievements = [
    monthPaid >= 10 && "🔥 10+ змін за місяць",
    monthCash >= 50000 && "🏆 Особиста каса 50 000+ ₴",
    monthTraining >= 3 && "🎓 Активне стажування",
    myPercent >= 1000 && "💰 Накопичено 1 000+ ₴",
  ].filter(Boolean);
  return <main style={{ maxWidth: 620, margin: "0 auto" }}>
    <Header onLogout={onLogout} />
    <div style={S.card}>
      <h2 style={{ margin: 0, color: "#fff" }}>Привіт, {person.name}!</h2>
      <p style={{ color: "#e9e2d8", marginTop: 5 }}>{person.point} · {person.profession}</p>
      <p style={{ color: "#fff" }}>Сьогодні, {today.getDate()} {MONTHS_G[today.getMonth()]}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
        {choices.map(([value, label]) => <button key={String(value)} disabled={hasChoice} style={{ ...S.bigBtn, ...(selected === value ? S.bigOn : {}), ...(hasChoice && selected !== value ? { opacity: .42 } : {}) }} onClick={() => !hasChoice && writeShift(todayKey, person.id, value)}>{label}</button>)}
      </div>
      <p style={S.hint}>{selected === 1 ? "Повну зміну збережено." : selected === 0.5 ? "Пів зміни збережено." : selected === "training" ? "Стажування збережено." : selected === "off" ? "Вихідний збережено." : "Обери статус. Після збереження змінити його зможе лише адміністратор."}</p>
      {saveStatus?.state === "saving" && <p style={S.hint}>Зберігаю…</p>}
      {saveStatus?.state === "saved" && <p style={S.success}>✓ Збережено</p>}
      {saveStatus?.state === "error" && <p style={S.error}>Не вдалося зберегти. Спробуй ще раз.</p>}
    </div>
    {PERCENT_PROFESSIONS.includes(person.profession) && <div style={{ ...S.card, marginTop: 12, borderColor: "#e8763a" }}>
      <h3 style={S.h3}>Твій накопичений %</h3>
      <div style={S.emberAmount}>{money(myPercent)}</div>
      {person.profession === "Офіціант" && <p style={S.hint}>Розраховано лише від твоєї особистої каси, внесеної адміністратором.</p>}
    </div>}
    <div style={{ ...S.card, marginTop: 12 }}>
      <PeriodNav period={period} setPeriod={setPeriod} />
      <div style={S.grid3}>
        <Mini title="Змін" value={fmt(stats.total)} />
        <Mini title="Половинок" value={stats.half} />
        <Mini title="За зміни" value={person.rate ? money(stats.total * person.rate) : "—"} />
      </div>
    </div>
    <div style={{ ...S.card, marginTop: 12 }}>
      <h3 style={S.h3}>📊 Мої результати цього місяця</h3>
      <div style={S.grid3}><Mini title="Змін" value={fmt(monthPaid)} /><Mini title="Особиста каса" value={person.profession === "Офіціант" ? money(monthCash) : "—"} /><Mini title="Прогноз виплати" value={money(monthPaid * person.rate + myPercent)} /></div>
    </div>
    <div style={{ ...S.card, marginTop: 12 }}>
      <h3 style={S.h3}>🗓 Календар місяця</h3>
      <div style={S.calendarGrid}>{Array.from({ length: monthDays }, (_, i) => { const v = monthValues[i]; return <div key={i} title={String(v || "")} style={{ ...S.calendarDay, ...(v===1?S.calendarFull:v===0.5?S.calendarHalf:v==="training"?S.calendarTraining:v==="off"?S.calendarOff:{}) }}>{i+1}</div>; })}</div>
      <p style={S.hint}>Помаранчевий — повна, половина — ½, золотий — стажування, сірий — вихідний.</p>
    </div>
    {activeAnnouncements.length > 0 && <div style={{ ...S.card, marginTop: 12 }}><h3 style={S.h3}>📣 Оголошення</h3>{activeAnnouncements.map((a) => <div key={a.id} style={S.notice}><b>{a.title}</b><p style={{margin:"6px 0 0"}}>{a.text}</p></div>)}</div>}
    <div style={{ ...S.card, marginTop: 12 }}><h3 style={S.h3}>🏅 Досягнення</h3>{achievements.length ? achievements.map((x) => <div key={x} style={S.badge}>{x}</div>) : <p style={S.hint}>Перші досягнення з’являться після кількох змін.</p>}</div>
    <div style={{ ...S.card, marginTop: 12 }}><h3 style={S.h3}>✉️ Запит адміністратору</h3><select style={S.inputFull} value={requestType} onChange={(e)=>setRequestType(e.target.value)}>{["Виправлення табеля","Заміна зміни","Вихідний","Помилка в касі","Інше"].map(x=><option key={x}>{x}</option>)}</select><textarea style={{...S.textarea,marginTop:8}} rows={3} placeholder="Опиши запит" value={requestText} onChange={(e)=>setRequestText(e.target.value)} /><button style={{...S.primary,marginTop:8}} onClick={sendRequest}>Надіслати</button>{myRequests.slice(0,5).map(r=><div key={r.id} style={S.requestRow}><span>{r.type}: {r.text}</span><b>{r.status==="approved"?"Схвалено":r.status==="rejected"?"Відхилено":"На розгляді"}</b></div>)}</div>
    {person.profession === "Офіціант" && <div style={{ ...S.card, marginTop: 12 }}><h3 style={S.h3}>Правила</h3><pre style={S.pre}>{rules}</pre></div>}
    <ShiftReminderControl person={person} />
    <footer style={S.footer}>Синхронізовано: {lastSync ? lastSync.toLocaleTimeString("uk-UA") : "—"} · <button style={S.linkBtn} onClick={onRefresh}>Оновити</button></footer>
  </main>;
}

function AdminView({ me, staff, shifts, cash, payouts, settings, rules, announcements, requests, plans, closedMonths, audit, writeShift, writeCash, saveStaff, saveSettings, saveRules, saveAnnouncements, saveRequests, savePlans, saveClosedMonths, addAudit, addPayout, onLogout, lastPayoutDay, saveStatus, lastSync, onRefresh }) {
  const today = new Date();
  const todayKey = dk(today);
  const [tab, setTab] = useState("control");
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [cashPoint, setCashPoint] = useState("Полум'я");
  const [cashDraft, setCashDraft] = useState({ kitchen: "", bar: "", total: "", waiterCash: {}, roomService: "", hookahs: "" });
  const [period, setPeriod] = useState(() => periodOf(today));
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [staffForm, setStaffForm] = useState(null);
  const [rulesDraft, setRulesDraft] = useState(rules);
  const [percentDraft, setPercentDraft] = useState(normalizePercentRules(settings.percentRules));
  const [cashMessage, setCashMessage] = useState("");
  const [announcementForm, setAnnouncementForm] = useState({ title: "", text: "", expiresAt: "" });
  const [planDraft, setPlanDraft] = useState("");
  const [massPoint, setMassPoint] = useState("Полум'я");
  const [massStatus, setMassStatus] = useState("off");
  const [bulkAccessBusy, setBulkAccessBusy] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState([]);

  useEffect(() => setPercentDraft(normalizePercentRules(settings.percentRules)), [settings.percentRules]);
  useEffect(() => {
    const rec = getPointCash(cash, selectedDay, cashPoint);
    setCashDraft({
      kitchen: rec.kitchen ? String(rec.kitchen) : "",
      bar: rec.bar ? String(rec.bar) : "",
      total: rec.total ? String(rec.total) : "",
      waiterCash: Object.fromEntries(Object.entries(rec.waiterCash || {}).map(([id, value]) => [id, value ? String(value) : ""])),
      roomService: rec.roomService ? String(rec.roomService) : "",
      hookahs: rec.hookahs ? String(rec.hookahs) : "",
    });
  }, [cash, selectedDay, cashPoint]);

  const normalizedStaff = useMemo(() => staff.map(normalizePerson), [staff]);
  const byPointProfession = useMemo(() => normalizedStaff.reduce((g, p) => {
    const key = `${p.point}|${p.profession}`;
    (g[key] ||= []).push(p);
    return g;
  }, {}), [normalizedStaff]);
  const stats = useMemo(() => periodStats(shifts, period), [shifts, period]);
  const accrual = useMemo(() => calculateAccrual(normalizedStaff, shifts, cash, lastPayoutDay, settings.percentRules), [normalizedStaff, shifts, cash, lastPayoutDay, settings.percentRules]);
  const totalPay = normalizedStaff.reduce((sum, p) => sum + (stats[p.id]?.total || 0) * p.rate, 0);
  const waiters = normalizedStaff.filter((p) => p.point === "Полум'я" && p.profession === "Офіціант");
  const monthPrefix = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
  const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const monthCashSummary = useMemo(() => {
    const summary = Object.fromEntries(POINTS.map((point) => [point, { kitchen: 0, bar: 0, total: 0, waiter: 0, roomService: 0, hookahs: 0 }]));
    Object.keys(cash).filter((day) => day.startsWith(monthPrefix)).forEach((day) => {
      POINTS.forEach((point) => {
        const rec = getPointCash(cash, day, point);
        summary[point].kitchen += rec.kitchen;
        summary[point].bar += rec.bar;
        summary[point].total += rec.total || rec.kitchen + rec.bar;
        summary[point].waiter += Object.values(rec.waiterCash || {}).reduce((s, value) => s + (Number(value) || 0), 0);
        summary[point].roomService += Number(rec.roomService) || 0;
        summary[point].hookahs += Number(rec.hookahs) || 0;
      });
    });
    return summary;
  }, [cash, monthPrefix]);

  const waiterMonthCash = useMemo(() => {
    const out = {};
    Object.keys(cash).filter((day) => day.startsWith(monthPrefix)).forEach((day) => {
      const rec = getPointCash(cash, day, "Полум'я");
      Object.entries(rec.waiterCash || {}).forEach(([id, value]) => { out[id] = (out[id] || 0) + (Number(value) || 0); });
    });
    return out;
  }, [cash, monthPrefix]);
  const bestWaiter = [...waiters].sort((a, b) => (waiterMonthCash[b.id] || 0) - (waiterMonthCash[a.id] || 0))[0];
  const missingToday = normalizedStaff.filter((p) => shifts[todayKey]?.[p.id] === undefined);
  const anomalies = useMemo(() => {
    const out = [];
    Object.keys(cash).filter((d) => d.startsWith(monthPrefix)).forEach((day) => {
      POINTS.forEach((point) => {
        const rec = getPointCash(cash, day, point);
        const hasCash = rec.total > 0 || rec.kitchen > 0 || rec.bar > 0;
        const workers = normalizedStaff.filter((p) => p.point === point && isPaidShift(shifts[day]?.[p.id]));
        if (hasCash && !workers.length) out.push(`${dayLabel(day)} · ${point}: є каса, але немає змін`);
        if (!hasCash && workers.length) out.push(`${dayLabel(day)} · ${point}: є працівники, але немає каси`);
        if (point === "Полум'я") {
          const personal = Object.values(rec.waiterCash || {}).reduce((s,v)=>s+Number(v||0),0);
          if (personal > rec.total && rec.total > 0) out.push(`${dayLabel(day)} · особисті каси офіціантів більші за загальну`);
        }
      });
    });
    return out;
  }, [cash, shifts, normalizedStaff, monthPrefix]);
  const planKey = monthPrefix;
  const monthPlan = Number(plans?.[planKey]) || 0;
  const monthTotalCash = POINTS.reduce((s,p)=>s+monthCashSummary[p].total,0);
  const planProgress = monthPlan > 0 ? Math.min(100, monthTotalCash / monthPlan * 100) : 0;
  const estimatedPayroll = normalizedStaff.reduce((sum,p)=>sum+(stats[p.id]?.total||0)*p.rate,0)+accrual.total;
  const forecastPayroll = today.getDate() > 0 ? estimatedPayroll / Math.max(1,today.getDate()) * monthDays : estimatedPayroll;
  const pointComparison = POINTS.map((point)=>({ point, cash: monthCashSummary[point].total, percent: accrual.byPoint[point]?.total||0, workers: normalizedStaff.filter(p=>p.point===point).length }));
  const monthClosed = (closedMonths || []).includes(monthPrefix);
  const createAnnouncement = async () => { if(!announcementForm.title.trim() || !announcementForm.text.trim()) return; const next=[...(announcements||[]),{id:uid(),...announcementForm,createdAt:new Date().toISOString(),author:me.name}]; await saveAnnouncements(next); await addAudit("Створено оголошення", announcementForm.title); setAnnouncementForm({title:"",text:"",expiresAt:""}); };
  const decideRequest = async (id,status) => { const next=(requests||[]).map(r=>r.id===id?{...r,status,decidedAt:new Date().toISOString(),decidedBy:me.name}:r); await saveRequests(next); await addAudit(status==="approved"?"Схвалено запит":"Відхилено запит", id); };
  const saveMonthPlan = async () => { const next={...(plans||{}),[planKey]:Number(planDraft)||0}; await savePlans(next); await addAudit("Оновлено місячний план", `${planKey}: ${money(next[planKey])}`); };
  const toggleMonthClose = async () => { const next=monthClosed?(closedMonths||[]).filter(x=>x!==monthPrefix):[...(closedMonths||[]),monthPrefix]; await saveClosedMonths(next); await addAudit(monthClosed?"Відкрито місяць":"Закрито місяць",monthPrefix); };
  const applyMassStatus = async () => { if(!confirm(`Встановити статус усім працівникам ${massPoint} за ${dayLabel(selectedDay)}?`)) return; let next={...(shifts||{}),[selectedDay]:{...(shifts[selectedDay]||{})}}; normalizedStaff.filter(p=>p.point===massPoint).forEach(p=>{next[selectedDay][p.id]=massStatus}); await sSet(K_SHIFTS,next,true); window.location.reload(); };
  const exportCsv = () => { const rows=[["Об’єкт","Кухня","Бар","Загальна каса","Особисті каси","Room service","Кальяни","Нараховано %"],...POINTS.map(p=>[p,monthCashSummary[p].kitchen,monthCashSummary[p].bar,monthCashSummary[p].total,monthCashSummary[p].waiter,monthCashSummary[p].roomService,monthCashSummary[p].hookahs,accrual.byPoint[p]?.total||0])]; const csv=rows.map(r=>r.join(";")).join("\n"); const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`fin-report-${monthPrefix}.csv`; a.click(); URL.revokeObjectURL(a.href); };

  const createStaffAccess = async (staffId, name, login, password, role = "employee") => {
    if (!login?.trim() || !password) return { ok: false, error: "Вкажи логін і пароль" };
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: { staffId, name, login: login.trim(), password, role },
    });
    if (error || !data?.ok) return { ok: false, error: data?.error || error?.message || "Не вдалося створити доступ" };
    return { ok: true, userId: data.userId };
  };

  const resetStaffPassword = async (person) => {
    const nextPassword = window.prompt(`Новий пароль для ${person.name} (мінімум 8 символів):`);
    if (!nextPassword) return;
    if (nextPassword.length < 8) { alert("Пароль має містити щонайменше 8 символів"); return; }
    const { data, error } = await supabase.functions.invoke("admin-reset-password", {
      body: { userId: person.authUserId, login: person.login, password: nextPassword },
    });
    if (error || !data?.ok) { alert(data?.error || error?.message || "Не вдалося змінити пароль"); return; }
    await addAudit("Змінено пароль працівника", person.name);
    alert(`Пароль для ${person.name} змінено. Передай його працівнику особисто.`);
  };

  const uniqueLoginFor = (person, used) => {
    if (person.login?.trim()) return latinLogin(person.login);
    const suffix = person.profession === "Офіціант" ? "waiter" : person.profession === "Бармен" ? "bar" : person.profession === "Кухня" ? "kitchen" : person.profession === "Прибиральниця" ? "clean" : "staff";
    const pointSuffix = person.point === "Полум'я" ? "" : person.point === "Підгір'я" ? ".pidgirya" : ".spa";
    const base = `${latinLogin(person.name)}.${suffix}${pointSuffix}`;
    let candidate = base;
    let i = 2;
    while (used.has(candidate)) candidate = `${base}${i++}`;
    used.add(candidate);
    return candidate;
  };

  const createAccessForAll = async () => {
    const targets = normalizedStaff.filter((person) => person.active !== false && !person.authUserId);
    if (!targets.length) { alert("У всіх активних працівників уже є доступ."); return; }
    if (!confirm(`Створити особисті входи для ${targets.length} працівників?`)) return;

    setBulkAccessBusy(true);
    const used = new Set(normalizedStaff.map((person) => latinLogin(person.login || "")).filter(Boolean));
    const updated = normalizedStaff.map((person) => ({ ...person }));
    const credentials = [];
    const failures = [];

    for (const person of targets) {
      const login = uniqueLoginFor(person, used);
      const password = generatedPassword();
      const access = await createStaffAccess(person.id, person.name, login, password, "employee");
      if (access.ok) {
        const row = updated.find((item) => item.id === person.id);
        if (row) { row.login = login; row.authUserId = access.userId; }
        credentials.push({ name: person.name, point: person.point, profession: person.profession, login, password });
      } else {
        failures.push(`${person.name}: ${access.error}`);
      }
    }

    if (credentials.length) {
      await saveStaff(updated);
      await addAudit("Створено масові доступи", `${credentials.length} працівників`);
      setCreatedCredentials(credentials);
    }
    setBulkAccessBusy(false);
    if (failures.length) alert(`Не вдалося створити частину доступів:
${failures.join("\n")}`);
  };

  const copyCredentials = async () => {
    const text = createdCredentials.map((row) => `${row.name} (${row.profession}, ${row.point}) — логін: ${row.login}, пароль: ${row.password}`).join("\n");
    await navigator.clipboard.writeText(text);
    alert("Логіни й паролі скопійовано.");
  };

  const downloadCredentials = () => {
    const rows = [["Ім’я","Об’єкт","Професія","Логін","Тимчасовий пароль"], ...createdCredentials.map((row) => [row.name,row.point,row.profession,row.login,row.password])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"','""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `staff-access-${dk(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const submitStaff = async () => {
    if (!staffForm?.name?.trim()) return;
    const point = staffForm.point || "Полум'я";
    const profession = staffForm.profession || PROFESSIONS[point][0];
    const staffId = staffForm.id || uid();
    const record = {
      name: staffForm.name.trim(),
      point,
      profession,
      rate: Number(staffForm.rate) || 0,
      login: staffForm.login?.trim() || "",
      authUserId: staffForm.authUserId || null,
      active: staffForm.active !== false,
    };

    if (!staffForm.id || (staffForm.password && staffForm.login)) {
      const access = await createStaffAccess(staffId, record.name, record.login, staffForm.password, "employee");
      if (!access.ok) { alert(access.error); return; }
      record.authUserId = access.userId;
    }

    const next = staffForm.id
      ? normalizedStaff.map((person) => person.id === staffForm.id ? { ...person, ...record } : person)
      : [...normalizedStaff, { id: staffId, ...record }];
    await saveStaff(next);
    await addAudit(staffForm.id ? "Оновлено працівника" : "Створено працівника і доступ", record.name);
    setStaffForm(null);
  };

  const saveCashNow = async () => {
    const entry = cashPoint === "Полум'я"
      ? {
          kitchen: Number(cashDraft.kitchen) || 0,
          bar: Number(cashDraft.bar) || 0,
          total: (Number(cashDraft.kitchen) || 0) + (Number(cashDraft.bar) || 0),
          waiterCash: Object.fromEntries(Object.entries(cashDraft.waiterCash || {}).filter(([, value]) => Number(value) > 0).map(([id, value]) => [id, Number(value)])),
        }
      : cashPoint === "Підгір'я"
        ? { total: Number(cashDraft.total) || 0, kitchen: 0, bar: 0, waiterCash: {}, roomService: Number(cashDraft.roomService) || 0, hookahs: 0 }
        : { total: Number(cashDraft.total) || 0, kitchen: 0, bar: 0, waiterCash: {}, roomService: 0, hookahs: Number(cashDraft.hookahs) || 0 };
    const ok = await writeCash(selectedDay, cashPoint, entry);
    setCashMessage(ok ? `✓ Касу за ${dayLabel(selectedDay)} збережено та % перераховано.` : "Не вдалося зберегти касу");
  };

  const doPayout = async () => {
    if (accrual.total <= 0) return alert("Немає суми для виплати");
    if (!confirm(`Виплатити накопичені % на суму ${money(accrual.total)}?`)) return;
    await addPayout({ id: uid(), ts: new Date().toISOString(), upTo: todayKey, total: accrual.total, perEmp: accrual.perEmp });
  };

  const recentCashRows = useMemo(() => Object.keys(cash).sort().reverse().flatMap((day) => POINTS.map((point) => ({ day, point, rec: getPointCash(cash, day, point) })).filter(({ rec }) => rec.kitchen || rec.bar || rec.total || Object.keys(rec.waiterCash || {}).length)).slice(0, 30), [cash]);

  return <main style={{ maxWidth: 1180, margin: "0 auto" }}>
    <Header onLogout={onLogout} subtitle={`Адміністратор · ${me.name || ""}`} />
    <div style={S.stats}>
      <Stat title="Фонд ставок" value={money(totalPay)} />
      <Stat title="Накопичено %" value={money(accrual.total)} ember />
      <Stat title="Нерозподілено" value={money(accrual.undistributed)} />
    </div>
    <nav style={S.tabs}>{[
      ["control", "Центр керування"], ["day", "День"], ["cash", "Каса та %"], ["grid", "Табель"], ["pay", "Зарплата"], ["finance", "Фінзвіт"], ["requests", "Запити"], ["announcements", "Оголошення"], ["staff", "Персонал"], ["rules", "Правила"],
    ].map(([key, label]) => <button key={key} style={{ ...S.tab, ...(tab === key ? S.tabOn : {}) }} onClick={() => setTab(key)}>{label}</button>)}</nav>

    {tab === "control" && <>
      <div style={S.stats}><Stat title="Не відмітилися сьогодні" value={missingToday.length} ember={missingToday.length>0}/><Stat title="Проблеми в даних" value={anomalies.length}/><Stat title="Прогноз виплат" value={money(forecastPayroll)}/></div>
      <div style={{...S.card,marginBottom:12}}><div style={S.sectionHead}><h2 style={S.h2}>План / факт · {MONTHS[month.getMonth()]}</h2><MonthNav month={month} setMonth={setMonth}/></div><div style={S.progress}><div style={{...S.progressBar,width:`${planProgress}%`}}/></div><p style={S.hint}>{money(monthTotalCash)} із {monthPlan?money(monthPlan):"план не задано"} · {fmt(planProgress)}%</p><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><input style={S.input} type="number" placeholder="Місячний план" value={planDraft} onChange={e=>setPlanDraft(e.target.value)}/><button style={S.primary} onClick={saveMonthPlan}>Зберегти план</button><button style={S.ghost} onClick={toggleMonthClose}>{monthClosed?"Відкрити місяць":"Закрити місяць"}</button></div></div>
      <div style={{...S.card,marginBottom:12}}><h2 style={S.h2}>Порівняння об’єктів</h2>{pointComparison.map(x=><div key={x.point} style={S.metricRow}><b>{x.point}</b><span>Каса {money(x.cash)}</span><span>% {money(x.percent)}</span><span>Працівників {x.workers}</span></div>)}</div>
      <div style={{...S.card,marginBottom:12}}><h2 style={S.h2}>Хто не відмітився сьогодні</h2>{missingToday.length?missingToday.map(p=><div style={S.lineRow} key={p.id}><span>{p.name}<small style={S.smallText}>{p.point} · {p.profession}</small></span><button style={S.ghost} onClick={()=>writeShift(todayKey,p.id,"off")}>Поставити вихідний</button></div>):<p style={S.success}>✓ Усі відмітилися</p>}</div>
      <div style={{...S.card,marginBottom:12}}><h2 style={S.h2}>Перевірка даних</h2>{anomalies.length?anomalies.slice(0,20).map(x=><div key={x} style={S.alertRow}>⚠ {x}</div>):<p style={S.success}>✓ Критичних помилок не знайдено</p>}</div>
      <div style={{...S.card,marginBottom:12}}><h2 style={S.h2}>Масова дія</h2><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><input style={S.input} type="date" value={selectedDay} onChange={e=>setSelectedDay(e.target.value)}/><select style={S.input} value={massPoint} onChange={e=>setMassPoint(e.target.value)}>{POINTS.map(p=><option key={p}>{p}</option>)}</select><select style={S.input} value={massStatus} onChange={e=>setMassStatus(e.target.value)}><option value="off">Вихідний</option><option value="training">Стажування</option><option value="1">Повна</option><option value="0.5">Пів зміни</option></select><button style={S.primary} onClick={applyMassStatus}>Застосувати всім</button></div></div>
      <div style={S.card}><h2 style={S.h2}>Журнал адміністратора</h2>{(audit||[]).slice().reverse().slice(0,30).map(a=><div key={a.id} style={S.auditRow}><span><b>{a.action}</b><small style={S.smallText}>{a.details}</small></span><small>{new Date(a.ts).toLocaleString("uk-UA")} · {a.admin}</small></div>)}</div>
    </>}

    {tab === "day" && <div style={S.card}>
      <div style={S.sectionHead}><h2 style={S.h2}>Графік на день</h2><input style={S.input} type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} /></div>
      {Object.entries(byPointProfession).map(([group, people]) => {
        const [point, profession] = group.split("|");
        return <section key={group}><div style={S.label}>{point} · {profession}</div>{people.map((p) => {
          const value = shifts[selectedDay]?.[p.id];
          return <div key={p.id} style={{ ...S.row, ...(value !== undefined ? { borderColor: "#e8763a" } : {}) }}>
            <b>{p.name}</b>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[[1, "Повна"], [0.5, "½"], ["training", "Стажування"], ["off", "Вихідний"]].map(([v, label]) => <button key={String(v)} style={{ ...S.chip, ...(value === v ? S.chipOn : {}) }} onClick={() => writeShift(selectedDay, p.id, value === v ? null : v)}>{label}</button>)}
            </div>
          </div>;
        })}</section>;
      })}
    </div>}

    {tab === "cash" && <>
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={S.sectionHead}><h2 style={S.h2}>Каса та автоматичний %</h2><input style={S.input} type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} /></div>
        <div style={S.pointTabs}>{POINTS.map((point) => <button key={point} style={{ ...S.tab, ...(cashPoint === point ? S.tabOn : {}) }} onClick={() => setCashPoint(point)}>{point}</button>)}</div>
        {cashPoint === "Полум'я" ? <>
          <div style={S.formGrid}>
            <Field label="Кухонна каса"><input style={S.inputFull} type="number" min="0" value={cashDraft.kitchen} onChange={(e) => setCashDraft({ ...cashDraft, kitchen: e.target.value })} /></Field>
            <Field label="Барна каса"><input style={S.inputFull} type="number" min="0" value={cashDraft.bar} onChange={(e) => setCashDraft({ ...cashDraft, bar: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 16 }}><div style={S.label}>Особиста каса кожного офіціанта</div>{waiters.map((p) => <div key={p.id} style={S.cashInputRow}><span><b>{p.name}</b><small style={S.smallText}>Його % рахується лише від цієї суми</small></span><input style={{ ...S.input, width: 160 }} type="number" min="0" placeholder="0" value={cashDraft.waiterCash[p.id] || ""} onChange={(e) => setCashDraft({ ...cashDraft, waiterCash: { ...cashDraft.waiterCash, [p.id]: e.target.value } })} /></div>)}</div>
        </> : cashPoint === "Підгір'я" ? <div style={S.formGrid}>
          <Field label="Загальна каса · Підгір’я"><input style={S.inputFull} type="number" min="0" value={cashDraft.total} onChange={(e) => setCashDraft({ ...cashDraft, total: e.target.value })} /></Field>
          <Field label="Room service, ₴ (окремо)"><input style={S.inputFull} type="number" min="0" value={cashDraft.roomService} onChange={(e) => setCashDraft({ ...cashDraft, roomService: e.target.value })} /></Field>
        </div> : <div style={S.formGrid}>
          <Field label="Загальна каса · SPA"><input style={S.inputFull} type="number" min="0" value={cashDraft.total} onChange={(e) => setCashDraft({ ...cashDraft, total: e.target.value })} /></Field>
          <Field label="Кількість кальянів"><input style={S.inputFull} type="number" min="0" step="1" value={cashDraft.hookahs} onChange={(e) => setCashDraft({ ...cashDraft, hookahs: e.target.value })} /></Field>
          <div style={S.detailBox}>Кальяни: {Number(cashDraft.hookahs) || 0} × {money((percentDraft.SPA || DEFAULT_PERCENT_RULES.SPA).hookahUnitRate)} = <b>{money((Number(cashDraft.hookahs) || 0) * Number((percentDraft.SPA || DEFAULT_PERCENT_RULES.SPA).hookahUnitRate || 0))}</b></div>
        </div>}
        <button style={{ ...S.primary, marginTop: 14 }} onClick={saveCashNow}>Зберегти касу та перерахувати %</button>
        {cashMessage && <p style={cashMessage.startsWith("✓") ? S.success : S.error}>{cashMessage}</p>}
      </div>

      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={S.sectionHead}><h2 style={S.h2}>Умови % · {cashPoint}</h2><button style={S.primary} onClick={() => saveSettings({ ...settings, percentRules: percentDraft })}>Зберегти умови %</button></div>
        <p style={S.hint}>Умови можна змінювати в будь-який момент. Після збереження всі невиплачені нарахування автоматично перерахуються.</p>
        <PercentEditor point={cashPoint} value={percentDraft[cashPoint] || DEFAULT_PERCENT_RULES[cashPoint]} onChange={(value) => setPercentDraft({ ...percentDraft, [cashPoint]: value })} />
      </div>

      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={S.sectionHead}><h2 style={S.h2}>Нараховано · {cashPoint}</h2><button style={{ ...S.primary, background: "#607454" }} onClick={doPayout}>Виплатити всі % · {money(accrual.total)}</button></div>
        {normalizedStaff.filter((p) => p.point === cashPoint && PERCENT_PROFESSIONS.includes(p.profession)).map((p) => <div key={p.id} style={S.lineRow}><span><b>{p.name}</b><small style={S.smallText}>{p.profession}</small></span><strong style={{ color: "#ff9a64" }}>{money(accrual.perEmp[p.id] || 0)}</strong></div>)}
        {cashPoint === "Полум'я" && waiters.map((p) => {
          const d = accrual.waiterDetails[p.id];
          return d ? <div key={`detail-${p.id}`} style={S.detailBox}><b>{p.name}</b>: особиста каса {money(d.cash)} → офіціанту {money(d.netToWaiter)} · бару {money(d.barPart)} · прибиранню {money(d.cleaningPart)}</div> : null;
        })}
      </div>

      <div style={S.card}>
        <h2 style={S.h2}>Збережені каси</h2>
        {recentCashRows.length ? recentCashRows.map(({ day, point, rec }) => <div key={`${day}-${point}`} style={S.savedRow}>
          <div><b>{dayLabel(day)} · {point}</b><small style={S.smallText}>{point === "Полум'я" ? `Кухня ${money(rec.kitchen)} · Бар ${money(rec.bar)}` : point === "Підгір'я" ? `Каса ${money(rec.total)} · Room service ${money(rec.roomService)}` : `Каса ${money(rec.total)} · Кальяни ${rec.hookahs} шт. (${money(rec.hookahs * Number((settings.percentRules?.SPA || DEFAULT_PERCENT_RULES.SPA).hookahUnitRate || 0))})`}</small></div>
          <div style={{ textAlign: "right" }}><b>{money(point === "Полум'я" ? rec.kitchen + rec.bar : rec.total)}</b><small style={S.smallText}>{Object.values(rec.waiterCash || {}).reduce((s, value) => s + Number(value || 0), 0) > 0 ? `Особисті каси: ${money(Object.values(rec.waiterCash).reduce((s, value) => s + Number(value || 0), 0))}` : ""}</small></div>
        </div>) : <p style={S.hint}>Ще немає збережених кас.</p>}
      </div>
    </>}

    {tab === "grid" && <div style={S.card}>
      <div style={S.sectionHead}><h2 style={S.h2}>Табель</h2><MonthNav month={month} setMonth={setMonth} /></div>
      <div style={{ overflowX: "auto" }}><table style={S.table}><thead><tr><th>Ім'я</th>{Array.from({ length: monthDays }, (_, i) => <th key={i}>{i + 1}</th>)}</tr></thead><tbody>{normalizedStaff.map((p) => <tr key={p.id}><td style={S.stickyName}>{p.name}</td>{Array.from({ length: monthDays }, (_, i) => {
        const day = `${monthPrefix}-${pad(i + 1)}`;
        const value = shifts[day]?.[p.id];
        const nextValue = value === undefined ? 1 : value === 1 ? 0.5 : value === 0.5 ? "training" : value === "training" ? "off" : null;
        return <td key={i}><button title={String(value || "")} style={{ ...S.cell, background: value === 1 ? "#e8763a" : value === 0.5 ? "linear-gradient(135deg,#e8763a 50%,#2a2722 50%)" : value === "training" ? "#766243" : value === "off" ? "#64605a" : "#2a2722" }} onClick={() => writeShift(day, p.id, nextValue)} /></td>;
      })}</tr>)}</tbody></table></div>
      <p style={S.hint}>Клік: повна → половина → стажування → вихідний → порожньо.</p>
    </div>}

    {tab === "pay" && <div style={S.card}>
      <PeriodNav period={period} setPeriod={setPeriod} />
      <div style={{ overflowX: "auto", marginTop: 14 }}><table style={{ ...S.table, width: "100%" }}><thead><tr><th>Працівник</th><th>Точка</th><th>Професія</th><th>Повних</th><th>½</th><th>Стаж.</th><th>Оплач. змін</th><th>Ставка</th><th>За зміни</th><th>%</th></tr></thead><tbody>{normalizedStaff.map((p) => {
        const st = stats[p.id] || { full: 0, half: 0, training: 0, total: 0 };
        return <tr key={p.id}><td>{p.name}</td><td>{p.point}</td><td>{p.profession}</td><td>{st.full}</td><td>{st.half}</td><td>{st.training}</td><td>{fmt(st.total)}</td><td>{money(p.rate)}</td><td>{money(st.total * p.rate)}</td><td>{PERCENT_PROFESSIONS.includes(p.profession) ? money(accrual.perEmp[p.id] || 0) : "—"}</td></tr>;
      })}</tbody></table></div>
    </div>}

    {tab === "finance" && <div style={S.card}>
      <div style={S.sectionHead}>
        <h2 style={S.h2}>Місячний фінансовий звіт</h2>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><MonthNav month={month} setMonth={setMonth} /><button style={S.ghost} onClick={exportCsv}>Експорт CSV</button></div>
      </div>

      <div style={S.stats}>
        {POINTS.map((point) => (
          <Stat key={point} title={`${point} · каса`} value={money(monthCashSummary[point].total)} />
        ))}
      </div>

      <div className="finance-report">
        <div className="finance-report-head">
          <span>Об’єкт</span><span>Кухня</span><span>Бар</span><span>Загальна каса</span><span>Особисті каси</span><span>Нараховано %</span>
        </div>
        {POINTS.map((point) => (
          <div className="finance-report-row" key={point}>
            <div className="finance-title">{point}</div>
            <div><small>Кухня</small><b>{money(monthCashSummary[point].kitchen)}</b></div>
            <div><small>Бар</small><b>{money(monthCashSummary[point].bar)}</b></div>
            <div><small>Загальна каса</small><b>{money(monthCashSummary[point].total)}</b></div>
            <div><small>Особисті каси</small><b>{point === "Полум'я" ? money(monthCashSummary[point].waiter) : "—"}</b></div>
            <div><small>Нараховано %</small><b style={{ color: "#ff9a64" }}>{money(accrual.byPoint[point]?.total || 0)}</b></div>
          </div>
        ))}
      </div>

      <div style={{ ...S.card, marginTop: 16, background: "#2a2722", textAlign: "center" }}>
        <h3 style={S.h3}>🏆 Найкращий офіціант місяця</h3>
        {bestWaiter && (waiterMonthCash[bestWaiter.id] || 0) > 0
          ? <div style={S.emberAmount}>{bestWaiter.name} · {money(waiterMonthCash[bestWaiter.id])}</div>
          : <p style={S.hint}>Особисті каси офіціантів за цей місяць ще не внесені.</p>}
      </div>

      <h3 style={{ ...S.h3, marginTop: 20 }}>Каса кожного офіціанта за місяць</h3>
      <div className="waiter-report">
        <div className="waiter-report-head"><span>Офіціант</span><span>Особиста каса</span><span>Нараховано офіціанту</span></div>
        {waiters.map((person) => (
          <div className="waiter-report-row" key={person.id}>
            <span>{person.name}</span>
            <b>{money(waiterMonthCash[person.id] || 0)}</b>
            <b style={{ color: "#ff9a64" }}>{money(accrual.waiterDetails?.[person.id]?.netToWaiter || 0)}</b>
          </div>
        ))}
      </div>
    </div>}

    {tab === "requests" && <div style={S.card}><h2 style={S.h2}>Запити працівників</h2>{(requests||[]).length?(requests||[]).slice().reverse().map(r=><div key={r.id} style={S.requestAdmin}><div><b>{r.employeeName} · {r.type}</b><small style={S.smallText}>{r.point} · {new Date(r.createdAt).toLocaleString("uk-UA")}</small><p style={{margin:"7px 0"}}>{r.text}</p></div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{r.status==="new"?<><button style={S.primary} onClick={()=>decideRequest(r.id,"approved")}>Схвалити</button><button style={S.ghost} onClick={()=>decideRequest(r.id,"rejected")}>Відхилити</button></>:<b>{r.status==="approved"?"Схвалено":"Відхилено"}</b>}</div></div>):<p style={S.hint}>Нових запитів немає.</p>}</div>}

    {tab === "announcements" && <div style={S.card}><h2 style={S.h2}>Оголошення для персоналу</h2><div style={S.formGrid}><Field label="Заголовок"><input style={S.inputFull} value={announcementForm.title} onChange={e=>setAnnouncementForm({...announcementForm,title:e.target.value})}/></Field><Field label="Показувати до"><input style={S.inputFull} type="date" value={announcementForm.expiresAt} onChange={e=>setAnnouncementForm({...announcementForm,expiresAt:e.target.value})}/></Field></div><textarea style={{...S.textarea,marginTop:10}} rows={4} placeholder="Текст оголошення" value={announcementForm.text} onChange={e=>setAnnouncementForm({...announcementForm,text:e.target.value})}/><button style={{...S.primary,marginTop:8}} onClick={createAnnouncement}>Опублікувати</button><div style={{marginTop:14}}>{(announcements||[]).slice().reverse().map(a=><div style={S.notice} key={a.id}><div style={S.sectionHead}><b>{a.title}</b><button style={S.ghost} onClick={()=>saveAnnouncements((announcements||[]).filter(x=>x.id!==a.id))}>Видалити</button></div><p>{a.text}</p><small>{a.author} · {new Date(a.createdAt).toLocaleString("uk-UA")}</small></div>)}</div></div>}

    {tab === "staff" && <div style={S.card}>
      <div style={S.sectionHead}>
        <h2 style={S.h2}>Персонал</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={S.primary} onClick={() => setStaffForm({ name: "", point: "Полум'я", profession: "Офіціант", rate: "", login: "", password: "", active: true })}>+ Додати нового</button>
          <button style={S.ghost} disabled={bulkAccessBusy} onClick={createAccessForAll}>{bulkAccessBusy ? "Створюю доступи…" : "🔐 Створити входи всім"}</button>
        </div>
      </div>
      <p style={S.hint}>Кнопка «Створити входи всім» створює акаунти лише тим активним працівникам, у кого їх ще немає. Нових людей надалі додавай кнопкою «+ Додати нового».</p>
      {createdCredentials.length > 0 && <div style={{ ...S.card, marginTop: 12, background: "#2a2722" }}>
        <div style={S.sectionHead}><h3 style={S.h3}>Нові логіни та тимчасові паролі</h3><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button style={S.ghost} onClick={copyCredentials}>Копіювати</button><button style={S.ghost} onClick={downloadCredentials}>Завантажити CSV</button></div></div>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}><thead><tr>{["Працівник","Об’єкт","Професія","Логін","Пароль"].map((h)=><th key={h} style={{textAlign:"left",padding:"8px",borderBottom:"1px solid #4a443b",color:"#eee7dc"}}>{h}</th>)}</tr></thead><tbody>{createdCredentials.map((row)=><tr key={`${row.login}-${row.name}`}><td style={{padding:8,borderBottom:"1px solid #39352e"}}>{row.name}</td><td style={{padding:8,borderBottom:"1px solid #39352e"}}>{row.point}</td><td style={{padding:8,borderBottom:"1px solid #39352e"}}>{row.profession}</td><td style={{padding:8,borderBottom:"1px solid #39352e"}}><b>{row.login}</b></td><td style={{padding:8,borderBottom:"1px solid #39352e"}}><b>{row.password}</b></td></tr>)}</tbody></table></div>
        <p style={S.hint}>Збережи або скопіюй цей список зараз. Паролі після закриття сторінки не показуються повторно.</p>
      </div>}
      {staffForm && <div style={S.formBox}>
        <input style={S.input} placeholder="Ім'я" value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} />
        <select style={S.input} value={staffForm.point} onChange={(e) => { const point = e.target.value; setStaffForm({ ...staffForm, point, profession: PROFESSIONS[point][0] }); }}>{POINTS.map((point) => <option key={point}>{point}</option>)}</select>
        <select style={S.input} value={staffForm.profession} onChange={(e) => setStaffForm({ ...staffForm, profession: e.target.value })}>{PROFESSIONS[staffForm.point].map((profession) => <option key={profession}>{profession}</option>)}</select>
        <input style={S.input} type="number" min="0" placeholder="Ставка за зміну" value={staffForm.rate} onChange={(e) => setStaffForm({ ...staffForm, rate: e.target.value })} />
          <input style={S.input} autoCapitalize="none" placeholder="Особистий логін" value={staffForm.login || ""} onChange={(e) => setStaffForm({ ...staffForm, login: e.target.value })} />
          <input style={S.input} type="password" placeholder={staffForm.id ? "Новий пароль (необов’язково)" : "Тимчасовий пароль"} value={staffForm.password || ""} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} />
        <div><button style={S.primary} onClick={submitStaff}>Зберегти</button> <button style={S.ghost} onClick={() => setStaffForm(null)}>Скасувати</button></div>
      </div>}
      {POINTS.map((point) => <section key={point}><div style={S.label}>{point}</div>{normalizedStaff.filter((p) => p.point === point).map((p) => <div key={p.id} style={S.row}><span><b>{p.name}</b><small style={S.smallText}>{p.profession} · {p.rate ? `${money(p.rate)}/зміна` : "ставку не задано"}</small></span><span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}><button style={S.ghost} onClick={() => setStaffForm({ ...p, rate: String(p.rate || ""), login: p.login || "", password: "" })}>Змінити</button>{p.authUserId && <button style={S.ghost} onClick={() => resetStaffPassword(p)}>Новий пароль</button>}<button style={{ ...S.ghost, color: "#ffd4cb" }} onClick={() => confirm(`Видалити ${p.name}?`) && saveStaff(normalizedStaff.filter((x) => x.id !== p.id))}>Видалити</button></span></div>)}</section>)}
    </div>}

    {tab === "rules" && <div style={S.card}><h2 style={S.h2}>Правила</h2><textarea style={S.textarea} rows={16} value={rulesDraft} onChange={(e) => setRulesDraft(e.target.value)} /><button style={{ ...S.primary, marginTop: 10 }} onClick={() => saveRules(rulesDraft)}>Зберегти правила</button></div>}

    <footer style={S.footer}>{saveStatus?.state === "saving" ? "Зберігаю…" : saveStatus?.state === "error" ? "Помилка збереження" : `Синхронізовано: ${lastSync ? lastSync.toLocaleTimeString("uk-UA") : "—"}`} · <button style={S.linkBtn} onClick={onRefresh}>Оновити</button></footer>
  </main>;
}

function PercentEditor({ point, value, onChange }) {
  const update = (key, next) => onChange({ ...value, [key]: Number(next) || 0 });
  if (point === "Підгір'я") return <div style={S.formGrid}>
    <PercentField label="Загальний фонд від каси, %" value={value.pointRate} onChange={(v) => update("pointRate", v)} />
    <PercentField label="Частка кухні з фонду, %" value={value.kitchenShare} onChange={(v) => update("kitchenShare", v)} />
    <PercentField label="Частка залу з фонду, %" value={value.hallShare} onChange={(v) => update("hallShare", v)} />
  </div>;
  if (point === "SPA") return <div style={S.formGrid}>
    <PercentField label="Бармену від загальної каси, %" value={value.pointRate} onChange={(v) => update("pointRate", v)} />
    <PercentField label="Оплата за 1 кальян, ₴" value={value.hookahUnitRate} onChange={(v) => update("hookahUnitRate", v)} />
  </div>;
  return <div style={S.formGrid}>
    <PercentField label="Офіціанту від особистої каси, %" value={value.waiterRate} onChange={(v) => update("waiterRate", v)} />
    <PercentField label="Бару від особистої каси офіціанта, %" value={value.waiterBarRate} onChange={(v) => update("waiterBarRate", v)} />
    <PercentField label="Прибиральниці від особистої каси офіціанта, %" value={value.waiterCleaningRate} onChange={(v) => update("waiterCleaningRate", v)} />
    <PercentField label="Кухні від кухонної каси, %" value={value.kitchenRate} onChange={(v) => update("kitchenRate", v)} />
    <PercentField label="Бару від барної каси, %" value={value.barRate} onChange={(v) => update("barRate", v)} />
    <PercentField label="Прибиральниці від кухонної каси, %" value={value.cleaningRate} onChange={(v) => update("cleaningRate", v)} />
  </div>;
}
function PercentField({ label, value, onChange }) { return <Field label={label}><input style={S.inputFull} type="number" min="0" step="0.1" value={value ?? 0} onChange={(e) => onChange(e.target.value)} /></Field>; }
function Field({ label, children }) { return <label style={S.field}><span>{label}</span>{children}</label>; }
function Header({ onLogout, subtitle }) { return <header style={S.header}><div><Brand />{subtitle && <div style={S.headerSub}>{subtitle}</div>}</div><button style={S.ghost} onClick={onLogout}>Вийти</button></header>; }
function PeriodNav({ period, setPeriod }) { return <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><button style={S.nav} onClick={() => setPeriod(prevP(period))}>‹</button><b>{periodLabel(period)}</b><button style={S.nav} onClick={() => setPeriod(nextP(period))}>›</button></div>; }
function MonthNav({ month, setMonth }) { return <div style={{ display: "flex", alignItems: "center", gap: 8 }}><button style={S.nav} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><b>{MONTHS[month.getMonth()]} {month.getFullYear()}</b><button style={S.nav} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>; }
function Stat({ title, value, ember }) { return <div style={{ ...S.stat, ...(ember ? { borderColor: "#e8763a" } : {}) }}><div style={{ fontSize: 23, fontWeight: 700, color: ember ? "#ff9a64" : "#fff" }}>{value}</div><small style={{ color: "#eee7dc" }}>{title}</small></div>; }
function Mini({ title, value }) { return <div style={S.mini}><b style={{ fontSize: 20 }}>{value}</b><small style={{ color: "#eee7dc" }}>{title}</small></div>; }

const S = {
  page: { minHeight: "100vh", background: "#171512", color: "#fff", fontFamily: "Inter,sans-serif", padding: "20px 14px 44px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 },
  headerSub: { color: "#eee7dc", fontSize: 13, marginLeft: 40, marginTop: 2 },
  card: { background: "#22201c", border: "1px solid #39352e", borderRadius: 14, padding: 16 },
  h2: { margin: 0, fontFamily: "Alegreya,serif", fontSize: 21, color: "#fff" },
  h3: { margin: "0 0 12px", color: "#fff", fontFamily: "Alegreya,serif", fontSize: 18 },
  label: { color: "#dcead4", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", margin: "12px 0 8px" },
  input: { background: "#171512", border: "1px solid #4a443b", color: "#fff", borderRadius: 8, padding: "9px 12px", fontSize: 14 },
  inputFull: { width: "100%", background: "#171512", border: "1px solid #4a443b", color: "#fff", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginTop: 5 },
  primary: { background: "#e8763a", color: "#fff", border: 0, borderRadius: 8, padding: "9px 15px", fontWeight: 700 },
  ghost: { background: "transparent", color: "#fff", border: "1px solid #4a443b", borderRadius: 8, padding: "7px 12px" },
  loginBtn: { background: "#2a2722", border: "1px solid #474139", color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 15 },
  subtleCenter: { textAlign: "center", color: "#eee7dc", marginBottom: 24 },
  bigBtn: { background: "#2a2722", border: "1px solid #474139", color: "#fff", borderRadius: 12, padding: 15, fontWeight: 700 },
  bigOn: { background: "#e8763a", borderColor: "#e8763a", color: "#fff" },
  hint: { color: "#eee7dc", fontSize: 12.5, lineHeight: 1.5 },
  success: { color: "#dcead4", fontSize: 13, fontWeight: 700 },
  error: { color: "#ffd4cb", fontSize: 13 },
  emberAmount: { color: "#ff9a64", fontFamily: "Alegreya,serif", fontSize: 29, fontWeight: 700 },
  grid3: { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 14 },
  mini: { background: "#2a2722", borderRadius: 10, padding: 10, textAlign: "center", display: "grid", gap: 5 },
  pre: { whiteSpace: "pre-wrap", fontFamily: "Inter,sans-serif", lineHeight: 1.6, color: "#fff" },
  footer: { textAlign: "center", color: "#eee7dc", fontSize: 12, marginTop: 22 },
  linkBtn: { background: "none", border: 0, color: "#fff", textDecoration: "underline", padding: 0 },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 15 },
  stat: { background: "#22201c", border: "1px solid #39352e", borderRadius: 12, padding: "12px 16px" },
  tabs: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 },
  tab: { background: "transparent", border: "1px solid #3b3730", color: "#fff", borderRadius: 20, padding: "7px 15px" },
  tabOn: { background: "#e8763a", borderColor: "#e8763a", color: "#fff", fontWeight: 700 },
  pointTabs: { display: "flex", gap: 7, flexWrap: "wrap", margin: "14px 0" },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#2a2722", border: "1px solid #3b3730", borderRadius: 10, padding: "9px 12px", marginBottom: 6 },
  chip: { background: "transparent", border: "1px solid #4a443b", color: "#fff", borderRadius: 16, padding: "5px 10px" },
  chipOn: { background: "#e8763a", borderColor: "#e8763a", color: "#fff", fontWeight: 700 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 },
  field: { color: "#fff", fontSize: 12.5, fontWeight: 600 },
  cashInputRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 4px", borderBottom: "1px solid #3b3730" },
  smallText: { display: "block", color: "#eee7dc", fontSize: 11.5, marginTop: 3 },
  calendarGrid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 },
  calendarDay: { minHeight: 36, borderRadius: 8, display: "grid", placeItems: "center", background: "#2a2722", border: "1px solid #3b3730", color: "#fff", fontSize: 12 },
  calendarFull: { background: "#e8763a", borderColor: "#e8763a" },
  calendarHalf: { background: "linear-gradient(135deg,#e8763a 50%,#2a2722 50%)" },
  calendarTraining: { background: "#766243" },
  calendarOff: { background: "#64605a" },
  notice: { background: "#2a2722", border: "1px solid #4a443b", borderRadius: 10, padding: 12, marginTop: 8, color: "#fff" },
  badge: { display: "inline-block", background: "#2a2722", border: "1px solid #e8763a", color: "#fff", padding: "7px 10px", borderRadius: 18, margin: "4px 6px 4px 0", fontSize: 12 },
  requestRow: { display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid #3b3730", color: "#fff", fontSize: 12 },
  requestAdmin: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "#2a2722", border: "1px solid #3b3730", borderRadius: 10, padding: 12, marginTop: 8 },
  progress: { height: 14, background: "#171512", border: "1px solid #3b3730", borderRadius: 20, overflow: "hidden", marginTop: 14 },
  progressBar: { height: "100%", background: "#e8763a", borderRadius: 20 },
  metricRow: { display: "grid", gridTemplateColumns: "1.2fr repeat(3,1fr)", gap: 8, padding: "11px 0", borderBottom: "1px solid #3b3730", color: "#fff" },
  alertRow: { background: "#33251f", border: "1px solid #6f4531", color: "#ffd4cb", borderRadius: 8, padding: 10, marginTop: 7 },
  auditRow: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 0", borderBottom: "1px solid #3b3730", color: "#fff" },
  lineRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: "1px solid #3b3730", color: "#fff" },
  detailBox: { background: "#2a2722", color: "#fff", borderRadius: 8, padding: 10, marginTop: 7, fontSize: 12.5, lineHeight: 1.5 },
  savedRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: "1px solid #3b3730" },
  table: { borderCollapse: "collapse", fontSize: 13, color: "#fff" },
  stickyName: { position: "sticky", left: 0, background: "#22201c", whiteSpace: "nowrap", padding: "7px 9px", zIndex: 1 },
  cell: { width: 20, height: 20, borderRadius: 5, border: "1px solid #4a443b" },
  nav: { background: "#2a2722", border: "1px solid #4a443b", color: "#fff", borderRadius: 8, width: 32, height: 32 },
  formBox: { display: "grid", gap: 8, background: "#2a2722", borderRadius: 10, padding: 14, marginBottom: 14 },
  textarea: { width: "100%", background: "#171512", border: "1px solid #4a443b", color: "#fff", borderRadius: 8, padding: 12, fontSize: 14, lineHeight: 1.6 },
};
