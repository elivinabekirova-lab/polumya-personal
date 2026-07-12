import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const AUTH_EMAIL_DOMAIN = "staff.polumya.app";

const normalizeLogin = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRole) {
      throw new Error(
        "Не налаштовані системні ключі Supabase"
      );
    }

    const service = createClient(
      supabaseUrl,
      serviceRole,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const body = await request
      .json()
      .catch(() => ({}));

    const action = String(body.action || "status");

    const { data: usersPage, error: usersError } =
      await service.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

    if (usersError) throw usersError;

    const users = usersPage?.users || [];

    const admins = users.filter(
      (user) =>
        user.user_metadata?.role === "admin" &&
        user.user_metadata?.active !== false
    );

    if (action === "status") {
      return new Response(
        JSON.stringify({
          ok: true,
          needsSetup: admins.length === 0,
        }),
        { headers }
      );
    }

    if (
      action !== "create" &&
      action !== "repair"
    ) {
      throw new Error("Невідома дія");
    }

    const login = normalizeLogin(
      String(body.login || "")
    );

    const password = String(
      body.password || ""
    );

    const displayName = String(
      body.displayName || "Адміністратор"
    ).trim();

    if (!login) {
      throw new Error(
        "Введи логін латинськими літерами"
      );
    }

    if (password.length < 8) {
      throw new Error(
        "Пароль має містити щонайменше 8 символів"
      );
    }

    const email =
      login.includes("@")
        ? login
        : `${login}@${AUTH_EMAIL_DOMAIN}`;

    const existing = users.find(
      (user) =>
        String(user.email || "").toLowerCase() ===
        email.toLowerCase()
    );

    let userId: string;

    if (existing) {
      const { error: updateError } =
        await service.auth.admin.updateUserById(
          existing.id,
          {
            password,
            email_confirm: true,
            user_metadata: {
              ...existing.user_metadata,
              role: "admin",
              login,
              display_name: displayName,
              active: true,
            },
          }
        );

      if (updateError) throw updateError;

      userId = existing.id;
    } else {
      const { data: created, error: createError } =
        await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            role: "admin",
            login,
            display_name: displayName,
            active: true,
          },
        });

      if (createError) throw createError;

      userId = created.user.id;
    }

    // Профіль створюємо, але його відсутність
    // більше не блокує вхід.
    const { error: profileError } =
      await service
        .from("profiles")
        .upsert(
          {
            user_id: userId,
            role: "admin",
            staff_id: null,
            display_name: displayName,
            login,
            active: true,
            updated_at:
              new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

    if (profileError) {
      console.error(
        "Profile upsert warning:",
        profileError
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        login,
        email,
        userId,
      }),
      { headers }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Помилка авторизації",
      }),
      {
        status: 400,
        headers,
      }
    );
  }
});
