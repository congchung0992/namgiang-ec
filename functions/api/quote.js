// Cloudflare Pages Function: /api/quote
// Đọc báo giá nhà cung cấp / thầu phụ / tổ đội bằng Gemini (Google) và ghép từng dòng với BOQ.
// Biến bí mật trên Cloudflare: GEMINI_API_KEY (lấy ở aistudio.google.com). Tuỳ chọn GEMINI_MODEL, GEMINI_MODEL_PRO.
// Chỉ người đã đăng nhập mới gọi được.
const SB = "https://omzyspsszmitcnejsmxq.supabase.co";
const SB_KEY = "sb_publishable_L9ww2j1N61HVF3MfpqnQcw_Vo14XjI0";
const GA = "https://generativelanguage.googleapis.com/v1beta";
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

/* ---------- Gemini: tự chọn mẫu mới nhất đang có, trả JSON theo khuôn ---------- */
let picked = {};
async function pickModel(env, kind) {
  if (kind === "pro" && env.GEMINI_MODEL_PRO) return env.GEMINI_MODEL_PRO;
  if (kind === "flash" && env.GEMINI_MODEL) return env.GEMINI_MODEL;
  if (picked[kind]) return picked[kind];
  const r = await fetch(`${GA}/models?pageSize=200`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  if (!r.ok) throw new Error("gemini_models_" + r.status);
  const L = ((await r.json()).models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => m.name.replace(/^models\//, ""))
    .filter(n => /^gemini-/.test(n) && n.includes(kind) && !/lite|image|tts|audio|live|embed|thinking|exp|learnlm|robotics|computer|nano/.test(n));
  const ver = n => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  // Ưu tiên bản mới nhất; cùng phiên bản thì bản chính thức trước bản thử (preview)
  L.sort((a, b) => ver(b) - ver(a) || (/preview/.test(a) - /preview/.test(b)) || a.length - b.length);
  if (!L.length) throw new Error("gemini_no_model");
  return (picked[kind] = L[0]);
}
const upperSchema = s => {
  if (Array.isArray(s)) return s.map(upperSchema);
  if (!s || typeof s !== "object") return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties") continue;
    if (k === "type") { const t = Array.isArray(v) ? v.find(x => x !== "null") : v; o.type = String(t).toUpperCase(); if (Array.isArray(v) && v.includes("null")) o.nullable = true; }
    else o[k] = upperSchema(v);
  }
  return o;
};
export async function gemini(env, { system, parts, schema, kind = "flash" }) {
  const model = await pickModel(env, kind);
  const call = gen => fetch(`${GA}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json", ...gen } })
  });
  // Khuôn JSON: thử kiểu mới (responseJsonSchema), không được thì kiểu cũ (responseSchema), cuối cùng chỉ yêu cầu JSON
  let r = await call({ responseJsonSchema: schema });
  if (r.status === 400) r = await call({ responseSchema: upperSchema(schema) });
  if (r.status === 400) r = await call({});
  if (!r.ok) { console.error("gemini", r.status, (await r.text()).slice(0, 300)); throw new Error("gemini_" + r.status); }
  const j = await r.json();
  const text = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
  if (!text) throw new Error("gemini_empty_" + ((j.candidates || [])[0]?.finishReason || "none"));
  return { data: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")), model };
}

/* ---------- Khuôn dữ liệu ---------- */
const nul = t => ({ type: [t, "null"] });
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

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return json({ error: "chua_ket_noi" }, 503);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "origin" }, 403);
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(auth)) return json({ error: "auth" }, 401);
  const who = await fetch(SB + "/auth/v1/user", { headers: { apikey: SB_KEY, authorization: auth } });
  if (!who.ok) return json({ error: "auth" }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  try {
    if (b.action === "extract") {
      const parts = [];
      if (b.doc && b.doc.mime && typeof b.doc.data === "string") parts.push({ inline_data: { mime_type: b.doc.mime, data: b.doc.data } });
      parts.push({ text: `Tên file: ${String(b.name || "").slice(0, 200)}` + (typeof b.text === "string" && b.text ? `\nNội dung bảng tính:\n${b.text.slice(0, 400000)}` : "") });
      const { data, model } = await gemini(env, { system: SYS_EXTRACT, parts, schema: QUOTE, kind: "pro" });
      return json({ ...data, model });
    }
    if (b.action === "match") {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 80);
      const { data, model } = await gemini(env, { system: SYS_MATCH, parts: [{ text: JSON.stringify({ items }) }], schema: MATCH, kind: "flash" });
      return json({ ...data, model });
    }
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    console.error("quote", e && e.message);
    return json({ error: "ai_error", detail: String(e && e.message || "").slice(0, 100) }, 502);
  }
}
