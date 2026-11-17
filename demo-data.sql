-- ============================================================
-- OPSIONAL - data contoh bulan berjalan supaya dashboard langsung terisi.
-- Jalankan SETELAH supabase-schema.sql. Hapus lagi sebelum data asli diinput:
--   truncate public.daily_revenue, public.budgets;
-- ============================================================
insert into public.daily_revenue (rev_date, outlet_id, amount)
select d::date, o.id,
  round(case o.name
    when 'Cardo'           then 5000000 + random() * 8000000
    when 'The Living Room' then 500000  + random() * 1500000
    when 'Breakfast'       then 3000000 + random() * 4000000
    when 'Pool Bar'        then 300000  + random() * 1000000
    when 'Wedding'         then case when random() < 0.12 then 80000000 + random() * 150000000 else 0 end
    when 'Meeting'         then case when random() < 0.40 then 8000000  + random() * 20000000  else 0 end
    else                        case when random() < 0.20 then 5000000  + random() * 15000000  else 0 end
  end)::numeric
from generate_series(date_trunc('month', current_date)::date, current_date, interval '1 day') d
cross join public.outlets o
on conflict (rev_date, outlet_id) do nothing;

insert into public.budgets (month, outlet_id, amount)
select date_trunc('month', current_date)::date, o.id,
  case o.name
    when 'Cardo' then 300000000 when 'The Living Room' then 30000000 when 'Breakfast' then 120000000
    when 'Pool Bar' then 20000000 when 'Wedding' then 600000000 when 'Meeting' then 250000000 else 80000000 end
from public.outlets o
on conflict (month, outlet_id) do nothing;
