// Supabase Edge Function: ai-peek
// Đọc sơ bộ báo giá khi tải lên (anh Chung chốt 07/11/2026): chỉ lấy ngày, tên công ty, nội dung cung cấp để web đặt tên file
// 20261107-TenCongTy-NoiDungCungCap; phân tích giá kỹ để lúc bấm lập so sánh giá (hàm ai, action extract). Người gọi phải đăng nhập.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.5.0";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const SYS = `Bạn đọc lướt một file báo giá gửi công ty tổng thầu xây dựng Nam Giang (Nam Giang là bên NHẬN báo giá, không phải bên báo giá).
Chỉ trả về:
"date": ngày ghi trên báo giá dạng yyyy-mm-dd; không thấy thì "".
"vendor": tên ngắn của công ty/đơn vị gửi báo giá, bỏ các chữ loại hình (Công ty, Cổ phần, TNHH, MTV, Thương mại, Đầu tư, Xây dựng nếu không phải tên riêng), tối đa 4 chữ, ví dụ "Thép Hòa Phát", "Bê tông Việt Hàn"; không thấy thì "".
"scope": nội dung cung cấp/thi công chính, tối đa 6 chữ, ví dụ "Bê tông thương phẩm", "Ép cọc D350", "Cát đá xi măng".
"kind": ncc (bán vật tư/thiết bị), thau_phu (thầu phụ cung cấp và thi công, trọn gói) hoặc nhan_cong (tổ đội, nhân công).`;
const SCHEMA = {
  type: "object",
  properties: { date: { type: "string" }, vendor: { type: "string" }, scope: { type: "string" }, kind: { type: "string", enum: ["ncc", "thau_phu", "nhan_cong"] } },
  required: ["date", "vendor", "scope", "kind"],
  additionalProperties: false
};
const fileBlock = (mime: string, data: string) => mime === "application/pdf"
  ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
  : /^image\/(jpeg|png|gif|webp)$/.test(mime) ? { type: "image", source: { type: "base64", media_type: mime, data } } : null;

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
  const content: any[] = [];
  const fb = b.doc && typeof b.doc.data === "string" ? fileBlock(String(b.doc.mime || ""), b.doc.data) : null;
  if (fb) content.push(fb);
  content.push({ type: "text", text: `Tên file: ${String(b.name || "").slice(0, 200)}` + (typeof b.text === "string" && b.text ? `\nNội dung đầu file:\n${b.text.slice(0, 12000)}` : "") });
  const r: any = { model, max_tokens: 4000, system: SYS, messages: [{ role: "user", content }], output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } } };
  if (model !== "claude-haiku-5-5") { r.betas = ["server-side-fallback-2026-07-01"]; r.fallbacks = "default"; }
  let out: any = null, err = "", used = model, tin = 0, tout = 0;
  try {
    const msg: any = await new Anthropic({ apiKey: key, timeout: 60000, maxRetries: 1 }).beta.messages.stream(r).finalMessage();
    const u = msg.usage || {}; used = msg.model || model; tin = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); tout = u.output_tokens || 0;
    const text = (msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    out = JSON.parse(text);
  } catch (e) {
    err = e instanceof Anthropic.AuthenticationError ? "sai_khoa" : e instanceof Anthropic.RateLimitError ? "het_luot" : e instanceof Anthropic.APIError && (e.status || 0) >= 500 ? "qua_tai" : "ai_error";
    console.error("peek", err, String((e as Error)?.message || e).slice(0, 200));
  }
  try { await admin.from("ai_usage").insert({ user_id: who.user.id, provider: "claude", action: "peek", model: used, in_tok: tin, out_tok: tout, ms: Date.now() - t0, ok: !err, err: err || null, project_id: String(b.pid || "").slice(0, 60) || null }); } catch (_) { /* bỏ qua */ }
  if (err || !out) return json({ error: err || "ai_error" }, 502);
  return json({ date: String(out.date || "").slice(0, 10), vendor: String(out.vendor || "").slice(0, 80), scope: String(out.scope || "").slice(0, 80), kind: ["ncc", "thau_phu", "nhan_cong"].includes(out.kind) ? out.kind : "ncc", model: used });
});
