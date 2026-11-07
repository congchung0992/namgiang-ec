// Supabase Edge Function: ai-name
// Gợi ý tên phần giao thầu (anh Chung chốt 07/11/2026): mỗi công tác BOQ tách vật tư / nhân công thì Claude đặt tên ngắn, đúng nghề
// cho từng phần (vật tư gì, nhân công làm gì); người dùng sửa lại trên web nếu sai. Người gọi phải đăng nhập.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.5.0";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const SYS = `Bạn là QS của tổng thầu xây dựng Nam Giang. Mỗi mục là một phần giao thầu tách từ một dòng BOQ: t = "v" là phần VẬT TƯ (mua vật liệu), t = "n" là phần NHÂN CÔNG (tổ đội, thầu phụ thi công).
Đặt tên ngắn gọn, đúng nghề, tiếng Việt có dấu, tối đa 10 chữ, để sau này cộng khối lượng theo gói thầu:
- Vật tư: ghi đúng loại vật liệu cần mua và quy cách chính (mác, đường kính, chủng loại), KHÔNG ghi chữ "Vật tư" ở đầu. Ví dụ: "Bê tông thương phẩm M300", "Bê tông thương phẩm M100", "Nilon lót 2 lớp", "Cát đen san lấp", "Thép bản mã đầu cọc", "Keo chèn khe cắt mạch".
- Nhân công: bắt đầu bằng "Nhân công", nêu việc làm. Ví dụ: "Nhân công thi công bê tông lót", "Nhân công đào đất", "Nhân công đắp cát đầm chặt", "Nhân công trải nilon lót", "Nhân công xoa nền".
- Bám tên dòng BOQ, quy cách, đơn vị, hạng mục, đầu mục được cho; không bịa quy cách không có.
Trả về đủ mọi mục, giữ nguyên k.`;
const SCHEMA = {
  type: "object",
  properties: { names: { type: "array", items: { type: "object", properties: { k: { type: "string" }, name: { type: "string" } }, required: ["k", "name"], additionalProperties: false } } },
  required: ["names"],
  additionalProperties: false
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "auth" }, 401);
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "auth" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { data: S } = await admin.from("app_secrets").select("name,value").in("name", ["claude", "claude_model"]);
  const get = (n: string) => (S || []).find((x: any) => x.name === n)?.value || "";
  const key = Deno.env.get("ANTHROPIC_API_KEY") || get("claude");
  if (!key) return json({ error: "chua_ket_noi" }, 503);
  const model = MODELS.includes(get("claude_model")) ? get("claude_model") : MODELS[0], t0 = Date.now();
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 200).map((x: any) => ({ k: String(x.k || "").slice(0, 300), t: x.t === "v" ? "v" : "n", ten: String(x.name || "").slice(0, 200), quy_cach: String(x.spec || "").slice(0, 200), dvt: String(x.unit || "").slice(0, 20), hang_muc: String(x.hm || "").slice(0, 120), dau_muc: String(x.dm || "").slice(0, 120), goi: String(x.goi || "").slice(0, 120) }));
  if (!items.length) return json({ names: [] });
  const content = JSON.stringify({ muc: items });
  const r: any = { model, max_tokens: 16000, system: SYS, messages: [{ role: "user", content }], output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } } };
  if (model !== "claude-haiku-5-5") { r.betas = ["server-side-fallback-2026-07-01"]; r.fallbacks = "default"; }
  let out: any = null, err = "", used = model, tin = 0, tout = 0;
  try {
    const msg: any = await new Anthropic({ apiKey: key, timeout: 110000, maxRetries: 1 }).beta.messages.stream(r).finalMessage();
    const u = msg.usage || {}; used = msg.model || model; tin = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); tout = u.output_tokens || 0;
    const text = (msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    out = JSON.parse(text);
  } catch (e) {
    err = e instanceof Anthropic.AuthenticationError ? "sai_khoa" : e instanceof Anthropic.RateLimitError ? "het_luot" : e instanceof Anthropic.APIError && (e.status || 0) >= 500 ? "qua_tai" : "ai_error";
    console.error("name_parts", err, String((e as Error)?.message || e).slice(0, 200));
  }
  try { await admin.from("ai_usage").insert({ user_id: who.user.id, provider: "claude", action: "name_parts", model: used, in_tok: tin, out_tok: tout, ms: Date.now() - t0, ok: !err, err: err || null, project_id: String(b.pid || "").slice(0, 60) || null }); } catch (_) { /* bỏ qua */ }
  if (err || !out) return json({ error: err || "ai_error" }, 502);
  const K = new Set(items.map((x: any) => x.k));
  return json({ names: (out.names || []).filter((x: any) => x && K.has(String(x.k)) && String(x.name || "").trim()).map((x: any) => ({ k: String(x.k), name: String(x.name).trim().slice(0, 120) })), model: used });
});
