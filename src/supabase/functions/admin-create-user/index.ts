import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const DOMAIN = "staff.polumya.app";
const normalize = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Не налаштовані серверні ключі Supabase");
    const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: current, error: currentError } = await service.auth.getUser(token);
    if (currentError || !current.user) throw new Error("Потрібна авторизація адміністратора");

    const { data: profile } = await service.from("profiles").select("role,active").eq("user_id", current.user.id).maybeSingle();
    const meta = current.user.user_metadata || {};
    const isAdmin = (profile?.role === "admin" && profile?.active !== false) || (meta.role === "admin" && meta.active !== false);
    if (!isAdmin) throw new Error("Недостатньо прав адміністратора");

    const body = await req.json();
    const login = normalize(String(body.login || ""));
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const staffId = String(body.staffId || "").trim();
    const role = body.role === "admin" ? "admin" : "employee";
    if (!login || !name || password.length < 8) throw new Error("Логін, ім’я та пароль від 8 символів обов’язкові");
    if (role === "employee" && !staffId) throw new Error("Не знайдено ID працівника");

    const email = login.includes("@") ? login : `${login}@${DOMAIN}`;
    const { data: usersPage, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw listError;
    const existing = (usersPage.users || []).find((u) => String(u.email || "").toLowerCase() === email.toLowerCase());

    let userId: string;
    if (existing) {
      const { error } = await service.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { ...(existing.user_metadata || {}), role, staff_id: role === "employee" ? staffId : null, display_name: name, login, active: true },
      });
      if (error) throw error;
      userId = existing.id;
    } else {
      const { data, error } = await service.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { role, staff_id: role === "employee" ? staffId : null, display_name: name, login, active: true },
      });
      if (error) throw error;
      userId = data.user.id;
    }

    // remove stale conflicting profile rows before upsert
    if (role === "employee") await service.from("profiles").delete().eq("staff_id", staffId).neq("user_id", userId);
    await service.from("profiles").delete().eq("login", login).neq("user_id", userId);

    const { error: profileError } = await service.from("profiles").upsert({
      user_id: userId, role, staff_id: role === "employee" ? staffId : null,
      display_name: name, login, active: true, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (profileError) throw profileError;

    return new Response(JSON.stringify({ ok: true, userId, login, email }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Помилка" }), { status: 400, headers });
  }
});
