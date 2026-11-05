// Cloudflare Pages Function: /api/drive
// Lưu file hồ sơ dự án lên Google Drive của công ty. Trình duyệt không thấy khoá Google.
// Quyền do Supabase quyết định: mọi truy vấn đều dùng phiên đăng nhập của người gọi.
// Biến bí mật trên Cloudflare: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
const SB = "https://omzyspsszmitcnejsmxq.supabase.co";
const SB_KEY = "sb_publishable_L9ww2j1N61HVF3MfpqnQcw_Vo14XjI0";
const G = "https://www.googleapis.com";
const ROOT = "Nam Giang E&C - Dự án";
// 6 thư mục lớn, mỗi thư mục có thư mục con; file chỉ lưu ở thư mục con (mã 01.1 … 06.3)
const GROUPS = {
  "01": "01 Pháp lý - Hợp đồng", "02": "02 Kỹ thuật - Tiến độ", "03": "03 Chất lượng - An toàn",
  "04": "04 Khối lượng - Thanh toán", "05": "05 Vật tư - Thầu phụ", "06": "06 Hiện trường - Văn bản"
};
const FOLDERS = {
  "01.1": "01.1 Pháp lý dự án", "01.2": "01.2 Hồ sơ thầu", "01.3": "01.3 Hợp đồng - phụ lục", "01.4": "01.4 Bảo lãnh - bảo hiểm",
  "02.1": "02.1 Bản vẽ thiết kế", "02.2": "02.2 Tiến độ - biện pháp thi công", "02.3": "02.3 Hoàn công - bàn giao",
  "03.1": "03.1 Nghiệm thu kỹ thuật", "03.2": "03.2 Thí nghiệm - CO CQ", "03.3": "03.3 An toàn - môi trường",
  "04.1": "04.1 Nghiệm thu khối lượng", "04.2": "04.2 Phát sinh", "04.3": "04.3 Thanh toán - hoá đơn - công nợ",
  "05.1": "05.1 Báo giá - đặt hàng vật tư", "05.2": "05.2 Nhập xuất vật tư", "05.3": "05.3 Thầu phụ - tổ đội",
  "06.1": "06.1 Nhật ký thi công", "06.2": "06.2 Báo cáo - ảnh hiện trường", "06.3": "06.3 Công văn - biên bản họp"
};
// Thư mục cũ (8 thư mục ngang hàng) chuyển thành thư mục con nào
const OLD = { "01": "01.2", "02": "01.3", "03": "02.2", "04": "04.1", "05": "04.3", "06": "05.1", "07": "05.3", "08": "06.2" };
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_SIZE = 95 * 1024 * 1024; // giới hạn thân yêu cầu của Cloudflare là 100 MB

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const cleanName = s => String(s || "").replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0, 200);
const qStr = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function sb(auth) {
  return (path, init = {}) => fetch(SB + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: SB_KEY, authorization: auth, "content-type": "application/json", ...(init.headers || {}) }
  });
}

// Giữ khoá truy cập Google trong bộ nhớ (hạn 1 giờ) để không phải xin lại ở mỗi lần tải file
let tokCache = null;
async function googleToken(env) {
  if (tokCache && tokCache.exp > Date.now() + 60000) return tokCache.tok;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token"
    })
  });
  if (!r.ok) {
    let why = ""; try { why = (await r.json()).error || ""; } catch {}
    const e = new Error("google_token_" + r.status + " " + why); e.code = "google_auth"; throw e;
  }
  const j = await r.json();
  tokCache = { tok: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

async function makeFolder(tok, name, parent) {
  const r = await fetch(G + "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) })
  });
  if (!r.ok) throw new Error("google_folder_" + r.status);
  return (await r.json()).id;
}

async function rootFolder(tok) {
  const q = `name='${qStr(ROOT)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await fetch(G + "/drive/v3/files?fields=files(id)&pageSize=1&q=" + encodeURIComponent(q), { headers: { authorization: "Bearer " + tok } });
  if (!r.ok) throw new Error("google_list_" + r.status);
  const f = (await r.json()).files || [];
  return f.length ? f[0].id : makeFolder(tok, ROOT);
}

async function moveFolder(tok, id, name, parent, oldParent) {
  const r = await fetch(`${G}/drive/v3/files/${encodeURIComponent(id)}?addParents=${encodeURIComponent(parent)}&removeParents=${encodeURIComponent(oldParent)}&fields=id`, {
    method: "PATCH", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ name })
  });
  if (!r.ok) throw new Error("google_move_" + r.status);
}

// Tạo 6 thư mục lớn rồi các thư mục con (song song); thư mục con đã có (từ cấu trúc cũ) thì đổi tên và chuyển vào
async function buildTree(tok, projId, reuse = {}) {
  const gids = {};
  await Promise.all(Object.keys(GROUPS).map(async g => { gids[g] = await makeFolder(tok, GROUPS[g], projId); }));
  const folders = {};
  await Promise.all(Object.keys(FOLDERS).map(async k => {
    const parent = gids[k.slice(0, 2)];
    if (reuse[k]) { await moveFolder(tok, reuse[k], FOLDERS[k], parent, projId); folders[k] = reuse[k]; }
    else folders[k] = await makeFolder(tok, FOLDERS[k], parent);
  }));
  return { ...folders, _groups: gids };
}

async function projectFolders(api, tok, pid) {
  const pidQ = encodeURIComponent(pid);
  const get = async () => (await (await api(`project_drive?project_id=eq.${pidQ}&select=root_id,folders`)).json())[0];
  const had = await get();
  if (had && had.folders["01.1"]) return had.folders;
  if (had) {
    // Dự án tạo theo cấu trúc cũ: chuyển một lần sang cấu trúc mới
    const reuse = {};
    for (const [o, n] of Object.entries(OLD)) if (had.folders[o]) reuse[n] = had.folders[o];
    const folders = await buildTree(tok, had.root_id, reuse);
    const up = await api(`project_drive?project_id=eq.${pidQ}`, { method: "PATCH", body: JSON.stringify({ folders }) });
    if (!up.ok) throw new Error("drive_map_" + up.status);
    return folders;
  }
  const pr = (await (await api(`projects?id=eq.${pidQ}&select=boq`)).json())[0];
  if (!pr) throw new Error("no_project");
  const root = await rootFolder(tok);
  const projId = await makeFolder(tok, cleanName(`${pr.boq.code || pid}-${pr.boq.name || "Dự án"}`), root);
  const folders = await buildTree(tok, projId);
  const ins = await api("project_drive", { method: "POST", body: JSON.stringify({ project_id: pid, root_id: projId, folders }) });
  if (ins.ok) return folders;
  const again = await get(); // người khác vừa tạo cùng lúc
  if (again) return again.folders;
  throw new Error("drive_map_" + ins.status);
}

async function trash(tok, id) {
  return fetch(`${G}/drive/v3/files/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ trashed: true })
  });
}

async function upload(request, api, tok, url) {
  const pid = url.searchParams.get("project") || "", folder = OLD[url.searchParams.get("folder")] || url.searchParams.get("folder") || "", name = cleanName(url.searchParams.get("name"));
  if (!pid || !FOLDERS[folder] || !name) return json({ error: "bad_request" }, 400);
  const size = Number(request.headers.get("content-length") || 0);
  if (!size) return json({ error: "empty" }, 400);
  if (size > MAX_SIZE) return json({ error: "too_large" }, 413);
  // Kiểm tra quyền và xin khoá Google cùng lúc cho nhanh; chưa đủ quyền thì dừng trước khi đụng tới Drive
  const [can, accessToken] = await Promise.all([api("rpc/can_folder", { method: "POST", body: JSON.stringify({ pid, folder }) }), tok()]);
  if (can.status === 401) return json({ error: "auth" }, 401);
  if (!can.ok || (await can.json()) !== true) return json({ error: "forbidden" }, 403);
  const folders = await projectFolders(api, accessToken, pid);
  const mime = request.headers.get("content-type") || "application/octet-stream";
  const init = await fetch(G + "/upload/drive/v3/files?uploadType=resumable&fields=id,mimeType,size", {
    method: "POST",
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mime, "x-upload-content-length": String(size) },
    body: JSON.stringify({ name, parents: [folders[folder]] })
  });
  const loc = init.ok && init.headers.get("location");
  if (!loc) throw new Error("google_init_" + init.status);
  const put = await fetch(loc, { method: "PUT", headers: { "content-type": mime, "content-length": String(size) }, body: request.body, duplex: "half" });
  if (!put.ok) throw new Error("google_put_" + put.status);
  const file = await put.json();
  const ins = await api("project_files", {
    method: "POST", headers: { prefer: "return=representation" },
    body: JSON.stringify({ project_id: pid, folder, name, drive_id: file.id, mime, size })
  });
  if (!ins.ok) { await trash(accessToken, file.id); throw new Error("record_" + ins.status); }
  const row = (await ins.json())[0];
  return json({ id: row.id, name: row.name, folder: row.folder });
}

/* Đường dẫn tạm cho trình xem Office Online của Microsoft: ký HMAC, hết hạn sau 15 phút.
   Microsoft tải file qua /api/office/<mã>/<tên file>; mã chứa id file Drive và hạn dùng nên không cần đăng nhập. */
const OFFICE_TTL = 15 * 60;
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
async function hmacKey(env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode("office-link:" + env.GOOGLE_CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signOffice(env, data) {
  const body = b64u(new TextEncoder().encode(JSON.stringify(data)));
  const sig = b64u(await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(body)));
  return body + "." + sig;
}
export async function verifyOffice(env, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64u(sig), new TextEncoder().encode(body)); } catch { return null; }
  if (!ok) return null;
  const d = JSON.parse(new TextDecoder().decode(fromB64u(body)));
  return d.e > Date.now() / 1000 ? d : null;
}
export { googleToken };

async function officeLink(env, api, url, id) {
  const r = await api(`project_files?id=eq.${encodeURIComponent(id)}&select=name,drive_id,size`);
  if (r.status === 401) return json({ error: "auth" }, 401);
  const row = r.ok ? (await r.json())[0] : null;
  if (!row) return json({ error: "not_found" }, 404); // không có quyền cũng trả về như không tồn tại
  const token = await signOffice(env, { d: row.drive_id, e: Math.floor(Date.now() / 1000) + OFFICE_TTL });
  return json({ url: `${url.origin}/api/office/${token}/${encodeURIComponent(row.name)}`, size: row.size });
}

async function download(api, tok, id) {
  const r = await api(`project_files?id=eq.${encodeURIComponent(id)}&select=name,mime,drive_id`);
  if (r.status === 401) return json({ error: "auth" }, 401);
  const row = r.ok ? (await r.json())[0] : null;
  if (!row) return json({ error: "not_found" }, 404); // không có quyền cũng trả về như không tồn tại
  const g = await fetch(`${G}/drive/v3/files/${encodeURIComponent(row.drive_id)}?alt=media`, { headers: { authorization: "Bearer " + await tok() } });
  if (!g.ok) throw new Error("google_get_" + g.status);
  return new Response(g.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(row.name),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store"
    }
  });
}

async function remove(api, tok, id) {
  const r = await api(`project_files?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { prefer: "return=representation" } });
  if (r.status === 401) return json({ error: "auth" }, 401);
  const row = r.ok ? (await r.json())[0] : null;
  if (!row) return json({ error: "forbidden" }, 403);
  const t = await trash(await tok(), row.drive_id); // vào thùng rác của Drive, còn khôi phục được
  return json({ ok: true, trashed: t.ok });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url), action = url.searchParams.get("action") || "";
  const connected = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
  if (action === "status") {
    if (!connected) return json({ connected: false, reason: "chua_ket_noi" });
    try { await googleToken(env); return json({ connected: true }); } // thử xin quyền thật, khoá hết hạn thì báo ngay
    catch (e) { console.error("drive status", e && e.message); return json({ connected: false, reason: "google_auth" }); }
  }
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return json({ error: "origin" }, 403);
  if (!connected) return json({ error: "chua_ket_noi" }, 503);
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(auth)) return json({ error: "auth" }, 401);
  const api = sb(auth);
  let cached = null;
  const tok = async () => cached || (cached = await googleToken(env));
  try {
    if (action === "upload" && request.method === "POST") return await upload(request, api, tok, url);
    if (action === "download" && request.method === "GET") return await download(api, tok, url.searchParams.get("id") || "");
    if (action === "office" && request.method === "GET") return await officeLink(env, api, url, url.searchParams.get("id") || "");
    if (action === "delete" && request.method === "DELETE") return await remove(api, tok, url.searchParams.get("id") || "");
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    console.error("drive", e && e.message);
    return json({ error: e && e.code === "google_auth" ? "google_auth" : "drive_error" }, 502);
  }
}
