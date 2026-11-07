// Supabase Edge Function: push
// Gửi thông báo đẩy (Web Push) tới mọi máy người nhận đã bật thông báo, ngay khi có dòng mới trong bảng notifications.
// Trigger notif_push (pg_net) gọi hàm này kèm khoá riêng x-cron-key (app_secrets "cron_key"); khoá VAPID lưu ở app_secrets.
// Máy đã huỷ đăng ký (404/410) thì xoá khỏi push_subs. Deploy với verify_jwt = false (không gọi từ trình duyệt).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://namgiang-ec.pages.dev/";
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: S } = await admin.from("app_secrets").select("name,value").in("name", ["cron_key", "vapid_public", "vapid_private"]);
  const k: Record<string, string> = Object.fromEntries((S || []).map((x: any) => [x.name, x.value]));
  if (!k.cron_key || req.headers.get("x-cron-key") !== k.cron_key) return json({ error: "forbidden" }, 403);
  if (!k.vapid_public || !k.vapid_private) return json({ error: "no_vapid" }, 500);
  let id: number | null = null;
  try { id = Number((await req.json()).id); } catch (_) { /* */ }
  if (!id) return json({ error: "bad_request" }, 400);
  const { data: n } = await admin.from("notifications").select("id,user_id,title,body,link,kind").eq("id", id).maybeSingle();
  if (!n) return json({ sent: 0 });
  const { data: subs } = await admin.from("push_subs").select("id,endpoint,p256dh,auth").eq("user_id", n.user_id);
  webpush.setVapidDetails(SITE, k.vapid_public, k.vapid_private);
  const payload = JSON.stringify({ title: n.title || "Nam Giang E&C", body: n.body || "", tag: "ng-" + n.id, url: SITE + (n.link ? "#" + String(n.link).replace(/^#/, "") : "") });
  let sent = 0;
  await Promise.all((subs || []).map(async (s: any) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" });
      sent++;
      await admin.from("push_subs").update({ last_ok: new Date().toISOString() }).eq("id", s.id);
    } catch (e: any) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await admin.from("push_subs").delete().eq("id", s.id);
      else await admin.from("push_subs").update({ last_err: String((e && (e.body || e.message)) || e).slice(0, 300) }).eq("id", s.id);
    }
  }));
  return json({ sent, subs: (subs || []).length });
});
