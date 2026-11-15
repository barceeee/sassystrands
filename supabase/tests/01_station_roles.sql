-- Task 1 test: STATION/LEADER roles, stations, permissions. Runs in a rolled-back transaction.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'st-test@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'inv-test@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'ld-test@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a4', 'bad-test@example.invalid');

insert into public.profiles (id, username, full_name, role, station) values
  ('00000000-0000-0000-0000-0000000000a1', 'st-test', 'Station Test', 'STATION', 'RSB'),
  ('00000000-0000-0000-0000-0000000000a2', 'inv-test', 'Inv Test', 'INVENTORY', null),
  ('00000000-0000-0000-0000-0000000000a3', 'ld-test', 'Leader Test', 'LEADER', 'WEFTING');

-- STATION with null station must raise
do $$ begin
  begin
    insert into public.profiles (id, username, full_name, role, station)
    values ('00000000-0000-0000-0000-0000000000a4', 'bad-test', 'Bad', 'STATION', null);
    raise exception 'expected check violation for STATION without station';
  exception when check_violation then null;
  end;
  -- non-station role with a station must raise too
  begin
    update public.profiles set station = 'RSB' where id = '00000000-0000-0000-0000-0000000000a2';
    raise exception 'expected check violation for INVENTORY with station';
  exception when check_violation then null;
  end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not public.has_perm('station.scan') then raise exception 'station.scan expected for STATION'; end if;
  if public.has_perm('station.lead') then raise exception 'station.lead not expected for STATION'; end if;
  if public.my_station() is distinct from 'RSB' then raise exception 'my_station should be RSB'; end if;
  if public.has_perm('receiving.manage') then raise exception 'receiving.manage not expected for STATION'; end if;
end $$;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not (public.has_perm('station.scan') and public.has_perm('station.lead')) then raise exception 'LEADER needs scan+lead'; end if;
  if public.my_station() is distinct from 'WEFTING' then raise exception 'my_station should be WEFTING'; end if;
end $$;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not public.has_perm('receiving.manage') then raise exception 'receiving.manage expected for INVENTORY'; end if;
  if public.has_perm('production.manage') then raise exception 'production.manage must be false'; end if;
  if public.has_perm('qa.manage') then raise exception 'qa.manage must be false'; end if;
  if public.has_perm('station.scan') then raise exception 'station.scan not expected for INVENTORY'; end if;
  if not public.has_perm('inventory.manage') then raise exception 'default perms must still work for INVENTORY'; end if;
end $$;

reset role;
do $$ begin
  if not exists (select 1 from public.production_stages where code = 'RECEIVED') then raise exception 'RECEIVED stage missing'; end if;
end $$;

rollback;
