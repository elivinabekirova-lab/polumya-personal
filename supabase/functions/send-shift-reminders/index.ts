import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const headers = {
  "Content-Type": "application/json"
};

function kyivDateParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour)
  };
}

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (
    !cronSecret ||
    request.headers.get("x-cron-secret") !== cronSecret
  ) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers }
    );
  }

  const { date, hour } = kyivDateParts();

  // Cron запускається щогодини, але надсилання відбувається
  // тільки о 12:00 за часовим поясом Києва.
  if (hour !== 12) {
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: "Not 12:00 in Europe/Kyiv",
        date,
        hour
      }),
      { headers }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!
  );

  const { data: stateRecord, error: stateError } =
    await supabase
      .from("app_state")
      .select("value")
      .eq("key", "flame:shifts")
      .maybeSingle();

  if (stateError) throw stateError;

  const shifts = stateRecord?.value || {};

  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("enabled", true);

  if (error) throw error;

  let sent = 0;
  let skipped = 0;
  let removed = 0;

  for (const record of subscriptions || []) {
    const alreadyMarked = Boolean(
      shifts?.[date]?.[record.employee_id]
    );

    if (
      alreadyMarked ||
      record.last_sent_on === date
    ) {
      skipped += 1;
      continue;
    }

    try {
      await webpush.sendNotification(
        record.subscription,
        JSON.stringify({
          title: "Полум’я та Підгір’я",
          body:
            `Привіт, ${record.employee_name || ""}! ` +
            "Не забудь відмітити сьогоднішню зміну.",
          url: "/"
        })
      );

      await supabase
        .from("push_subscriptions")
        .update({
          last_sent_on: date,
          updated_at: new Date().toISOString()
        })
        .eq("id", record.id);

      sent += 1;
    } catch (pushError) {
      const status =
        pushError?.statusCode ||
        pushError?.status;

      if (status === 404 || status === 410) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("id", record.id);

        removed += 1;
      } else {
        console.error(
          "Push error:",
          record.employee_id,
          pushError
        );
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      date,
      sent,
      skipped,
      removed
    }),
    { headers }
  );
});
