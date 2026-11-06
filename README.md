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
- Claude (Anthropic) chạy ở Supabase Edge Function `supabase/functions/ai` (đọc báo giá, ghép dòng, gợi ý thư mục, trợ lý chat, kiểm tra khoá), gọi qua SDK `@anthropic-ai/sdk`. **Khoá Claude (`sk-ant-…`, lấy ở platform.claude.com → API Keys) dán ở màn Quản trị → Kết nối AI**: lưu trong bảng `app_secrets` (tên `claude`; migration `20261105_claude_key.sql`), trình duyệt không đọc được, chỉ Edge Function đọc bằng khoá service role; web chỉ hiện 4 ký tự cuối. Biến môi trường `ANTHROPIC_API_KEY` của Edge Function (nếu đặt) được ưu tiên. Khoá đặt trong biến môi trường Cloudflare Pages (`ANTHROPIC_API_KEY`, hoặc biến bất kỳ có giá trị `sk-ant-…`) được chuyển sang `app_secrets` qua `functions/api/claude-key.js` khi Ban giám đốc mở Quản trị → Kết nối AI (hoặc bấm "Lấy khoá đã đặt trên Cloudflare"). Mẫu cố định Claude Haiku 5.5 (dòng `claude_model` trong `app_secrets`, migration `20261105_claude_haiku.sql`; web không đổi được). Mỗi lượt gọi ghi vào bảng `ai_usage` (Quản trị → Đo lường AI).
- Đọc: Excel (chữ từ mọi sheet đang hiện), PDF, ảnh chụp → tên nhà cung cấp, từng dòng (tên, quy cách, ĐVT, khối lượng, đơn giá VT/NC/gộp), VAT, thanh toán, giao hàng. Chưa có khoá thì Excel đọc theo cách đọc BOQ, PDF/ảnh chưa đọc được.
- Ghép: dòng giống hẳn thì tự ghép; còn lại Claude chọn trong 6 dòng BOQ ứng viên (có cả nhóm công việc cho giá trọn gói) và trả hệ số quy đổi đơn vị. Anh xem lại trước khi lưu.
- So sánh: đơn giá quy về đơn vị BOQ, chưa VAT; nhà cung cấp so phần vật tư, tổ đội so phần nhân công, thầu phụ so cả đơn giá.
- Chọn → gửi Hộp quyết định → duyệt thì ghi giá vốn (nguồn `q:<id>`), thời gian giao hàng (kế hoạch đặt vật tư) và số ngày trả nhà cung cấp (dòng tiền).
- Gợi ý thư mục khi tải file cũng dùng Claude qua cùng Edge Function.

## Nghiệm thu khối lượng, phát sinh, đối chiếu 4 lớp (tab Nghiệm thu, Đối chiếu 4 lớp)
- **Nghiệm thu:** tải file Excel bảng khối lượng đợt của chủ đầu tư. Web tự nhận tiêu đề nhiều tầng, ô gộp, cột lũy kế đến kỳ này (hoặc kỳ trước + kỳ này, hoặc chỉ kỳ này), ghép từng dòng với mã BOQ theo sheet ↔ hạng mục, tên, mác/quy cách, khối lượng hợp đồng; dòng phân vân gửi Claude (`action: match`); anh soát, sửa ghép rồi lưu. Lần sửa ghép được ghi vào `ai_lessons` và áp ở lần sau. Có nút nhập tay đợt mới và sửa ô lũy kế trực tiếp.
- Lưu trong `p.nt` (bảng `project_cost`, chỉ GĐ dự án/QS sửa được, chỉ huy trưởng không xem): mỗi đợt ghi khối lượng **lũy kế** theo mã; dòng không có trong đợt giữ lũy kế đợt trước. Giá trị = khối lượng × đơn giá hợp đồng, chưa VAT; so kế hoạch theo tiến độ đến ngày nghiệm thu.
- **Xuất Excel** bảng xác định khối lượng hoàn thành đợt (ExcelJS 4.4.0 từ cdnjs), tải về và lưu vào thư mục 04.1.
- **Phát sinh** (`p.ps`): tăng/giảm khối lượng dòng BOQ (đơn giá hợp đồng) hoặc công việc mới (mã PS001… theo `p.psSeq`), file căn cứ lưu 04.2. Gửi Hộp quyết định; chỉ phát sinh đã duyệt mới cộng vào giá trị hợp đồng và khối lượng được nghiệm thu. BOQ gốc không đổi. Có nút lập phát sinh từ các dòng ngoài BOQ khi soát file nghiệm thu.
- **Đối chiếu 4 lớp** theo hạng mục và nhóm công việc: ① doanh thu dự thầu (+ phát sinh đã duyệt) · ② giá vốn dự thầu · ③ doanh thu nghiệm thu · ④ chi phí thực tế (chờ phiếu chi), kèm giá vốn dự thầu của phần đã làm và so kế hoạch.

## Phiếu yêu cầu vật tư và luồng duyệt (tab Yêu cầu vật tư, Quản trị → Luồng duyệt)
- Chỉ huy trưởng (hoặc GĐ dự án, QS) lập phiếu theo mẫu Đề xuất vật tư: gõ tay (gợi ý tên từ BOQ) hoặc tải file Excel theo mẫu; Lưu nháp hoặc Gửi duyệt.
- Phiếu đi lần lượt qua các bước của luồng `pyc` (bảng `workflows`); mặc định: Kế toán vật tư duyệt (ghi đơn giá) → Giám đốc phê duyệt (Ban giám đốc). Ban giám đốc thêm, bớt, đổi thứ tự, đổi người duyệt ở Quản trị → Luồng duyệt; phiếu đã gửi giữ luồng lúc gửi. Trả về thì phiếu về người lập sửa, gửi lại từ bước đầu.
- Vai trò mới **Kế toán vật tư** (`ktvt`), phân công ở Quản trị như các vai trò khác; thấy các tab hiện trường và phiếu, không thấy giá vốn.
- Bảng `material_requests`; mọi thay đổi qua hàm `mr_save`, `mr_act`, `mr_cancel` (máy chủ kiểm tra người bấm có đúng vai trò của bước hiện tại). Duyệt xong tự lưu file Excel phiếu vào 05.1; nút Tải Excel ra file theo mẫu, chữ ký ghi tên và ngày duyệt từng bước.
- **Thông báo** (bảng `notifications`): mỗi khi phiếu tới bước mới, người giữ vai trò bước đó nhận thông báo; người lập nhận khi qua bước, bị trả về hoặc duyệt xong. Chuông trên thanh trên hiện số chưa đọc, nhận ngay qua Supabase Realtime, có nút bật thông báo của trình duyệt (hiện cả khi đang ở tab khác, khi web đang mở). Migration `20261105_phieu_yeu_cau_vat_tu.sql`.

## Đề nghị thanh toán NCC – TP (tab Thanh toán NCC – TP)
- Chỉ huy trưởng lập theo mẫu hồ sơ thanh toán của công ty (Thông báo thanh toán + Khối lượng thanh toán thi công): nhập tay hoặc tải file Excel mẫu (web đọc nhà thầu, số hợp đồng, ngày, gói thầu, đợt, các dòng khối lượng theo hợp đồng, ngoài hợp đồng, khấu trừ, hỗ trợ, phạt). Chọn được hợp đồng đã lưu ở 05.2.
- Tính đúng công thức mẫu: giá trị thực hiện đến kỳ này (gồm VAT) → được thanh toán (100% − % giữ lại, mặc định 90%) → + tạm ứng − hoàn trả tạm ứng → − đã thanh toán các kỳ trước (web tự cộng các đợt đã duyệt cùng hợp đồng) = đề nghị thanh toán kỳ này.
- Luồng `tt` mặc định: Kế toán duyệt (được sửa số liệu: tạm ứng, khấu trừ, đã thanh toán…) → Giám đốc phê duyệt (Ban giám đốc); sửa ở Quản trị → Luồng duyệt. Có thông báo từng bước như phiếu vật tư. Duyệt xong lưu file Excel 2 sheet vào 05.3; đợt đã duyệt có nút Lập đợt tiếp theo.
- Đề nghị đã duyệt vào cột **④ Chi phí thực tế** ở tab Đối chiếu 4 lớp: mỗi hợp đồng lấy đợt mới nhất (giá trị thực hiện lũy kế, chưa VAT), phân bổ vào dòng BOQ của gói và hạng mục gắn với hợp đồng 05.2 theo tỷ trọng giá vốn dự thầu; đề nghị chưa chọn hợp đồng hiện ở dòng Chưa phân bổ. Cảnh báo ④/③ trên 88%, chỉ số chi phí = giá vốn phần đã làm ÷ chi phí thực tế.
- Dùng chung bảng `material_requests` (cột `kind` = `tt`, `data` = thông tin riêng) và các hàm `mr_save`, `mr_act` (migration `20261105_thanh_toan_ncc_tp.sql`).

## Hợp đồng NCC – TP gắn gói thầu (thư mục 05.2)
- Khi lưu file vào 05.2, hộp rà file bắt buộc chọn **gói thầu** (theo sheet Gói thầu) và **hạng mục BOQ** hợp đồng áp dụng; chưa chọn thì không lưu. Web gợi ý gói (✨) theo tên file, nội dung file Word/Excel, mác/quy cách và nhà cung cấp đã chọn cho gói; hạng mục gợi ý theo tên hạng mục ghi trong file.
- Liên kết lưu ở `p.hdl` (cùng phần tiến độ, chỉ huy trưởng cũng ghi được). Thư mục 05.2 hiện nhãn gói, hạng mục cho từng file; file chưa gắn có nút **Gắn gói thầu**. Sheet Gói thầu hiện hợp đồng đã có dưới tên từng gói.

## Bảng so sánh giá → hợp đồng → thanh toán, kế hoạch giao thầu (tab Gói thầu, Kế hoạch giao thầu)
- Mỗi gói thầu (vật tư hoặc thầu phụ – tổ đội) lập một **bảng so sánh giá** từ các báo giá đã ghép vào gói: từng dòng BOQ × từng đơn vị (đơn giá, thành tiền), giá BOQ CĐT, giá gốc, tổng, lời/lỗ so gốc, điều kiện thanh toán, giao hàng, file báo giá 05.1; chọn đơn vị và ghi lý do (bắt buộc khi không chọn đơn vị rẻ nhất).
- Bảng đi luồng duyệt `ssg` (mặc định Giám đốc dự án → Tổng giám đốc, sửa ở Quản trị → Luồng duyệt); người duyệt đổi được đơn vị chọn. Duyệt xong: chốt đơn vị cho gói, áp giá vốn các dòng BOQ của gói, lưu Excel có chữ ký duyệt vào 05.1.
- Hợp đồng NCC – TP (05.2) chỉ gắn được vào gói đã có bảng so sánh giá được duyệt; đề nghị thanh toán chỉ lập và gửi được khi chọn hợp đồng đã ký (tự điền tên đơn vị theo bảng so sánh giá).
- **Kế hoạch giao thầu**: ngày cần = ngày bắt đầu sớm nhất của công việc trong gói trên tiến độ; ký hợp đồng trước 14 ngày (gói vật tư không muộn hơn ngày đặt hàng = ngày cần − thời gian giao hàng), bảng so sánh giá duyệt trước 21 ngày; trình mẫu vật tư CĐT/TVGS trước 21 ngày, CĐT duyệt trước 14 ngày; các mốc sửa được, ghi ngày đã trình / CĐT duyệt, cảnh báo quá hạn.
- Máy chủ: `supabase/migrations/20261105_bang_so_sanh_gia.sql`.

## Bộ não dự án (tab Bộ não dự án, khung chat Trợ lý)
- Mỗi file văn bản tải lên thư mục dự án (PDF, Word, Excel, PowerPoint; bỏ ảnh, bản vẽ 02.1, nhật ký 06.1) được đọc một lần và lưu **bản chữ + tóm tắt** trên máy chủ (bảng `kb_docs`), không mất khi tải lại trang. PDF có lớp chữ thì lấy chữ trực tiếp (pdf.js); PDF scan gửi Claude ghi chép điều khoản chính.
- Máy đang mở dự án tự đọc các file chưa đọc, kể cả file cũ; máy chủ khoá từng file để hai máy không đọc trùng. File lỗi có nút Đọc lại.
- **Hồ sơ dự án** (bảng `kb_facts`): trợ lý tự điền các mục chuẩn (loại hợp đồng, giá trị, tạm ứng, thanh toán, bảo hành, phạt…) từ hồ sơ với chủ đầu tư, kèm câu căn cứ và file nguồn; ghi "chưa xác nhận" cho tới khi GĐ dự án, QS hoặc Ban giám đốc xác nhận. Sửa, thêm, xoá được.
- Trợ lý chat đọc hồ sơ dự án + danh mục tài liệu, tự mở bản chữ hoặc tìm theo từ khoá khi cần, ghi nguồn [1], [2] có nút mở file. Khi anh dặn điều gì lâu dài, trợ lý hỏi lại rồi mới ghi vào hồ sơ dự án hoặc kiến thức chung của công ty.
- Máy chủ: `supabase/migrations/20261105_bo_nao_du_an.sql`, hàm `ai` (việc `digest`, `chat` có công cụ đọc tài liệu).

## Tra cứu liên kết (tab Tra cứu liên kết, nút 🔗 Liên quan)
- Mọi thứ của dự án được nối theo logic quản lý dự án: hạng mục ↔ dòng BOQ ↔ gói thầu ↔ báo giá ↔ đơn vị (NCC, thầu phụ, tổ đội) ↔ bảng so sánh giá ↔ hợp đồng ↔ yêu cầu vật tư ↔ đề nghị thanh toán ↔ nghiệm thu, phát sinh ↔ file hồ sơ.
- Mối nối tự suy ra từ dữ liệu; file được nối theo tên đơn vị, gói, hạng mục nhắc trong tên và tóm tắt; anh tự "Nối thêm" được (lưu p.lk cùng tiến độ).
- Ô tìm kiếm không phân biệt dấu, lọc theo loại; bấm kết quả mở khung Liên quan, đi tiếp từ mục này sang mục khác, có nút quay lại, mở trang, mở file, hỏi trợ lý.
- Bản đồ gói thầu: mỗi gói đi tới bước nào (báo giá → so sánh giá → hợp đồng → yêu cầu vật tư → nghiệm thu → thanh toán), tô màu theo kế hoạch giao thầu.
- Trợ lý chat nhận kèm tóm tắt liên kết của dự án đang mở để trả lời lần theo mối nối.

## Làm việc với Claude thay trợ lý trên web (06/11/2026)
- Đã bỏ khung chat trợ lý và việc tự đọc file của Bộ não dự án trên web. Hỏi đáp, phân tích, so sánh giá, trích hợp đồng làm trên Claude với skill `quan-tri-du-an-nam-giang` (đọc dữ liệu qua kết nối Supabase; chỉ đọc tự do, mọi việc ghi phải được anh đồng ý).
- Giữ các nút giúp nhập liệu: đọc báo giá, đọc hợp đồng CĐT, gợi ý thư mục khi tải file, nút "Tạo bản chữ" từng file ở tab Bộ não dự án.
- Thẻ "Trợ lý Nam Giang" ở trang Tổng quan chuyển thành nút mở Claude.

## Bài học cho AI
- Bảng `ai_lessons` (migration `20261105_ai_lessons.sql`): `kind = match` là cặp dòng báo giá ↔ dòng BOQ đúng/sai (web tự áp khi ghép); `kind = rule` là câu dặn (`q` = phạm vi `baogia | hopdong | thumuc | chat | all`, `l` = nội dung).
- Web tự ghi bài học khi anh sửa ghép báo giá, đổi gói vật tư, sửa số đọc từ hợp đồng hoặc đợt thanh toán, xếp file khác thư mục gợi ý. Anh tự dặn thêm ở Quản trị → Bài học cho AI.
- Edge Function `ai` gửi kèm 60 bài học mới nhất đúng phạm vi vào lời dặn hệ thống của mỗi lượt gọi Claude.

## Quản trị · Bản chữ tài liệu (`#quan-tri-bc`)
Thống kê mỗi dự án: tổng file, file không cần đọc (ảnh, bản vẽ), file văn bản, đã có bản chữ (kèm số bản scan đã chép nguyên văn), chờ tóm tắt, chờ chép scan, chưa tách, lỗi. Có danh sách file cần chú ý (nút Xử lý lại) và các đợt chạy máy chủ gần đây.
