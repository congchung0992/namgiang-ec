alter table public.profiles add column if not exists gender text check (gender in ('nam','nu'));
comment on column public.profiles.gender is 'Giới tính để chào anh/chị: nam | nu (Ban giám đốc sửa trong Quản trị)';
