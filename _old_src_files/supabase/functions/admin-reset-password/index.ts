import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const AUTH_EMAIL_DOMAIN = "staff.polumya.app";
const normalizeLogin = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: current, error: currentError } = await service.auth.getUser(token);
    if (currentError || !current.user) throw new Error("Потрібна авторизація адміністратора");

    const { data: caller } = await service.from("profiles").select("role, active").eq("user_id", current.user.id).maybeSingle();
    const metadata = current.user.user_metadata || {};
    const isAdmin = (caller?.role === "admin" && caller?.active !== false) || (metadata.role === "admin" && metadata.active !== false);
    if (!isAdmin) throw new Error("Недостатньо прав адміністратора");

    const body = await req.json();
    const password = String(body.password || "");
    if (password.length < 8) throw new Error("Пароль має містити щонайменше 8 символів");

    let userId = String(body.userId || "").trim();
    if (!userId && body.login) {
      const login = normalizeLogin(String(body.login));
      const { data: profile } = await service.from("profiles").select("user_id").eq("login", login).maybeSingle();
      userId = profile?.user_id || "";
      if (!userId) {
        const email = `${login}@${AUTH_EMAIL_DOMAIN}`;
        const { data: usersPage } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
        userId = (usersPage?.users || []).find((user) => String(user.email || "").toLowerCase() === email)?.id || "";
      }
    }
    if (!userId) throw new Error("Акаунт працівника не знайдено");

    const { error } = await service.auth.admin.updateUserById(userId, { password });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Помилка" }), { status: 400, headers });
  }
});
