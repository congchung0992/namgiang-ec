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
