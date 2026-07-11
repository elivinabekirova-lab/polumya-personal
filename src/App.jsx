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

const POINTS = ["Полум'я", "Підгір'я", "SPA"];
const PROFESSIONS = {
  "Полум'я": ["Офіціант", "Бармен", "Кухня", "Прибиральниця", "Студент"],
  "Підгір'я": ["Бармен"],
  SPA: ["Бармен"],
};
const PERCENT_PROFESSIONS = ["Офіціант", "Бармен", "Кухня", "Прибиральниця"];
const MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
const MONTHS_G = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const DEFAULT_ADMINS = [
  { id: "adm-elya", name: "Еля", login: "elya", pass: "Vohon-2417" },
  { id: "adm-dima", name: "Діма", login: "dima", pass: "Smereka-8203" },
  { id: "adm-dina", name: "Діна", login: "dina", pass: "Zharyna-5926" },
];

const DEFAULT_PERCENT_RULES = {
  "Полум'я": {
    waiterRate: 4.5,
    waiterBarShare: 10,
    waiterCleaningShare: 10,
    kitchenRate: 1.5,
    barRate: 3,
    cleaningRate: 0.5,
  },
  "Підгір'я": {
    waiterRate: 0,
    waiterBarShare: 0,
    waiterCleaningShare: 0,
    kitchenRate: 0,
    barRate: 3,
    cleaningRate: 0,
  },
  SPA: {
    waiterRate: 0,
    waiterBarShare: 0,
    waiterCleaningShare: 0,
    kitchenRate: 0,
    barRate: 3,
    cleaningRate: 0,
  },
};


const normalizePercentRules = (input = {}) => Object.fromEntries(
  POINTS.map((point) => [point, { ...DEFAULT_PERCENT_RULES[point], ...(input[point] || {}) }])
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
      if (!isPaidShift(value)) return;
      if (!out[id]) out[id] = { full: 0, half: 0, total: 0 };
      if (value === 1) out[id].full += 1;
      if (value === 0.5) out[id].half += 1;
      out[id].total += value;
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
      savedAt: dayRecord.savedAt || null,
    };
  }
  const rec = dayRecord[point] || {};
  return {
    kitchen: Number(rec.kitchen) || 0,
    bar: Number(rec.bar) || 0,
    total: Number(rec.total) || 0,
    waiterCash: rec.waiterCash || {},
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
          const cleanFund = personalCash * (Number(r.waiterRate) || 0) / 100 * netFactor;
          const barPart = cleanFund * (Number(r.waiterBarShare) || 0) / 100;
          const cleaningPart = cleanFund * (Number(r.waiterCleaningShare) || 0) / 100;
          const waiterPart = Math.max(0, cleanFund - barPart - cleaningPart);
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
      } else {
        const base = c.total || c.bar || c.kitchen;
        const barPool = base * (Number(r.barRate) || 0) / 100 * netFactor;
        distributePool({ pool: barPool, profession: "Бармен", point, day, staff, shifts, perEmp, byPoint, undistributed });
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
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const pending = useRef(0);

  useEffect(() => {
    (async () => {
      let loadedStaff = await sGet(K_STAFF, true);
      if (!loadedStaff?.length) {
        loadedStaff = SEED.flatMap(([profession, names]) => names.map((name) => ({ id: uid(), name, point: "Полум'я", profession, rate: 0 })));
      }
      loadedStaff = loadedStaff.map(normalizePerson);
      let loadedSettings = (await sGet(K_SETTINGS, true)) || {};
      loadedSettings = {
        ...loadedSettings,
        admins: loadedSettings.admins?.length ? loadedSettings.admins : DEFAULT_ADMINS,
        percentRules: normalizePercentRules(loadedSettings.percentRules),
      };
      setStaff(loadedStaff);
      setShifts((await sGet(K_SHIFTS, true)) || {});
      setCash((await sGet(K_CASH, true)) || {});
      setPayouts((await sGet(K_PAYOUTS, true)) || []);
      setRules((await sGet(K_RULES, true)) || DEFAULT_RULES);
      setSettings(loadedSettings);
      const savedMe = await sGet(K_ME, false);
      if (savedMe) setMe(savedMe);
      await Promise.all([sSet(K_STAFF, loadedStaff, true), sSet(K_SETTINGS, loadedSettings, true)]);
      setLastSync(new Date());
      setLoading(false);
    })();
  }, []);

  const refresh = async () => {
    if (pending.current > 0) return;
    const [st, sh, ca, po, ru, se] = await Promise.all([
      sGet(K_STAFF, true), sGet(K_SHIFTS, true), sGet(K_CASH, true), sGet(K_PAYOUTS, true), sGet(K_RULES, true), sGet(K_SETTINGS, true),
    ]);
    if (st) setStaff(st.map(normalizePerson));
    if (sh) setShifts(sh);
    if (ca) setCash(ca);
    if (po) setPayouts(po);
    if (ru) setRules(ru);
    if (se) setSettings({ ...se, percentRules: normalizePercentRules(se.percentRules) });
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
  const addPayout = async (record) => {
    const latest = (await sGet(K_PAYOUTS, true)) || payouts;
    return saveShared(K_PAYOUTS, [...latest, record], setPayouts);
  };
  const login = (session) => {
    setMe(session);
    sSet(K_ME, session, false);
  };
  const logout = () => {
    setMe(null);
    sSet(K_ME, null, false);
  };

  const lastPayoutDay = payouts.length ? [...payouts].map((p) => p.upTo).sort().at(-1) : null;

  if (loading) return <Shell><Centered>Завантажуємо дані…</Centered></Shell>;
  if (!me) return <Shell><Login staff={staff} settings={settings} onLogin={login} /></Shell>;
  if (me.type === "emp") {
    const person = staff.find((p) => p.id === me.id);
    if (!person) return <Shell><Centered>Працівника не знайдено. Вийди та зайди знову.</Centered></Shell>;
    return <Shell><EmployeeView person={person} staff={staff} shifts={shifts} cash={cash} payouts={payouts} settings={settings} rules={rules} writeShift={writeShift} onLogout={logout} lastPayoutDay={lastPayoutDay} saveStatus={saveStatus} lastSync={lastSync} onRefresh={refresh} /></Shell>;
  }
  return <Shell><AdminView me={me} staff={staff} shifts={shifts} cash={cash} payouts={payouts} settings={settings} rules={rules} writeShift={writeShift} writeCash={writeCash} saveStaff={saveStaff} saveSettings={saveSettings} saveRules={saveRules} addPayout={addPayout} onLogout={logout} lastPayoutDay={lastPayoutDay} saveStatus={saveStatus} lastSync={lastSync} onRefresh={refresh} /></Shell>;
}

function Shell({ children }) {
  return <div style={S.page}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Alegreya:wght@500;700&family=Inter:wght@400;500;600;700&display=swap');
      *{box-sizing:border-box} body{margin:0;background:#171512} button,input,textarea,select{font-family:inherit}
      button{cursor:pointer} button:disabled{cursor:not-allowed} input::placeholder,textarea::placeholder{color:#d8d0c4;opacity:.85}
      select option{background:#1c1a17;color:#fff} ::-webkit-scrollbar{height:8px;width:8px} ::-webkit-scrollbar-thumb{background:#49443c;border-radius:5px}
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

function Login({ staff, settings, onLogin }) {
  const [taps, setTaps] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const [login, setLogin] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const grouped = useMemo(() => staff.reduce((g, p) => {
    const key = `${p.point} · ${p.profession}`;
    (g[key] ||= []).push(p);
    return g;
  }, {}), [staff]);
  const tap = () => {
    const next = taps + 1;
    if (next >= 5) { setShowAdmin(true); setTaps(0); } else setTaps(next);
  };
  const enter = () => {
    const admin = (settings.admins || []).find((a) => a.login.toLowerCase() === login.trim().toLowerCase() && a.pass === pass);
    if (admin) onLogin({ type: "admin", adminId: admin.id, name: admin.name });
    else setError("Невірний логін або пароль");
  };
  return <main style={{ maxWidth: 620, margin: "0 auto", paddingTop: 24 }}>
    <button onClick={tap} style={{ display: "block", margin: "0 auto", background: "none", border: 0 }}><Brand /></button>
    <p style={S.subtleCenter}>Обери себе, щоб відмітити зміну</p>
    {Object.entries(grouped).map(([group, people]) => <section key={group} style={{ marginBottom: 16 }}>
      <div style={S.label}>{group}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{people.map((p) => <button key={p.id} style={S.loginBtn} onClick={() => onLogin({ type: "emp", id: p.id })}>{p.name}</button>)}</div>
    </section>)}
    {showAdmin && <div style={S.card}>
      <div style={S.label}>Вхід адміністратора</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input style={S.input} placeholder="Логін" value={login} onChange={(e) => setLogin(e.target.value)} />
        <input style={S.input} type="password" placeholder="Пароль" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enter()} />
        <button style={S.primary} onClick={enter}>Увійти</button>
      </div>
      {error && <div style={S.error}>{error}</div>}
    </div>}
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

function EmployeeView({ person, staff, shifts, cash, settings, rules, writeShift, onLogout, lastPayoutDay, saveStatus, lastSync, onRefresh }) {
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
    {person.profession === "Офіціант" && <div style={{ ...S.card, marginTop: 12 }}><h3 style={S.h3}>Правила</h3><pre style={S.pre}>{rules}</pre></div>}
    <ShiftReminderControl person={person} />
    <footer style={S.footer}>Синхронізовано: {lastSync ? lastSync.toLocaleTimeString("uk-UA") : "—"} · <button style={S.linkBtn} onClick={onRefresh}>Оновити</button></footer>
  </main>;
}

function AdminView({ me, staff, shifts, cash, payouts, settings, rules, writeShift, writeCash, saveStaff, saveSettings, saveRules, addPayout, onLogout, lastPayoutDay, saveStatus, lastSync, onRefresh }) {
  const today = new Date();
  const todayKey = dk(today);
  const [tab, setTab] = useState("day");
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [cashPoint, setCashPoint] = useState("Полум'я");
  const [cashDraft, setCashDraft] = useState({ kitchen: "", bar: "", total: "", waiterCash: {} });
  const [period, setPeriod] = useState(() => periodOf(today));
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [staffForm, setStaffForm] = useState(null);
  const [rulesDraft, setRulesDraft] = useState(rules);
  const [percentDraft, setPercentDraft] = useState(normalizePercentRules(settings.percentRules));
  const [cashMessage, setCashMessage] = useState("");

  useEffect(() => setPercentDraft(normalizePercentRules(settings.percentRules)), [settings.percentRules]);
  useEffect(() => {
    const rec = getPointCash(cash, selectedDay, cashPoint);
    setCashDraft({
      kitchen: rec.kitchen ? String(rec.kitchen) : "",
      bar: rec.bar ? String(rec.bar) : "",
      total: rec.total ? String(rec.total) : "",
      waiterCash: Object.fromEntries(Object.entries(rec.waiterCash || {}).map(([id, value]) => [id, value ? String(value) : ""])),
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
    const summary = Object.fromEntries(POINTS.map((point) => [point, { kitchen: 0, bar: 0, total: 0, waiter: 0 }]));
    Object.keys(cash).filter((day) => day.startsWith(monthPrefix)).forEach((day) => {
      POINTS.forEach((point) => {
        const rec = getPointCash(cash, day, point);
        summary[point].kitchen += rec.kitchen;
        summary[point].bar += rec.bar;
        summary[point].total += rec.total || rec.kitchen + rec.bar;
        summary[point].waiter += Object.values(rec.waiterCash || {}).reduce((s, value) => s + (Number(value) || 0), 0);
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

  const submitStaff = async () => {
    if (!staffForm?.name?.trim()) return;
    const point = staffForm.point || "Полум'я";
    const profession = staffForm.profession || PROFESSIONS[point][0];
    const record = { name: staffForm.name.trim(), point, profession, rate: Number(staffForm.rate) || 0 };
    const next = staffForm.id
      ? normalizedStaff.map((p) => p.id === staffForm.id ? { ...p, ...record } : p)
      : [...normalizedStaff, { id: uid(), ...record }];
    await saveStaff(next);
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
      : { total: Number(cashDraft.total) || 0, kitchen: 0, bar: Number(cashDraft.total) || 0, waiterCash: {} };
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
      ["day", "День"], ["cash", "Каса та %"], ["grid", "Табель"], ["pay", "Зарплата"], ["finance", "Фінзвіт"], ["staff", "Персонал"], ["rules", "Правила"],
    ].map(([key, label]) => <button key={key} style={{ ...S.tab, ...(tab === key ? S.tabOn : {}) }} onClick={() => setTab(key)}>{label}</button>)}</nav>

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
        </> : <Field label={`Загальна каса · ${cashPoint}`}><input style={{ ...S.inputFull, maxWidth: 340 }} type="number" min="0" value={cashDraft.total} onChange={(e) => setCashDraft({ ...cashDraft, total: e.target.value })} /></Field>}
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
          <div><b>{dayLabel(day)} · {point}</b><small style={S.smallText}>{point === "Полум'я" ? `Кухня ${money(rec.kitchen)} · Бар ${money(rec.bar)}` : `Каса ${money(rec.total)}`}</small></div>
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
      <div style={{ overflowX: "auto", marginTop: 14 }}><table style={{ ...S.table, width: "100%" }}><thead><tr><th>Працівник</th><th>Точка</th><th>Професія</th><th>Повних</th><th>½</th><th>Змін</th><th>Ставка</th><th>За зміни</th><th>%</th></tr></thead><tbody>{normalizedStaff.map((p) => {
        const st = stats[p.id] || { full: 0, half: 0, total: 0 };
        return <tr key={p.id}><td>{p.name}</td><td>{p.point}</td><td>{p.profession}</td><td>{st.full}</td><td>{st.half}</td><td>{fmt(st.total)}</td><td>{money(p.rate)}</td><td>{money(st.total * p.rate)}</td><td>{PERCENT_PROFESSIONS.includes(p.profession) ? money(accrual.perEmp[p.id] || 0) : "—"}</td></tr>;
      })}</tbody></table></div>
    </div>}

    {tab === "finance" && <div style={S.card}>
      <div style={S.sectionHead}><h2 style={S.h2}>Місячний фінансовий звіт</h2><MonthNav month={month} setMonth={setMonth} /></div>
      <div style={S.stats}>{POINTS.map((point) => <Stat key={point} title={`${point} · каса`} value={money(monthCashSummary[point].total)} />)}</div>
      <div style={{ overflowX: "auto" }}><table style={{ ...S.table, width: "100%" }}><thead><tr><th>Об'єкт</th><th>Кухня</th><th>Бар</th><th>Загальна каса</th><th>Особисті каси офіціантів</th><th>Накопичено %</th></tr></thead><tbody>{POINTS.map((point) => <tr key={point}><td><b>{point}</b></td><td>{money(monthCashSummary[point].kitchen)}</td><td>{money(monthCashSummary[point].bar)}</td><td>{money(monthCashSummary[point].total)}</td><td>{point === "Полум'я" ? money(monthCashSummary[point].waiter) : "—"}</td><td>{money(accrual.byPoint[point]?.total || 0)}</td></tr>)}</tbody></table></div>
      <div style={{ ...S.card, marginTop: 14, background: "#2a2722" }}><h3 style={S.h3}>🏆 Найкращий офіціант місяця</h3>{bestWaiter && (waiterMonthCash[bestWaiter.id] || 0) > 0 ? <div style={S.emberAmount}>{bestWaiter.name} · {money(waiterMonthCash[bestWaiter.id])}</div> : <p style={S.hint}>Особисті каси офіціантів за цей місяць ще не внесені.</p>}</div>
      <h3 style={{ ...S.h3, marginTop: 18 }}>Каса кожного офіціанта за місяць</h3>{waiters.map((p) => <div key={p.id} style={S.lineRow}><span>{p.name}</span><b>{money(waiterMonthCash[p.id] || 0)}</b></div>)}
    </div>}

    {tab === "staff" && <div style={S.card}>
      <div style={S.sectionHead}><h2 style={S.h2}>Персонал</h2><button style={S.primary} onClick={() => setStaffForm({ name: "", point: "Полум'я", profession: "Офіціант", rate: "" })}>+ Додати</button></div>
      {staffForm && <div style={S.formBox}>
        <input style={S.input} placeholder="Ім'я" value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} />
        <select style={S.input} value={staffForm.point} onChange={(e) => { const point = e.target.value; setStaffForm({ ...staffForm, point, profession: PROFESSIONS[point][0] }); }}>{POINTS.map((point) => <option key={point}>{point}</option>)}</select>
        <select style={S.input} value={staffForm.profession} onChange={(e) => setStaffForm({ ...staffForm, profession: e.target.value })}>{PROFESSIONS[staffForm.point].map((profession) => <option key={profession}>{profession}</option>)}</select>
        <input style={S.input} type="number" min="0" placeholder="Ставка за зміну" value={staffForm.rate} onChange={(e) => setStaffForm({ ...staffForm, rate: e.target.value })} />
        <div><button style={S.primary} onClick={submitStaff}>Зберегти</button> <button style={S.ghost} onClick={() => setStaffForm(null)}>Скасувати</button></div>
      </div>}
      {POINTS.map((point) => <section key={point}><div style={S.label}>{point}</div>{normalizedStaff.filter((p) => p.point === point).map((p) => <div key={p.id} style={S.row}><span><b>{p.name}</b><small style={S.smallText}>{p.profession} · {p.rate ? `${money(p.rate)}/зміна` : "ставку не задано"}</small></span><span><button style={S.ghost} onClick={() => setStaffForm({ ...p, rate: String(p.rate || "") })}>Змінити</button> <button style={{ ...S.ghost, color: "#ffd4cb" }} onClick={() => confirm(`Видалити ${p.name}?`) && saveStaff(normalizedStaff.filter((x) => x.id !== p.id))}>Видалити</button></span></div>)}</section>)}
    </div>}

    {tab === "rules" && <div style={S.card}><h2 style={S.h2}>Правила</h2><textarea style={S.textarea} rows={16} value={rulesDraft} onChange={(e) => setRulesDraft(e.target.value)} /><button style={{ ...S.primary, marginTop: 10 }} onClick={() => saveRules(rulesDraft)}>Зберегти правила</button></div>}

    <footer style={S.footer}>{saveStatus?.state === "saving" ? "Зберігаю…" : saveStatus?.state === "error" ? "Помилка збереження" : `Синхронізовано: ${lastSync ? lastSync.toLocaleTimeString("uk-UA") : "—"}`} · <button style={S.linkBtn} onClick={onRefresh}>Оновити</button></footer>
  </main>;
}

function PercentEditor({ point, value, onChange }) {
  const update = (key, next) => onChange({ ...value, [key]: Number(next) || 0 });
  if (point !== "Полум'я") return <div style={S.formGrid}><PercentField label="Барменам від загальної каси, %" value={value.barRate} onChange={(v) => update("barRate", v)} /></div>;
  return <div style={S.formGrid}>
    <PercentField label="Офіціанту від його особистої каси, %" value={value.waiterRate} onChange={(v) => update("waiterRate", v)} />
    <PercentField label="Із фонду офіціанта бару, %" value={value.waiterBarShare} onChange={(v) => update("waiterBarShare", v)} />
    <PercentField label="Із фонду офіціанта прибиранню, %" value={value.waiterCleaningShare} onChange={(v) => update("waiterCleaningShare", v)} />
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
