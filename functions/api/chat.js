// Cloudflare Pages Function: /api/chat
// Chuyển câu hỏi từ khung chat sang Claude. Khoá API đặt trong Cloudflare (biến bí mật ANTHROPIC_API_KEY),
// không nằm trong mã nguồn. Chưa đặt khoá thì trả 503 và web tự trả lời bằng số liệu có sẵn.
const SYSTEM = `Bạn là "Trợ lý Nam Giang", trợ lý quản lý dự án của Công ty CP Đầu tư và Xây lắp Nam Giang (tổng thầu xây dựng).
Trả lời bằng tiếng Việt, ngắn gọn, đi thẳng vào số liệu. Số tiền viết kiểu Việt Nam (dấu chấm phân cách nghìn, dấu phẩy thập phân), dùng "tỷ" hoặc "triệu" cho dễ đọc; ngày dạng dd/mm/yyyy.
Chỉ dựa vào dữ liệu trong phần NGỮ CẢNH. Nếu dữ liệu không có, nói rõ là chưa có và gợi ý cần nhập gì. Không bịa số.
Nhắc khi con số dựa trên giả định (giá vốn ước tính, điều khoản thanh toán giả định, thời gian chờ vật tư mặc định). Công trình "Mẫu" là số liệu minh hoạ.
Có thể dùng gạch đầu dòng "- " và **in đậm**; không dùng bảng hay tiêu đề.`;

export async function onRequestPost({ request, env }) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "chua_ket_noi" }, 503);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "origin" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[0].role !== "user") return json({ error: "no_message" }, 400);
  const context = JSON.stringify(body.context || {}).slice(0, 150000);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: 1200,
      system: SYSTEM + "\n\nNGỮ CẢNH (JSON số liệu hiện có trên web):\n" + context,
      messages
    })
  });
  if (!r.ok) return json({ error: "claude_" + r.status }, 502);
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
  return json({ text });
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
