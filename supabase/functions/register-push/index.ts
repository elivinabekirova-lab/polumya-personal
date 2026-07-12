import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    const { data: auth, error: authError } = await service.auth.getUser(token);
    if (authError || !auth.user) throw new Error("Потрібно увійти в застосунок");

    const body = await req.json();
    const { data: record, error: readError } = await service.from("app_state").select("value").eq("key", "flame:push-subscriptions").maybeSingle();
    if (readError) throw readError;
    const current = Array.isArray(record?.value) ? record.value : [];

    if (body.action === "disable") {
      const next = current.map((item: any) => item.endpoint === body.endpoint ? { ...item, enabled: false, updatedAt: new Date().toISOString() } : item);
      const { error } = await service.from("app_state").upsert({ key: "flame:push-subscriptions", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const subscription = body.subscription;
    if (!subscription?.endpoint) throw new Error("Телефон не передав push-підписку");

    const entry = {
      endpoint: subscription.endpoint,
      subscription,
      userId: auth.user.id,
      employeeId: String(body.employeeId || ""),
      employeeName: String(body.employeeName || "Працівник"),
      point: String(body.point || ""),
      enabled: true,
      updatedAt: new Date().toISOString(),
    };

    const next = [...current.filter((item: any) => item.endpoint !== entry.endpoint), entry];
    const { error } = await service.from("app_state").upsert({ key: "flame:push-subscriptions", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, count: next.length }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Помилка реєстрації" }), { status: 400, headers });
  }
});
