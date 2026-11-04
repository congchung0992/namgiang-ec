// Cloudflare Pages Function: /api/classify
// Đọc nội dung file sắp tải lên (PDF, ảnh, hoặc chữ trích từ Excel/Word) và gợi ý thư mục hồ sơ phù hợp.
// Chỉ người đã đăng nhập mới gọi được, để khoá Claude không bị người ngoài dùng.
// Biến bí mật trên Cloudflare: ANTHROPIC_API_KEY (chung với khung chat). Chưa đặt thì trả 503, web tự đoán theo tên file.
const SB = "https://omzyspsszmitcnejsmxq.supabase.co";
const SB_KEY = "sb_publishable_L9ww2j1N61HVF3MfpqnQcw_Vo14XjI0";
const FOLDERS = {
  "01": "Hồ sơ thầu: BOQ, dự toán, báo giá, hồ sơ dự thầu, bản vẽ mời thầu",
  "02": "Hợp đồng, phụ lục hợp đồng với chủ đầu tư",
  "03": "Tiến độ: tiến độ thi công, kế hoạch được duyệt",
  "04": "Nghiệm thu khối lượng: biên bản nghiệm thu, bảng khối lượng hoàn thành",
  "05": "Thanh toán, công nợ: hồ sơ đề nghị thanh toán, hoá đơn, bảo lãnh, tạm ứng, uỷ nhiệm chi",
  "06": "Vật tư: báo giá nhà cung cấp, đơn đặt hàng, phiếu nhập/xuất, phiếu giao nhận vật tư",
  "07": "Thầu phụ, tổ đội: hợp đồng giao khoán, hợp đồng thầu phụ, thanh toán tổ đội",
  "08": "Nhật ký, ảnh: nhật ký công trường, ảnh hiện trường"
};
const SYSTEM = `Bạn phân loại hồ sơ của một công ty tổng thầu xây dựng Việt Nam vào đúng thư mục dự án.
Các thư mục:
${Object.entries(FOLDERS).map(([k, v]) => `${k}: ${v}`).join("\n")}
Đọc nội dung file (và tên file) rồi chọn MỘT thư mục hợp lý nhất.
"reason": một câu ngắn tiếng Việt nêu file này là gì và vì sao chọn thư mục đó.
"title": tên mô tả ngắn cho file bằng tiếng Việt, tối đa 8 chữ, không ghi ngày, không ghi mã dự án (ví dụ "Biên bản nghiệm thu đợt 2 phần móng").`;
const SCHEMA = {
  type: "object",
  properties: {
    folder: { type: "string", enum: Object.keys(FOLDERS) },
    reason: { type: "string" },
    title: { type: "string" }
  },
  required: ["folder", "reason", "title"],
  additionalProperties: false
};
const IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

export async function onRequestPost({ request, env }) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "chua_ket_noi" }, 503);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "origin" }, 403);
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(auth)) return json({ error: "auth" }, 401);
  const who = await fetch(SB + "/auth/v1/user", { headers: { apikey: SB_KEY, authorization: auth } });
  if (!who.ok) return json({ error: "auth" }, 401);

  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const name = String(b.name || "").slice(0, 200);
  const content = [];
  if (b.doc && b.doc.media_type === "application/pdf" && typeof b.doc.data === "string")
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b.doc.data } });
  else if (b.img && IMG.includes(b.img.media_type) && typeof b.img.data === "string")
    content.push({ type: "image", source: { type: "base64", media_type: b.img.media_type, data: b.img.data } });
  const text = typeof b.text === "string" ? b.text.slice(0, 20000) : "";
  const proj = b.project && typeof b.project === "object" ? `${String(b.project.code || "").slice(0, 40)} ${String(b.project.name || "").slice(0, 200)}` : "";
  content.push({ type: "text", text: `Dự án: ${proj}\nTên file: ${name}` + (text ? `\nNội dung trích từ file:\n${text}` : "") });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01"
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 2000,
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }]
    })
  });
  if (!r.ok) return json({ error: "claude_" + r.status }, 502);
  const j = await r.json();
  if (j.stop_reason === "refusal" || j.stop_reason === "max_tokens") return json({ error: "khong_doc_duoc" }, 422);
  const out = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  let v;
  try { v = JSON.parse(out); } catch { return json({ error: "khong_doc_duoc" }, 422); }
  if (!FOLDERS[v.folder]) return json({ error: "khong_doc_duoc" }, 422);
  return json({ folder: v.folder, reason: String(v.reason || "").slice(0, 300), title: String(v.title || "").slice(0, 120) });
}
