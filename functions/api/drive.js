// Cloudflare Pages Function: /api/drive
// Lưu file hồ sơ dự án lên Google Drive của công ty. Trình duyệt không thấy khoá Google.
// Quyền do Supabase quyết định: mọi truy vấn đều dùng phiên đăng nhập của người gọi.
// Biến bí mật trên Cloudflare: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
const SB = "https://omzyspsszmitcnejsmxq.supabase.co";
const SB_KEY = "sb_publishable_L9ww2j1N61HVF3MfpqnQcw_Vo14XjI0";
const G = "https://www.googleapis.com";
const ROOT = "Nam Giang E&C - Dự án";
const FOLDERS = {
  "01": "01 Hồ sơ thầu", "02": "02 Hợp đồng - phụ lục", "03": "03 Tiến độ", "04": "04 Nghiệm thu khối lượng",
  "05": "05 Thanh toán - công nợ", "06": "06 Vật tư", "07": "07 Thầu phụ - tổ đội", "08": "08 Nhật ký - ảnh"
};
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

async function googleToken(env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token"
    })
  });
  if (!r.ok) throw new Error("google_token_" + r.status);
  return (await r.json()).access_token;
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

async function projectFolders(api, tok, pid) {
  const pidQ = encodeURIComponent(pid);
  const get = async () => (await (await api(`project_drive?project_id=eq.${pidQ}&select=folders`)).json())[0];
  const had = await get();
  if (had) return had.folders;
  const pr = (await (await api(`projects?id=eq.${pidQ}&select=boq`)).json())[0];
  if (!pr) throw new Error("no_project");
  const root = await rootFolder(tok);
  const projId = await makeFolder(tok, cleanName(`${pr.boq.code || pid}-${pr.boq.name || "Dự án"}`), root);
  const folders = {};
  for (const k of Object.keys(FOLDERS)) folders[k] = await makeFolder(tok, FOLDERS[k], projId);
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
  const pid = url.searchParams.get("project") || "", folder = url.searchParams.get("folder") || "", name = cleanName(url.searchParams.get("name"));
  if (!pid || !FOLDERS[folder] || !name) return json({ error: "bad_request" }, 400);
  const size = Number(request.headers.get("content-length") || 0);
  if (!size) return json({ error: "empty" }, 400);
  if (size > MAX_SIZE) return json({ error: "too_large" }, 413);
  const can = await api("rpc/can_folder", { method: "POST", body: JSON.stringify({ pid, folder }) });
  if (can.status === 401) return json({ error: "auth" }, 401);
  if (!can.ok || (await can.json()) !== true) return json({ error: "forbidden" }, 403);
  const accessToken = await tok();
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
  if (action === "status") return json({ connected });
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
    if (action === "delete" && request.method === "DELETE") return await remove(api, tok, url.searchParams.get("id") || "");
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    console.error("drive", e && e.message);
    return json({ error: "drive_error" }, 502);
  }
}
