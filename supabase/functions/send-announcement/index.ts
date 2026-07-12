import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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
    if (authError || !auth.user) throw new Error("Потрібно увійти як адміністратор");

    const { data: profile } = await service.from("profiles").select("role, active").eq("user_id", auth.user.id).maybeSingle();
    const metadata = auth.user.user_metadata || {};
    const isAdmin = (profile?.role === "admin" && profile?.active !== false) || (metadata.role === "admin" && metadata.active !== false);
    if (!isAdmin) throw new Error("Недостатньо прав адміністратора");

    const body = await req.json();
    const title = String(body.title || "Нове оголошення").trim();
    const text = String(body.text || "").trim();
    if (!text) throw new Error("Текст оголошення порожній");

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") || "mailto:admin@polumya.app",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    const { data: record, error: readError } = await service.from("app_state").select("value").eq("key", "flame:push-subscriptions").maybeSingle();
    if (readError) throw readError;
    const subscriptions = (Array.isArray(record?.value) ? record.value : []).filter((item: any) => item.enabled !== false && item.subscription?.endpoint);

    let sent = 0, removed = 0, failed = 0;
    const alive: any[] = [];
    for (const item of subscriptions) {
      try {
        await webpush.sendNotification(item.subscription, JSON.stringify({
          title: `📣 ${title}`,
          body: text,
          url: "/?section=announcements",
          tag: `announcement-${Date.now()}`,
          icon: "/icon-192.png",
          badge: "/notification-icon.svg",
        }));
        sent += 1;
        alive.push(item);
      } catch (pushError: any) {
        if (pushError?.statusCode === 404 || pushError?.statusCode === 410) removed += 1;
        else { failed += 1; alive.push(item); console.error("push error", item.employeeName, pushError); }
      }
    }

    if (removed > 0) {
      await service.from("app_state").upsert({ key: "flame:push-subscriptions", value: alive, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }

    return new Response(JSON.stringify({ ok: true, sent, failed, removed, registered: subscriptions.length }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Не вдалося надіслати оголошення" }), { status: 400, headers });
  }
});
