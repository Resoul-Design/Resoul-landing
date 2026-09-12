-- ============================================================
-- RESOUL 安全加固 migration
-- 用法：Supabase（diyxcx）→ SQL Editor → 貼上全部 → Run（安全、可重複執行）
--
-- #1 公開預約：anon 插入時強制付款欄位，防止假「已付款」記錄
-- #2 紀念故事：公開列表只露 public；link 故事改用憑 slug 的 RPC 精準讀取
-- ============================================================

-- ---------- #1 cremation_bookings：anon 插入清洗（含付款欄位） ----------
create or replace function public.cb_before_insert_public()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'anon' then
    new.status       := 'new';
    new.amount       := null;
    new.cost         := null;
    new.case_no      := null;
    new.handled_by   := null;
    new.service_time := null;
    -- 付款欄位：anon 不可自設，避免偽造「已付款」；payment_ref 保留供 webhook 對數
    new.payment_status     := 'pending';
    new.payment_amount     := null;
    new.payment_currency   := null;
    new.shopify_order_id   := null;
    new.shopify_order_name := null;
    new.paid_at            := null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_cb_public on public.cremation_bookings;
create trigger trg_cb_public
  before insert on public.cremation_bookings
  for each row execute function public.cb_before_insert_public();

-- ---------- #2 posts：公開列表只露 public ----------
drop policy if exists "read visible posts" on public.posts;
create policy "read visible posts"
  on public.posts for select
  to anon, authenticated
  using (status = 'visible' and (visibility is null or visibility = 'public'));

-- link 故事：憑 slug 精準取一條（SECURITY DEFINER 繞過上面 policy，但仍限 visible 且非 private）
create or replace function public.get_post_by_slug(p_slug text)
returns setof public.posts
language sql
security definer
set search_path = public
as $$
  select *
  from public.posts
  where slug = p_slug
    and status = 'visible'
    and visibility <> 'private'
  limit 1;
$$;

grant execute on function public.get_post_by_slug(text) to anon, authenticated;
