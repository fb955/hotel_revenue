-- HANYA jika kamu SUDAH menjalankan supabase-schema.sql versi lama (yang ada Room Stays).
-- Menghapus semua yang berkaitan dengan room. Data revenue/budget outlet room ikut terhapus.
drop table if exists public.daily_room_stats;
delete from public.outlets where category = 'room' or name = 'In Room Dining';
alter table public.outlets drop constraint if exists outlets_category_check;
alter table public.outlets add constraint outlets_category_check check (category in ('resto','event'));
