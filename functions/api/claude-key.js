// Cloudflare Pages Function: /api/claude-key
// Anh đặt khoá Claude (sk-ant-…) trong biến môi trường của Cloudflare Pages. AI của web chạy ở Supabase Edge Function "ai",
// nên hàm này chuyển khoá đó sang kho khoá của Supabase (bảng app_secrets) bằng chính phiên đăng nhập của người bấm:
// hàm set_app_secret trên Supabase tự kiểm tra người đó thuộc Ban giám đốc. Khoá không bao giờ trả về trình duyệt.
const SB = "https://omzyspsszmitcnejsmxq.supabase.co";
const SB_KEY = "sb_publishable_L9ww2j1N61HVF3MfpqnQcw_Vo14XjI0";
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "origin" }, 403);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "auth" }, 401);
  // Tìm khoá: ưu tiên tên thường dùng, không có thì lấy biến nào có giá trị bắt đầu bằng sk-ant-
  const names = ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "ANTHROPIC_KEY", "CLAUDE_KEY"];
  let key = names.map(n => env[n]).find(v => typeof v === "string" && v.trim());
  if (!key) key = Object.values(env).find(v => typeof v === "string" && /^sk-ant-/.test(v.trim()));
  key = (key || "").trim();
  if (!key) return json({ error: "chua_co" }, 404);
  if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key)) return json({ error: "sai_dang" }, 422);
  const r = await fetch(SB + "/rest/v1/rpc/set_app_secret", {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SB_KEY, authorization: "Bearer " + token },
    body: JSON.stringify({ sname: "claude", svalue: key })
  });
  if (!r.ok) { const t = await r.text(); return json({ error: /forbidden/.test(t) ? "khong_quyen" : "luu_loi" }, r.status === 401 ? 401 : 502); }
  return json({ ok: true, tail: key.slice(-4) });
}
