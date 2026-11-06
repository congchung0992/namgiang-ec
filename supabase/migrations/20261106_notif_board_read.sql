-- Ban giám đốc (Admin, Tổng giám đốc) được đọc thông báo của mọi người để dùng chế độ "Xem như"; không sửa, không xoá
create policy notif_read_board on public.notifications for select to authenticated using (is_board());
