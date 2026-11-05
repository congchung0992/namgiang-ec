// Thử các hàm tính toán thuần trong index.html bằng node (không cần trình duyệt, không cần đăng nhập).
// Chạy: node tests/logic.test.mjs
// Số liệu ở đây là số giả để thử, không phải số liệu thật của dự án.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(root + "index.html", "utf8");
const lines = html.split("\n");

/* Lấy nguyên khai báo cấp ngoài cùng: dòng mở đầu bằng `function NAME(` hoặc `const NAME=`
   cộng các dòng thụt lề ngay sau nó (cách code trong index.html đang được viết). */
function grab(name) {
  const i = lines.findIndex(l => l.startsWith(`function ${name}(`) || l.startsWith(`const ${name}=`));
  if (i < 0) throw new Error("Không tìm thấy " + name);
  const out = [lines[i]];
  for (let k = i + 1; k < lines.length && /^\s/.test(lines[k]); k++) out.push(lines[k]);
  return out.join("\n");
}
/* Bộ đọc BOQ: lấy cả khối, mở thêm words/sim để thử */
const b0 = html.indexOf("var BOQ=(function(){"), b1 = html.indexOf("})();", html.indexOf("return {parse:parse", b0)) + 5;
const boqSrc = html.slice(b0, b1).replace(/return \{parse:parse,/, "return {words:words,sim:sim,parse:parse,");

const NAMES = ["parseVN", "has", "lineCost", "calc", "pd", "fd", "addD", "tkey", "tasks", "PH", "propose", "ensureSched", "M_", "timeline", "cash",
  "GZ", "gStat", "keepUp", "isUp", "sc", "tw_", "simW", "ggMatch", "chatMsgs", "bShift", "xc_"];
const ctx = vm.createContext({ console });
vm.runInContext(boqSrc, ctx);
const got = [];
for (const n of NAMES) { try { vm.runInContext(grab(n).replace(/^const /, "var "), ctx); got.push(n) } catch (e) { /* hàm chưa có ở bản cũ */ } }
const G = n => vm.runInContext(`typeof ${n}!=="undefined"?${n}:undefined`, ctx);
const BOQ = G("BOQ");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ĐẠT  " + name) }
  catch (e) { fail++; console.log("  LỖI  " + name + "\n        " + (e && e.message || e)) }
}
function eq(a, b, m) { if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) throw new Error(`${m || ""} nhận ${JSON.stringify(a)}, cần ${JSON.stringify(b)}`) }
function near(a, b, tol, m) { if (!(Math.abs(a - b) < tol)) throw new Error(`${m || ""} nhận ${a}, cần ${b} (±${tol})`) }
function ok(c, m) { if (!c) throw new Error(m || "điều kiện sai") }
const sum = a => a.reduce((x, y) => x + y, 0);
const clone = o => JSON.parse(JSON.stringify(o));

/* dự án giả */
function proj(hms, o = {}) {
  return { id: "x", value: o.value ?? sum(hms.map(h => h.total)), ratio: o.ratio ?? 85, cost: o.cost || {}, xcost: o.xcost, hms,
    sched: o.sched, terms: o.terms };
}
const hm = (code, name, total, lines = []) => ({ code, name, total, lines });

console.log("Tính tiền");
t("1. cash: dòng tiền thay đổi dần theo số ngày trả chi phí (14 / 15 / 30 ngày)", () => {
  const peak = (cost, pay = 30) => {
    const p = proj([hm("A01", "Xây dựng nhà xưởng", 8e9)], { terms: { adv: 0, ret: 5, pay, cost } });
    return G("cash")(p, G("timeline")(p)).peak;
  };
  const p14 = peak(14), p15 = peak(15), p30 = peak(30), p0 = peak(0), p22 = peak(22);
  console.log(`        vốn cần ứng: 0 ngày ${Math.round(p0 / 1e6)} tr · 14 ngày ${Math.round(p14 / 1e6)} tr · 15 ngày ${Math.round(p15 / 1e6)} tr · 22 ngày ${Math.round(p22 / 1e6)} tr · 30 ngày ${Math.round(p30 / 1e6)} tr`);
  ok(p0 > p14 && p14 > p15 && p15 > p22 && p22 >= p30, "vốn cần ứng phải giảm dần khi trả chi phí chậm hơn");
  ok(p15 > 0, "trả chi phí sau 15 ngày không được tương đương 30 ngày");
  ok(peak(15, 45) > peak(15, 30) && peak(15, 40) > peak(15, 30), "thu tiền chậm hơn (40, 45 ngày) phải cần ứng nhiều hơn");
  const p = proj([hm("A01", "Xây dựng", 8e9)], { terms: { adv: 10, ret: 5, pay: 37, cost: 13 } }), cf = G("cash")(p, G("timeline")(p));
  near(sum(cf.inn), 8e9 * 0.95, 1, "tổng thu (trừ giữ lại 5%)"); near(sum(cf.out), G("calc")(p).cost, 1, "tổng chi");
});
t("2. lineCost: dòng chưa nhập giá vốn ước tính = ratio% × thành tiền, vẫn tách VL/NC", () => {
  const lc = G("lineCost"), p = { cost: {}, ratio: 85 };
  const a = lc(p, { code: "a", qty: 1, vl: 0, nc: 0, total: 1e6 });
  near(a.t, 850000, 1e-6, "vl=0,nc=0:");
  const b = lc(p, { code: "b", qty: 1, vl: 400000, nc: null, total: 1e6 });
  near(b.t, 850000, 1e-6, "vl=400.000:");
  const c = lc(p, { code: "c", qty: 1, vl: 600000, nc: 400000, total: 1e6 });
  near(c.t, 850000, 1e-6, "vl+nc:"); near(c.v, 510000, 1e-6, "phần VL:"); near(c.n, 340000, 1e-6, "phần NC:");
  const d = lc(p, { code: "d", qty: 2, vl: null, nc: null, total: 1e6 });
  near(d.t, 850000, 1e-6, "không có cột VL/NC:"); eq(d.est, 1);
  const e = lc({ cost: { e: { v: 100, n: 50 } }, ratio: 85 }, { code: "e", qty: 3, total: 1e6 });
  eq(e.t, 450, "đã nhập giá vốn:"); eq(e.est, 0);
});
t("3. tasks/calc: hạng mục giá trị 0 có chi phí ngoài BOQ vẫn vào dòng tiền", () => {
  const p = proj([hm("A01", "Xây dựng", 8e9), hm("A02", "Công tác tạm", 0)], { xcost: { A02: { v: 1e9, n: 0 } } });
  const c = G("calc")(p), tl = G("timeline")(p);
  console.log(`        calc.cost ${c.cost / 1e9} tỷ · tổng giá vốn theo tháng ${sum(tl.cost) / 1e9} tỷ`);
  near(sum(tl.cost), c.cost, 1, "tổng giá vốn theo tháng"); near(sum(tl.rev), c.rev, 1, "tổng doanh thu theo tháng");
  const q = proj([hm("A01", "Xây dựng", 2e9), hm("B01", "Chi phí chung", 5e8)], { xcost: { B01: { v: 3e8, n: 1e8 } } });
  near(sum(G("timeline")(q).cost), G("calc")(q).cost, 1, "hạng mục có xcost và giá trị > 0");
});
t("4. propose: dự án 40 hạng mục không có thời lượng âm, doanh thu theo tháng đủ 4 tỷ", () => {
  const hs = [...Array(40)].map((_, i) => hm("A" + String(i + 1).padStart(2, "0"), "Lắp cửa", 1e8));
  const p = proj(hs), tl = G("timeline")(p), bad = Object.entries(p.sched.t).filter(([, q]) => !(q.d >= 1) || q.s < 0);
  console.log(`        ${bad.length} công việc thời lượng < 1 · doanh thu theo tháng ${sum(tl.rev) / 1e9} tỷ`);
  eq(bad.length, 0, "số công việc lỗi"); near(sum(tl.rev), 4e9, 1, "doanh thu");
  ok(Object.values(p.sched.t).every(q => q.s + q.d <= p.sched.D + 30), "vượt tổng thời gian");
});
t("4b. dự án đã lưu với thời lượng âm được sửa khi mở", () => {
  const hs = [...Array(3)].map((_, i) => hm("A0" + (i + 1), "Lắp cửa", 1e8));
  const p = proj(hs, { sched: { start: "01/12/2026", D: 240, t: { "A01|": { s: 250, d: -10 }, "A02|": { s: 10, d: 20 }, "A03|": { s: 10, d: 0 } } } });
  const tl = G("timeline")(p); near(sum(tl.rev), 3e8, 1, "doanh thu"); eq(p.sched.t["A02|"].d, 20, "công việc đúng giữ nguyên:");
});
t("5. timeline: bỏ Chủ nhật khi chia giá trị theo tháng, tổng vẫn đúng", () => {
  // 29/12/2026 (thứ Ba) → 04/01/2027: 3 ngày tháng 12, 4 ngày tháng 1 trong đó 03/01 là Chủ nhật
  const p = proj([hm("A01", "Xây dựng", 6e8)], { sched: { start: "29/12/2026", D: 30, t: { "A01|": { s: 0, d: 7 } } } });
  const tl = G("timeline")(p);
  console.log(`        tháng 12: ${tl.rev[0] / 1e6} tr · tháng 1: ${tl.rev[1] / 1e6} tr`);
  near(tl.rev[0], 3e8, 1, "tháng 12 (3/6 ngày thi công)"); near(sum(tl.rev), 6e8, 1e-3, "tổng");
  const q = proj([hm("A01", "Xây dựng", 123456789.37)], { sched: { start: "06/12/2026", D: 30, t: { "A01|": { s: 0, d: 1 } } } });
  near(sum(G("timeline")(q).rev), 123456789.37, 1e-3, "công việc 1 ngày rơi vào Chủ nhật");
  const r = proj([...Array(9)].map((_, i) => hm("A0" + (i + 1), "Hạng mục " + i, 1e9 / 3 + i)));
  const tr = G("timeline")(r); near(sum(tr.rev), sum(r.hms.map(h => h.total)), 1e-3, "nhiều công việc");
});

console.log("Đọc BOQ và giá gốc");
t("6. BOQ.num đọc đúng định dạng Việt Nam", () => {
  const n = BOQ.num;
  eq(n("1.234.567"), 1234567, "1.234.567:"); eq(n("1.234"), 1234, "1.234:"); eq(n("1,234"), 1.234, "1,234:");
  eq(n("1.234.567,89"), 1234567.89, "1.234.567,89:"); eq(n("-1.234.567"), -1234567, "-1.234.567:"); eq(n(" 12 345 "), 12345, "có dấu cách:");
  eq(n("1,5"), 1.5); eq(n("1.5"), 1.5); eq(n("0.123"), 0.123); eq(n("12.50"), 12.5); eq(n("1,234,567"), 1234567); eq(n("1,234.5"), 1234.5);
  eq(n(1234.5), 1234.5, "số thật từ Excel:"); eq(n(""), null); eq(n("abc"), null); eq(n(NaN), null);
});
t("7. sc: tên khách hàng có ngoặc không làm hỏng việc đọc file", () => {
  const client = "CÔNG TY TNHH SUNRISE (VIỆT NAM)", brand = client.replace(/^.*?(TNHH|CỔ PHẦN|CP|JSC)\s*/i, "");
  eq(G("sc")("NHÀ MÁY SUNRISE (VIỆT NAM) GIAI ĐOẠN 2", brand), "Nhà máy Sunrise (việt nam) giai đoạn 2");
  eq(G("sc")("NHÀ XƯỞNG A+B [C*]", "KHÁCH+ [ABC*]"), "Nhà xưởng a+b [c*]");
  eq(G("sc")("NHÀ MÁY HOA SEN", "HOA SEN GROUP"), "Nhà máy hoa sen", "trường hợp cũ:");
  eq(G("sc")("NHÀ MÁY SUNRISE", "SUNRISE"), "Nhà máy Sunrise", "trường hợp cũ:");
});
// bản sao sim cũ để so: các cặp đang ghép đúng không được đổi điểm
const OLDW = s => BOQ.nz(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w && !/^(lot|nha|xuong|tram|day|update|hang|muc|thi|cong)$/.test(w));
const OLDS = (a, b) => { const A = OLDW(a), B = OLDW(b); if (!A.length || !B.length) return 0; let s = 0; A.forEach(w => { if (B.includes(w)) s++ }); return s / Math.max(A.length, B.length) };
const X = { utils: { sheet_to_json: ws => ws }, SSF: { parse_date_code: () => ({ d: 1, m: 1, y: 2026 }) } };
const sheet = (title, rows) => [["STT", "Nội dung công việc", "ĐVT", "Khối lượng", "Đơn giá", "Thành tiền"], ...(title ? [["", title, "", "", "", sum(rows.map(r => r[5]))]] : []), ...rows];
const thSheet = rows => [["BẢNG TỔNG HỢP"], ["STT", "Hạng mục", "Thành tiền"], ...rows];
t("8. sim: hạng mục và sheet cùng tên toàn từ chung vẫn ghép được", () => {
  ok(BOQ.sim("Nhà xưởng", "Nhà xưởng") > 0, "sim(Nhà xưởng, Nhà xưởng) = " + BOQ.sim("Nhà xưởng", "Nhà xưởng"));
  const wb = { SheetNames: ["TH", "Nhà xưởng", "Điện"], Sheets: {
    TH: thSheet([["1", "Nhà xưởng", 3000], ["2", "Hệ thống điện", 500], ["", "Tổng cộng trước thuế", 3500]]),
    "Nhà xưởng": sheet("", [["1", "Bê tông móng", "m3", 10, 300, 3000]]),
    "Điện": sheet("", [["1", "Cáp điện", "m", 5, 100, 500]]) } };
  const r = BOQ.parse(wb, X);
  eq(r.hms[0].sheet, "Nhà xưởng", "hạng mục Nhà xưởng ghép với sheet:"); eq(r.hms[1].sheet, "Điện");
  const pairs = [["Hạng mục điện nhà xưởng", "Điện"], ["Nhà xưởng", "Nhà xưởng A1"], ["Trạm biến áp", "TBA"], ["Hệ thống PCCC", "PCCC nhà xưởng"],
    ["Hạ tầng", "Hạ tầng kỹ thuật"], ["Nhà văn phòng", "Văn phòng"], ["Nhà xưởng", "Điện"], ["Lot 1", "Lot 2"], ["Thi công", "Công"], ["Xưởng", "Nhà xưởng"]];
  pairs.forEach(([a, b]) => { if (OLDS(a, b) > 0 || OLDW(a).length && OLDW(b).length) eq(BOQ.sim(a, b), OLDS(a, b), `sim(${a}, ${b})`) });
  eq(BOQ.sim("Nhà xưởng", "Nhà xưởng A1"), 0, "chỉ trùng từ chung, khác tên: không ghép");
});
t("9. ggMatch: hai dòng cùng tên Bê tông nhận đúng giá theo thứ tự", () => {
  const L = (name, uVL) => ({ name, unit: "m3", qty: 10, uVL, uNC: 0, vl: uVL * 10, nc: 0, u: uVL, total: uVL * 10, g1: "" });
  const p = { cost: {}, hms: [{ code: "A01", name: "Xây dựng", sheet: "XD", total: 2000, lines: [{ ...L("Bê tông", 100), code: "A01.01.001" }, { ...L("Bê tông", 100), code: "A01.01.002" }] }] };
  const r = { hms: [{ name: "Xây dựng", sheet: "XD", total: 0, lines: [L("Bê tông", 100), L("Bê tông", 999)] }] };
  const R = G("ggMatch")(p, r);
  eq(R.rows[0].v, 100, "dòng 1:"); eq(R.rows[1].v, 999, "dòng 2:");
});
t("10. Ngưỡng khớp tổng tiền: lệch dưới 1 đồng", () => {
  eq(BOQ.okSum && BOQ.okSum(1000500, 1000000), false, "lệch 500 đ:"); eq(BOQ.okSum(1000000.4, 1000000), true, "lệch 0,4 đ:");
  const mk = (detail, tot) => ({ SheetNames: ["TH", "Xây dựng"], Sheets: {
    TH: thSheet([["1", "Xây dựng", tot], ["", "Tổng cộng trước thuế", tot]]), "Xây dựng": sheet("", [["1", "Bê tông", "m3", 1, detail, detail]]) } });
  const r = BOQ.parse(mk(1000000, 1000500), X);
  eq(r.hms[0].lines.length, 2, "lệch 500 đ phải có dòng tự cân:"); near(r.check, 1000500, 1e-6);
  const r2 = BOQ.parse(mk(1000000, 1000000.3), X); eq(r2.hms[0].lines.length, 1, "lệch 0,3 đ không tự cân:");
  ok(/BOQ\.okSum/.test(grab("preview")), "preview dùng ngưỡng chung");
  ok(/BOQ\.okSum/.test(grab("createFromPending")), "createFromPending dùng ngưỡng chung");
  ok(!/<1000/.test(grab("preview")) && !/<1000/.test(grab("pvDetail")), "còn ngưỡng 1000 đ trong preview");
});

console.log("Tiến độ và chat");
t("11. Tiến độ gốc: dời ngày khởi công 2 tháng phải báo lệch", () => {
  const p = proj([hm("A01", "Xây dựng", 1e9)], { sched: { start: "01/12/2026", D: 100, t: { "A01|": { s: 0, d: 100 } } } });
  const S = p.sched, t2 = {}; Object.entries(S.t).forEach(([k, q]) => t2[k] = { s: q.s, d: q.d });
  S.base = { t: t2, date: "01/11/2026", start: S.start }; // giống nút Chốt tiến độ gốc ở bản mới
  S.start = "01/02/2027";
  const g = G("gStat")(p, G("timeline")(p));
  console.log(`        lệch so gốc: ${g.var} ngày`);
  eq(g.var, 62, "lệch (01/12/2026 → 01/02/2027)");
  ok(/start:cur\.sched\.start/.test(html), "nút chốt tiến độ gốc phải lưu ngày khởi công");
  const old = clone(p); delete old.sched.base.start; const g2 = G("gStat")(old, G("timeline")(old));
  eq(g2.var, 0, "tiến độ gốc cũ chưa có ngày khởi công (giữ cách tính cũ, không lỗi):");
});
t("12. Chat: lịch sử gửi đi luôn bắt đầu bằng tin người dùng", () => {
  const f = G("chatMsgs"); ok(f, "chưa có hàm chatMsgs");
  for (let n = 1; n <= 30; n += 2) {
    const h = [...Array(n)].map((_, i) => ({ role: i % 2 ? "assistant" : "user", content: "c" + i })), m = f(h);
    eq(m[0].role, "user", `độ dài ${n}:`); ok(m.length <= 12 && m[m.length - 1] === h[n - 1], "tin cuối phải là câu hỏi mới");
  }
  ok(/Lỗi gọi Claude|chưa gọi được Claude/.test(html.slice(html.indexOf("async function ask("))), "nhãn phải báo khi gọi Claude lỗi");
});
const chatSrc = readFileSync(root + "functions/api/chat.js", "utf8");
const chat = await import("data:text/javascript;base64," + Buffer.from(chatSrc).toString("base64"));
await (async () => {
  const name = "12b. api/chat: bỏ tin assistant đứng đầu thay vì trả 400";
  try {
    let sent = null; const of = globalThis.fetch;
    globalThis.fetch = async (u, o) => { sent = JSON.parse(o.body); return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }) };
    const h = [...Array(13)].map((_, i) => ({ role: i % 2 ? "assistant" : "user", content: "c" + i }));
    const req = new Request("https://x.test/api/chat", { method: "POST", body: JSON.stringify({ messages: h, context: {} }) });
    const res = await chat.onRequestPost({ request: req, env: { ANTHROPIC_API_KEY: "khoa-gia" } });
    globalThis.fetch = of;
    eq(res.status, 200, "mã trả về:"); eq(sent.messages[0].role, "user"); ok(sent.messages.length <= 12);
    eq(sent.model, "claude-haiku-5-5", "mô hình mặc định:"); ok(sent.max_tokens >= 2000, "max_tokens phải đủ chỗ cho cả suy nghĩ và câu trả lời");
    pass++; console.log("  ĐẠT  " + name);
  } catch (e) { fail++; console.log("  LỖI  " + name + "\n        " + e.message) }
})();

console.log(`\n${pass} đạt · ${fail} lỗi`);
process.exit(fail ? 1 : 0);
