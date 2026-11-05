// Supabase Edge Function: ai
// Gọi Gemini (Google) cho web: đọc báo giá (extract), ghép dòng với BOQ (match), gợi ý thư mục khi tải file (classify), kiểm tra khoá (ping).
// Khoá Gemini do Ban giám đốc dán ở màn Quản trị, lưu trong bảng app_secrets (chỉ máy chủ đọc được, không trả về trình duyệt).
// Có biến môi trường GEMINI_API_KEY thì ưu tiên biến đó. Người gọi phải đăng nhập.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const GA = "https://generativelanguage.googleapis.com/v1beta";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

/* ---------- Gemini: danh sách mẫu đang có, thử lần lượt; trả JSON theo khuôn ---------- */
let models: string[] | null = null, proBlocked = 0;
const ver = (n: string) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
async function listModels(env: any) {
  if (models) return models;
  const r = await fetch(`${GA}/models?pageSize=200`, { headers: { "x-goog-api-key": env.KEY } });
  if (!r.ok) throw new Error("gemini_models_" + r.status);
  models = ((await r.json()).models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m: any) => m.name.replace(/^models\//, ""))
    .filter((n: string) => /^gemini-/.test(n) && /pro|flash/.test(n) && !/image|tts|audio|live|embed|thinking|exp|learnlm|robotics|computer|nano/.test(n))
    // Bản mới trước; cùng phiên bản thì bản chính thức trước bản thử (preview)
    .sort((a: string, b: string) => ver(b) - ver(a) || (Number(/preview/.test(a)) - Number(/preview/.test(b))) || a.length - b.length);
  return models!;
}
/* Thứ tự thử: đọc báo giá → pro (nếu khoá có lượt) rồi flash; việc nhẹ → flash; cuối cùng flash-lite */
async function candidates(env: any, kind: string) {
  const L = await listModels(env), pro = L.filter(n => /pro/.test(n)), fl = L.filter(n => /flash/.test(n) && !/lite/.test(n)), lite = L.filter(n => /lite/.test(n));
  const fix = [kind === "pro" ? env.PRO : "", env.FLASH].filter(Boolean);
  const usePro = kind === "pro" && Date.now() - proBlocked > 3600000;
  // Thêm một bản flash ổn định đời cũ (ít người dùng, ít bị quá tải) làm dự phòng
  const old = fl.filter(n => !/preview/.test(n) && ver(n) < ver(fl[0] || "")).slice(0, 1);
  return [...new Set([...fix, ...(usePro ? pro.slice(0, 1) : []), ...fl.slice(0, 2), ...old, ...lite.slice(0, 1)])];
}
const upperSchema = (s: any): any => {
  if (Array.isArray(s)) return s.map(upperSchema);
  if (!s || typeof s !== "object") return s;
  const o: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties") continue;
    if (k === "type") { const t = Array.isArray(v) ? v.find((x: string) => x !== "null") : v; o.type = String(t).toUpperCase(); if (Array.isArray(v) && v.includes("null")) o.nullable = true; }
    else o[k] = upperSchema(v);
  }
  return o;
};
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
/* Supabase cắt hàm sau ~150 giây: giữ tổng thời gian dưới 120 giây, mẫu nào quá tải thì chuyển ngay sang mẫu khác */
async function gemini(env: any, { system, parts, schema, kind = "flash", budget = 120000 }: any) {
  const C = await candidates(env, kind), end = Date.now() + budget;
  if (!C.length) throw new Error("gemini_no_model");
  let last = "gemini_unknown";
  for (let ci = 0; ci < C.length; ci++) {
    const model = C[ci], isLast = ci === C.length - 1;
    if (end - Date.now() < Math.min(15000, budget / 3)) break;
    const call = (gen: any) => fetch(`${GA}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.KEY },
      signal: AbortSignal.timeout(Math.max(5000, Math.min(end - Date.now(), isLast ? 120000 : 70000))), // một mẫu treo thì sau 70 giây chuyển mẫu khác
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json", ...gen } })
    });
    // Suy nghĩ ít (nhanh, rẻ hơn); mẫu không nhận tham số nào thì bỏ dần: khuôn mới → khuôn cũ → chỉ JSON
    const think = ver(model) >= 3 ? { thinkingConfig: { thinkingLevel: "low" } } : { thinkingConfig: { thinkingBudget: 0 } };
    const run = async () => {
      let r = await call({ responseJsonSchema: schema, ...think });
      if (r.status === 400) r = await call({ responseJsonSchema: schema });
      if (r.status === 400) r = await call({ responseSchema: upperSchema(schema) });
      if (r.status === 400) r = await call({});
      return r;
    };
    let r: Response;
    try { r = await run(); } catch (e) { last = "gemini_503"; console.error("gemini", model, "timeout", String(e).slice(0, 100)); continue; }
    // 429 có hẹn chờ ngắn: chờ rồi thử lại; 503/500: chỉ thử lại trên mẫu cuối cùng, còn lại chuyển mẫu khác ngay
    for (let k = 0; k < 2 && [429, 500, 503].includes(r.status); k++) {
      const t = await r.text();
      console.error("gemini", model, r.status, t.replace(/\s+/g, " ").slice(0, 300));
      let w = 0;
      if (r.status === 429) {
        if (/limit: 0/.test(t)) { if (/pro/.test(model)) proBlocked = Date.now(); break; }
        const m = t.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/); w = m ? parseFloat(m[1]) * 1000 + 500 : 0;
        if (!(w > 0 && w <= 30500)) break;
      } else { if (!isLast) break; w = k ? 6000 : 2500; }
      if (end - Date.now() < w + 20000) break;
      await sleep(w);
      try { r = await run(); } catch { break; }
    }
    if (r.ok) {
      const j = await r.json();
      const text = ((j.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
      if (!text) { last = "gemini_empty_" + ((j.candidates || [])[0]?.finishReason || "none"); continue; }
      try { return { data: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")), model }; } catch { last = "gemini_badjson"; continue; }
    }
    if (!r.bodyUsed) console.error("gemini", model, r.status, (await r.text()).replace(/\s+/g, " ").slice(0, 300));
    last = "gemini_" + r.status;
    if (r.status === 400 || r.status === 401 || r.status === 403) break; // khoá sai: đổi mẫu cũng không được
  }
  throw new Error(last);
}

/* ---------- Khuôn dữ liệu ---------- */
const nul = (t: string) => ({ type: [t, "null"] });
const QUOTE = {
  type: "object",
  properties: {
    vendor: { type: "string" }, quote_no: nul("string"), date: nul("string"),
    kind: { type: "string", enum: ["ncc", "thau_phu", "nhan_cong"] },
    scope: nul("string"), vat_included: { type: "boolean" }, vat_rate: nul("number"),
    payment_terms: nul("string"), payment_days: nul("number"), advance_percent: nul("number"),
    delivery_terms: nul("string"), delivery_days: nul("number"), validity: nul("string"),
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" }, spec: nul("string"), unit: nul("string"), qty: nul("number"),
          price_material: nul("number"), price_labor: nul("number"), price: nul("number"), amount: nul("number"), note: nul("string")
        },
        required: ["name", "spec", "unit", "qty", "price_material", "price_labor", "price", "amount", "note"]
      }
    }
  },
  required: ["vendor", "quote_no", "date", "kind", "scope", "vat_included", "vat_rate", "payment_terms", "payment_days", "advance_percent", "delivery_terms", "delivery_days", "validity", "items"]
};
const SYS_EXTRACT = `Bạn là QS (kỹ sư dự toán) của một tổng thầu xây dựng Việt Nam. Đọc báo giá của nhà cung cấp, thầu phụ hoặc tổ đội nhân công và chép lại CHÍNH XÁC từng dòng hàng.
Quy tắc:
- Lấy TẤT CẢ các dòng có đơn giá; bỏ dòng tiêu đề nhóm, dòng cộng, dòng thuế, dòng tổng.
- Số viết kiểu Việt Nam: dấu chấm phân cách nghìn, dấu phẩy thập phân (1.234.567,5 = 1234567.5). Ghi số thuần, không đơn vị tiền.
- price_material = đơn giá vật tư, price_labor = đơn giá nhân công nếu báo giá tách riêng; price = đơn giá gộp nếu chỉ có một đơn giá. amount = thành tiền dòng.
- Giữ nguyên tên, quy cách (mác, kích thước, xuất xứ), đơn vị như trong báo giá.
- vat_included = true nếu đơn giá đã gồm VAT; vat_rate = thuế suất % nếu có.
- kind: ncc = cung cấp vật tư/thiết bị; thau_phu = thầu phụ thi công trọn gói (vật tư + nhân công); nhan_cong = tổ đội, khoán nhân công.
- payment_days = số ngày được trả chậm sau khi giao hàng/nghiệm thu; advance_percent = % tạm ứng; delivery_days = số ngày giao hàng kể từ khi đặt (ước lượng nếu ghi tuần).
- Ngày viết dd/mm/yyyy. Thiếu thông tin thì để null, không bịa.`;

const MATCH = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, code: nul("string"), factor: { type: "number" }, confidence: { type: "number" }, reason: { type: "string" } },
        required: ["i", "code", "factor", "confidence", "reason"]
      }
    }
  },
  required: ["matches"]
};
const SYS_MATCH = `Bạn là QS của tổng thầu xây dựng. Ghép từng dòng báo giá với đúng MỘT dòng BOQ hợp đồng trong danh sách ứng viên của dòng đó (hoặc null nếu không dòng nào đúng).
- So tên công việc/vật tư, quy cách (mác bê tông, đường kính thép, độ dày tôn, kích thước…), đơn vị. Khác quy cách quan trọng thì KHÔNG ghép.
- Mã có dấu "|" là cả một nhóm công việc: chỉ chọn khi dòng báo giá là giá trọn gói cho cả nhóm đó.
- factor = số đơn vị báo giá trong 1 đơn vị BOQ (ví dụ báo giá theo kg, BOQ theo tấn → 1000; báo giá theo tấn, BOQ theo kg → 0.001; cùng đơn vị → 1).
- confidence từ 0 đến 1. reason: một câu ngắn tiếng Việt.`;


const MATCH_LINES = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: { code: { type: "string" }, i: nul("integer"), factor: { type: "number" }, confidence: { type: "number" }, reason: { type: "string" } },
        required: ["code", "i", "factor", "confidence", "reason"]
      }
    }
  },
  required: ["matches"]
};
const SYS_MATCH_LINES = `Bạn là QS của tổng thầu xây dựng. Có một bảng báo giá (danh sách dòng giá, đánh số i) và các dòng BOQ hợp đồng.
Với MỖI dòng BOQ, chọn dòng báo giá cung cấp đúng vật tư hoặc nhân công cho dòng đó (trả về chỉ số i), hoặc null nếu báo giá không có.
- Phải trùng loại và quy cách chính: mác bê tông (M100, M150, M200, M250, M300, M350… hoặc B15, B20…), đường kính và mác thép (D10, D16, CB300, CB400…), độ dày, kích thước, chủng loại. Khác mác hoặc quy cách thì KHÔNG chọn.
- Một dòng báo giá được dùng cho nhiều dòng BOQ (ví dụ bê tông M300 cho móng, cột, dầm, sàn của mọi hạng mục).
- Báo giá có nhiều lựa chọn cùng mác (ví dụ khác loại cát) thì chọn dòng thông dụng, rẻ hơn, trừ khi BOQ ghi rõ loại.
- goi_y là các chỉ số dòng báo giá gợi ý theo tên, chỉ để tham khảo.
- factor = số đơn vị báo giá trong 1 đơn vị BOQ (kg → tấn: 1000; tấn → kg: 0.001; cùng đơn vị: 1).
- confidence từ 0 đến 1. reason: một câu ngắn tiếng Việt.
Trả về đủ mọi dòng BOQ được gửi, giữ nguyên code.`;

const FOLDERS: any = {
  "01.1": "Pháp lý dự án: giấy phép xây dựng, quyết định phê duyệt, thẩm duyệt PCCC, thông báo khởi công, bàn giao mặt bằng, hồ sơ năng lực",
  "01.2": "Hồ sơ thầu: hồ sơ mời thầu, hồ sơ dự thầu, BOQ, dự toán, giá gốc, báo giá cho chủ đầu tư",
  "01.3": "Hợp đồng, phụ lục hợp đồng với chủ đầu tư",
  "01.4": "Bảo lãnh (thực hiện, tạm ứng, bảo hành), bảo hiểm công trình",
  "02.1": "Bản vẽ thiết kế, bản vẽ thi công (shop drawing), thay đổi thiết kế",
  "02.2": "Tiến độ thi công, kế hoạch tuần/tháng, biện pháp thi công",
  "02.3": "Hoàn công, hồ sơ hoàn thành công trình, biên bản bàn giao, bảo hành",
  "03.1": "Nghiệm thu kỹ thuật: nghiệm thu vật liệu đầu vào, nghiệm thu công việc, giai đoạn",
  "03.2": "Kết quả thí nghiệm, chứng chỉ CO/CQ vật liệu, thiết bị",
  "03.3": "An toàn lao động, vệ sinh môi trường, huấn luyện, sự cố",
  "04.1": "Biên bản nghiệm thu khối lượng hoàn thành, bảng khối lượng",
  "04.2": "Phát sinh tăng giảm, công văn xác nhận phát sinh, điều chỉnh",
  "04.3": "Hồ sơ đề nghị thanh toán, hoá đơn, uỷ nhiệm chi, đối chiếu công nợ",
  "05.1": "Báo giá nhà cung cấp, đơn đặt hàng, hợp đồng mua vật tư thiết bị",
  "05.2": "Phiếu nhập, phiếu xuất, phiếu giao nhận vật tư",
  "05.3": "Hợp đồng thầu phụ, hợp đồng giao khoán tổ đội, nghiệm thu và thanh toán thầu phụ",
  "06.1": "Nhật ký thi công",
  "06.2": "Báo cáo tuần/tháng, ảnh hiện trường",
  "06.3": "Công văn đi/đến, biên bản họp giao ban"
};
const SYS_CLASSIFY = `Bạn phân loại hồ sơ của một công ty tổng thầu xây dựng Việt Nam vào đúng thư mục dự án.
Các thư mục:
${Object.entries(FOLDERS).map(([k, v]) => `${k}: ${v}`).join("\n")}
Đọc nội dung file (và tên file) rồi chọn MỘT thư mục hợp lý nhất.
"reason": một câu ngắn tiếng Việt nêu file này là gì và vì sao chọn thư mục đó.
"title": tên mô tả ngắn cho file bằng tiếng Việt, tối đa 8 chữ, không ghi ngày, không ghi mã dự án (ví dụ "Biên bản nghiệm thu đợt 2 phần móng").`;
const CLASSIFY = {
  type: "object",
  properties: {
    folder: { type: "string", enum: Object.keys(FOLDERS) },
    reason: { type: "string" },
    title: { type: "string" }
  },
  required: ["folder", "reason", "title"],
  additionalProperties: false
};

let keyCache: { v: string; at: number } | null = null;
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
  // Khoá: biến môi trường, không có thì đọc bảng app_secrets (giữ 5 phút trong bộ nhớ)
  let key = Deno.env.get("GEMINI_API_KEY") || "";
  if (!key) {
    if (keyCache && Date.now() - keyCache.at < 300000 && b.action !== "ping") key = keyCache.v;
    else { const { data } = await admin.from("app_secrets").select("value").eq("name", "gemini").maybeSingle(); key = data?.value || ""; keyCache = { v: key, at: Date.now() }; models = null; }
  }
  if (!key) return json({ error: "chua_ket_noi" }, 503);
  const env = { KEY: key, PRO: Deno.env.get("GEMINI_MODEL_PRO") || "", FLASH: Deno.env.get("GEMINI_MODEL") || "" };
  try {
    if (b.action === "ping") {
      // Thử gọi thật một câu ngắn để biết khoá có lượt dùng không
      const { model } = await gemini(env, { system: "Trả lời JSON.", parts: [{ text: "Trả về {\"ok\": true}" }], schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, kind: "flash" });
      const C = await candidates(env, "pro");
      return json({ ok: true, flash: model, pro: C[0] && /pro/.test(C[0]) ? C[0] : model + " (khoá miễn phí không dùng được bản pro)" });
    }
    if (b.action === "extract") {
      const parts: any[] = [];
      if (b.doc && b.doc.mime && typeof b.doc.data === "string") parts.push({ inline_data: { mime_type: b.doc.mime, data: b.doc.data } });
      parts.push({ text: `Tên file: ${String(b.name || "").slice(0, 200)}` + (typeof b.text === "string" && b.text ? `\nNội dung bảng tính:\n${b.text.slice(0, 400000)}` : "") });
      const { data, model } = await gemini(env, { system: SYS_EXTRACT, parts, schema: QUOTE, kind: env.PRO ? "pro" : "flash" });
      return json({ ...data, model });
    }
    if (b.action === "match") {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 80);
      const { data, model } = await gemini(env, { system: SYS_MATCH, parts: [{ text: JSON.stringify({ items }) }], schema: MATCH, kind: "flash" });
      return json({ ...data, model });
    }
    if (b.action === "match_lines") {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300), lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 80);
      const { data, model } = await gemini(env, { system: SYS_MATCH_LINES, parts: [{ text: JSON.stringify({ bao_gia: items, boq: lines }) }], schema: MATCH_LINES, kind: "flash" });
      return json({ ...data, model });
    }
    if (b.action === "classify") {
      const parts: any[] = [];
      if (b.doc && b.doc.media_type === "application/pdf" && typeof b.doc.data === "string") parts.push({ inline_data: { mime_type: "application/pdf", data: b.doc.data } });
      else if (b.img && /^image\/(jpeg|png|gif|webp)$/.test(b.img.media_type) && typeof b.img.data === "string") parts.push({ inline_data: { mime_type: b.img.media_type, data: b.img.data } });
      const proj = b.project && typeof b.project === "object" ? `${String(b.project.code || "").slice(0, 40)} ${String(b.project.name || "").slice(0, 200)}` : "";
      parts.push({ text: `Dự án: ${proj}\nTên file: ${String(b.name || "").slice(0, 200)}` + (typeof b.text === "string" && b.text ? `\nNội dung trích từ file:\n${b.text.slice(0, 8000)}` : "") });
      const { data: v } = await gemini(env, { system: SYS_CLASSIFY, parts, schema: CLASSIFY, kind: "flash", budget: 25000 });
      if (!FOLDERS[v.folder]) return json({ error: "khong_doc_duoc" }, 422);
      return json({ folder: v.folder, reason: String(v.reason || "").slice(0, 300), title: String(v.title || "").slice(0, 120) });
    }
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    const m = String((e as Error)?.message || "");
    console.error("ai", m);
    if (/gemini_(400|401|403)\b/.test(m) || /gemini_models_(400|401|403)/.test(m)) return json({ error: "sai_khoa" }, 502);
    if (/gemini_(503|500)\b/.test(m)) return json({ error: "qua_tai" }, 502);
    if (/gemini_429/.test(m)) return json({ error: "het_luot" }, 502);
    return json({ error: "ai_error", detail: m.slice(0, 100) }, 502);
  }
});
