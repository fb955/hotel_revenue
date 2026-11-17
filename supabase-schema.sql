-- ============================================================
-- Hotel F&B Revenue - skema database (Supabase / PostgreSQL)
-- Jalankan sekali di: Supabase -> SQL Editor -> New query -> Run
-- ============================================================

-- 1) TABEL ---------------------------------------------------
create table if not exists public.outlets (
  id          serial primary key,
  name        text not null unique,
  category    text not null check (category in ('resto','event')),
  color       text not null default '#8C6D53',
  sort_order  int  not null default 0,
  active      boolean not null default true
);

-- revenue harian per outlet F&B
create table if not exists public.daily_revenue (
  id          bigint generated always as identity primary key,
  rev_date    date not null,
  outlet_id   int  not null references public.outlets(id) on delete cascade,
  amount      numeric(16,2) not null default 0 check (amount >= 0),
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  unique (rev_date, outlet_id)
);

-- budget bulanan per outlet (month selalu tanggal 1)
create table if not exists public.budgets (
  id          bigint generated always as identity primary key,
  month       date not null check (extract(day from month) = 1),
  outlet_id   int  not null references public.outlets(id) on delete cascade,
  amount      numeric(16,2) not null default 0 check (amount >= 0),
  unique (month, outlet_id)
);

create index if not exists idx_daily_revenue_date on public.daily_revenue (rev_date);

-- 2) DATA OUTLET AWAL (sesuaikan nama jika perlu) -------------
insert into public.outlets (name, category, color, sort_order) values
  ('Cardo',           'resto', '#8C6D53', 1),
  ('Breakfast',       'resto', '#A68A72', 2),
  ('Pool Bar',        'resto', '#A85A5A', 3),
  ('Wedding',         'event', '#D4AF37', 4),
  ('Meeting',         'event', '#8C6D53', 5),
  ('Social Event',    'event', '#C4A484', 6)
on conflict (name) do nothing;

-- 3) KEAMANAN (Row Level Security) ----------------------------
-- Publik (anon) : hanya boleh MEMBACA  -> dashboard bisa dilihat tanpa login
-- Login (authenticated): boleh menambah / mengubah / menghapus
alter table public.outlets          enable row level security;
alter table public.daily_revenue    enable row level security;
alter table public.budgets          enable row level security;

do $$
declare t text;
begin
  foreach t in array array['outlets','daily_revenue','budgets'] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('drop policy if exists "auth insert" on public.%I', t);
    execute format('drop policy if exists "auth update" on public.%I', t);
    execute format('drop policy if exists "auth delete" on public.%I', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "auth insert" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "auth update" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "auth delete" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- 4) HAK AKSES TABEL (aman dijalankan ulang) ------------------
grant usage on schema public to anon, authenticated;
grant select on public.outlets, public.daily_revenue, public.budgets to anon;
grant select, insert, update, delete on public.outlets, public.daily_revenue, public.budgets to authenticated;
grant usage, select on all sequences in schema public to authenticated;
