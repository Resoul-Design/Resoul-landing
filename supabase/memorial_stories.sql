-- ============================================================
-- RESOUL 分享頁 / Remember Their Story — 紀念故事擴充
-- 用法：Supabase 專案 (diyxcxkgvqvyrstrzttq — 與 resoul-admin 後台同一個) → SQL Editor → 貼上全部 → Run
--       （注意：前端現已統一指向 diyxcxkgvqvyrstrzttq；請在此 project 執行）
-- 設計：沿用現有 public.posts 表，用 context='memorial' 區分紀念故事；
--       匿名提交、預先審核（held→visible）、私隱三選一、留下心意（heart）。
-- 本檔可重複執行（idempotent）。
-- ============================================================

-- 1) 新增紀念故事欄位（沿用 name=署名 / body=故事 / image_path=照片）--------
alter table public.posts add column if not exists pet_name   text;                 -- 毛孩名字
alter table public.posts add column if not exists years      text;                 -- 年份 / 一起生活的年期
alter table public.posts add column if not exists one_line   text;                 -- 最像牠的一句話
alter table public.posts add column if not exists visibility text not null default 'public'; -- public/link/private
alter table public.posts add column if not exists hearts     integer not null default 0;      -- 留下心意數目
alter table public.posts add column if not exists slug       uuid not null default gen_random_uuid(); -- 只限連結分享用

do $$ begin
  alter table public.posts add constraint visibility_val check (visibility in ('public','link','private'));
exception when duplicate_object then null; end $$;

create index if not exists posts_slug_idx on public.posts (slug);
create index if not exists posts_memorial_idx on public.posts (context, visibility, status, created_at desc);

-- 2) 提交時強制安全值（沿用並擴充現有 trigger）------------------
create or replace function public.posts_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.status := 'held';                 -- 一律待審，審核後才顯示
  new.hearts := 0;                      -- 心意由 RPC 累加，提交時歸零
  if new.visibility is null or new.visibility not in ('public','link','private') then
    new.visibility := 'public';
  end if;
  if new.slug is null then new.slug := gen_random_uuid(); end if;
  if new.body ~ '(想死|唔想活|自殺|傷害自己|撐唔住|頂唔住|想跟(佢|牠|你)去|活唔落去|結束生命|唔想生存|冇晒意思)' then
    new.crisis_flag := true;
  else
    new.crisis_flag := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_posts_before_insert on public.posts;
create trigger trg_posts_before_insert
  before insert on public.posts
  for each row execute function public.posts_before_insert();

-- 3) 讀取權限：已顯示且非私人（private 永不外露）------------------
drop policy if exists "read visible posts" on public.posts;
create policy "read visible posts"
  on public.posts for select
  to anon, authenticated
  using (status = 'visible' and (visibility is null or visibility <> 'private'));

-- 4) 留下心意：以 RPC 累加，唔開放 anon UPDATE ------------------
create or replace function public.increment_post_heart(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v integer;
begin
  update public.posts
     set hearts = hearts + 1
   where id = p_id and status = 'visible' and visibility <> 'private'
   returning hearts into v;
  return coalesce(v, 0);
end;
$$;

grant execute on function public.increment_post_heart(uuid) to anon, authenticated;

-- ============================================================
-- 完成。紀念故事沿用 board-images bucket（memorial/ 路徑），無需另建 bucket。
-- 審核：Table Editor → posts → context='memorial' 的列，將 status 改為 'visible' 才會公開。
--   • visibility='public'  → 公開列表顯示
--   • visibility='link'    → 唔上列表，只有持連結（?s=<slug>）先睇到
--   • visibility='private' → 只作記錄，永不外露（後台可見）
-- 心意：前端呼叫 rpc/increment_post_heart，唔使開 UPDATE 權限。
-- ============================================================
