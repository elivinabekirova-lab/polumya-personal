import { useState, useEffect, useMemo, useRef } from "react";
import {
  enableShiftReminder,
  disableShiftReminder,
  isPushSupported,
  isReminderEnabled
} from "./pushNotifications.js";
import { supabase } from "./supabase.js";

// ─── «Полум'я та Підгір'я» · Журнал змін v3 ───
// Зарплата: періоди 21–06 та 07–20.
// Особистий %: рахується щодня від кас, мінус 5% ПДВ,
// ділиться між людьми відділу на зміні того дня, накопичується до виплати.

const K_STAFF = "flame:staff";
const K_SHIFTS = "flame:shifts";
const K_SET = "flame:settings";
const K_CASH = "flame:cash";       // { "2026-07-11": { kitchen: 12500, bar: 4300 } }
const K_PAYOUTS = "flame:payouts"; // [ { id, ts, upTo, total, perEmp } ]
const K_RULES = "flame:rules";
const K_ME = "flame:me";           // особистий ключ — запам'ятати вхід

const MONTHS = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
const MONTHS_G = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
const DOW = ["Нд","Пн","Вт","Ср","Чт","Пт","Сб"];
const DEPTS = ["Бар","Офіціанти","Кухня","Прибиральниці","Посудомийниці"];

// Відсотки за відділами: скільки % кухонної та барної каси йде відділу.
// Офіціанти: 4,5% − 0,5% (бар) − 0,5% (прибирання) = 3,5%.
const PCT = {
  "Бар":            { kitchen: 0.5, bar: 3 },
  "Офіціанти":      { kitchen: 3.5, bar: 0 },
  "Кухня":          { kitchen: 1.5, bar: 0 },
  "Прибиральниці":  { kitchen: 0.5, bar: 0 },
};
const VAT = 0.05; // 5% ПДВ віднімається з усіх відсотків

// Адміністратори за замовчуванням (логіни/паролі можна змінити в «Персонал → Адміністратори»)
const DEFAULT_ADMINS = [
  { id: "adm-elya", name: "Еля", login: "elya", pass: "Vohon-2417" },
  { id: "adm-dima", name: "Діма", login: "dima", pass: "Smereka-8203" },
  { id: "adm-dina", name: "Діна", login: "dina", pass: "Zharyna-5926" },
];

const SEED = [
  ["Бар", ["Юра","Петро","Назар","Саша","Міша"]],
  ["Офіціанти", ["Іван","Катя","Віка","Андрій","Саша","Настя"]],
  ["Кухня", ["Вася","Леся","Надя","Андрій","Діма"]],
  ["Прибиральниці", ["Леся"]],
  ["Посудомийниці", ["Наталя","Люба","Катя"]],
];

const DEFAULT_RULES = `ПРАВИЛА ЗАКРИТТЯ РАХУНКІВ ТА КАСИ (для офіціантів)

1. Рахунок закривається одразу після розрахунку гостя — не накопичуй відкриті чеки.
2. Перед закриттям звір позиції в чеку з тим, що реально було на столі.
3. Готівку тримай окремо від власних грошей. Здача — з каси, не з кишені.
4. Оплата карткою: переконайся, що термінал видав чек «успішно», і прикріпи сліп до рахунку.
5. Скасування або зміна позиції в закритому чеку — ТІЛЬКИ через адміністратора.
6. У кінці зміни: перерахуй готівку разом з адміністратором, звір суму з системою.
7. Розбіжність каси понад 50 грн — фіксується письмово в той же день.
8. Не залишай відкриту касу без нагляду. Виходиш — закрий і повідом колегу.

(Адміністратор може змінити ці правила у вкладці «Правила».)`;

const pad = (n) => String(n).padStart(2, "0");
const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n) => Number(n.toFixed(1)).toLocaleString("uk-UA");
const money = (n) => Math.round(n).toLocaleString("uk-UA") + " ₴";
const dayLabel = (key) => { const [y, m, d] = key.split("-").map(Number); return `${pad(d)} ${MONTHS_G[m - 1]}`; };

// ── зарплатні періоди ──
const periodOf = (date) => {
  const d = date.getDate(), y = date.getFullYear(), m = date.getMonth();
  if (d >= 21) { const nm = new Date(y, m + 1, 1); return { y: nm.getFullYear(), m: nm.getMonth(), half: 1 }; }
  if (d <= 6) return { y, m, half: 1 };
  return { y, m, half: 2 };
};
const periodRange = (p) => p.half === 1
  ? [new Date(p.y, p.m - 1, 21), new Date(p.y, p.m, 6)]
  : [new Date(p.y, p.m, 7), new Date(p.y, p.m, 20)];
const periodDates = (p) => {
  const [s, e] = periodRange(p), out = [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(dk(d));
  return out;
};
const periodLabel = (p) => {
  const [s, e] = periodRange(p);
  return `${pad(s.getDate())} ${MONTHS_G[s.getMonth()]} – ${pad(e.getDate())} ${MONTHS_G[e.getMonth()]} ${e.getFullYear()}`;
};
const nextP = (p) => p.half === 1 ? { ...p, half: 2 } : (() => { const d = new Date(p.y, p.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth(), half: 1 }; })();
const prevP = (p) => p.half === 2 ? { ...p, half: 1 } : (() => { const d = new Date(p.y, p.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth(), half: 2 }; })();
const samePeriod = (a, b) => a.y === b.y && a.m === b.m && a.half === b.half;

// підсумок змін за період: {id: {full, half, total}}
const periodStats = (shifts, p) => {
  const res = {};
  periodDates(p).forEach((day) => {
    const rec = shifts[day];
    if (!rec) return;
    Object.entries(rec).forEach(([id, v]) => {
      if (!res[id]) res[id] = { full: 0, half: 0, total: 0 };
      if (v === 0.5) res[id].half += 1; else res[id].full += 1;
      res[id].total += v;
    });
  });
  return res;
};

// ── особистий %: накопичення від дня після afterDay і до сьогодні ──
// Пул відділу за день = (кухня×% + бар×%) × 0,95, ділиться між людьми
// відділу на зміні того дня пропорційно до зміни (повна 1, половина 0,5).
const percentAccrual = (staff, shifts, cash, afterDay) => {
  const perEmp = {};
  let total = 0, undistributed = 0;
  const undistributedDays = [];
  Object.entries(cash).sort().forEach(([day, c]) => {
    if (afterDay && day <= afterDay) return;
    Object.entries(PCT).forEach(([dept, pct]) => {
      const pool = ((c.kitchen || 0) * pct.kitchen / 100 + (c.bar || 0) * pct.bar / 100) * (1 - VAT);
      if (pool <= 0) return;
      const workers = staff.filter((p) => p.dept === dept && shifts[day]?.[p.id]);
      const wsum = workers.reduce((s, p) => s + shifts[day][p.id], 0);
      if (!wsum) { undistributed += pool; if (!undistributedDays.includes(day)) undistributedDays.push(day); return; }
      workers.forEach((p) => {
        const share = pool * shifts[day][p.id] / wsum;
        perEmp[p.id] = (perEmp[p.id] || 0) + share;
        total += share;
      });
    });
  });
  return { perEmp, total, undistributed, undistributedDays };
};

const sGet = async (key, shared = true) => {
  try {
    if (!shared) {
      const local = window.localStorage.getItem(key);
      return local ? JSON.parse(local) : null;
    }

    const { data, error } = await supabase
      .from("app_state")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;
    return data?.value ?? null;
  } catch (e) {
    console.error("storage read", e);
    return null;
  }
};

const sSet = async (key, val, shared = true) => {
  try {
    if (!shared) {
      if (val === null || val === undefined) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(val));
      }
      return true;
    }

    const { error } = await supabase
      .from("app_state")
      .upsert(
        {
          key,
          value: val,
          updated_at: new Date().toISOString()
        },
        { onConflict: "key" }
      );

    if (error) throw error;
    return true;
  } catch (e) {
    console.error("storage write", e);
    return false;
  }
};

export default function App() {
  const [staff, setStaff] = useState([]);
  const [shifts, setShifts] = useState({});
  const [cash, setCash] = useState({});
  const [payouts, setPayouts] = useState([]);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [settings, setSettings] = useState({ admins: [] });
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [storageOk, setStorageOk] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null); // {state:'saving'|'saved'|'error'}
  const [lastSync, setLastSync] = useState(null);
  const today = new Date();

  const shiftsRef = useRef({});
  const cashRef = useRef({});
  const pendingRef = useRef(0);
  useEffect(() => { shiftsRef.current = shifts; }, [shifts]);
  useEffect(() => { cashRef.current = cash; }, [cash]);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") { setStorageOk(false); setLoading(false); return; }
      let st = await sGet(K_STAFF, true);
      if (!st) {
        st = SEED.flatMap(([dept, names]) => names.map((name) => ({ id: uid(), name, dept, rate: 0 })));
        await sSet(K_STAFF, st, true);
      }
      setStaff(st);
      setShifts((await sGet(K_SHIFTS, true)) || {});
      setCash((await sGet(K_CASH, true)) || {});
      setPayouts((await sGet(K_PAYOUTS, true)) || []);
      setRules((await sGet(K_RULES, true)) || DEFAULT_RULES);
      let se = (await sGet(K_SET, true)) || {};
      if (!se.admins || !se.admins.length) { se = { ...se, admins: DEFAULT_ADMINS }; await sSet(K_SET, se, true); }
      setSettings(se);
      const saved = await sGet(K_ME, false);
      if (saved && ((saved.type === "admin" && se.admins.some((a) => a.id === saved.adminId)) || st.some((p) => p.id === saved.id))) setMe(saved);
      setLastSync(new Date());
      setLoading(false);
    })();
  }, []);

  // ── жива синхронізація: підтягуємо чужі відмітки кожні 12 с і при поверненні на вкладку ──
  const refresh = async () => {
    if (pendingRef.current > 0) return; // не оновлюємось під час запису
    const [st, sh, c, po, ru, se] = await Promise.all([
      sGet(K_STAFF, true), sGet(K_SHIFTS, true), sGet(K_CASH, true),
      sGet(K_PAYOUTS, true), sGet(K_RULES, true), sGet(K_SET, true),
    ]);
    if (st) setStaff(st);
    if (sh) setShifts(sh);
    if (c) setCash(c);
    if (po) setPayouts(po);
    if (ru) setRules(ru);
    if (se) setSettings(se);
    setLastSync(new Date());
  };
  useEffect(() => {
    const t = setInterval(refresh, 12000);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const saveStaff = (list) => { setStaff(list); sSet(K_STAFF, list, true); };
  const saveSettings = (s) => { setSettings(s); sSet(K_SET, s, true); };
  const saveRules = (r) => { setRules(r); sSet(K_RULES, r, true); };
  const login = (session) => { setMe(session); sSet(K_ME, session, false); };
  const logout = () => { setMe(null); sSet(K_ME, null, false); };

  // ── запис відмітки: миттєво на екрані → злиття зі свіжими даними → збереження → підтвердження ──
  const writeShift = async (day, empId, val) => {
    pendingRef.current += 1;
    setSaveStatus({ state: "saving" });
    const apply = (src) => {
      const rec = { ...(src[day] || {}) };
      if (val == null) delete rec[empId]; else rec[empId] = val;
      const next = { ...src };
      if (Object.keys(rec).length) next[day] = rec; else delete next[day];
      return next;
    };
    setShifts((prev) => apply(prev)); // одразу показуємо на екрані
    // зливаємо зі свіжими даними зі сховища, щоб не затерти чужі відмітки;
    // якщо сховище не прочиталось — беремо поточний стан, нічого не втрачаючи
    const latest = await sGet(K_SHIFTS, true);
    const merged = apply(latest || shiftsRef.current);
    const ok = await sSet(K_SHIFTS, merged, true);
    if (ok) setShifts(merged);
    setSaveStatus({ state: ok ? "saved" : "error" });
    pendingRef.current -= 1;
    if (ok) setLastSync(new Date());
  };
  const writeCash = async (day, entry) => {
    pendingRef.current += 1;
    setSaveStatus({ state: "saving" });
    const apply = (src) => {
      const next = { ...src };
      if (!entry.kitchen && !entry.bar) delete next[day]; else next[day] = entry;
      return next;
    };
    setCash((prev) => apply(prev));
    const latest = await sGet(K_CASH, true);
    const merged = apply(latest || cashRef.current);
    const ok = await sSet(K_CASH, merged, true);
    if (ok) setCash(merged);
    setSaveStatus({ state: ok ? "saved" : "error" });
    pendingRef.current -= 1;
  };
  const addPayout = async (rec) => {
    const latest = await sGet(K_PAYOUTS, true);
    const next = [...(latest || payouts), rec];
    setPayouts(next);
    await sSet(K_PAYOUTS, next, true);
  };

  const lastPayoutDay = payouts.length ? payouts.map((p) => p.upTo).sort().slice(-1)[0] : null;

  if (loading) return <Shell><div style={{ textAlign: "center", marginTop: 90, color: "#EDE6D8" }}>Розпалюємо вогнище…</div></Shell>;
  if (!storageOk) return <Shell><div style={{ textAlign: "center", marginTop: 90, color: "#C96A5A", maxWidth: 420, margin: "90px auto 0" }}>
    Сховище даних недоступне в цьому режимі перегляду. Відкрий застосунок у Claude — і відмітки будуть зберігатися.
  </div></Shell>;
  if (!me) return <Shell><Login staff={staff} settings={settings} onLogin={login} /></Shell>;
  if (me.type === "emp") {
    const person = staff.find((p) => p.id === me.id);
    if (!person) { logout(); return null; }
    return <Shell><EmployeeView person={person} shifts={shifts} cash={cash} staff={staff} rules={rules}
      lastPayoutDay={lastPayoutDay} writeShift={writeShift} today={today} onLogout={logout}
      saveStatus={saveStatus} lastSync={lastSync} onRefresh={refresh} /></Shell>;
  }
  return <Shell><AdminView me={me} staff={staff} shifts={shifts} cash={cash} payouts={payouts} rules={rules} settings={settings} today={today}
    lastPayoutDay={lastPayoutDay} writeShift={writeShift} writeCash={writeCash} addPayout={addPayout}
    saveStaff={saveStaff} saveSettings={saveSettings} saveRules={saveRules} onLogout={logout}
    saveStatus={saveStatus} lastSync={lastSync} onRefresh={refresh} /></Shell>;
}

// ─────────────── ОБГОРТКА ───────────────
function Shell({ children }) {
  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Alegreya:wght@500;700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        button { cursor: pointer; font-family: inherit; }
        button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid #E8763A; outline-offset: 2px; }
        input, textarea, select { font-family: inherit; color: #EDE6D8; }
        input::placeholder, textarea::placeholder { color: #BDB5A8; opacity: 1; }
        select option { background: #1C1A17; color: #EDE6D8; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: #3A362F; border-radius: 4px; }
      `}</style>
      {children}
    </div>
  );
}

function Brand({ small }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={small ? 22 : 28} height={small ? 26 : 32} viewBox="0 0 26 30" aria-hidden="true">
        <path d="M13 1c2 5-6 8-6 15a7.5 7.5 0 0 0 15 0c0-4-2.5-6-3.5-9-2 2-2.5 4-2 6-2.5-2.5-4.5-7-3.5-12z" fill="#E8763A" />
        <path d="M2 29h22l-4-5H6l-4 5z" fill="#6B7F5E" />
      </svg>
      <span style={{ fontFamily: "'Alegreya', serif", fontSize: small ? 20 : 26, fontWeight: 700 }}>Полум'я та Підгір'я</span>
    </div>
  );
}

// ─────────────── ВХІД ───────────────
function Login({ staff, settings, onLogin }) {
  const [taps, setTaps] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const byDept = useMemo(() => {
    const g = {};
    staff.forEach((p) => { (g[p.dept] = g[p.dept] || []).push(p); });
    return g;
  }, [staff]);

  // секретний вхід: 5 натискань на логотип-вогник
  const tapBrand = () => {
    const n = taps + 1;
    if (n >= 5) { setShowAdmin(true); setTaps(0); }
    else setTaps(n);
  };

  const check = () => {
    const admin = (settings.admins || []).find(
      (a) => a.login.toLowerCase() === loginName.trim().toLowerCase() && a.pass === pass
    );
    if (admin) onLogin({ type: "admin", adminId: admin.id, name: admin.name });
    else setErr("Невірний логін або пароль");
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", paddingTop: 30 }}>
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <button onClick={tapBrand} style={{ background: "none", border: "none", color: "inherit", padding: 0 }} aria-label="Полум'я та Підгір'я">
          <Brand />
        </button>
      </div>
      <p style={{ textAlign: "center", color: "#EDE6D8", fontSize: 14, marginBottom: 26 }}>Хто ти? Обери себе, щоб відмічати свої зміни.</p>

      {Object.entries(byDept).map(([dept, people]) => (
        <div key={dept} style={{ marginBottom: 18 }}>
          <div style={S.deptLabel}>{dept}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {people.map((p) => (
              <button key={p.id} style={S.loginBtn} onClick={() => onLogin({ type: "emp", id: p.id })}>{p.name}</button>
            ))}
          </div>
        </div>
      ))}

      {showAdmin && (
        <div style={{ borderTop: "1px solid #2E2B25", marginTop: 26, paddingTop: 18 }}>
          <div style={{ ...S.deptLabel, textAlign: "center" }}>Вхід адміністратора</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
            <input style={S.input} placeholder="Логін" value={loginName} autoCapitalize="none"
              onChange={(e) => setLoginName(e.target.value)} />
            <input style={S.input} type="password" placeholder="Пароль" value={pass}
              onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && check()} />
            <button style={S.primary} onClick={check}>Увійти</button>
          </div>
          {err && <div style={{ color: "#C96A5A", fontSize: 13, textAlign: "center", marginTop: 8 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}


function ShiftReminderControl({ person }) {
  const [enabled, setEnabled] = useState(() =>
    isReminderEnabled(person.id)
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    setStatus("");

    try {
      await enableShiftReminder(person);
      setEnabled(true);
      setStatus("✓ Нагадування о 12:00 увімкнено.");
    } catch (error) {
      setStatus(error?.message || "Не вдалося увімкнути сповіщення.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setStatus("");

    try {
      await disableShiftReminder(person.id);
      setEnabled(false);
      setStatus("Нагадування вимкнено.");
    } catch (error) {
      setStatus(error?.message || "Не вдалося вимкнути сповіщення.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        ...S.card,
        marginBottom: 12,
        borderColor: enabled ? "#6B7F5E" : "#E8763A"
      }}
    >
      <h2 style={S.h2}>🔔 Нагадування про зміну</h2>

      <div
        style={{
          color: "#F5EFE5",
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: 12
        }}
      >
        Щодня о 12:00 прийде сповіщення, якщо ти ще не
        відмітив або не відмітила свою зміну.
      </div>

      {!isPushSupported() && (
        <div
          style={{
            color: "#FFD4CB",
            fontSize: 13,
            marginBottom: 10
          }}
        >
          На iPhone відкрий застосунок через іконку на
          початковому екрані, а не у звичайній вкладці Safari.
        </div>
      )}

      <button
        style={{
          ...S.primary,
          background: enabled ? "#2A2722" : "#E8763A",
          color: "#FFFFFF",
          opacity: busy ? 0.6 : 1
        }}
        disabled={busy}
        onClick={enabled ? turnOff : turnOn}
      >
        {busy
          ? "Зачекай…"
          : enabled
            ? "Вимкнути нагадування"
            : "Увімкнути нагадування о 12:00"}
      </button>

      {status && (
        <div
          style={{
            color: status.startsWith("✓")
              ? "#DCEAD4"
              : "#F5EFE5",
            fontSize: 13,
            marginTop: 10
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

// ─────────────── КАБІНЕТ СПІВРОБІТНИКА ───────────────
function EmployeeView({ person, shifts, cash, staff, rules, lastPayoutDay, writeShift, today, onLogout, saveStatus, lastSync, onRefresh }) {
  const [period, setPeriod] = useState(() => periodOf(today));
  const cur = periodOf(today);
  const tk = dk(today);
  const myToday = shifts[tk]?.[person.id];

  const stats = useMemo(() => periodStats(shifts, period), [shifts, period]);
  const mine = stats[person.id] || { full: 0, half: 0, total: 0 };
  const pay = mine.total * person.rate;
  const days = periodDates(period);

  const accrual = useMemo(() => percentAccrual(staff, shifts, cash, lastPayoutDay), [staff, shifts, cash, lastPayoutDay]);
  const myPct = accrual.perEmp[person.id] || 0;
  const pct = PCT[person.dept];

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <header style={{ ...S.header, marginBottom: 14 }}>
        <Brand small />
        <button style={S.ghost} onClick={onLogout}>Вийти</button>
      </header>

      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ fontFamily: "'Alegreya', serif", fontSize: 22, fontWeight: 700 }}>Привіт, {person.name}!</div>
        <div style={{ color: "#D5E2CE", fontSize: 13, fontWeight: 500, marginBottom: 16 }}>{person.dept}</div>

        <div style={{ fontSize: 13, color: "#EDE6D8", marginBottom: 8 }}>Сьогодні, {pad(today.getDate())} {MONTHS_G[today.getMonth()]}:</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            disabled={Boolean(myToday)}
            style={{
              ...S.bigBtn,
              ...(myToday === 1 ? S.bigOn : {}),
              ...(myToday ? { cursor: "not-allowed", opacity: myToday === 1 ? 1 : 0.45 } : {})
            }}
            onClick={() => {
              if (!myToday) writeShift(tk, person.id, 1);
            }}
          >
            🔥 Повна зміна
          </button>

          <button
            disabled={Boolean(myToday)}
            style={{
              ...S.bigBtn,
              ...(myToday === 0.5 ? S.bigOn : {}),
              ...(myToday ? { cursor: "not-allowed", opacity: myToday === 0.5 ? 1 : 0.45 } : {})
            }}
            onClick={() => {
              if (!myToday) writeShift(tk, person.id, 0.5);
            }}
          >
            ◐ Пів зміни
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: "#EDE6D8", marginTop: 10 }}>
          {myToday === 1
            ? "✓ Повну зміну збережено. Змінити її може лише адміністратор."
            : myToday === 0.5
              ? "✓ Половину зміни збережено. Змінити її може лише адміністратор."
              : "Обери тип зміни. Після збереження змінити вибір самостійно буде неможливо."}
        </div>
        {saveStatus?.state === "saving" && <div style={{ fontSize: 13, color: "#B8845A", marginTop: 6 }}>⏳ Зберігаю…</div>}
        {saveStatus?.state === "saved" && <div style={{ fontSize: 13, color: "#D5E2CE", marginTop: 6, fontWeight: 600 }}>✓ Збережено — адміністратор уже бачить твою відмітку.</div>}
        {saveStatus?.state === "error" && <div style={{ fontSize: 13, color: "#C96A5A", marginTop: 6, fontWeight: 600 }}>⚠ Не вдалося зберегти. Перевір інтернет і натисни кнопку ще раз.</div>}
      </div>

      <ShiftReminderControl person={person} />

      {/* Особистий % */}
      {pct && (
        <div style={{ ...S.card, marginBottom: 12, borderColor: "#E8763A" }}>
          <h2 style={S.h2}>Твій % з каси</h2>
          <div style={{ fontFamily: "'Alegreya', serif", fontSize: 30, fontWeight: 700, color: "#E8763A" }}>{money(myPct)}</div>
          <div style={{ fontSize: 12.5, color: "#EDE6D8", marginTop: 4 }}>
            накопичено {lastPayoutDay ? `з ${dayLabel(lastPayoutDay)} (після останньої виплати)` : "з початку роботи журналу"}
          </div>
          <div style={{ ...S.hint, marginTop: 10 }}>
            Відділ «{person.dept}»: {pct.kitchen ? `${pct.kitchen}% кухонної каси` : ""}{pct.kitchen && pct.bar ? " + " : ""}{pct.bar ? `${pct.bar}% барної каси` : ""}, мінус 5% ПДВ, ділиться між тими з відділу, хто був на зміні того дня.
          </div>
        </div>
      )}

      <div style={{ ...S.card, marginBottom: 12 }}>
        <PeriodNav period={period} setPeriod={setPeriod} isCurrent={samePeriod(period, cur)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "14px 0" }}>
          <MiniStat label="Змін" value={fmt(mine.total)} ember />
          <MiniStat label="З них половинок" value={mine.half} />
          <MiniStat label="Ставка за період" value={person.rate ? money(pay) : "—"} />
        </div>
        {!person.rate && <div style={S.hint}>Ставку ще не задано — попроси адміністратора вказати її.</div>}

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "#EDE6D8", marginBottom: 6 }}>Твої відмітки за період:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {days.map((day) => {
              const v = shifts[day]?.[person.id];
              return (
                <div key={day} title={day} style={{
                  width: 26, height: 26, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, border: "1px solid #33302A", color: v ? "#1C1A17" : "#5A554A",
                  background: v === 1 ? "#E8763A" : v === 0.5 ? "linear-gradient(135deg, #E8763A 50%, #2A2722 50%)" : "#22201C",
                  fontWeight: v ? 700 : 400,
                }}>{Number(day.slice(-2))}</div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Правила для офіціантів */}
      {person.dept === "Офіціанти" && (
        <div style={S.card}>
          <h2 style={S.h2}>📋 Правила закриття рахунків та каси</h2>
          <pre style={S.rulesText}>{rules}</pre>
        </div>
      )}

      <footer style={S.footer}>
        Ставка — двічі на місяць (21–06 та 07–20) · % — накопичується до дня виплати
        <div style={{ marginTop: 6 }}>
          Синхронізовано: {lastSync ? lastSync.toLocaleTimeString("uk-UA") : "—"} · <button style={{ ...S.ghost, padding: "3px 10px", fontSize: 12 }} onClick={onRefresh}>⟳ Оновити</button>
        </div>
      </footer>
    </div>
  );
}

// ─────────────── АДМІНІСТРАТОР ───────────────
function AdminView({ me, staff, shifts, cash, payouts, rules, settings, today, lastPayoutDay,
  writeShift, writeCash, addPayout, saveStaff, saveSettings, saveRules, onLogout, saveStatus, lastSync, onRefresh }) {
  const [tab, setTab] = useState("today");
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [period, setPeriod] = useState(() => periodOf(today));
  const [form, setForm] = useState(null);
  const [adminForm, setAdminForm] = useState(null); // null | {id?, name, login, pass}
  const [cashDay, setCashDay] = useState(() => dk(today));
  const [cashDraft, setCashDraft] = useState({ kitchen: "", bar: "" });
  const [rulesDraft, setRulesDraft] = useState(rules);
  const cur = periodOf(today);
  const tk = dk(today);

  useEffect(() => {
    const c = cash[cashDay] || {};
    setCashDraft({ kitchen: c.kitchen ? String(c.kitchen) : "", bar: c.bar ? String(c.bar) : "" });
  }, [cashDay, cash]);

  const byDept = useMemo(() => {
    const g = {};
    staff.forEach((p) => { (g[p.dept] = g[p.dept] || []).push(p); });
    return g;
  }, [staff]);

  const pStats = useMemo(() => periodStats(shifts, period), [shifts, period]);
  const totalShifts = Object.values(pStats).reduce((a, b) => a + b.total, 0);
  const totalPay = staff.reduce((s, p) => s + (pStats[p.id]?.total || 0) * p.rate, 0);

  const accrual = useMemo(() => percentAccrual(staff, shifts, cash, lastPayoutDay), [staff, shifts, cash, lastPayoutDay]);

  const cycle = (day, id) => {
    const v = shifts[day]?.[id];
    writeShift(day, id, v === undefined ? 1 : v === 1 ? 0.5 : null);
  };

  const [selDay, setSelDay] = useState(() => dk(today));
  const shiftSelDay = (dir) => {
    const [y, m, d] = selDay.split("-").map(Number);
    setSelDay(dk(new Date(y, m - 1, d + dir)));
  };

  const submitForm = () => {
    if (!form.name.trim()) return;
    const rec = { name: form.name.trim(), dept: form.dept.trim() || "Інше", rate: Number(form.rate) || 0 };
    if (form.id) saveStaff(staff.map((p) => (p.id === form.id ? { ...p, ...rec } : p)));
    else saveStaff([...staff, { id: uid(), ...rec }]);
    setForm(null);
  };

  const doPayout = () => {
    if (accrual.total <= 0) { alert("Немає накопичених відсотків для виплати."); return; }
    if (!confirm(`Виплатити всі накопичені % на суму ${money(accrual.total)}?\nПісля цього лічильник обнулиться і почне рахувати заново.`)) return;
    addPayout({ id: uid(), ts: new Date().toISOString(), upTo: tk, total: accrual.total, perEmp: accrual.perEmp });
  };

  const exportCSV = () => {
    const rows = [["Ім'я", "Відділ", "Повних змін", "Половинок", "Разом змін", "Ставка (грн)", "Ставка до виплати (грн)", "Накопичений % (грн)"]];
    staff.forEach((p) => {
      const s = pStats[p.id] || { full: 0, half: 0, total: 0 };
      rows.push([p.name, p.dept, s.full, s.half, String(s.total).replace(".", ","), p.rate,
        Math.round(s.total * p.rate), Math.round(accrual.perEmp[p.id] || 0)]);
    });
    rows.push(["РАЗОМ", "", "", "", String(totalShifts).replace(".", ","), "", Math.round(totalPay), Math.round(accrual.total)]);
    const csv = "\uFEFF" + rows.map((r) => r.join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `виплати_${periodLabel(period).replaceAll(" ", "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const mPrefix = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
  const monthTotal = (id) => {
    let t = 0;
    for (let i = 1; i <= monthDays; i++) t += shifts[`${mPrefix}-${pad(i)}`]?.[id] || 0;
    return t;
  };

  const shiftCashDay = (dir) => {
    const [y, m, d] = cashDay.split("-").map(Number);
    setCashDay(dk(new Date(y, m - 1, d + dir)));
  };

  const recentCashDays = Object.keys(cash).sort().reverse().slice(0, 10);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <header style={S.header}>
        <div>
          <Brand />
          <div style={{ color: "#EDE6D8", fontSize: 13, marginTop: 2, marginLeft: 38 }}>Кабінет адміністратора{me?.name ? ` · ${me.name}` : ""}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: saveStatus?.state === "error" ? "#C96A5A" : "#5A554A" }}>
            {saveStatus?.state === "saving" ? "⏳ зберігаю…" : saveStatus?.state === "error" ? "⚠ помилка збереження" : `синхр. ${lastSync ? lastSync.toLocaleTimeString("uk-UA") : "—"}`}
          </span>
          <button style={S.ghost} onClick={onRefresh}>⟳ Оновити</button>
          <button style={S.ghost} onClick={onLogout}>Вийти</button>
        </div>
      </header>

      <div style={S.statRow}>
        <Stat label="Змін за період" value={fmt(totalShifts)} />
        <Stat label="Фонд ставок за період" value={money(totalPay)} />
        <Stat label="Накопичено % (до виплати)" value={money(accrual.total)} ember />
      </div>

      <nav style={S.tabs}>
        {[["today", "День"], ["cash", "Каса та %"], ["grid", "Табель"], ["pay", "Зарплата"], ["staff", "Персонал"], ["rules", "Правила"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{l}</button>
        ))}
      </nav>

      {/* ── День: графік на будь-яку дату (заднім числом чи наперед) ── */}
      {tab === "today" && (() => {
        const [sy, sm, sd] = selDay.split("-").map(Number);
        const selDate = new Date(sy, sm - 1, sd);
        const isToday = selDay === tk;
        const isPast = selDay < tk;
        const isFuture = selDay > tk;
        return (
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
              <h2 style={{ ...S.h2, margin: 0 }}>Графік на день</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button style={S.navBtn} onClick={() => shiftSelDay(-1)} aria-label="Попередній день">‹</button>
                <input style={{ ...S.input, colorScheme: "dark" }} type="date" value={selDay} onChange={(e) => e.target.value && setSelDay(e.target.value)} />
                <button style={S.navBtn} onClick={() => shiftSelDay(1)} aria-label="Наступний день">›</button>
                {!isToday && <button style={S.ghost} onClick={() => setSelDay(tk)}>Сьогодні</button>}
              </div>
            </div>
            <div style={{ fontFamily: "'Alegreya', serif", fontSize: 17, marginBottom: 4 }}>
              {DOW[selDate.getDay()]}, {pad(sd)} {MONTHS_G[sm - 1]} {sy}
              {isToday && <span style={{ color: "#D5E2CE", fontSize: 12, fontFamily: "'Inter', sans-serif" }}> · сьогодні</span>}
              {isPast && <span style={{ color: "#B8845A", fontSize: 12, fontFamily: "'Inter', sans-serif" }}> · заднім числом</span>}
              {isFuture && <span style={{ color: "#EDE6D8", fontSize: 12, fontFamily: "'Inter', sans-serif" }}> · наперед</span>}
            </div>
            {isPast && lastPayoutDay && selDay <= lastPayoutDay && (
              <div style={{ ...S.hint, color: "#C96A5A", marginTop: 4, marginBottom: 8 }}>Увага: % за цей день уже виплачено ({dayLabel(lastPayoutDay)} і раніше) — зміни вплинуть лише на підрахунок змін і ставку, а не на нові відсотки.</div>
            )}
            <div style={{ marginBottom: 14 }} />
            {Object.entries(byDept).map(([dept, people]) => (
              <div key={dept} style={{ marginBottom: 16 }}>
                <div style={S.deptLabel}>{dept}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {people.map((p) => {
                    const v = shifts[selDay]?.[p.id];
                    return (
                      <div key={p.id} style={{ ...S.personRow, ...(v ? S.personOn : {}) }}>
                        <span style={{ fontWeight: 600 }}>{p.name}
                          {v === 0.5 && <span style={{ color: "#E8763A", fontSize: 13 }}> · пів зміни</span>}
                          {v === 1 && <span style={{ color: "#E8763A", fontSize: 13 }}> · повна</span>}
                        </span>
                        <span style={{ display: "flex", gap: 6 }}>
                          <button style={{ ...S.chip, ...(v === 1 ? S.chipOn : {}) }} onClick={() => writeShift(selDay, p.id, v === 1 ? null : 1)}>Повна</button>
                          <button style={{ ...S.chip, ...(v === 0.5 ? S.chipOn : {}) }} onClick={() => writeShift(selDay, p.id, v === 0.5 ? null : 0.5)}>½</button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <p style={S.hint}>Стрілками або календарем обери будь-яку дату — минулу чи майбутню — і простав зміни. Швидке масове редагування місяця є у вкладці «Табель».</p>
          </div>
        );
      })()}

      {/* ── Каса та % ── */}
      {tab === "cash" && (
        <>
          <div style={{ ...S.card, marginBottom: 12 }}>
            <h2 style={S.h2}>Денна каса</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <button style={S.navBtn} onClick={() => shiftCashDay(-1)} aria-label="Попередній день">‹</button>
              <input style={{ ...S.input, colorScheme: "dark" }} type="date" value={cashDay} onChange={(e) => e.target.value && setCashDay(e.target.value)} />
              <button style={S.navBtn} onClick={() => shiftCashDay(1)} aria-label="Наступний день">›</button>
              {cashDay === tk && <span style={{ color: "#D5E2CE", fontSize: 12 }}>сьогодні</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 460 }}>
              <label style={{ fontSize: 12, color: "#EDE6D8" }}>Кухонна каса, ₴
                <input style={{ ...S.input, width: "100%", marginTop: 4 }} type="number" min="0" placeholder="0"
                  value={cashDraft.kitchen} onChange={(e) => setCashDraft({ ...cashDraft, kitchen: e.target.value })} />
              </label>
              <label style={{ fontSize: 12, color: "#EDE6D8" }}>Барна каса, ₴
                <input style={{ ...S.input, width: "100%", marginTop: 4 }} type="number" min="0" placeholder="0"
                  value={cashDraft.bar} onChange={(e) => setCashDraft({ ...cashDraft, bar: e.target.value })} />
              </label>
            </div>
            <button style={{ ...S.primary, marginTop: 12 }} onClick={() => writeCash(cashDay, { kitchen: Number(cashDraft.kitchen) || 0, bar: Number(cashDraft.bar) || 0 })}>
              Зберегти касу за {dayLabel(cashDay)}
            </button>
            {lastPayoutDay && cashDay <= lastPayoutDay && (
              <div style={{ ...S.hint, color: "#C96A5A" }}>Увага: цей день уже входить у виплачений період ({dayLabel(lastPayoutDay)} і раніше) — зміна каси не вплине на нові нарахування.</div>
            )}

            {recentCashDays.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={S.deptLabel}>Останні внесені дні</div>
                {recentCashDays.map((d) => (
                  <button key={d} onClick={() => setCashDay(d)} style={{ ...S.ghost, marginRight: 6, marginBottom: 6 }}>
                    {dayLabel(d)} · 🍳 {money(cash[d].kitchen || 0)} · 🍺 {money(cash[d].bar || 0)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
              <h2 style={{ ...S.h2, margin: 0 }}>Накопичені %</h2>
              <button style={{ ...S.primary, background: "#6B7F5E", color: "#EDE6D8" }} onClick={doPayout}>💸 Виплатити всі % · {money(accrual.total)}</button>
            </div>
            <div style={{ ...S.hint, marginTop: 0, marginBottom: 12 }}>
              Рахується щодня від внесених кас, мінус 5% ПДВ, {lastPayoutDay ? `з дня після останньої виплати (${dayLabel(lastPayoutDay)})` : "з першого внесеного дня"}. Ставки: бар 3% барної + 0,5% кухонної · офіціанти 3,5% кухонної · кухня 1,5% · прибирання 0,5%.
            </div>

            {accrual.undistributed > 0 && (
              <div style={{ ...S.hint, color: "#C96A5A", marginBottom: 12 }}>
                ⚠ {money(accrual.undistributed)} не розподілено: у дні {accrual.undistributedDays.map(dayLabel).join(", ")} каса внесена, але у відповідному відділі ніхто не відмічений на зміні. Відміть людей у табелі заднім числом — і сума розподілиться.
              </div>
            )}

            {Object.entries(byDept).map(([dept, people]) => PCT[dept] && (
              <div key={dept} style={{ marginBottom: 12 }}>
                <div style={S.deptLabel}>{dept}</div>
                {people.map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 4px", borderBottom: "1px solid #2E2B25", fontSize: 14 }}>
                    <span>{p.name}</span>
                    <span style={{ color: "#E8763A", fontWeight: 600 }}>{money(accrual.perEmp[p.id] || 0)}</span>
                  </div>
                ))}
              </div>
            ))}

            {payouts.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={S.deptLabel}>Історія виплат %</div>
                {[...payouts].reverse().slice(0, 8).map((p) => (
                  <div key={p.id} style={{ fontSize: 13, color: "#EDE6D8", padding: "4px 0" }}>
                    {new Date(p.ts).toLocaleDateString("uk-UA")} · виплачено {money(p.total)} (нарахування по {dayLabel(p.upTo)})
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Табель ── */}
      {tab === "grid" && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ ...S.h2, margin: 0 }}>Табель</h2>
            <div style={S.monthNav}>
              <button style={S.navBtn} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Попередній місяць">‹</button>
              <div style={S.monthLabel}>{MONTHS[month.getMonth()]} {month.getFullYear()}</div>
              <button style={S.navBtn} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Наступний місяць">›</button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={{ ...S.th, textAlign: "left", position: "sticky", left: 0, background: "#22201C", zIndex: 1 }}>Ім'я</th>
                  {Array.from({ length: monthDays }, (_, i) => {
                    const d = new Date(month.getFullYear(), month.getMonth(), i + 1);
                    const wk = d.getDay() === 0 || d.getDay() === 6;
                    const boundary = i + 1 === 6 || i + 1 === 20;
                    return (
                      <th key={i} style={{ ...S.th, color: wk ? "#B8845A" : "#8A8272", borderRight: boundary ? "1px dashed #6B7F5E" : "none" }}>
                        <div>{i + 1}</div>
                        <div style={{ fontSize: 9, fontWeight: 400 }}>{DOW[d.getDay()]}</div>
                      </th>
                    );
                  })}
                  <th style={S.th}>Σ міс.</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byDept).map(([dept, people]) => [
                  <tr key={dept}><td colSpan={monthDays + 2} style={{ ...S.deptLabel, padding: "10px 4px 4px", position: "sticky", left: 0 }}>{dept}</td></tr>,
                  ...people.map((p) => (
                    <tr key={p.id}>
                      <td style={{ ...S.tdName, position: "sticky", left: 0, background: "#22201C", zIndex: 1 }}>{p.name}</td>
                      {Array.from({ length: monthDays }, (_, i) => {
                        const day = `${mPrefix}-${pad(i + 1)}`;
                        const v = shifts[day]?.[p.id];
                        const boundary = i + 1 === 6 || i + 1 === 20;
                        return (
                          <td key={i} style={{ ...S.tdCell, borderRight: boundary ? "1px dashed #3d4a36" : "none" }}>
                            <button onClick={() => cycle(day, p.id)} aria-label={`${p.name}, ${i + 1}`}
                              style={{ ...S.cellBtn,
                                background: v === 1 ? "#E8763A" : v === 0.5 ? "linear-gradient(135deg,#E8763A 50%,#2A2722 50%)" : "#2A2722",
                                boxShadow: v ? "0 0 6px rgba(232,118,58,.4)" : "none" }} />
                          </td>
                        );
                      })}
                      <td style={{ ...S.tdCell, fontWeight: 700, color: "#E8763A", whiteSpace: "nowrap" }}>{fmt(monthTotal(p.id))}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
          <p style={S.hint}>Клік по клітинці: повна → ½ → порожньо. Пунктир після 6-го та 20-го — межі зарплатних періодів.</p>
        </div>
      )}

      {/* ── Зарплата ── */}
      {tab === "pay" && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
            <h2 style={{ ...S.h2, margin: 0 }}>Зарплата за період</h2>
            <button style={S.primary} onClick={exportCSV}>⬇ Експорт CSV</button>
          </div>
          <PeriodNav period={period} setPeriod={setPeriod} isCurrent={samePeriod(period, cur)} />
          <p style={{ ...S.hint, marginTop: 8 }}>Ставка рахується за обраний період. Стовпчик «%» — накопичені відсотки з каси на зараз (вони живуть своїм графіком і обнуляються кнопкою виплати у вкладці «Каса та %»).</p>
          <table style={{ ...S.table, width: "100%", marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: "left" }}>Ім'я</th>
                <th style={S.th}>Повних</th>
                <th style={S.th}>½</th>
                <th style={S.th}>Разом</th>
                <th style={{ ...S.th, textAlign: "right" }}>Ставка</th>
                <th style={{ ...S.th, textAlign: "right" }}>За зміни</th>
                <th style={{ ...S.th, textAlign: "right" }}>% (накопич.)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byDept).map(([dept, people]) => [
                <tr key={dept}><td colSpan={7} style={{ ...S.deptLabel, padding: "10px 4px 4px" }}>{dept}</td></tr>,
                ...people.map((p) => {
                  const s = pStats[p.id] || { full: 0, half: 0, total: 0 };
                  return (
                    <tr key={p.id} style={{ borderTop: "1px solid #2E2B25" }}>
                      <td style={S.tdName}>{p.name}{!p.rate && <span style={{ color: "#C96A5A", fontSize: 11 }}> · без ставки</span>}</td>
                      <td style={{ ...S.tdPay, textAlign: "center" }}>{s.full || "·"}</td>
                      <td style={{ ...S.tdPay, textAlign: "center" }}>{s.half || "·"}</td>
                      <td style={{ ...S.tdPay, textAlign: "center", fontWeight: 600 }}>{fmt(s.total)}</td>
                      <td style={S.tdPay}>{p.rate ? money(p.rate) : "—"}</td>
                      <td style={{ ...S.tdPay, color: "#E8763A", fontWeight: 700 }}>{money(s.total * p.rate)}</td>
                      <td style={{ ...S.tdPay, color: "#D5E2CE", fontWeight: 600 }}>{PCT[p.dept] ? money(accrual.perEmp[p.id] || 0) : "—"}</td>
                    </tr>
                  );
                }),
              ])}
              <tr style={{ borderTop: "2px solid #E8763A" }}>
                <td style={{ ...S.tdName, fontFamily: "'Alegreya', serif", fontSize: 17 }}>Разом</td>
                <td /><td />
                <td style={{ ...S.tdPay, textAlign: "center", fontWeight: 700 }}>{fmt(totalShifts)}</td>
                <td />
                <td style={{ ...S.tdPay, color: "#E8763A", fontWeight: 700, fontSize: 16 }}>{money(totalPay)}</td>
                <td style={{ ...S.tdPay, color: "#D5E2CE", fontWeight: 700 }}>{money(accrual.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Персонал ── */}
      {tab === "staff" && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ ...S.h2, margin: 0 }}>Персонал</h2>
            <button style={S.primary} onClick={() => setForm({ name: "", dept: "Бар", rate: "" })}>+ Додати</button>
          </div>

          {form && (
            <div style={S.formBox}>
              <input style={S.input} placeholder="Ім'я" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input style={S.input} list="depts" placeholder="Відділ" value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })} />
              <datalist id="depts">{[...new Set([...DEPTS, ...staff.map((p) => p.dept)])].map((d) => <option key={d} value={d} />)}</datalist>
              <input style={S.input} type="number" min="0" placeholder="Ставка за зміну, ₴" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={S.primary} onClick={submitForm}>{form.id ? "Зберегти" : "Додати"}</button>
                <button style={S.ghost} onClick={() => setForm(null)}>Скасувати</button>
              </div>
            </div>
          )}

          {Object.entries(byDept).map(([dept, people]) => (
            <div key={dept} style={{ marginBottom: 14 }}>
              <div style={S.deptLabel}>{dept}{PCT[dept] && <span style={{ textTransform: "none", letterSpacing: 0 }}> · {PCT[dept].kitchen ? `${PCT[dept].kitchen}% кухні` : ""}{PCT[dept].kitchen && PCT[dept].bar ? " + " : ""}{PCT[dept].bar ? `${PCT[dept].bar}% бару` : ""} (−5% ПДВ)</span>}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {people.map((p) => (
                  <div key={p.id} style={{ ...S.personRow, cursor: "default" }}>
                    <span>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span style={{ color: "#EDE6D8", fontSize: 13 }}> · {p.rate ? `${p.rate.toLocaleString("uk-UA")} ₴/зміна` : "ставку не задано"}</span>
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button style={S.ghost} onClick={() => setForm({ id: p.id, name: p.name, dept: p.dept, rate: String(p.rate || "") })}>Змінити</button>
                      <button style={{ ...S.ghost, color: "#C96A5A" }} onClick={() => {
                        if (confirm(`Видалити ${p.name}? Відмітки залишаться в архіві.`)) saveStaff(staff.filter((x) => x.id !== p.id));
                      }}>Видалити</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ borderTop: "1px solid #2E2B25", marginTop: 20, paddingTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ ...S.deptLabel, marginBottom: 0 }}>Адміністратори</div>
              <button style={S.ghost} onClick={() => setAdminForm({ name: "", login: "", pass: "" })}>+ Додати адміна</button>
            </div>

            {adminForm && (
              <div style={S.formBox}>
                <input style={S.input} placeholder="Ім'я (напр. Еля)" value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} />
                <input style={S.input} placeholder="Логін" autoCapitalize="none" value={adminForm.login} onChange={(e) => setAdminForm({ ...adminForm, login: e.target.value })} />
                <input style={S.input} placeholder="Пароль" value={adminForm.pass} onChange={(e) => setAdminForm({ ...adminForm, pass: e.target.value })} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={S.primary} onClick={() => {
                    if (!adminForm.name.trim() || !adminForm.login.trim() || !adminForm.pass) return;
                    const rec = { name: adminForm.name.trim(), login: adminForm.login.trim().toLowerCase(), pass: adminForm.pass };
                    const admins = adminForm.id
                      ? settings.admins.map((a) => (a.id === adminForm.id ? { ...a, ...rec } : a))
                      : [...(settings.admins || []), { id: uid(), ...rec }];
                    saveSettings({ ...settings, admins });
                    setAdminForm(null);
                  }}>{adminForm.id ? "Зберегти" : "Додати"}</button>
                  <button style={S.ghost} onClick={() => setAdminForm(null)}>Скасувати</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(settings.admins || []).map((a) => (
                <div key={a.id} style={{ ...S.personRow, cursor: "default" }}>
                  <span>
                    <span style={{ fontWeight: 600 }}>{a.name}</span>
                    <span style={{ color: "#EDE6D8", fontSize: 13 }}> · логін: {a.login}</span>
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button style={S.ghost} onClick={() => setAdminForm({ ...a })}>Змінити</button>
                    <button style={{ ...S.ghost, color: "#C96A5A" }} onClick={() => {
                      if ((settings.admins || []).length <= 1) { alert("Не можна видалити останнього адміністратора."); return; }
                      if (confirm(`Видалити адміністратора ${a.name}?`)) saveSettings({ ...settings, admins: settings.admins.filter((x) => x.id !== a.id) });
                    }}>Видалити</button>
                  </span>
                </div>
              ))}
            </div>
            <p style={S.hint}>Вхід в адмін-панель прихований: на екрані вибору імені натисни 5 разів на логотип-вогник — з'явиться форма логіна й пароля. Паролі зберігай при собі й міняй тут за потреби.</p>
          </div>
        </div>
      )}

      {/* ── Правила ── */}
      {tab === "rules" && (
        <div style={S.card}>
          <h2 style={S.h2}>Правила закриття рахунків та каси</h2>
          <p style={{ ...S.hint, marginTop: 0, marginBottom: 10 }}>Цей текст бачать офіціанти у своєму кабінеті. Відредагуй під свій заклад і збережи.</p>
          <textarea style={S.textarea} rows={16} value={rulesDraft} onChange={(e) => setRulesDraft(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={S.primary} onClick={() => saveRules(rulesDraft)}>Зберегти правила</button>
            <button style={S.ghost} onClick={() => setRulesDraft(rules)}>Скасувати зміни</button>
          </div>
        </div>
      )}

      <footer style={S.footer}>Дані спільні — усі, хто відкриє застосунок, бачать той самий журнал</footer>
    </div>
  );
}

// ─────────────── ДРІБНІ КОМПОНЕНТИ ───────────────
function PeriodNav({ period, setPeriod, isCurrent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button style={S.navBtn} onClick={() => setPeriod(prevP(period))} aria-label="Попередній період">‹</button>
      <div style={{ fontFamily: "'Alegreya', serif", fontSize: 16 }}>
        {periodLabel(period)}
        {isCurrent && <span style={{ color: "#D5E2CE", fontSize: 12, fontFamily: "'Inter', sans-serif" }}> · поточний</span>}
      </div>
      <button style={S.navBtn} onClick={() => setPeriod(nextP(period))} aria-label="Наступний період">›</button>
    </div>
  );
}

function Stat({ label, value, ember }) {
  return (
    <div style={{ ...S.stat, ...(ember ? { borderColor: "#E8763A" } : {}) }}>
      <div style={{ fontFamily: "'Alegreya', serif", fontSize: 22, fontWeight: 700, color: ember ? "#E8763A" : "#EDE6D8", lineHeight: 1.3 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#EDE6D8" }}>{label}</div>
    </div>
  );
}

function MiniStat({ label, value, ember }) {
  return (
    <div style={{ background: "#2A2722", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontFamily: "'Alegreya', serif", fontSize: 20, fontWeight: 700, color: ember ? "#E8763A" : "#EDE6D8" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#EDE6D8" }}>{label}</div>
    </div>
  );
}

const S = {
  page: { minHeight: "100vh", background: "#1C1A17", color: "#EDE6D8", fontFamily: "'Inter', sans-serif", padding: "20px 14px 40px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  monthNav: { display: "flex", alignItems: "center", gap: 8 },
  monthLabel: { fontFamily: "'Alegreya', serif", fontSize: 16, minWidth: 130, textAlign: "center" },
  navBtn: { background: "#2A2722", border: "1px solid #3A362F", color: "#EDE6D8", borderRadius: 8, width: 32, height: 32, fontSize: 17 },
  statRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 16 },
  stat: { background: "#22201C", border: "1px solid #2E2B25", borderRadius: 12, padding: "12px 16px" },
  tabs: { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" },
  tab: { background: "transparent", border: "1px solid #2E2B25", color: "#EDE6D8", borderRadius: 20, padding: "7px 16px", fontSize: 14, fontWeight: 500 },
  tabActive: { background: "#E8763A", borderColor: "#E8763A", color: "#1C1A17", fontWeight: 600 },
  card: { background: "#22201C", border: "1px solid #2E2B25", borderRadius: 14, padding: "18px 16px" },
  h2: { fontFamily: "'Alegreya', serif", fontSize: 19, fontWeight: 700, margin: "0 0 14px" },
  hint: { color: "#EDE6D8", fontSize: 12.5, marginTop: 12, lineHeight: 1.5 },
  deptLabel: { color: "#D5E2CE", fontSize: 12, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 },
  personRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#2A2722", border: "1px solid #33302A", borderRadius: 10, padding: "10px 14px", fontSize: 15, gap: 8, flexWrap: "wrap" },
  personOn: { borderColor: "#E8763A", background: "#2E2620" },
  chip: { background: "transparent", border: "1px solid #3A362F", color: "#EDE6D8", borderRadius: 16, padding: "5px 12px", fontSize: 13 },
  chipOn: { background: "#E8763A", borderColor: "#E8763A", color: "#1C1A17", fontWeight: 600 },
  loginBtn: { background: "#2A2722", border: "1px solid #3A362F", color: "#EDE6D8", borderRadius: 10, padding: "10px 18px", fontSize: 15, fontWeight: 500 },
  bigBtn: { flex: 1, minWidth: 140, background: "#2A2722", border: "1px solid #3A362F", color: "#EDE6D8", borderRadius: 12, padding: "16px 12px", fontSize: 15, fontWeight: 600 },
  bigOn: { background: "#E8763A", borderColor: "#E8763A", color: "#1C1A17" },
  table: { borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "6px 4px", fontSize: 11, fontWeight: 600, color: "#EDE6D8", textAlign: "center" },
  tdName: { padding: "7px 10px 7px 4px", whiteSpace: "nowrap", fontWeight: 500, fontSize: 14 },
  tdCell: { padding: 2, textAlign: "center" },
  tdPay: { padding: "9px 6px", textAlign: "right", fontSize: 14 },
  cellBtn: { width: 20, height: 20, borderRadius: 5, border: "1px solid #3A362F" },
  primary: { background: "#E8763A", color: "#1C1A17", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 600, fontSize: 14 },
  ghost: { background: "transparent", color: "#EDE6D8", border: "1px solid #3A362F", borderRadius: 8, padding: "7px 12px", fontSize: 13 },
  formBox: { display: "flex", flexDirection: "column", gap: 8, background: "#2A2722", borderRadius: 10, padding: 14, marginBottom: 14 },
  input: { background: "#1C1A17", border: "1px solid #3A362F", color: "#EDE6D8", borderRadius: 8, padding: "9px 12px", fontSize: 14 },
  textarea: { width: "100%", background: "#1C1A17", border: "1px solid #3A362F", color: "#EDE6D8", borderRadius: 8, padding: "12px", fontSize: 13.5, lineHeight: 1.6, resize: "vertical" },
  rulesText: { whiteSpace: "pre-wrap", fontFamily: "'Inter', sans-serif", fontSize: 13.5, lineHeight: 1.7, color: "#D8D0C2", margin: 0 },
  footer: { textAlign: "center", color: "#CFC7B9", fontSize: 12, marginTop: 24 },
};
