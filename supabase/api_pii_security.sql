-- Public booking PII is written only by the Vercel API with service_role.
-- Run in the production Supabase SQL editor; safe to run repeatedly.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('cremation_bookings', 'deposit_bookings')
      and (roles @> array['anon']::name[] or roles @> array['public']::name[])
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

revoke all on public.cremation_bookings from anon, authenticated;
revoke all on public.deposit_bookings from anon, authenticated;
alter table public.cremation_bookings enable row level security;
alter table public.deposit_bookings enable row level security;
