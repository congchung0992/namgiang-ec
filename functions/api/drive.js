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
  "04": "04 Thanh toán CĐT", "05": "05 NCC - TP", "06": "06 Hiện trường - Văn bản"
};
const FOLDERS = {
  "01.1": "01.1 Pháp lý dự án", "01.2": "01.2 Hồ sơ thầu", "01.3": "01.3 Hợp đồng - phụ lục", "01.4": "01.4 Bảo lãnh - bảo hiểm",
  "02.1": "02.1 Bản vẽ thiết kế", "02.2": "02.2 Tiến độ - biện pháp thi công", "02.3": "02.3 Hoàn công - bàn giao",
  "03.1": "03.1 Nghiệm thu kỹ thuật", "03.2": "03.2 Thí nghiệm - CO CQ", "03.3": "03.3 An toàn - môi trường",
  "04.1": "04.1 Nghiệm thu khối lượng", "04.2": "04.2 Phát sinh", "04.3": "04.3 Hồ sơ thanh toán - công nợ CĐT",
  "05.1": "05.1 Báo giá NCC - TP", "05.2": "05.2 Hợp đồng NCC - TP", "05.3": "05.3 Thanh toán NCC - TP", "05.4": "05.4 Nhập xuất vật tư",
  "06.1": "06.1 Nhật ký thi công", "06.2": "06.2 Báo cáo - ảnh hiện trường", "06.3": "06.3 Công văn - biên bản họp"
};
// Thư mục cũ (8 thư mục ngang hàng) chuyển thành thư mục con nào
const OLD = { "01": "01.2", "02": "01.3", "03": "02.2", "04": "04.1", "05": "04.3", "06": "05.1", "07": "05.2", "08": "06.2" };
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
  return { ...folders, _groups: gids, _v: 2 };
}

async function projectFolders(api, tok, pid) {
  const pidQ = encodeURIComponent(pid);
  const get = async () => (await (await api(`project_drive?project_id=eq.${pidQ}&select=root_id,folders`)).json())[0];
  const had = await get();
  if (had && had.folders["01.1"]) {
    // Cấu trúc v2: nhóm 04 "Thanh toán CĐT", nhóm 05 "NCC - TP" (thêm 05.4) — đổi tên thư mục đã có, tạo thư mục còn thiếu, một lần
    if (had.folders._v !== 2) {
      const F = { ...had.folders }, G2 = F._groups || {};
      const ren = (id, name) => id ? fetch(`${G}/drive/v3/files/${encodeURIComponent(id)}?fields=id`, { method: "PATCH", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ name }) }) : null;
      await Promise.all([ren(G2["04"], GROUPS["04"]), ren(G2["05"], GROUPS["05"]), ...["04.3", "05.1", "05.2", "05.3"].map(k => ren(F[k], FOLDERS[k]))]);
      if (!F["05.4"] && G2["05"]) F["05.4"] = await makeFolder(tok, FOLDERS["05.4"], G2["05"]);
      F._v = 2;
      await api(`project_drive?project_id=eq.${pidQ}`, { method: "PATCH", body: JSON.stringify({ folders: F }) });
      return F;
    }
    return had.folders;
  }
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

/* Thư mục ngày bên trong thư mục hồ sơ (ví dụ 06.2 > 2026-10-31): tìm trên Drive trước rồi mới tạo, nhớ id trong project_drive */
async function dayFolder(api, tok, pid, folders, folder, sub) {
  const key = folder + "/" + sub, parent = folders[folder];
  if (folders._sub && folders._sub[key]) return folders._sub[key];
  const q = `name='${qStr(sub)}' and '${qStr(parent)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await fetch(`${G}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { authorization: "Bearer " + tok } });
  let id = r.ok ? ((await r.json()).files || [])[0]?.id : null;
  if (!id) id = await makeFolder(tok, sub, parent);
  const pidQ = encodeURIComponent(pid);
  const now = (await (await api(`project_drive?project_id=eq.${pidQ}&select=folders`)).json())[0];
  const F = { ...((now && now.folders) || folders) };
  F._sub = { ...(F._sub || {}), [key]: id };
  await api(`project_drive?project_id=eq.${pidQ}`, { method: "PATCH", body: JSON.stringify({ folders: F }) });
  return id;
}

async function upload(request, api, tok, url) {
  // folder có thể kèm thư mục con: thư mục ngày "06.2/2026-10-31" (ảnh hiện trường xếp theo ngày chụp)
  // hoặc thư mục gói thầu trong 05.1 Báo giá: "05.1/Cọc bê tông · cung cấp + ép cọc" (báo giá tải từ sheet Báo giá)
  // hoặc thư mục hạng mục trong 06.1 Nhật ký thi công: "06.1/FACTORY -2" (báo cáo ngày theo hạng mục)
  const fp = url.searchParams.get("folder") || "", cut = fp.indexOf("/"), f0 = cut < 0 ? fp : fp.slice(0, cut), sub0 = cut < 0 ? "" : fp.slice(cut + 1).trim();
  const pid = url.searchParams.get("project") || "", folder = OLD[f0] || f0, name = cleanName(url.searchParams.get("name"));
  const sub = /^\d{4}-\d{2}-\d{2}$/.test(sub0) ? sub0 : (folder === "05.1" || folder === "06.1") && sub0 && sub0.length <= 100 && !/[\/\\\u0000-\u001f]/.test(sub0) ? sub0 : "";
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
    body: JSON.stringify({ name, parents: [sub ? await dayFolder(api, accessToken, pid, folders, folder, sub) : folders[folder]] })
  });
  const loc = init.ok && init.headers.get("location");
  if (!loc) throw new Error("google_init_" + init.status);
  const put = await fetch(loc, { method: "PUT", headers: { "content-type": mime, "content-length": String(size) }, body: request.body, duplex: "half" });
  if (!put.ok) throw new Error("google_put_" + put.status);
  const file = await put.json();
  const ins = await api("project_files", {
    method: "POST", headers: { prefer: "return=representation" },
    body: JSON.stringify({ project_id: pid, folder, name, drive_id: file.id, mime, size, ...(sub ? { sub } : {}) })
  });
  let ok = ins;
  // Cơ sở dữ liệu cũ chỉ nhận thư mục ngày: lưu bản ghi không kèm thư mục con (file trên Drive vẫn nằm trong thư mục gói)
  if (!ok.ok && sub && !/^\d{4}-/.test(sub)) ok = await api("project_files", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ project_id: pid, folder, name, drive_id: file.id, mime, size }) });
  if (!ok.ok) { await trash(accessToken, file.id); throw new Error("record_" + ok.status); }
  const row = (await ok.json())[0];
  return json({ id: row.id, name: row.name, folder: row.folder, sub: row.sub || null });
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

// Đổi tên file (tên chuẩn hợp đồng…): kiểm quyền sửa ở bảng project_files trước (RLS), rồi đổi tên trên Drive; Drive lỗi thì trả lại tên cũ
async function rename(api, tok, id, name) {
  name = cleanName(name);
  if (!id || !name) return json({ error: "bad_request" }, 400);
  const r0 = await api(`project_files?id=eq.${encodeURIComponent(id)}&select=name,drive_id`);
  if (r0.status === 401) return json({ error: "auth" }, 401);
  const old = r0.ok ? (await r0.json())[0] : null;
  if (!old) return json({ error: "not_found" }, 404);
  const r = await api(`project_files?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ name }) });
  const row = r.ok ? (await r.json())[0] : null;
  if (!row) return json({ error: "forbidden" }, 403);
  const g = await fetch(`${G}/drive/v3/files/${encodeURIComponent(old.drive_id)}?fields=id`, { method: "PATCH", headers: { authorization: "Bearer " + await tok(), "content-type": "application/json" }, body: JSON.stringify({ name }) });
  if (!g.ok) { await api(`project_files?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name: old.name }) }); throw new Error("google_rename_" + g.status); }
  return json({ ok: true, name, old: old.name });
}

// Chuyển file sang thư mục khác (xếp nhầm): sửa bản ghi trước (RLS: quyền sửa + thư mục đích phải được mở), rồi chuyển trên Drive; Drive lỗi thì trả lại như cũ
// Nhóm 05 NCC – TP chỉ lưu theo luồng (báo giá, hợp đồng, thanh toán, nhận hàng) nên không chuyển vào đó được
async function move(api, tok, id, folder0, sub0) {
  const folder = OLD[folder0] || folder0, sub = /^\d{4}-\d{2}-\d{2}$/.test(sub0 || "") ? sub0 : "";
  if (!id || !FOLDERS[folder]) return json({ error: "bad_request" }, 400);
  if (/^05\./.test(folder)) return json({ error: "theo_luong" }, 400);
  const r0 = await api(`project_files?id=eq.${encodeURIComponent(id)}&select=project_id,folder,sub,drive_id`);
  if (r0.status === 401) return json({ error: "auth" }, 401);
  const old = r0.ok ? (await r0.json())[0] : null;
  if (!old) return json({ error: "not_found" }, 404);
  if (old.folder === folder && (old.sub || "") === sub) return json({ ok: true, folder, sub: sub || null });
  const r = await api(`project_files?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ folder, sub: sub || null }) });
  const row = r.ok ? (await r.json())[0] : null;
  if (!row) return json({ error: "forbidden" }, 403);
  try {
    const T = await tok(), folders = await projectFolders(api, T, old.project_id);
    const to = sub ? await dayFolder(api, T, old.project_id, folders, folder, sub) : folders[folder];
    const g0 = await fetch(`${G}/drive/v3/files/${encodeURIComponent(old.drive_id)}?fields=parents&supportsAllDrives=true`, { headers: { authorization: "Bearer " + T } });
    const from = g0.ok ? ((await g0.json()).parents || []).join(",") : "";
    const g = await fetch(`${G}/drive/v3/files/${encodeURIComponent(old.drive_id)}?addParents=${encodeURIComponent(to)}${from ? "&removeParents=" + encodeURIComponent(from) : ""}&fields=id&supportsAllDrives=true`, { method: "PATCH", headers: { authorization: "Bearer " + T, "content-type": "application/json" }, body: "{}" });
    if (!g.ok) throw new Error("google_move_" + g.status);
  } catch (e) {
    await api(`project_files?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ folder: old.folder, sub: old.sub }) });
    throw e;
  }
  return json({ ok: true, folder, sub: sub || null });
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
    if (action === "rename" && request.method === "POST") { const b = await request.json().catch(() => ({})); return await rename(api, tok, String(b.id || ""), String(b.name || "")); }
    if (action === "move" && request.method === "POST") { const b = await request.json().catch(() => ({})); return await move(api, tok, String(b.id || ""), String(b.folder || ""), String(b.sub || "")); }
    if (action === "delete" && request.method === "DELETE") return await remove(api, tok, url.searchParams.get("id") || "");
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    console.error("drive", e && e.message);
    return json({ error: e && e.code === "google_auth" ? "google_auth" : "drive_error" }, 502);
  }
}
