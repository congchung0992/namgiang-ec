// Cloudflare Pages Function: /api/office/<mã ký>/<tên file>
// Trả nội dung file cho trình xem Office Online của Microsoft (view.officeapps.live.com).
// Không cần đăng nhập: mã do /api/drive?action=office ký HMAC, chỉ đúng một file và hết hạn sau 15 phút.
import { verifyOffice, googleToken } from "../drive.js";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint"
};

export async function onRequestGet({ params, env }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const d = await verifyOffice(env, parts[0]);
  if (!d) return new Response("Đường dẫn đã hết hạn", { status: 403 });
  const name = decodeURIComponent(parts[parts.length - 1] || "file");
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (!TYPES[ext]) return new Response("Không hỗ trợ", { status: 415 });
  const g = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(d.d)}?alt=media`, { headers: { authorization: "Bearer " + await googleToken(env) } });
  if (!g.ok) return new Response("Không đọc được file", { status: 502 });
  return new Response(g.body, {
    headers: {
      "content-type": TYPES[ext],
      "content-disposition": "inline; filename*=UTF-8''" + encodeURIComponent(name),
      "cache-control": "private, max-age=600",
      "x-robots-tag": "noindex"
    }
  });
}
