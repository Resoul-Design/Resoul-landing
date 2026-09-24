-- ============================================================
-- 遷移：安排預約接送・訂金訂單（deposit_bookings）
-- 用法：Supabase → SQL Editor → 貼上全部 → Run（安全，可重複執行）
-- 說明：
--   • 「安排預約接送」流程收 HK$1,800 訂金；此表記錄呢類訂金預約。
--   • 寫入由伺服器端 /api/deposit 以 service_role 進行（繞過 RLS）。
--   • 保留 payment_ref，供 Shopify orders/paid webhook 事後配對標記已付款。
-- ============================================================

create table if not exists public.deposit_bookings (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz not null    default now(),
  owner_name       text        not null,
  contact          text        not null,
  project_no       text,
  pet_name         text,
  pet_type         text,
  plan             text,                               -- 目前固定為「預約接送訂金」
  service_date     date,
  service_time     text,
  pickup_address   text,
  notes            text,
  source           text        default 'web:cremation-deposit',
  status           text        not null default 'new'  -- new=新收到 / contacted=已聯絡 / scheduled=已排期 / completed=已完成 / cancelled=已取消
    check (status in ('new','contacted','scheduled','completed','cancelled')),
  handled_by       text,
  -- 付款追蹤（對應 Shopify orders/paid webhook）
  payment_ref      text,
  payment_status   text        not null default 'pending'
    check (payment_status in ('pending','paid','failed','refunded')),
  payment_amount   numeric(12,2),
  payment_currency text        default 'HKD',
  shopify_order_id text,
  shopify_order_name text,
  paid_at          timestamptz
);

alter table public.deposit_bookings
  add column if not exists project_no text;

create unique index if not exists deposit_payment_ref_idx
  on public.deposit_bookings (payment_ref)
  where payment_ref is not null;

create index if not exists deposit_status_idx
  on public.deposit_bookings (status, created_at desc);

create index if not exists deposit_payment_status_idx
  on public.deposit_bookings (payment_status, created_at desc);

-- 權限：啟用 RLS，但不開放 anon / authenticated 讀寫。
-- 寫入只經 /api/deposit（service_role，繞過 RLS）；後台亦以 service_role 讀取。
alter table public.deposit_bookings enable row level security;
