# Nam Giang IC

Hệ thống quản trị nội bộ của **Công ty Cổ phần Đầu tư và Xây lắp Nam Giang** (tổng thầu xây dựng).

> Phiên bản hiện tại: **bản phác thảo giao diện (v0.1)**. Số liệu là số mẫu, đăng nhập chưa kiểm tra tài khoản thật.

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
