// Supabase Edge Function: ai-dm
// Xếp công tác BOQ vào đầu mục công việc (anh Chung 07/11/2026): Claude đọc danh sách công tác, đầu mục hiện có, các lần anh đã
// kéo thả (quy tắc) và lời dặn, trả về các công tác nên chuyển đầu mục. Web chỉ gợi ý, anh duyệt mới lưu. Người gọi phải đăng nhập.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.5.0";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const pickModel = (act: string, cms: string, def: string) => { let cm: any = {}; try { cm = JSON.parse(cms || "{}"); } catch { /* bỏ qua */ } return MODELS.includes(cm[act]) ? cm[act] : MODELS.includes(def) ? def : MODELS[0]; };
const SYS = `Bạn là QS của tổng thầu xây dựng Nam Giang. Nhiệm vụ: xếp mỗi công tác BOQ vào đúng ĐẦU MỤC CÔNG VIỆC (nhóm theo loại công việc, để giao thầu và theo dõi), không xếp theo hạng mục / nhà.
Đầu mục thường gặp: Công tác cọc, Công tác cừ, Công tác cọc tre, Công tác đất (đào, đắp, lấp, đầm, san lấp, cát đen, vận chuyển đất), Công tác kết cấu (bê tông, cốt thép, ván khuôn, nilon lót, xoa nền, cắt mạch), Công tác xây trát (xây, trát, láng, sơn, bả, giàn giáo), Công tác trần, sàn (trần, sàn, lát, ốp), Công tác cửa, Phần kết cấu thép và bao che, Đường và cảnh quan; phần cơ điện giữ theo hệ.
QUY TẮC:
- "quy_tac" là các lần người dùng tự chuyển: coi là đúng tuyệt đối và suy rộng cho công tác tương tự.
- "loi_dan" là ý người dùng: phải làm theo.
- Ưu tiên tên đầu mục có sẵn trong "dau_muc"; chỉ đặt tên mới khi thật sự không hợp đầu mục nào (tên ngắn, tiếng Việt có dấu, bắt đầu bằng "Công tác").
- Chỉ trả về công tác CẦN CHUYỂN (đầu mục mới khác đầu mục hiện tại). Công tác đang đúng thì bỏ qua. Không chắc thì bỏ qua.
- "ly_do" tối đa 12 chữ.`;
const SCHEMA = {
  type: "object",
  properties: { moves: { type: "array", items: { type: "object", properties: { k: { type: "string" }, dm: { type: "string" }, ly_do: { type: "string" } }, required: ["k", "dm", "ly_do"], additionalProperties: false } } },
  required: ["moves"],
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
  const { data: S } = await admin.from("app_secrets").select("name,value").in("name", ["claude", "claude_model", "claude_models"]);
  const get = (n: string) => (S || []).find((x: any) => x.name === n)?.value || "";
  const key = Deno.env.get("ANTHROPIC_API_KEY") || get("claude");
  if (!key) return json({ error: "chua_ket_noi" }, 503);
  const model = pickModel("dm_group", get("claude_models"), get("claude_model")), t0 = Date.now();
  const s = (v: any, n: number) => String(v ?? "").slice(0, n);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 600).map((x: any) => ({ k: s(x.k, 300), ten: s(x.name, 200), quy_cach: s(x.spec, 120), dvt: s(x.unit, 20), hang_muc: s(x.hm, 160), nhom_boq: s(x.g1, 120), dau_muc_hien_tai: s(x.dm, 120) }));
  if (!items.length) return json({ moves: [] });
  const dms = (Array.isArray(b.dms) ? b.dms : []).slice(0, 120).map((x: any) => s(x, 120));
  const rules = (Array.isArray(b.rules) ? b.rules : []).slice(0, 400).map((x: any) => ({ cong_tac: s(x.name, 200), dau_muc: s(x.dm, 120) }));
  const content = JSON.stringify({ dau_muc: dms, quy_tac: rules, loi_dan: s(b.guide, 4000), cong_tac: items });
  const r: any = { model, max_tokens: 32000, system: SYS, messages: [{ role: "user", content }], output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } } };
  if (model !== "claude-haiku-5-5") { r.betas = ["server-side-fallback-2026-07-01"]; r.fallbacks = "default"; }
  let out: any = null, err = "", used = model, tin = 0, tout = 0;
  try {
    const msg: any = await new Anthropic({ apiKey: key, timeout: 140000, maxRetries: 1 }).beta.messages.stream(r).finalMessage();
    const u = msg.usage || {}; used = msg.model || model; tin = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); tout = u.output_tokens || 0;
    const text = (msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    out = JSON.parse(text);
  } catch (e) {
    err = e instanceof Anthropic.AuthenticationError ? "sai_khoa" : e instanceof Anthropic.RateLimitError ? "het_luot" : e instanceof Anthropic.APIError && (e.status || 0) >= 500 ? "qua_tai" : "ai_error";
    console.error("dm_group", err, String((e as Error)?.message || e).slice(0, 200));
  }
  try { await admin.from("ai_usage").insert({ user_id: who.user.id, provider: "claude", action: "dm_group", model: used, in_tok: tin, out_tok: tout, ms: Date.now() - t0, ok: !err, err: err || null, project_id: s(b.pid, 60) || null }); } catch (_) { /* bỏ qua */ }
  if (err || !out) return json({ error: err || "ai_error" }, 502);
  const K = new Map(items.map((x: any) => [x.k, x.dau_muc_hien_tai]));
  return json({ moves: (out.moves || []).filter((x: any) => x && K.has(String(x.k)) && String(x.dm || "").trim() && String(x.dm).trim() !== K.get(String(x.k))).map((x: any) => ({ k: String(x.k), dm: String(x.dm).trim().slice(0, 120), why: String(x.ly_do || "").slice(0, 120) })), model: used });
});
