-- ============================================================
-- 遷移：預約付款追蹤 + Shopify paid webhook 對應欄位
-- 用法：Supabase → SQL Editor → 貼上 → Run（安全，可重複執行）
-- ============================================================

alter table public.cremation_bookings
  add column if not exists payment_ref text,
  add column if not exists payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','failed','refunded')),
  add column if not exists payment_amount numeric(12, 2),
  add column if not exists payment_currency text,
  add column if not exists shopify_order_id text,
  add column if not exists shopify_order_name text,
  add column if not exists paid_at timestamptz;

create unique index if not exists cb_payment_ref_idx
  on public.cremation_bookings (payment_ref)
  where payment_ref is not null;

create index if not exists cb_payment_status_idx
  on public.cremation_bookings (payment_status, created_at desc);
