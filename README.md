# Nam Giang E&C

Hệ thống quản trị nội bộ của **Công ty Cổ phần Đầu tư và Xây lắp Nam Giang** (tổng thầu xây dựng).

> Đăng nhập và số liệu dự án dùng Supabase; lược đồ và phân quyền ở `supabase/schema.sql`. Khoá công khai trong `index.html` được phép lộ, quyền do máy chủ quyết định. Bắt buộc đăng nhập (không còn chế độ thử). Ban giám đốc tạo tài khoản, đặt lại mật khẩu, khoá hoặc xoá ở màn **Quản trị**, qua Supabase Edge Function `supabase/functions/admin-users` (máy chủ tự kiểm tra quyền Ban giám đốc). Tên đăng nhập ngắn như `an.nguyen` tương ứng email nội bộ `an.nguyen@namgiang-ec.pages.dev`.

> File hồ sơ (tab Hồ sơ) lưu ở Google Drive của công ty qua `functions/api/drive.js`. Biến bí mật trên Cloudflare: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (phạm vi `drive.file`). Chưa đặt thì tab Hồ sơ báo chưa kết nối.
>
> **Khi web báo "Khoá Google Drive đã hết hạn"** (lỗi `invalid_grant`), tạo lại `GOOGLE_REFRESH_TOKEN`:
> 1. Google Cloud Console → APIs & Services → OAuth consent screen (Google Auth Platform → Audience): nếu đang ở **Testing** thì bấm **Publish app** sang **In production**. Ở chế độ Testing, khoá tự hết hạn sau 7 ngày.
> 2. Mở https://developers.google.com/oauthplayground → bánh răng → tick *Use your own OAuth credentials* → dán Client ID, Client secret. Ứng dụng OAuth phải có `https://developers.google.com/oauthplayground` trong *Authorized redirect URIs*.
> 3. Ô *Input your own scopes* nhập `https://www.googleapis.com/auth/drive.file` → Authorize APIs → đăng nhập tài khoản Google của công ty → *Exchange authorization code for tokens* → chép **Refresh token**.
> 4. Cloudflare → Workers & Pages → namgiang-ec → Settings → Variables and Secrets → sửa `GOOGLE_REFRESH_TOKEN` → triển khai lại. File đang chờ trên trình duyệt sẽ tự đưa lên ở lần vào web tiếp theo.

## Tính năng giao diện
- Màn giới thiệu và đăng nhập 2 bước (email/mã nhân viên → mật khẩu), có hiệu ứng thẻ số liệu bay vào.
- Điều hướng: Tổng quan · Dự án · Báo cáo. Vào Dự án → danh sách công trình → mỗi công trình có các sheet Tổng quan, Doanh thu, Chi phí, Tiến độ, Vật liệu, Nhân sự.
- Bảng điều khiển: bản đồ công trình (bấm vào ghim để mở công trình), doanh thu, hồ sơ chờ thanh toán, tiến độ, chi phí theo nhóm, doanh thu – chi phí theo tuần/tháng/năm, trợ lý hỏi đáp.
- Tự vừa một màn hình 16:9, có nút xem toàn màn hình; tự xếp dọc trên điện thoại.

## Chạy thử
Mở `index.html` bằng trình duyệt, hoặc xem bản phát hành trên GitHub Pages.

## Cấu trúc
```
index.html              Toàn bộ giao diện (HTML + CSS + JS)
img/logo.png            Logo Nam Giang
img/mark.png            Biểu tượng N (favicon)
manifest.webmanifest    Cho phép "Thêm vào màn hình chính" trên điện thoại
```

## Lộ trình
1. Lưu dữ liệu thật dùng chung cho cả công ty (cơ sở dữ liệu).
2. Đăng nhập thật và phân quyền theo vai trò (ban giám đốc, kế toán, chỉ huy trưởng).
3. Màn chi tiết từng phân hệ: Dự án, Doanh thu, Chi phí, Tiến độ, Vật liệu, Nhân sự, Báo cáo.
4. Nhập dữ liệu từ Excel, xuất báo cáo.

## Trợ lý AI (khung chat)
- Nút tin nhắn ở góc phải dưới mở khung chat. Chưa kết nối Claude thì trợ lý trả lời từ số liệu trên web.
- Kết nối Claude: vào Cloudflare → Workers & Pages → namgiang-ec → Settings → Variables and Secrets, thêm biến bí mật `ANTHROPIC_API_KEY` (khoá lấy ở console.anthropic.com), rồi triển khai lại. Mã xử lý nằm ở `functions/api/chat.js`; khoá không nằm trong mã nguồn.

## Thời tiết công trường
- Dự báo lấy từ Open-Meteo (mô hình ECMWF, đối chiếu GFS), không cần khoá.
- Vị trí công trường tra bằng Google Maps qua `functions/api/geocode.js`, biến bí mật `GOOGLE_MAPS_KEY` trên Cloudflare (Google Cloud → bật **Geocoding API** → tạo API key, giới hạn chỉ dùng Geocoding API). Chưa đặt khoá thì web tìm bằng OpenStreetMap.

## Xem file Excel, Word, PowerPoint
- Mở bằng trình xem Office Online của Microsoft (`view.officeapps.live.com`). `api/drive?action=office` tạo đường dẫn tạm `/api/office/<mã>/<tên file>`, ký HMAC (khoá suy ra từ `GOOGLE_CLIENT_SECRET`), hết hạn sau 15 phút. Microsoft tải file qua đường dẫn này khi hiển thị.
- File Excel trên 5 MB, Word/PowerPoint trên 10 MB, hoặc file chưa lên Drive thì xem bằng bản đơn giản do web tự vẽ; có nút "Xem bản đơn giản" để chuyển.

## Thư mục hồ sơ dự án
6 nhóm, file lưu ở thư mục con (mã `01.1` … `06.3`, quyền theo vai trò trong `supabase/migrations/20261105_thu_muc_6_nhom.sql`):
- 01 Pháp lý – Hợp đồng: 01.1 Pháp lý dự án · 01.2 Hồ sơ thầu · 01.3 Hợp đồng – phụ lục · 01.4 Bảo lãnh – bảo hiểm
- 02 Kỹ thuật – Tiến độ: 02.1 Bản vẽ thiết kế · 02.2 Tiến độ – biện pháp · 02.3 Hoàn công – bàn giao
- 03 Chất lượng – An toàn: 03.1 Nghiệm thu kỹ thuật · 03.2 Thí nghiệm – CO/CQ · 03.3 An toàn – môi trường
- 04 Khối lượng – Thanh toán: 04.1 Nghiệm thu khối lượng · 04.2 Phát sinh · 04.3 Thanh toán – công nợ
- 05 Vật tư – Thầu phụ: 05.1 Báo giá – đặt hàng · 05.2 Nhập xuất vật tư · 05.3 Thầu phụ – tổ đội
- 06 Hiện trường – Văn bản: 06.1 Nhật ký thi công · 06.2 Báo cáo – ảnh · 06.3 Công văn – biên bản họp

Dự án tạo theo cấu trúc cũ (8 thư mục ngang hàng) tự chuyển ở lần tải file đầu tiên: thư mục cũ được đổi tên và đưa vào nhóm mới, file giữ nguyên.

## Báo giá nhà cung cấp, thầu phụ, tổ đội (tab Báo giá)
- Claude (Anthropic) chạy ở Supabase Edge Function `supabase/functions/ai` (đọc báo giá, ghép dòng, gợi ý thư mục, trợ lý chat, kiểm tra khoá), gọi qua SDK `@anthropic-ai/sdk`. **Khoá Claude (`sk-ant-…`, lấy ở platform.claude.com → API Keys) dán ở màn Quản trị → Kết nối AI**: lưu trong bảng `app_secrets` (tên `claude`; migration `20261105_claude_key.sql`), trình duyệt không đọc được, chỉ Edge Function đọc bằng khoá service role; web chỉ hiện 4 ký tự cuối. Biến môi trường `ANTHROPIC_API_KEY` của Edge Function (nếu đặt) được ưu tiên. Mẫu mặc định Claude Opus 5.5, đổi sang Sonnet 5.5 / Haiku 5.5 ở cùng màn (lưu `claude_model`). Bật dự phòng phía máy chủ (`fallbacks: "default"`) khi Opus/Sonnet từ chối. Mỗi lượt gọi ghi vào bảng `ai_usage` (Quản trị → Đo lường AI).
- Đọc: Excel (chữ từ mọi sheet đang hiện), PDF, ảnh chụp → tên nhà cung cấp, từng dòng (tên, quy cách, ĐVT, khối lượng, đơn giá VT/NC/gộp), VAT, thanh toán, giao hàng. Chưa có khoá thì Excel đọc theo cách đọc BOQ, PDF/ảnh chưa đọc được.
- Ghép: dòng giống hẳn thì tự ghép; còn lại Claude chọn trong 6 dòng BOQ ứng viên (có cả nhóm công việc cho giá trọn gói) và trả hệ số quy đổi đơn vị. Anh xem lại trước khi lưu.
- So sánh: đơn giá quy về đơn vị BOQ, chưa VAT; nhà cung cấp so phần vật tư, tổ đội so phần nhân công, thầu phụ so cả đơn giá.
- Chọn → gửi Hộp quyết định → duyệt thì ghi giá vốn (nguồn `q:<id>`), thời gian giao hàng (kế hoạch đặt vật tư) và số ngày trả nhà cung cấp (dòng tiền).
- Gợi ý thư mục khi tải file cũng dùng Claude qua cùng Edge Function.
