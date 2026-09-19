-- Public writes now pass through same-origin, rate-limited Vercel APIs.
create table if not exists public.api_rate_limits (
  key text primary key,
  request_count integer not null default 0,
  window_expires_at timestamptz not null
);
alter table public.api_rate_limits enable row level security;

create or replace function public.consume_api_quota(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_count integer;
begin
  insert into public.api_rate_limits(key, request_count, window_expires_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    request_count = case when api_rate_limits.window_expires_at <= now() then 1 else api_rate_limits.request_count + 1 end,
    window_expires_at = case when api_rate_limits.window_expires_at <= now() then now() + make_interval(secs => p_window_seconds) else api_rate_limits.window_expires_at end
  returning request_count into current_count;
  return current_count <= greatest(1, p_limit);
end;
$$;

revoke all on public.api_rate_limits from anon, authenticated;
revoke all on function public.consume_api_quota(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_quota(text, integer, integer) to service_role;

drop policy if exists "public submit booking" on public.cremation_bookings;
drop policy if exists "insert posts" on public.posts;
drop policy if exists "public upload board-images" on storage.objects;

do $$
declare policy_name text;
begin
  for policy_name in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
      and coalesce(with_check, '') like '%custom-uploads%'
  loop
    execute format('drop policy if exists %I on storage.objects', policy_name);
  end loop;
end $$;
