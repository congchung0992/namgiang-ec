// Supabase Edge Function: geo
// Địa điểm chấm công (anh Chung yêu cầu 08/11/2026): tìm địa chỉ theo tên và đọc link Google Maps (kể cả link rút gọn maps.app.goo.gl
// khi chia sẻ định vị từ điện thoại) ra toạ độ. Người gọi phải đăng nhập. Chỉ đi theo link của Google, không tải trang nào khác.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const OK_HOST = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+)$/i;
const UA = "Mozilla/5.0 (compatible; NamGiangEC/1.0; +https://namgiang-ec.pages.dev)";

function coords(s: string): { lat: number; lng: number } | null {
  let t = s; try { t = decodeURIComponent(s); } catch { /* giữ nguyên */ }
  const pats = [/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, /[?&](?:q|query|ll|center|destination|daddr)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/, /\/search\/(-?\d{1,2}\.\d+)\s*,\s*\+?(-?\d{1,3}\.\d+)/, /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, /\[null,null,(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)\]/];
  for (const p of pats) { const m = t.match(p); if (m) { const lat = +m[1], lng = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; } }
  return null;
}
const placeName = (u: string) => { let t = u; try { t = decodeURIComponent(u); } catch { /* giữ nguyên */ } const m = t.match(/\/place\/([^/@]+)/); return m ? m[1].replace(/\+/g, " ") : ""; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "auth" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ error: "auth" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  if (typeof body.url === "string") {
    let url = body.url.trim();
    for (let i = 0; i < 6; i++) {
      let h: URL;
      try { h = new URL(url); } catch { return json({ error: "Link không hợp lệ" }, 400); }
      if (!/^https?:$/.test(h.protocol) || !OK_HOST.test(h.hostname)) return json({ error: "Chỉ nhận link Google Maps" }, 400);
      const c = coords(url);
      if (c) return json({ ...c, name: placeName(url), url });
      const r = await fetch(url, { redirect: "manual", headers: { "user-agent": UA, "accept-language": "vi" } });
      const loc = r.headers.get("location");
      if (loc && r.status >= 300 && r.status < 400) { url = new URL(loc, url).toString(); continue; }
      const html = (await r.text()).slice(0, 400000);
      const c2 = coords(html);
      if (c2) return json({ ...c2, name: placeName(url), url });
      break;
    }
    return json({ error: "Link không có toạ độ · trong Google Maps hãy bấm giữ để thả ghim rồi Chia sẻ" }, 422);
  }

  if (typeof body.q === "string" && body.q.trim().length >= 3) {
    const p = new URLSearchParams({ q: body.q.trim(), format: "jsonv2", limit: "6", countrycodes: "vn", "accept-language": "vi", addressdetails: "0" });
    const r = await fetch("https://nominatim.openstreetmap.org/search?" + p, { headers: { "user-agent": UA, referer: "https://namgiang-ec.pages.dev" } });
    if (!r.ok) return json({ error: "Dịch vụ tìm địa chỉ đang bận, thử lại sau ít giây" }, 502);
    const a = await r.json();
    return json({ items: (a || []).map((x: any) => ({ lat: +(+x.lat).toFixed(6), lng: +(+x.lon).toFixed(6), name: x.name || "", label: x.display_name })) });
  }
  return json({ error: "bad_request" }, 400);
});
