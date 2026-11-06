// Supabase Edge Function: ai
// Gọi Claude (Anthropic) cho web: đọc báo giá (extract), ghép dòng với BOQ (match, match_lines), gợi ý thư mục khi tải file (classify),
// trợ lý chat (chat), kiểm tra khoá (ping). Khoá Claude do Ban giám đốc dán ở màn Quản trị, lưu trong bảng app_secrets
// (chỉ máy chủ đọc được). Có biến môi trường ANTHROPIC_API_KEY thì ưu tiên biến đó. Người gọi phải đăng nhập.
// Mỗi lượt ghi một dòng vào ai_usage để đo lường (việc, mẫu, token, thời gian, lỗi).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.5.0";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

/* Mẫu mặc định Claude Opus 5.5; Ban giám đốc đổi được ở màn Quản trị (lưu app_secrets "claude_model") */
const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
/* Khuôn JSON cho structured outputs: mọi object phải có additionalProperties: false */
const strictify = (s: any): any => {
  if (Array.isArray(s)) return s.map(strictify);
  if (!s || typeof s !== "object") return s;
  const o: any = {};
  for (const [k, v] of Object.entries(s)) o[k] = strictify(v);
  if (o.type === "object") o.additionalProperties = false;
  return o;
};
class AiErr extends Error { constructor(public code: string, msg?: string) { super(msg || code); } }

/* Một lượt gọi Claude, trả JSON theo khuôn. Stream để không bị cắt ở yêu cầu dài; tự chuyển mẫu dự phòng khi bị từ chối */
async function claude(env: any, { system, content, schema, effort = "low", maxTokens = 16000 }: any) {
  const model = env.MODEL;
  const req: any = {
    model, max_tokens: maxTokens, system: system + (env.R ? "\n\n" + env.R : ""),
    messages: [{ role: "user", content }],
    output_config: { effort, ...(schema ? { format: { type: "json_schema", schema: strictify(schema) } } : {}) },
  };
  // Haiku không có fallbacks phía máy chủ
  if (model !== "claude-haiku-5-5") { req.betas = ["server-side-fallback-2026-07-01"]; req.fallbacks = "default"; }
  let msg: any;
  try { msg = await env.client.beta.messages.stream(req).finalMessage(); }
  catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiErr("sai_khoa", String(e.message));
    if (e instanceof Anthropic.RateLimitError) throw new AiErr("het_luot", String(e.message));
    if (e instanceof Anthropic.BadRequestError) throw new AiErr(/credit|balance|billing/i.test(String(e.message)) ? "het_tien" : "ai_error", String(e.message));
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiErr("qua_tai", "timeout");
    if (e instanceof Anthropic.APIError) throw new AiErr((e.status || 0) >= 500 ? "qua_tai" : "ai_error", String(e.message));
    throw e;
  }
  const u = msg.usage || {};
  env.M.model = msg.model || model;
  env.M.in += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  env.M.out += u.output_tokens || 0;
  if (msg.stop_reason === "refusal") throw new AiErr("tu_choi", "refusal");
  if (msg.stop_reason === "max_tokens") throw new AiErr("qua_dai", "max_tokens");
  const text = (msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  if (!schema) return { text, model: env.M.model };
  try { return { data: JSON.parse(text), model: env.M.model }; } catch { throw new AiErr("ai_error", "badjson"); }
}
/* File gửi lên: PDF → document, ảnh → image */
const fileBlock = (mime: string, data: string) => mime === "application/pdf"
  ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
  : /^image\/(jpeg|png|gif|webp)$/.test(mime) ? { type: "image", source: { type: "base64", media_type: mime, data } } : null;

const SYS_CHAT = `Bạn là "Trợ lý Nam Giang", trợ lý quản lý dự án của Công ty CP Đầu tư và Xây lắp Nam Giang (tổng thầu xây dựng).
Trả lời bằng tiếng Việt, ngắn gọn, đi thẳng vào số liệu. Số tiền viết kiểu Việt Nam (dấu chấm phân cách nghìn, dấu phẩy thập phân), dùng "tỷ" hoặc "triệu" cho dễ đọc; ngày dạng dd/mm/yyyy.
Chỉ dựa vào dữ liệu trong phần NGỮ CẢNH. Nếu dữ liệu không có, nói rõ là chưa có và gợi ý cần nhập gì. Không bịa số.
Nhắc khi con số dựa trên giả định (giá vốn ước tính, điều khoản thanh toán giả định, thời gian chờ vật tư mặc định).
Có thể dùng gạch đầu dòng "- " và **in đậm**; không dùng bảng hay tiêu đề.
BỘ NÃO DỰ ÁN: ngoài số liệu, có HỒ SƠ DỰ ÁN (thông tin đã chốt; mục "chưa xác nhận" là trợ lý tự đọc từ file, nói rõ khi dùng) và DANH MỤC TÀI LIỆU (bản chữ các file đã tải lên, mã d1, d2…).
- Câu hỏi về hợp đồng, điều khoản, pháp lý, tiến độ, công văn, biên bản: xem hồ sơ dự án trước; cần chi tiết hoặc trích dẫn thì gọi doc_read (đọc bản chữ một tài liệu) hoặc doc_search (tìm theo từ khoá trong mọi tài liệu).
- Bản chữ ghi "(nguyên văn)" là chép đủ từng chữ của file: khi được hỏi trích, chép đúng nguyên văn đoạn đó (đặt trong ngoặc kép, ghi số điều và [Trang N] nếu có), không tóm tắt, không nói là không trích được. Bản chữ "(ghi chép)" chỉ là tóm lược: nói rõ khi dùng.
- Ghi nguồn ngay sau ý lấy từ tài liệu bằng mã trong ngoặc vuông, ví dụ [d3]; kèm số điều khoản nếu có. Không ghi mã tài liệu bạn chưa đọc.
- Khi người dùng nói ra thông tin lâu dài chưa có hoặc khác hồ sơ (ví dụ "hợp đồng Ekochem là đơn giá cố định", "TVGS là công ty X", "công ty luôn giữ lại 5% bảo hành thầu phụ"), hoặc sửa câu trả lời của bạn: gọi ghi_nho rồi hỏi lại đúng một câu "Em ghi vào hồ sơ …: … – đúng không anh?". Không tự coi là đã ghi.`;
const SYS_OCR = `Bạn chép lại NGUYÊN VĂN toàn bộ chữ trên các trang tài liệu scan được gửi (hợp đồng, phụ lục, văn bản pháp lý của dự án xây dựng Việt Nam).
- Chép đủ từng chữ, đúng thứ tự, giữ nguyên số điều, khoản, mục, số liệu, dấu câu, chữ in hoa; không tóm tắt, không diễn giải, không sửa câu chữ, không bỏ đoạn nào.
- Mở đầu mỗi trang bằng một dòng "[Trang N]" (N là số trang trong cả tài liệu, được cho ở đề bài). Giữ xuống dòng theo đoạn.
- Bảng: mỗi dòng bảng một dòng, các ô cách nhau bằng " | ".
- Chữ không đọc được thì ghi [không rõ]. Con dấu, chữ ký ghi [dấu], [chữ ký] kèm tên in bên dưới nếu có.
- Chỉ trả về phần chữ đã chép, không thêm lời nào khác.`;
const SYS_DIGEST = `Bạn là thư ký hồ sơ của một tổng thầu xây dựng Việt Nam (Nam Giang). Đọc một tài liệu của dự án và lập "bản chữ" để trợ lý tra cứu về sau.
- kind: loại tài liệu ngắn gọn (ví dụ "Hợp đồng thi công với chủ đầu tư", "Phụ lục hợp đồng", "Tiến độ thi công", "Hợp đồng thầu phụ", "Báo giá nhà cung cấp", "Công văn", "Biên bản họp", "Hồ sơ thanh toán").
- summary: tóm tắt 4–10 dòng, mỗi dòng bắt đầu "- ", nêu: số hiệu, ngày, các bên, phạm vi, giá trị, mốc thời gian, điều khoản quan trọng. Số tiền viết kiểu Việt Nam (1.250.000.000 đ), ngày dd/mm/yyyy.
- notes: nếu đề bài có kèm "Nội dung chữ của file" thì để "". Nếu không (file scan/ảnh), ghi chép chi tiết nội dung để tra cứu thay bản gốc: giữ nguyên văn các điều khoản về giá trị, loại hợp đồng, khối lượng, đơn giá, điều chỉnh giá, tạm ứng, thanh toán, giữ lại, bảo lãnh, bảo hành, tiến độ, phạt, nghiệm thu, các bên ký; ghi số điều khoản. Tối đa khoảng 12.000 ký tự.
- facts: chỉ lấy khi tài liệu là hồ sơ của DỰ ÁN với CHỦ ĐẦU TƯ (hợp đồng, phụ lục với CĐT, pháp lý dự án, hồ sơ thầu, tiến độ được duyệt). Hợp đồng/báo giá với thầu phụ, nhà cung cấp, tổ đội thì facts = []. Mỗi fact: k là đúng một tên trong danh sách sau (không tự đặt tên khác): ${"Chủ đầu tư|Tư vấn giám sát|Tên công trình|Địa điểm|Số hợp đồng với CĐT|Ngày ký hợp đồng với CĐT|Loại hợp đồng|Giá trị hợp đồng|Thuế VAT|Phạm vi công việc|Thời gian thực hiện|Ngày khởi công|Ngày hoàn thành|Tạm ứng|Thu hồi tạm ứng|Điều kiện thanh toán|Giữ lại khi thanh toán|Bảo lãnh thực hiện hợp đồng|Bảo hành|Phạt chậm tiến độ|Điều chỉnh khối lượng, đơn giá|Phát sinh|Bảo hiểm|Nghiệm thu|Giấy phép xây dựng|Phụ lục hợp đồng".split("|").join(", ")}; v là nội dung ngắn gọn, chính xác theo tài liệu; clause là câu nguyên văn làm căn cứ kèm số điều khoản. Loại hợp đồng ghi rõ: trọn gói / theo đơn giá cố định / theo đơn giá điều chỉnh / theo thời gian / kết hợp, và khối lượng có được tính lại theo thực tế không. Không đoán; điều gì tài liệu không ghi thì không đưa vào.`;

/* ---------- Khuôn dữ liệu ---------- */
const DIGEST = { type: "object", properties: { kind: { type: "string" }, summary: { type: "string" }, notes: { type: "string" },
  facts: { type: "array", items: { type: "object", properties: { k: { type: "string" }, v: { type: "string" }, clause: { type: "string" } }, required: ["k", "v", "clause"] } } },
  required: ["kind", "summary", "notes", "facts"] };
const FACT_KEYS = new Set("Chủ đầu tư|Tư vấn giám sát|Tên công trình|Địa điểm|Số hợp đồng với CĐT|Ngày ký hợp đồng với CĐT|Loại hợp đồng|Giá trị hợp đồng|Thuế VAT|Phạm vi công việc|Thời gian thực hiện|Ngày khởi công|Ngày hoàn thành|Tạm ứng|Thu hồi tạm ứng|Điều kiện thanh toán|Giữ lại khi thanh toán|Bảo lãnh thực hiện hợp đồng|Bảo hành|Phạt chậm tiến độ|Điều chỉnh khối lượng, đơn giá|Phát sinh|Bảo hiểm|Nghiệm thu|Giấy phép xây dựng|Phụ lục hợp đồng".split("|"));
const TOOLS = [
  { name: "doc_read", description: "Đọc bản chữ của một tài liệu trong DANH MỤC TÀI LIỆU. Có tu_khoa thì chỉ trả các đoạn quanh từ khoá (nhanh hơn).", input_schema: { type: "object", properties: { doc: { type: "string", description: "Mã tài liệu, ví dụ d3" }, tu_khoa: { type: "string", description: "Từ khoá có dấu, ví dụ: tạm ứng, điều chỉnh giá. Để trống để đọc cả bài." } }, required: ["doc"] } },
  { name: "doc_search", description: "Tìm một cụm từ (tiếng Việt có dấu) trong bản chữ mọi tài liệu được phép xem, trả về các đoạn có cụm từ đó.", input_schema: { type: "object", properties: { tu_khoa: { type: "string" } }, required: ["tu_khoa"] } },
  { name: "ghi_nho", description: "Đề xuất ghi một thông tin lâu dài người dùng vừa nói (người dùng phải bấm xác nhận mới ghi). pham_vi du_an: ghi vào hồ sơ dự án đang mở (muc nên là một tên chuẩn như Loại hợp đồng, Tư vấn giám sát…); cong_ty: kiến thức chung của công ty.", input_schema: { type: "object", properties: { pham_vi: { type: "string", enum: ["du_an", "cong_ty"] }, muc: { type: "string" }, noi_dung: { type: "string" } }, required: ["pham_vi", "muc", "noi_dung"] } },
];
/* Các đoạn quanh từ khoá (không phân biệt hoa thường) */
function around(body: string, kw: string, w = 700, max = 6) {
  const B = body.toLowerCase(), K = kw.toLowerCase().trim(); const out: string[] = []; let i = 0, last = -1e9;
  while (K && out.length < max && (i = B.indexOf(K, i)) >= 0) { if (i - last > w) { out.push("…" + body.slice(Math.max(0, i - w), i + K.length + w) + "…"); last = i; } i += K.length; }
  return out;
}
/* Claude giới hạn số ô kiểu "hoặc null" trong khuôn: dùng kiểu thường, ô thiếu ghi "" (chữ) hoặc 0 (số) / -1 (chỉ số), máy chủ đổi lại thành null */
const nul = (t: string) => ({ type: t });
const blank = (o: any, keys: string[]) => { for (const k of keys) if (o && (o[k] === "" || o[k] === 0 || o[k] === -1)) o[k] = null; return o; };
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
- Một dòng có NHIỀU CỘT đơn giá theo phương án (ví dụ theo loại cát: cát vàng 100% / 50% cát vàng + 50% cát Trung Hà / cát Trung Hà + cát nghiền; hoặc bơm sàn / bơm cột vách): tách MỖI cột thành một dòng riêng, ghi phương án trong ngoặc ở cuối tên, ví dụ "Bê tông M300 (12±2) (cát vàng 100%)". Không dồn giá của cột khác vào ghi chú.
- vat_included = true nếu đơn giá đã gồm VAT; vat_rate = thuế suất % nếu có.
- kind: ncc = cung cấp vật tư/thiết bị; thau_phu = thầu phụ thi công trọn gói (vật tư + nhân công); nhan_cong = tổ đội, khoán nhân công.
- payment_days = số ngày được trả chậm sau khi giao hàng/nghiệm thu; advance_percent = % tạm ứng; delivery_days = số ngày giao hàng kể từ khi đặt (ước lượng nếu ghi tuần).
- Ngày viết dd/mm/yyyy. Thiếu thông tin thì ghi chuỗi rỗng "" (ô chữ) hoặc 0 (ô số), không bịa.`;

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
const SYS_MATCH = `Bạn là QS của tổng thầu xây dựng. Ghép từng dòng báo giá với đúng MỘT dòng BOQ hợp đồng trong danh sách ứng viên của dòng đó (code = "" nếu không dòng nào đúng).
- So tên công việc/vật tư, quy cách (mác bê tông, đường kính thép, độ dày tôn, kích thước…), đơn vị. Khác quy cách quan trọng thì KHÔNG ghép.
- Mã có dấu "|" là cả một nhóm công việc: chỉ chọn khi dòng báo giá là giá trọn gói cho cả nhóm đó.
- factor = số đơn vị báo giá trong 1 đơn vị BOQ (ví dụ báo giá theo kg, BOQ theo tấn → 1000; báo giá theo tấn, BOQ theo kg → 0.001; cùng đơn vị → 1).
- code = "" nếu không dòng nào đúng. confidence từ 0 đến 1. reason: một câu ngắn tiếng Việt.`;


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
Với MỖI dòng BOQ, chọn dòng báo giá cung cấp đúng vật tư hoặc nhân công cho dòng đó (trả về chỉ số i), hoặc i = -1 nếu báo giá không có.
- Phải trùng loại và quy cách chính: mác bê tông (M100, M150, M200, M250, M300, M350… hoặc B15, B20…), đường kính và mác thép (D10, D16, CB300, CB400…), độ dày, kích thước, chủng loại. Khác mác hoặc quy cách thì KHÔNG chọn.
- Một dòng báo giá được dùng cho nhiều dòng BOQ (ví dụ bê tông M300 cho móng, cột, dầm, sàn của mọi hạng mục).
- Cùng mác có nhiều phương án vật liệu (ví dụ loại cát): BOQ ghi rõ loại (ví dụ cát vàng) thì chọn đúng phương án đó; BOQ ghi "cát thường" hoặc không ghi loại thì chọn phương án RẺ NHẤT không phải cát vàng (cát Trung Hà, cát nghiền, cát nhân tạo…), để mọi nhà cung cấp được so trên cùng một chuẩn.
- Đơn vị tính khác loại hẳn (m³ với cái, bộ, ca…) thì KHÔNG chọn.
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
  "04.3": "Thanh toán với CHỦ ĐẦU TƯ: hồ sơ đề nghị thanh toán đợt, hoá đơn xuất cho chủ đầu tư, đối chiếu công nợ chủ đầu tư",
  "05.1": "Báo giá của nhà cung cấp, thầu phụ, tổ đội; đơn đặt hàng",
  "05.2": "Hợp đồng với nhà cung cấp, thầu phụ, tổ đội: hợp đồng mua vật tư thiết bị, hợp đồng thầu phụ, giao khoán, phụ lục",
  "05.3": "Thanh toán cho nhà cung cấp, thầu phụ, tổ đội: đề nghị thanh toán, nghiệm thu thanh toán, hoá đơn đầu vào, uỷ nhiệm chi, đối chiếu công nợ",
  "05.4": "Phiếu nhập, phiếu xuất, phiếu giao nhận vật tư",
  "06.1": "Nhật ký thi công",
  "06.2": "Báo cáo tuần/tháng, ảnh hiện trường",
  "06.3": "Công văn đi/đến, biên bản họp giao ban"
};
const SYS_CLASSIFY = `Bạn phân loại hồ sơ của một công ty tổng thầu xây dựng Việt Nam vào đúng thư mục dự án.
Các thư mục:
${Object.entries(FOLDERS).map(([k, v]) => `${k}: ${v}`).join("\n")}
Đọc nội dung file (và tên file) rồi chọn MỘT thư mục hợp lý nhất.
QUAN TRỌNG với hợp đồng: Nam Giang là tổng thầu.
- 01.3 CHỈ dành cho hợp đồng, phụ lục ký với CHỦ ĐẦU TƯ (chủ đầu tư giao việc cho Nam Giang; Nam Giang là bên B/bên nhận thầu). Tên chủ đầu tư dự án được cho sẵn bên dưới.
- Hợp đồng mà Nam Giang là bên A/bên giao thầu/bên mua/bên thuê (thuê thầu phụ, giao khoán tổ đội, mua vật tư, thuê máy, ép cọc, khoan cọc…) → 05.2, kể cả khi bên kia gọi Nam Giang là "nhà thầu chính".
- Viết "reason" trước, rồi chọn "folder" khớp đúng với lý do vừa viết.
"fit": false nếu không thư mục nào thật sự hợp; khi đó "new_group" là mã nhóm (01–06) nên đặt thư mục mới và "new_folder" là tên thư mục mới nên tạo (ngắn, tiếng Việt); nếu fit = true thì để "" cho cả hai.
"reason": một câu ngắn tiếng Việt nêu file này là gì và vì sao chọn thư mục đó.
"photo_date": nếu là ảnh có in ngày chụp (ví dụ dấu Timemark "Thứ Bảy, 31 Tháng 10, 2026 15:32", hoặc ngày giờ góc ảnh) thì ghi ngày đó dạng dd/mm/yyyy; không thấy ngày in trên ảnh thì "".
"title": tên mô tả ngắn cho file bằng tiếng Việt, tối đa 8 chữ, không ghi ngày, không ghi mã dự án (ví dụ "Biên bản nghiệm thu đợt 2 phần móng").`;
const CLASSIFY = {
  type: "object",
  properties: {
    reason: { type: "string" },
    folder: { type: "string", enum: Object.keys(FOLDERS) },
    title: { type: "string" },
    fit: { type: "boolean" },
    new_group: { type: "string", enum: ["", "01", "02", "03", "04", "05", "06"] },
    new_folder: { type: "string" },
    photo_date: { type: "string" }
  },
  required: ["reason", "folder", "title", "fit", "new_group", "new_folder", "photo_date"],
  additionalProperties: false
};

/* Hợp đồng với chủ đầu tư: điều khoản thanh toán, tiến độ; ô thiếu ghi 0 hoặc "" */
const CONTRACT = {
  type: "object",
  properties: {
    contract_no: { type: "string" }, sign_date: { type: "string" },
    value_before_vat: { type: "number" }, value_with_vat: { type: "number" }, vat_rate: { type: "number" },
    advance_percent: { type: "number" }, advance_recovery: { type: "string" },
    retention_percent: { type: "number" }, warranty_months: { type: "number" },
    payment_days: { type: "number" }, payment_cycle: { type: "string" },
    start_date: { type: "string" }, duration_days: { type: "number" }, end_date: { type: "string" },
    penalty: { type: "string" }, notes: { type: "string" },
    milestones: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, kind: { type: "string", enum: ["tam_ung", "giai_doan", "quyet_toan", "bao_hanh"] },
      percent: { type: "number" }, basis: { type: "string" }, condition: { type: "string" }, documents: { type: "string" },
      progress_percent: { type: "number" }, days_after: { type: "number" }, clause: { type: "string" }
    }, required: ["name", "kind", "percent", "basis", "condition", "documents", "progress_percent", "days_after", "clause"] } },
    evidence: { type: "array", items: { type: "object", properties: { field: { type: "string" }, quote: { type: "string" } }, required: ["field", "quote"] } }
  },
  required: ["contract_no", "sign_date", "value_before_vat", "value_with_vat", "vat_rate", "advance_percent", "advance_recovery", "retention_percent", "warranty_months", "payment_days", "payment_cycle", "start_date", "duration_days", "end_date", "penalty", "notes", "milestones", "evidence"]
};
const SYS_CONTRACT = `Bạn là chuyên viên hợp đồng của một tổng thầu xây dựng Việt Nam. Đọc hợp đồng thi công (hoặc phụ lục) ký với chủ đầu tư và lấy CHÍNH XÁC các điều khoản dưới đây. Không đoán, không bịa: điều khoản nào hợp đồng không ghi thì để 0 (ô số) hoặc "" (ô chữ).
- value_before_vat, value_with_vat: giá trị hợp đồng (đồng, số thuần); vat_rate: thuế suất %.
- advance_percent: % tạm ứng trên giá trị hợp đồng; advance_recovery: cách thu hồi tạm ứng (một câu).
- retention_percent: % giá trị giữ lại bảo hành (hoặc bảo lãnh bảo hành thay thế thì ghi 0 và nói rõ ở notes); warranty_months: thời gian bảo hành (tháng).
- payment_days: số ngày chủ đầu tư thanh toán kể từ khi nhận đủ hồ sơ thanh toán/nghiệm thu đợt; payment_cycle: chu kỳ thanh toán (theo tháng, theo đợt/giai đoạn…) và % mỗi đợt nếu có.
- start_date, end_date: ngày khởi công, ngày hoàn thành (dd/mm/yyyy, nếu chỉ ghi "kể từ ngày bàn giao mặt bằng" thì để "" và ghi ở notes); duration_days: tổng thời gian thi công (ngày; tháng × 30).
- penalty: phạt chậm tiến độ (một câu). notes: điều khoản khác ảnh hưởng dòng tiền (bảo lãnh, điều chỉnh giá, tạm giữ…), tối đa 3 câu.
- milestones: liệt kê ĐẦY ĐỦ từng đợt thanh toán theo đúng thứ tự trong hợp đồng (tạm ứng, các đợt theo giai đoạn/nghiệm thu, quyết toán, hoàn trả bảo hành). Với mỗi đợt:
  name: tên ngắn (ví dụ "Lần 2 – hoàn thành phần móng"); kind: tam_ung | giai_doan | quyet_toan | bao_hanh;
  percent: % giá trị được thanh toán ở đợt đó (số thuần); basis: tính trên giá trị nào (giá trị hợp đồng gồm/chưa VAT, giá trị nghiệm thu, giá trị tạm tính…);
  condition: ĐIỀU KIỆN để được thanh toán đợt đó, ghi đủ và cụ thể (hạng mục/khối lượng phải hoàn thành, nghiệm thu, bảo lãnh phải nộp, khấu trừ tạm ứng…);
  documents: hồ sơ phải nộp để được thanh toán (biên bản nghiệm thu, hoá đơn, bảo lãnh, đề nghị thanh toán…), "" nếu không ghi;
  progress_percent: nếu điều kiện gắn với % khối lượng/giá trị hoàn thành thì ghi số % đó, không thì 0;
  days_after: số ngày chủ đầu tư thanh toán sau khi đủ điều kiện/hồ sơ, 0 nếu không ghi; clause: số điều khoản.
- evidence: với mỗi ô đã lấy được (field = tên ô), chép nguyên văn câu trong hợp đồng làm căn cứ, kèm số điều khoản nếu có.`;

let keyCache: { v: string; m: string; at: number } | null = null;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "auth" }, 401);
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  // Đọc theo quyền của người gọi (RLS): hồ sơ, bản chữ tài liệu
  const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: "Bearer " + token } } });
  if (whoErr || !who?.user) return json({ error: "auth" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  // Khoá và mẫu: đọc bảng app_secrets (giữ 5 phút trong bộ nhớ; kiểm tra kết nối thì đọc lại ngay)
  if (!keyCache || Date.now() - keyCache.at > 300000 || b.action === "ping") {
    const { data } = await admin.from("app_secrets").select("name,value").in("name", ["claude", "claude_model"]);
    const get = (n: string) => (data || []).find((x: any) => x.name === n)?.value || "";
    keyCache = { v: get("claude"), m: get("claude_model"), at: Date.now() };
  }
  const key = Deno.env.get("ANTHROPIC_API_KEY") || keyCache.v;
  if (!key) return json({ error: "chua_ket_noi" }, 503);
  const M = { model: "", in: 0, out: 0, err: "" }, t0 = Date.now();
  const env = { client: new Anthropic({ apiKey: key, timeout: 120000, maxRetries: 1 }), MODEL: MODELS.includes(keyCache.m) ? keyCache.m : MODELS[0], M };
  // Bài học anh Chung đã ghi (bảng ai_lessons, kind = rule; q = phạm vi, l = nội dung): gửi kèm mọi lượt gọi đúng phạm vi
  const SC: any = { ocr: "", extract: "baogia", match: "baogia", match_lines: "baogia", contract: "hopdong", classify: "thumuc", chat: "chat", digest: "hopdong" };
  try {
    const sc = SC[b.action];
    if (sc) {
      const { data: R } = await admin.from("ai_lessons").select("l").eq("kind", "rule").in("q", [sc, "all"]).order("at", { ascending: false }).limit(60);
      if (R && R.length) (env as any).R = "GHI NHỚ TỪ ANH CHUNG (các lần anh đã sửa hoặc dặn; ưu tiên làm theo khi phù hợp với tài liệu đang đọc):\n" + R.reverse().map((x: any) => "- " + String(x.l).slice(0, 400)).join("\n");
    }
  } catch (e) { console.error("rules", String(e).slice(0, 100)); }
  (env as any).uc = uc; (env as any).admin = admin;
  const res = await run(b, env);
  try {
    await admin.from("ai_usage").insert({ user_id: who.user.id, provider: "claude", action: String(b.action || "").slice(0, 40), model: M.model || null, in_tok: M.in, out_tok: M.out, ms: Date.now() - t0, ok: res.status < 300, err: M.err || null, project_id: String(b.pid || b.project?.code || "").slice(0, 60) || null });
  } catch (e) { console.error("ai_usage", String(e).slice(0, 100)); }
  return res;
});
async function run(b: any, env: any): Promise<Response> {
  try {
    if (b.action === "ping") {
      const { data } = await claude(env, { system: "Trả lời JSON.", content: "Trả về {\"ok\": true}", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, maxTokens: 2000 });
      return json({ ok: !!data?.ok, model: env.M.model });
    }
    if (b.action === "extract") {
      const content: any[] = [];
      const fb = b.doc && typeof b.doc.data === "string" ? fileBlock(String(b.doc.mime || ""), b.doc.data) : null;
      if (fb) content.push(fb);
      content.push({ type: "text", text: `Tên file: ${String(b.name || "").slice(0, 200)}` + (typeof b.text === "string" && b.text ? `\nNội dung bảng tính:\n${b.text.slice(0, 400000)}` : "") });
      const { data, model } = await claude(env, { system: SYS_EXTRACT, content, schema: QUOTE, effort: "medium", maxTokens: 64000 });
      blank(data, ["quote_no", "date", "scope", "vat_rate", "payment_terms", "payment_days", "advance_percent", "delivery_terms", "delivery_days", "validity"]);
      (data.items || []).forEach((it: any) => blank(it, ["spec", "unit", "qty", "price_material", "price_labor", "price", "amount", "note"]));
      return json({ ...data, model });
    }
    if (b.action === "match") {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 80);
      const { data, model } = await claude(env, { system: SYS_MATCH, content: JSON.stringify({ items }), schema: MATCH, maxTokens: 32000 });
      (data.matches || []).forEach((m: any) => blank(m, ["code"]));
      return json({ ...data, model });
    }
    if (b.action === "match_lines") {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300), lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 80);
      const { data, model } = await claude(env, { system: SYS_MATCH_LINES, content: JSON.stringify({ bao_gia: items, boq: lines }), schema: MATCH_LINES, maxTokens: 32000 });
      (data.matches || []).forEach((m: any) => { if (m && m.i === -1) m.i = null; });
      return json({ ...data, model });
    }
    if (b.action === "classify") {
      const content: any[] = [];
      const fb = b.doc && typeof b.doc.data === "string" ? fileBlock(String(b.doc.media_type || ""), b.doc.data) : b.img && typeof b.img.data === "string" ? fileBlock(String(b.img.media_type || ""), b.img.data) : null;
      if (fb) content.push(fb);
      const proj = b.project && typeof b.project === "object" ? `${String(b.project.code || "").slice(0, 40)} ${String(b.project.name || "").slice(0, 200)}` + (b.project.cdt ? `\nChủ đầu tư: ${String(b.project.cdt).slice(0, 200)}` : "") : "";
      content.push({ type: "text", text: `Dự án: ${proj}\nTên file: ${String(b.name || "").slice(0, 200)}` + (typeof b.text === "string" && b.text ? `\nNội dung trích từ file:\n${b.text.slice(0, 8000)}` : "") });
      const { data: v } = await claude(env, { system: SYS_CLASSIFY, content, schema: CLASSIFY, maxTokens: 8000 });
      if (!FOLDERS[v.folder]) return json({ error: "khong_doc_duoc" }, 422);
      return json({ folder: v.folder, reason: String(v.reason || "").slice(0, 300), title: String(v.title || "").slice(0, 120), fit: v.fit !== false, new_group: String(v.new_group || ""), new_folder: String(v.new_folder || "").slice(0, 80), photo_date: String(v.photo_date || "").slice(0, 10) });
    }
    if (b.action === "contract") {
      const content: any[] = [];
      const fb = b.doc && typeof b.doc.data === "string" ? fileBlock(String(b.doc.mime || ""), b.doc.data) : null;
      if (fb) content.push(fb);
      content.push({ type: "text", text: `Tên file: ${String(b.name || "").slice(0, 200)}` + (typeof b.text === "string" && b.text ? `\nNội dung hợp đồng:\n${b.text.slice(0, 300000)}` : "") });
      const { data, model } = await claude(env, { system: SYS_CONTRACT, content, schema: CONTRACT, effort: "medium", maxTokens: 32000 });
      (data.milestones || []).forEach((m: any) => blank(m, ["basis", "documents", "progress_percent", "days_after", "clause"]));
      blank(data, ["contract_no", "sign_date", "value_before_vat", "value_with_vat", "vat_rate", "advance_percent", "advance_recovery", "retention_percent", "warranty_months", "payment_days", "payment_cycle", "start_date", "duration_days", "end_date", "penalty", "notes"]);
      return json({ ...data, model });
    }
    if (b.action === "ocr") {
      const { data: f } = await env.uc.from("project_files").select("id,name").eq("id", String(b.file || "")).maybeSingle();
      if (!f) return json({ error: "khong_quyen" }, 403);
      const fb = b.doc && typeof b.doc.data === "string" ? fileBlock("application/pdf", b.doc.data) : null;
      if (!fb) return json({ error: "khong_doc_duoc" }, 422);
      const from = Math.max(1, Number(b.from) || 1), n = Math.max(1, Number(b.pages) || 1);
      const { text } = await claude(env, { system: SYS_OCR, content: [fb, { type: "text", text: `File: ${f.name}\nCác trang gửi kèm là trang ${from} đến ${from + n - 1} của tài liệu. Chép nguyên văn.` }], effort: "low", maxTokens: 32000 });
      return json({ text });
    }
    if (b.action === "digest") {
      const { data: f } = await env.uc.from("project_files").select("id,project_id,folder,name").eq("id", String(b.file || "")).maybeSingle();
      if (!f) return json({ error: "khong_quyen" }, 403);
      const text = typeof b.text === "string" ? b.text : "";
      const content: any[] = [];
      const fb = !text && b.doc && typeof b.doc.data === "string" ? fileBlock(String(b.doc.mime || ""), b.doc.data) : null;
      if (fb) content.push(fb);
      if (!fb && !text) return json({ error: "khong_doc_duoc" }, 422);
      content.push({ type: "text", text: `Thư mục: ${f.folder}\nTên file: ${f.name}` + (text ? `\nNội dung chữ của file:\n${text.slice(0, 150000)}` : "") });
      const { data, model } = await claude(env, { system: SYS_DIGEST, content, schema: DIGEST, effort: "low", maxTokens: 24000 });
      const now = new Date().toISOString();
      const { error: e1 } = await env.admin.from("kb_docs").upsert({ file_id: f.id, project_id: f.project_id, folder: f.folder, name: f.name, status: "ok", kind: String(data.kind || "").slice(0, 120), summary: String(data.summary || "").slice(0, 4000), body: text ? text.slice(0, 400000) : String(data.notes || "").slice(0, 60000), src: text ? (b.src === "ocr" ? "ocr" : "text") : "notes", err: "", model, at: now });
      if (e1) throw new Error(e1.message);
      const F = (data.facts || []).filter((x: any) => x && FACT_KEYS.has(String(x.k)) && String(x.v || "").trim());
      let n = 0;
      if (F.length) {
        const { data: old } = await env.admin.from("kb_facts").select("k,status").eq("project_id", f.project_id);
        const locked = new Set((old || []).filter((x: any) => x.status === "ok").map((x: any) => x.k));
        const rows = F.filter((x: any) => !locked.has(x.k)).map((x: any) => ({ project_id: f.project_id, k: x.k, v: String(x.v).slice(0, 2000), clause: String(x.clause || "").slice(0, 2000), file_id: f.id, src: f.name, status: "auto", by_name: "Trợ lý đọc file", by: null, at: now }));
        if (rows.length) { const { error: e2 } = await env.admin.from("kb_facts").upsert(rows, { onConflict: "project_id,k" }); if (e2) throw new Error(e2.message); n = rows.length; }
      }
      return json({ kind: data.kind, summary: data.summary, facts: n, model });
    }
    if (b.action === "chat") {
      const msgs = (Array.isArray(b.messages) ? b.messages : []).filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-12).map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (!msgs.length || msgs[0].role !== "user") return json({ error: "no_message" }, 400);
      const ctx = JSON.stringify(b.context || {}).slice(0, 150000), pid = String(b.proj || "");
      // Hồ sơ dự án và danh mục tài liệu theo quyền người hỏi
      let fq = env.uc.from("kb_facts").select("project_id,k,v,status,src").order("k").limit(400), dq = env.uc.from("kb_docs").select("file_id,project_id,folder,name,kind,summary,src").eq("status", "ok").order("folder").limit(250);
      if (pid) { fq = fq.eq("project_id", pid); dq = dq.eq("project_id", pid); }
      const [{ data: FA }, { data: DO }] = await Promise.all([fq, dq]);
      const docs = (DO || []).map((d: any, i: number) => ({ ...d, code: "d" + (i + 1) })), byCode: any = Object.fromEntries(docs.map((d: any) => [d.code, d])), byFile: any = Object.fromEntries(docs.map((d: any) => [d.file_id, d]));
      const hs = (FA || []).map((x: any) => `- ${pid ? "" : "[" + x.project_id + "] "}${x.k}: ${x.v}${x.status === "ok" ? "" : " (chưa xác nhận)"}${x.src ? " · nguồn: " + x.src : ""}`).join("\n") || "(chưa có)";
      const dm = docs.map((d: any) => `${d.code} · ${pid ? "" : "[" + d.project_id + "] "}${d.folder} · ${d.name.replace(/^\d{8}_[^_]+_/, "")} · ${d.kind} · ${d.src === "notes" ? "(ghi chép)" : "(nguyên văn)"}\n${String(d.summary || "").slice(0, 700)}`).join("\n\n") || "(chưa có tài liệu nào được đọc)";
      const system = SYS_CHAT + (env.R ? "\n\n" + env.R : "") + `\n\nHỒ SƠ DỰ ÁN${pid ? "" : " (mọi dự án; mã dự án trong ngoặc vuông)"}:\n${hs}\n\nDANH MỤC TÀI LIỆU:\n${dm}\n\nNGỮ CẢNH (JSON số liệu hiện có trên web):\n` + ctx;
      const remember: any[] = [], conv: any[] = msgs.slice();
      let text = "";
      for (let round = 0; round < 6; round++) {
        const r: any = { model: env.MODEL, max_tokens: 4000, system, messages: conv, tools: TOOLS, output_config: { effort: "low" } };
        if (env.MODEL !== "claude-haiku-5-5") { r.betas = ["server-side-fallback-2026-07-01"]; r.fallbacks = "default"; }
        let msg: any;
        try { msg = await env.client.beta.messages.stream(r).finalMessage(); }
        catch (e) { throw e instanceof Anthropic.AuthenticationError ? new AiErr("sai_khoa") : e instanceof Anthropic.RateLimitError ? new AiErr("het_luot") : e instanceof Anthropic.APIError && (e.status || 0) >= 500 ? new AiErr("qua_tai") : e; }
        const u = msg.usage || {}; env.M.model = msg.model; env.M.in += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); env.M.out += u.output_tokens || 0;
        if (msg.stop_reason === "refusal") throw new AiErr("tu_choi");
        text = (msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
        const calls = (msg.content || []).filter((c: any) => c.type === "tool_use");
        if (!calls.length || msg.stop_reason !== "tool_use") break;
        conv.push({ role: "assistant", content: msg.content });
        const results: any[] = [];
        for (const c of calls) {
          let out = "";
          try {
            if (c.name === "doc_read") {
              const d = byCode[String(c.input?.doc || "").trim()];
              if (!d) out = "Không có tài liệu mã này.";
              else { const { data: x } = await env.uc.from("kb_docs").select("body").eq("file_id", d.file_id).maybeSingle(); const body = String(x?.body || ""); const kw = String(c.input?.tu_khoa || "").trim();
                const A = kw ? around(body, kw) : []; out = kw && A.length ? A.join("\n\n") : body.slice(0, 90000) || "(bản chữ trống)"; if (kw && !A.length) out = "Không thấy từ khoá; bản chữ (đầu bài):\n" + body.slice(0, 30000); }
            } else if (c.name === "doc_search") {
              const kw = String(c.input?.tu_khoa || "").trim().slice(0, 80);
              if (kw.length < 2) out = "Từ khoá quá ngắn.";
              else { let q = env.uc.from("kb_docs").select("file_id,body").eq("status", "ok").ilike("body", "%" + kw.replace(/[%_]/g, "") + "%").limit(8); if (pid) q = q.eq("project_id", pid);
                const { data: H } = await q; out = (H || []).filter((h: any) => byFile[h.file_id]).map((h: any) => byFile[h.file_id].code + ":\n" + around(String(h.body), kw, 500, 3).join("\n")).join("\n\n") || "Không thấy cụm từ này trong tài liệu nào."; }
            } else if (c.name === "ghi_nho") {
              const x = { scope: c.input?.pham_vi === "cong_ty" || !pid ? "cong_ty" : "du_an", k: String(c.input?.muc || "").slice(0, 120), v: String(c.input?.noi_dung || "").slice(0, 1000) };
              if (x.v) remember.push(x); out = "Đã đưa đề xuất lên màn hình, chờ người dùng bấm xác nhận.";
            } else out = "Công cụ không có.";
          } catch (e) { out = "Lỗi: " + String((e as Error)?.message || e).slice(0, 200); }
          results.push({ type: "tool_result", tool_use_id: c.id, content: out });
        }
        conv.push({ role: "user", content: results });
      }
      // Mã tài liệu [d3] → số nguồn [1], kèm danh sách nguồn để web hiện nút mở file
      const sources: any[] = [];
      text = text.replace(/\[(d\d+)(?:\s*[,;]\s*(d\d+))*\]/g, (m) => m.replace(/d\d+/g, (code) => { const d = byCode[code]; if (!d) return ""; let i = sources.findIndex((s) => s.id === d.file_id); if (i < 0) { sources.push({ id: d.file_id, name: d.name }); i = sources.length - 1; } return String(i + 1); })).replace(/\[\s*[,;]?\s*\]/g, "");
      return json({ text: text || "Em chưa trả lời được, anh hỏi lại giúp em.", sources, remember });
    }
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    const code = e instanceof AiErr ? e.code : "ai_error", m = String((e as Error)?.message || "");
    console.error("ai", code, m.slice(0, 300)); env.M.err = (code + (m && m !== code ? ": " + m : "")).slice(0, 160);
    return json({ error: code }, 502);
  }
}
