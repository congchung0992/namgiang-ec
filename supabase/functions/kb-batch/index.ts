// Supabase Edge Function: kb-batch
// Đợt chạy theo lịch (pg_cron gọi lúc 6:00 và 13:00 giờ Việt Nam, kèm khoá riêng trong app_secrets "cron_key"):
// chép nguyên văn PDF scan đang chờ (kb_docs.status = 'wait', file trong Storage kb-inbox), rồi tóm tắt và điền hồ sơ dự án
// cho các file đã có bản chữ nhưng chưa tóm tắt. Mỗi lượt ~100 giây; chép dở thì lượt sau làm tiếp.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.5.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const strictify = (s: any): any => {
  if (Array.isArray(s)) return s.map(strictify);
  if (!s || typeof s !== "object") return s;
  const o: any = {};
  for (const [k, v] of Object.entries(s)) o[k] = strictify(v);
  if (o.type === "object") o.additionalProperties = false;
  return o;
};
class AiErr extends Error { constructor(public code: string, msg?: string) { super(msg || code); } }

/* Một lượt gọi Claude, trả JSON theo khuôn. Stream để không bị cắt ở yêu cầu dài; tự chuyển mẫu dự phòng khi bị từ chối */
async function claude(env: any, { system, content, schema, effort = "low", maxTokens = 16000 }: any) {
  const model = env.MODEL;
  const req: any = {
    model, max_tokens: maxTokens, system: system + (env.R ? "\n\n" + env.R : ""),
    messages: [{ role: "user", content }],
    output_config: { effort, ...(schema ? { format: { type: "json_schema", schema: strictify(schema) } } : {}) },
  };
  // Haiku không có fallbacks phía máy chủ
  if (model !== "claude-haiku-5-5") { req.betas = ["server-side-fallback-2026-07-01"]; req.fallbacks = "default"; }
  let msg: any;
  try { msg = await env.client.beta.messages.stream(req).finalMessage(); }
  catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiErr("sai_khoa", String(e.message));
    if (e instanceof Anthropic.RateLimitError) throw new AiErr("het_luot", String(e.message));
    if (e instanceof Anthropic.BadRequestError) throw new AiErr(/credit|balance|billing/i.test(String(e.message)) ? "het_tien" : "ai_error", String(e.message));
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiErr("qua_tai", "timeout");
    if (e instanceof Anthropic.APIError) throw new AiErr((e.status || 0) >= 500 ? "qua_tai" : "ai_error", String(e.message));
    throw e;
  }
  const u = msg.usage || {};
  env.M.model = msg.model || model;
  env.M.in += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  env.M.out += u.output_tokens || 0;
  if (msg.stop_reason === "refusal") throw new AiErr("tu_choi", "refusal");
  if (msg.stop_reason === "max_tokens") throw new AiErr("qua_dai", "max_tokens");
  const text = (msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  if (!schema) return { text, model: env.M.model };
  try { return { data: JSON.parse(text), model: env.M.model }; } catch { throw new AiErr("ai_error", "badjson"); }
}
/* File gửi lên: PDF → document, ảnh → image */
const fileBlock = (mime: string, data: string) => mime === "application/pdf"
  ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
  : /^image\/(jpeg|png|gif|webp)$/.test(mime) ? { type: "image", source: { type: "base64", media_type: mime, data } } : null;
const SYS_OCR = `Bạn chép lại NGUYÊN VĂN toàn bộ chữ trên các trang tài liệu scan được gửi (hợp đồng, phụ lục, văn bản pháp lý của dự án xây dựng Việt Nam).
- Chép đủ từng chữ, đúng thứ tự, giữ nguyên số điều, khoản, mục, số liệu, dấu câu, chữ in hoa; không tóm tắt, không diễn giải, không sửa câu chữ, không bỏ đoạn nào.
- Mở đầu mỗi trang bằng một dòng "[Trang N]" (N là số trang trong cả tài liệu, được cho ở đề bài). Giữ xuống dòng theo đoạn.
- Bảng: mỗi dòng bảng một dòng, các ô cách nhau bằng " | ".
- Chữ không đọc được thì ghi [không rõ]. Con dấu, chữ ký ghi [dấu], [chữ ký] kèm tên in bên dưới nếu có.
- Chỉ trả về phần chữ đã chép, không thêm lời nào khác.`;
const SYS_DIGEST = `Bạn là thư ký hồ sơ của một tổng thầu xây dựng Việt Nam (Nam Giang). Đọc một tài liệu của dự án và lập "bản chữ" để trợ lý tra cứu về sau.
- kind: loại tài liệu ngắn gọn (ví dụ "Hợp đồng thi công với chủ đầu tư", "Phụ lục hợp đồng", "Tiến độ thi công", "Hợp đồng thầu phụ", "Báo giá nhà cung cấp", "Công văn", "Biên bản họp", "Hồ sơ thanh toán").
- summary: tóm tắt 4–10 dòng, mỗi dòng bắt đầu "- ", nêu: số hiệu, ngày, các bên, phạm vi, giá trị, mốc thời gian, điều khoản quan trọng. Số tiền viết kiểu Việt Nam (1.250.000.000 đ), ngày dd/mm/yyyy.
- notes: nếu đề bài có kèm "Nội dung chữ của file" thì để "". Nếu không (file scan/ảnh), ghi chép chi tiết nội dung để tra cứu thay bản gốc: giữ nguyên văn các điều khoản về giá trị, loại hợp đồng, khối lượng, đơn giá, điều chỉnh giá, tạm ứng, thanh toán, giữ lại, bảo lãnh, bảo hành, tiến độ, phạt, nghiệm thu, các bên ký; ghi số điều khoản. Tối đa khoảng 12.000 ký tự.
- facts: chỉ lấy khi tài liệu là hồ sơ của DỰ ÁN với CHỦ ĐẦU TƯ (hợp đồng, phụ lục với CĐT, pháp lý dự án, hồ sơ thầu, tiến độ được duyệt). Hợp đồng/báo giá với thầu phụ, nhà cung cấp, tổ đội thì facts = []. Mỗi fact: k là đúng một tên trong danh sách sau (không tự đặt tên khác): ${"Chủ đầu tư|Tư vấn giám sát|Tên công trình|Địa điểm|Số hợp đồng với CĐT|Ngày ký hợp đồng với CĐT|Loại hợp đồng|Giá trị hợp đồng|Thuế VAT|Phạm vi công việc|Thời gian thực hiện|Ngày khởi công|Ngày hoàn thành|Tạm ứng|Thu hồi tạm ứng|Điều kiện thanh toán|Giữ lại khi thanh toán|Bảo lãnh thực hiện hợp đồng|Bảo hành|Phạt chậm tiến độ|Điều chỉnh khối lượng, đơn giá|Phát sinh|Bảo hiểm|Nghiệm thu|Giấy phép xây dựng|Phụ lục hợp đồng".split("|").join(", ")}; v là nội dung ngắn gọn, chính xác theo tài liệu; clause là câu nguyên văn làm căn cứ kèm số điều khoản. Loại hợp đồng ghi rõ: trọn gói / theo đơn giá cố định / theo đơn giá điều chỉnh / theo thời gian / kết hợp, và khối lượng có được tính lại theo thực tế không. Không đoán; điều gì tài liệu không ghi thì không đưa vào.`;

/* ---------- Khuôn dữ liệu ---------- */
const DIGEST = { type: "object", properties: { kind: { type: "string" }, summary: { type: "string" }, notes: { type: "string" },
  facts: { type: "array", items: { type: "object", properties: { k: { type: "string" }, v: { type: "string" }, clause: { type: "string" } }, required: ["k", "v", "clause"] } } },
  required: ["kind", "summary", "notes", "facts"] };
const FACT_KEYS = new Set("Chủ đầu tư|Tư vấn giám sát|Tên công trình|Địa điểm|Số hợp đồng với CĐT|Ngày ký hợp đồng với CĐT|Loại hợp đồng|Giá trị hợp đồng|Thuế VAT|Phạm vi công việc|Thời gian thực hiện|Ngày khởi công|Ngày hoàn thành|Tạm ứng|Thu hồi tạm ứng|Điều kiện thanh toán|Giữ lại khi thanh toán|Bảo lãnh thực hiện hợp đồng|Bảo hành|Phạt chậm tiến độ|Điều chỉnh khối lượng, đơn giá|Phát sinh|Bảo hiểm|Nghiệm thu|Giấy phép xây dựng|Phụ lục hợp đồng".split("|"));
/* Lưu kết quả tóm tắt vào kb_docs và điền hồ sơ dự án (không đè mục đã xác nhận) */
async function digestSave(env: any, f: any, data: any, model: string, o: { body?: string; src?: string }) {
  const now = new Date().toISOString(), row: any = { file_id: f.id, project_id: f.project_id, folder: f.folder, name: f.name, status: "ok", kind: String(data.kind || "").slice(0, 120) || "Tài liệu", summary: String(data.summary || "").slice(0, 4000) || "- (không có nội dung để tóm tắt)", err: "", model, at: now };
  if (o.body != null) row.body = o.body; if (o.src) row.src = o.src;
  const { error: e1 } = await env.admin.from("kb_docs").upsert(row);
  if (e1) throw new Error(e1.message);
  const F = (data.facts || []).filter((x: any) => x && FACT_KEYS.has(String(x.k)) && String(x.v || "").trim());
  if (!F.length) return 0;
  const { data: old } = await env.admin.from("kb_facts").select("k,status").eq("project_id", f.project_id);
  const locked = new Set((old || []).filter((x: any) => x.status === "ok").map((x: any) => x.k));
  const rows = F.filter((x: any) => !locked.has(x.k)).map((x: any) => ({ project_id: f.project_id, k: x.k, v: String(x.v).slice(0, 2000), clause: String(x.clause || "").slice(0, 2000), file_id: f.id, src: f.name, status: "auto", by_name: "Claude đọc file", by: null, at: now }));
  if (rows.length) { const { error: e2 } = await env.admin.from("kb_facts").upsert(rows, { onConflict: "project_id,k" }); if (e2) throw new Error(e2.message); }
  return rows.length;
}
const b64u8 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
/* Đợt chạy theo lịch (6:00, 13:00): chép nguyên văn PDF scan đang chờ, rồi tóm tắt các file đã có bản chữ nhưng chưa tóm tắt. Mỗi lượt ~100 giây, chép dở thì lượt sau làm tiếp */
async function kbBatch(env: any) {
  const t0 = Date.now(), A = env.admin, late = (ms = 95000) => Date.now() - t0 > ms;
  const { data: W } = await A.from("kb_docs").select("file_id,project_id,folder,name,inbox,ocr_page,body").eq("status", "wait").order("at").limit(5);
  for (const d of W || []) {
    if (late()) return;
    try {
      if (!d.inbox) throw new Error("Thiếu file chờ chép");
      const { data: blob, error } = await A.storage.from("kb-inbox").download(d.inbox);
      if (error || !blob) throw new Error("Không tải được file chờ: " + (error?.message || ""));
      const src = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true }), all = src.getPageCount(), n = Math.min(all, 300);
      let a = d.ocr_page || 0, body = a ? String(d.body || "") : "";
      while (a < n && !late(85000)) {
        let k = Math.min(3, n - a), bytes: Uint8Array;
        while (true) { const nd = await PDFDocument.create(); (await nd.copyPages(src, [...Array(k).keys()].map((i) => a + i))).forEach((pg) => nd.addPage(pg)); bytes = await nd.save(); if (bytes.byteLength <= 9 * 1048576 || k === 1) break; k = Math.max(1, Math.floor(k / 2)); }
        const { text } = await claude(env, { system: SYS_OCR, content: [fileBlock("application/pdf", b64u8(bytes!)), { type: "text", text: `File: ${d.name}\nCác trang gửi kèm là trang ${a + 1} đến ${a + k} của tài liệu. Chép nguyên văn.` }], effort: "low", maxTokens: 32000 });
        body += (body ? "\n" : "") + String(text || "").trim(); a += k;
        await A.from("kb_docs").update({ body: body.slice(0, 400000), ocr_page: a }).eq("file_id", d.file_id);
      }
      if (a < n) return;
      await A.from("kb_docs").update({ status: "ok", src: "ocr", summary: "", inbox: null, err: n < all ? `chép ${n}/${all} trang đầu` : "" }).eq("file_id", d.file_id);
      await A.storage.from("kb-inbox").remove([d.inbox]);
    } catch (e) {
      const code = e instanceof AiErr ? e.code : "";
      if (["sai_khoa", "het_tien", "het_luot", "qua_tai"].includes(code)) { env.M.err = code; return; }
      await A.from("kb_docs").update({ status: "err", err: String((e as Error)?.message || e).slice(0, 280) }).eq("file_id", d.file_id);
    }
  }
  const { data: S } = await A.from("kb_docs").select("file_id,project_id,folder,name,body").eq("status", "ok").eq("summary", "").order("at").limit(12);
  for (const d of S || []) {
    if (late()) return;
    const f = { id: d.file_id, project_id: d.project_id, folder: d.folder, name: d.name };
    try {
      if (!String(d.body || "").trim()) { await A.from("kb_docs").update({ summary: "- (file không có chữ)", kind: "Tài liệu" }).eq("file_id", d.file_id); continue; }
      const { data, model } = await claude(env, { system: SYS_DIGEST, content: [{ type: "text", text: `Thư mục: ${f.folder}\nTên file: ${f.name}\nNội dung chữ của file:\n${String(d.body).slice(0, 150000)}` }], schema: DIGEST, effort: "low", maxTokens: 24000 });
      await digestSave(env, f, data, model, {});
    } catch (e) {
      const code = e instanceof AiErr ? e.code : "";
      if (["sai_khoa", "het_tien", "het_luot", "qua_tai"].includes(code)) { env.M.err = code; return; }
      await A.from("kb_docs").update({ summary: "- (chưa tóm tắt được: " + String((e as Error)?.message || e).slice(0, 120) + ")" }).eq("file_id", d.file_id);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const cron = req.headers.get("x-cron-key") || "";
  const { data } = await admin.from("app_secrets").select("name,value").in("name", ["cron_key", "claude", "claude_model"]);
  const get = (n: string) => (data || []).find((x: any) => x.name === n)?.value || "";
  if (!cron || !get("cron_key") || cron !== get("cron_key")) return json({ error: "auth" }, 401);
  const k = Deno.env.get("ANTHROPIC_API_KEY") || get("claude");
  if (!k) return json({ error: "chua_ket_noi" }, 503);
  const M = { model: "", in: 0, out: 0, err: "" }, t0 = Date.now(), m = get("claude_model");
  const env: any = { client: new Anthropic({ apiKey: k, timeout: 120000, maxRetries: 1 }), MODEL: MODELS.includes(m) ? m : MODELS[0], M, admin };
  const job = kbBatch(env).catch((e) => { M.err = String(e?.message || e).slice(0, 160); }).finally(async () => {
    if (M.in || M.out || M.err) try { await admin.from("ai_usage").insert({ user_id: null, provider: "claude", action: "kb_batch", model: M.model || null, in_tok: M.in, out_tok: M.out, ms: Date.now() - t0, ok: !M.err, err: M.err || null }); } catch (_) { /* bỏ qua */ }
  });
  // @ts-ignore EdgeRuntime có sẵn trên Supabase: chạy nền, trả lời ngay cho pg_net
  if (typeof EdgeRuntime !== "undefined") { EdgeRuntime.waitUntil(job); return json({ ok: true, started: true }); }
  await job; return json({ ok: true });
});
