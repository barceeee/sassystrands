-- Station scanning, step 1: STATION and LEADER roles tied to a station, plus the permissions
-- later steps use. Each hair piece is moved only by station scans.

-- Stage that incoming pieces start in (target of profiles.station and of later scan rules).
insert into public.production_stages (code, label, sort_order, production_can_set)
values ('RECEIVED', 'Received', 5, false)
on conflict (code) do nothing;

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('OWNER', 'ADMIN', 'INVENTORY', 'PRODUCTION', 'QA', 'STATION', 'LEADER'));

alter table public.profiles add column station text references public.production_stages (code);
alter table public.profiles add constraint profiles_station_check
  check ((role in ('STATION', 'LEADER')) = (station is not null));

-- Permission map (mirrored in src/lib/perms.js):
--   station.scan        STATION, LEADER
--   station.lead        LEADER
--   receiving.manage    OWNER, ADMIN, INVENTORY
--   production.manage   nobody (old callers fail closed)
--   qa.manage           nobody (old callers fail closed)
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when p = 'users.manage' then role in ('OWNER', 'ADMIN')
      when p = 'production.view' then true
      when p = 'station.scan' then role in ('STATION', 'LEADER')
      when p = 'station.lead' then role = 'LEADER'
      when p = 'receiving.manage' then role in ('OWNER', 'ADMIN', 'INVENTORY')
      when p in ('production.manage', 'qa.manage') then false
      else role in ('OWNER', 'ADMIN', 'INVENTORY')
    end
    from public.profiles where id = auth.uid() and active
  ), false)
$$;

create or replace function public.my_station()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select station from public.profiles where id = auth.uid() and active
$$;

revoke execute on function public.my_station() from public, anon;
grant execute on function public.my_station() to authenticated;
