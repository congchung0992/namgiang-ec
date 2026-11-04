// Cloudflare Pages Function: /api/geocode
// Tra toạ độ công trường từ địa chỉ dự án bằng Google Maps (Geocoding API), dùng cho thẻ thời tiết.
// Biến bí mật trên Cloudflare: GOOGLE_MAPS_KEY. Chưa đặt thì trả 503, web tự tìm bằng OpenStreetMap.
// Chỉ người đã đăng nhập mới gọi được, để khoá không bị người ngoài dùng.
const SB = "https://omzyspsszmitcnejsmxq.supabase.co";
const SB_KEY = "sb_publishable_L9ww2j1N61HVF3MfpqnQcw_Vo14XjI0";
const ACC = { ROOFTOP: "đúng địa chỉ", RANGE_INTERPOLATED: "đoạn đường", GEOMETRIC_CENTER: "tâm khu vực", APPROXIMATE: "khu vực gần đúng" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

export async function onRequestGet({ request, env }) {
  const key = env.GOOGLE_MAPS_KEY;
  if (!key) return json({ error: "chua_ket_noi" }, 503);
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(auth)) return json({ error: "auth" }, 401);
  const who = await fetch(SB + "/auth/v1/user", { headers: { apikey: SB_KEY, authorization: auth } });
  if (!who.ok) return json({ error: "auth" }, 401);
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 300);
  if (!q) return json({ error: "bad_request" }, 400);
  const r = await fetch("https://maps.googleapis.com/maps/api/geocode/json?region=vn&language=vi&components=country:VN&address=" + encodeURIComponent(q) + "&key=" + encodeURIComponent(key));
  if (!r.ok) return json({ error: "google_" + r.status }, 502);
  const j = await r.json();
  if (j.status === "ZERO_RESULTS") return json({ error: "not_found" }, 404);
  if (j.status !== "OK" || !j.results || !j.results[0]) { console.error("geocode", j.status, j.error_message); return json({ error: "google_" + j.status }, 502); }
  const x = j.results[0], g = x.geometry || {};
  return json({
    lat: +g.location.lat.toFixed(5), lon: +g.location.lng.toFixed(5),
    name: x.formatted_address, acc: ACC[g.location_type] || "vị trí", partial: !!x.partial_match
  });
}
