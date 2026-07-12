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
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Не налаштовані серверні ключі Supabase");

    const service = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) throw new Error("Потрібна авторизація адміністратора");

    const { data: current, error: currentError } = await service.auth.getUser(token);
    if (currentError || !current.user) throw new Error("Сесію адміністратора не підтверджено");

    const { data: profile } = await service
      .from("profiles")
      .select("role, active")
      .eq("user_id", current.user.id)
      .maybeSingle();

    const metadata = current.user.user_metadata || {};
    const isAdmin =
      (profile?.role === "admin" && profile?.active !== false) ||
      (metadata.role === "admin" && metadata.active !== false);
    if (!isAdmin) throw new Error("Недостатньо прав адміністратора");

    const body = await req.json();
    const login = normalizeLogin(String(body.login || ""));
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const staffId = String(body.staffId || "").trim();
    const role = body.role === "admin" ? "admin" : "employee";

    if (!login) throw new Error("Введи логін латинськими літерами");
    if (!name) throw new Error("Введи ім’я працівника");
    if (password.length < 8) throw new Error("Пароль має містити щонайменше 8 символів");
    if (role === "employee" && !staffId) throw new Error("Не знайдено ID працівника");

    const email = login.includes("@") ? login : `${login}@${AUTH_EMAIL_DOMAIN}`;
    const { data: usersPage, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw listError;

    const existing = (usersPage.users || []).find(
      (user) => String(user.email || "").toLowerCase() === email.toLowerCase(),
    );

    let userId = "";
    if (existing) {
      const { error: updateError } = await service.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...(existing.user_metadata || {}),
          display_name: name,
          login,
          role,
          staff_id: role === "employee" ? staffId : null,
          active: true,
        },
      });
      if (updateError) throw updateError;
      userId = existing.id;
    } else {
      const { data: created, error: createError } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: name,
          login,
          role,
          staff_id: role === "employee" ? staffId : null,
          active: true,
        },
      });
      if (createError) throw createError;
      userId = created.user.id;
    }

    const { error: profileError } = await service.from("profiles").upsert(
      {
        user_id: userId,
        role,
        staff_id: role === "employee" ? staffId : null,
        display_name: name,
        login,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (profileError) throw new Error(`Акаунт створено, але профіль не збережено: ${profileError.message}`);

    return new Response(JSON.stringify({ ok: true, userId, login, email }), { headers });
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Не вдалося створити доступ" }),
      { status: 400, headers },
    );
  }
});
