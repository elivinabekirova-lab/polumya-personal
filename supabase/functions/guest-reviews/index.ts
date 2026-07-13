import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const KEY = "flame:guestReviews";
const id = () => crypto.randomUUID();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Supabase service settings are missing");

    const service = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "submit");

    const readReviews = async () => {
      const { data, error } = await service.from("app_state").select("value").eq("key", KEY).maybeSingle();
      if (error) throw error;
      return Array.isArray(data?.value) ? data.value : [];
    };

    const saveReviews = async (reviews: unknown[]) => {
      const { error } = await service.from("app_state").upsert(
        { key: KEY, value: reviews, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      if (error) throw error;
    };

    if (action === "submit") {
      const review = body.review || {};
      const rating = Math.max(1, Math.min(5, Number(review.rating) || 0));
      if (!rating) throw new Error("Оберіть оцінку");
      const reviews = await readReviews();
      const record = {
        id: id(),
        point: String(review.point || "Полум'я"),
        rating,
        name: String(review.name || "").slice(0, 80),
        waiter: String(review.waiter || "").slice(0, 80),
        text: String(review.text || "").slice(0, 1500),
        status: "new",
        createdAt: review.createdAt || new Date().toISOString(),
      };
      await saveReviews([record, ...reviews].slice(0, 1000));
      return new Response(JSON.stringify({ ok: true, id: record.id }), { headers: cors });
    }

    const token = (request.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) throw new Error("Потрібна авторизація адміністратора");
    const { data: userData, error: userError } = await service.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Сесію адміністратора не підтверджено");
    const metadata = userData.user.user_metadata || {};
    const { data: profile } = await service.from("profiles").select("role,active").eq("user_id", userData.user.id).maybeSingle();
    const isAdmin = (profile?.role === "admin" && profile?.active !== false) || (metadata.role === "admin" && metadata.active !== false);
    if (!isAdmin) throw new Error("Недостатньо прав");

    if (action === "list") {
      return new Response(JSON.stringify({ ok: true, reviews: await readReviews() }), { headers: cors });
    }

    if (action === "update") {
      const reviews = await readReviews();
      const next = reviews.map((review: any) => review.id === body.id ? { ...review, status: String(body.status || "resolved"), updatedAt: new Date().toISOString() } : review);
      await saveReviews(next);
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    throw new Error("Невідома дія");
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Помилка" }), { status: 400, headers: cors });
  }
});
