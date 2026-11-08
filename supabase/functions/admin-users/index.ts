// Supabase Edge Function: admin-users
// Ban giám đốc tạo, đặt lại mật khẩu, khoá/mở và xoá tài khoản đăng nhập.
// Chỉ máy chủ mới có khoá quản trị (SUPABASE_SERVICE_ROLE_KEY, Supabase tự cấp cho Edge Function).
// Tự kiểm tra người gọi: phải đăng nhập và có profiles.is_board = true.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const DOMAIN = "namgiang-ec.pages.dev"; // tên ngắn "an.nguyen" → an.nguyen@namgiang-ec.pages.dev, khớp ô đăng nhập
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "auth" }, 401);
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "auth" }, 401);
  const { data: me } = await admin.from("profiles").select("is_board").eq("id", who.user.id).maybeSingle();
  if (!me?.is_board) return json({ error: "forbidden" }, 403);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = String(b.action || "");
  const uid = typeof b.uid === "string" ? b.uid : "";
  const pw = typeof b.password === "string" ? b.password : "";
  const pwOk = pw.length >= 8 && pw.length <= 72;

  if (action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return json({ error: "server" }, 500);
    return json({ users: data.users.map(u => ({ id: u.id, email: u.email, last: u.last_sign_in_at, created: u.created_at, banned: !!u.banned_until && new Date(u.banned_until) > new Date() })) });
  }

  if (action === "create") {
    const user = String(b.username || "").trim().toLowerCase();
    const email = user.includes("@") ? user : user + "@" + DOMAIN;
    if (!/^[a-z0-9._-]{3,40}(@[a-z0-9.-]+\.[a-z]{2,})?$/.test(user)) return json({ error: "bad_username" }, 400);
    if (!pwOk) return json({ error: "bad_password" }, 400);
    const full = String(b.full_name || "").trim().slice(0, 100);
    const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: full } });
    if (error) return json({ error: /already|registered|exists/i.test(error.message) ? "exists" : "server", detail: error.message }, 400);
    await admin.from("profiles").update({ full_name: full || null, is_board: b.is_board === true }).eq("id", data.user.id);
    return json({ id: data.user.id, email });
  }

  if (!uid) return json({ error: "bad_request" }, 400);
  if (uid === who.user.id && (action === "ban" || action === "delete")) return json({ error: "self" }, 400);

  if (action === "password") {
    if (!pwOk) return json({ error: "bad_password" }, 400);
    const { error } = await admin.auth.admin.updateUserById(uid, { password: pw });
    return error ? json({ error: "server" }, 500) : json({ ok: true });
  }
  if (action === "ban" || action === "unban") {
    const { error } = await admin.auth.admin.updateUserById(uid, { ban_duration: action === "ban" ? "876000h" : "none" });
    return error ? json({ error: "server" }, 500) : json({ ok: true });
  }
  if (action === "name") {
    const { error } = await admin.from("profiles").update({ full_name: String(b.full_name || "").trim().slice(0, 100) || null }).eq("id", uid);
    return error ? json({ error: "server" }, 500) : json({ ok: true });
  }
  if (action === "contact") {
    const f = String(b.field || ""), v = String(b.value || "").trim().slice(0, 120);
    if (f === "contact_email") { if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return json({ error: "bad_email" }, 400); }
    else if (f === "phone") { if (v && !/^\+?[0-9 .()-]{8,20}$/.test(v)) return json({ error: "bad_phone" }, 400); }
    else return json({ error: "bad_request" }, 400);
    const { error } = await admin.from("profiles").update({ [f]: v || null }).eq("id", uid);
    return error ? json({ error: "server" }, 500) : json({ ok: true });
  }
  if (action === "delete") {
    const { error } = await admin.auth.admin.deleteUser(uid);
    return error ? json({ error: "server" }, 500) : json({ ok: true });
  }
  return json({ error: "bad_request" }, 400);
});
