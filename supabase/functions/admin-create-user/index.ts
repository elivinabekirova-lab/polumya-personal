import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const AUTH_EMAIL_DOMAIN = "staff.polumya.app";
const normalizeLogin = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Потрібна авторизація адміністратора");

    const { data: caller } = await admin
      .from("profiles")
      .select("role, active")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (caller?.role !== "admin" || !caller.active) throw new Error("Недостатньо прав");

    const body = await req.json();
    const login = normalizeLogin(String(body.login || ""));
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const staffId = String(body.staffId || "").trim();
    const role = body.role === "admin" ? "admin" : "employee";
    if (!login || password.length < 6 || !name) throw new Error("Логін, ім’я та пароль від 6 символів обов’язкові");

    const email = `${login}@${AUTH_EMAIL_DOMAIN}`;
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name, login },
    });
    if (createError) throw createError;

    const { error: profileError } = await service.from("profiles").upsert({
      user_id: created.user.id,
      role,
      staff_id: role === "employee" ? staffId : null,
      display_name: name,
      login,
      active: true,
      updated_at: new Date().toISOString(),
    });
    if (profileError) {
      await service.auth.admin.deleteUser(created.user.id);
      throw profileError;
    }

    return new Response(JSON.stringify({ ok: true, userId: created.user.id, login }), { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Помилка" }), { status: 400, headers: corsHeaders });
  }
});
