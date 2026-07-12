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
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const body = await req.json().catch(() => ({}));
    const { count, error: countError } = await service
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("active", true);
    if (countError) throw countError;
    const needsSetup = Number(count || 0) === 0;

    if (body.action === "status") {
      return new Response(JSON.stringify({ ok: true, needsSetup }), { headers });
    }
    if (body.action !== "create") throw new Error("Невідома дія");
    if (!needsSetup) {
      return new Response(JSON.stringify({ ok: false, error: "Головного адміністратора вже створено" }), { status: 409, headers });
    }

    const login = normalizeLogin(String(body.login || ""));
    const password = String(body.password || "");
    const displayName = String(body.displayName || "Адміністратор").trim();
    if (!login) throw new Error("Введи логін латинськими літерами");
    if (password.length < 8) throw new Error("Пароль має містити щонайменше 8 символів");
    if (!displayName) throw new Error("Введи ім’я");

    const email = `${login}@${AUTH_EMAIL_DOMAIN}`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, login },
    });
    if (createError) throw createError;

    const { error: profileError } = await service.from("profiles").insert({
      user_id: created.user.id,
      role: "admin",
      staff_id: null,
      display_name: displayName,
      login,
      active: true,
      updated_at: new Date().toISOString(),
    });
    if (profileError) {
      await service.auth.admin.deleteUser(created.user.id);
      throw profileError;
    }

    return new Response(JSON.stringify({ ok: true, login, email, userId: created.user.id }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Помилка" }), { status: 400, headers });
  }
});
