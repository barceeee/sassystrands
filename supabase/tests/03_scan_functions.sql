-- Task 3 test: receiving, station scan, QA, leader fix. Runs in a rolled-back transaction.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'sc-rsb@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'sc-weft@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b3', 'sc-curl@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b4', 'sc-qa@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b5', 'sc-lead@example.invalid');
insert into public.profiles (id, username, full_name, role, station) values
  ('00000000-0000-0000-0000-0000000000b1', 'sc-rsb', 'RSB', 'STATION', 'RSB'),
  ('00000000-0000-0000-0000-0000000000b2', 'sc-weft', 'Wefting', 'STATION', 'WEFTING'),
  ('00000000-0000-0000-0000-0000000000b3', 'sc-curl', 'Curling', 'STATION', 'CURLING'),
  ('00000000-0000-0000-0000-0000000000b4', 'sc-qa', 'QA', 'STATION', 'FOR_QA'),
  ('00000000-0000-0000-0000-0000000000b5', 'sc-lead', 'Lead', 'LEADER', 'RSB');

-- expect_err(sql, pattern, sqlstate): the statement must fail with a matching message (and sqlstate when given)
create function pg_temp.expect_err(p_sql text, p_pattern text, p_state text default null) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected failure matching "%" but statement succeeded: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'expected failure matching%' then raise; end if;
  if sqlerrm not like '%' || p_pattern || '%' then
    raise exception 'wrong error for %: got "%" wanted "%"', p_sql, sqlerrm, p_pattern;
  end if;
  if p_state is not null and sqlstate <> p_state then
    raise exception 'wrong sqlstate for %: got % wanted %', p_sql, sqlstate, p_state;
  end if;
end $$;

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---- receive_creates_pieces
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = 'inventory'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r bigint;
begin
  r := public.receive_pieces(3, 'test batch');
  if (select count(*) from public.pieces where receipt_id = r and stage = 'RECEIVED') <> 3 then
    raise exception 'receive_creates_pieces: expected 3 RECEIVED pieces';
  end if;
  if (select count(*) from public.piece_events where event = 'RECEIVED' and piece_id in (select id from public.pieces where receipt_id = r)) <> 3 then
    raise exception 'receive_creates_pieces: expected 3 RECEIVED events';
  end if;
  perform set_config('t.s1', (select serial from public.pieces where receipt_id = r order by id limit 1 offset 0), true);
  perform set_config('t.s2', (select serial from public.pieces where receipt_id = r order by id limit 1 offset 1), true);
  perform set_config('t.s3', (select serial from public.pieces where receipt_id = r order by id limit 1 offset 2), true);
  perform pg_temp.expect_err('select public.receive_pieces(0)', 'between 1 and 500');
  perform pg_temp.expect_err('select public.receive_pieces(501)', 'between 1 and 500');
  r := public.receive_pieces(1);
  perform set_config('t.s4', (select serial from public.pieces where receipt_id = r), true);
end $$;
reset role;

-- ---- station_moves_piece (RSB, in order) and rescan_same_station_refused
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
do $$
declare j jsonb;
begin
  j := public.station_scan(current_setting('t.s1'), 'scanner');
  if j->>'stage' <> 'RSB' then raise exception 'station_moves_piece: stage %', j->>'stage'; end if;
  if not exists (select 1 from public.piece_events e join public.pieces p on p.id = e.piece_id
                  where p.serial = current_setting('t.s1') and e.event = 'SCAN' and e.method = 'scanner'
                    and e.station = 'RSB' and e.from_stage = 'RECEIVED' and e.to_stage = 'RSB' and not e.out_of_order) then
    raise exception 'station_moves_piece: SCAN event wrong';
  end if;
  perform pg_temp.expect_err(format('select public.station_scan(%L, ''scanner'')', current_setting('t.s1')), 'already at this station');
  perform pg_temp.expect_err('select public.station_scan(''SS-999999'', ''scanner'')', 'No piece with serial SS-999999.');
  perform pg_temp.expect_err(format('select public.station_scan(%L, ''manual'')', current_setting('t.s4')), 'leaders only');
  perform pg_temp.expect_err(format('select public.qa_result(%L, true)', current_setting('t.s1')), 'Only the QA station', '42501');
  perform pg_temp.expect_err(format('select public.leader_fix(%L, ''RSB'', ''x'')', current_setting('t.s1')), 'Permission denied', '42501');
  perform pg_temp.expect_err('select public.receive_pieces(1)', 'Permission denied', '42501');
end $$;
reset role;

-- ---- serial_normalised + in-order next station (WEFTING)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$
declare j jsonb;
begin
  j := public.station_scan(' ]C0' || lower(current_setting('t.s1')) || ' ', 'scanner');
  if j->>'stage' <> 'WEFTING' then raise exception 'serial_normalised: stage %', j->>'stage'; end if;
  if exists (select 1 from public.piece_events e join public.pieces p on p.id = e.piece_id
              where p.serial = current_setting('t.s1') and e.to_stage = 'WEFTING' and e.out_of_order) then
    raise exception 'RSB -> WEFTING must not be out of order';
  end if;
end $$;
reset role;

-- ---- skip_flagged: WEFTING piece scanned at CURLING
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
do $$
declare j jsonb;
begin
  j := public.station_scan(current_setting('t.s1'), 'camera');
  if j->>'stage' <> 'CURLING' then raise exception 'skip_flagged: stage %', j->>'stage'; end if;
  if not exists (select 1 from public.piece_events e join public.pieces p on p.id = e.piece_id
                  where p.serial = current_setting('t.s1') and e.to_stage = 'CURLING' and e.out_of_order and e.method = 'camera') then
    raise exception 'skip_flagged: expected out_of_order event';
  end if;
end $$;
reset role;

-- ---- qa_pass_and_reject
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
do $$
declare j jsonb;
begin
  perform public.station_scan(current_setting('t.s1'), 'scanner');
  perform public.station_scan(current_setting('t.s2'), 'scanner');
  j := public.qa_result(current_setting('t.s1'), true);
  if j->>'stage' <> 'READY' then raise exception 'qa pass: stage %', j->>'stage'; end if;
  perform pg_temp.expect_err(format('select public.qa_result(%L, false, null)', current_setting('t.s2')), 'Describe the defects');
  j := public.qa_result(current_setting('t.s2'), false, 'loose knots');
  if j->>'stage' <> 'REJECTED' then raise exception 'qa reject: stage %', j->>'stage'; end if;
  if (select count(*) from public.qa_results where piece_id in (select id from public.pieces where serial in (current_setting('t.s1'), current_setting('t.s2')))) <> 2 then
    raise exception 'qa_results rows missing';
  end if;
  if (select count(*) from public.piece_events where event = 'QA' and piece_id in (select id from public.pieces where serial in (current_setting('t.s1'), current_setting('t.s2')))) <> 2 then
    raise exception 'QA events missing';
  end if;
  perform pg_temp.expect_err(format('select public.qa_result(%L, true)', current_setting('t.s3')), 'not at the QA station');
end $$;
reset role;

-- ---- finished_refused, rejected rework not flagged
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
do $$
declare j jsonb;
begin
  perform pg_temp.expect_err(format('select public.station_scan(%L, ''scanner'')', current_setting('t.s1')), 'already finished');
  j := public.station_scan(current_setting('t.s2'), 'scanner');   -- REJECTED -> RSB rework
  if exists (select 1 from public.piece_events e join public.pieces p on p.id = e.piece_id
              where p.serial = current_setting('t.s2') and e.from_stage = 'REJECTED' and e.out_of_order) then
    raise exception 'REJECTED rework must not be out of order';
  end if;
end $$;
reset role;

-- ---- leader_fix_needs_reason, manual allowed for leader, status
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
do $$
declare j jsonb;
begin
  perform pg_temp.expect_err(format('select public.leader_fix(%L, ''RSB'', '''')', current_setting('t.s3')), 'reason is required');
  perform pg_temp.expect_err(format('select public.leader_fix(%L, ''READY'', ''x'')', current_setting('t.s3')), 'only be moved');
  j := public.leader_fix(current_setting('t.s2'), 'WEFTING', 'back to wefting');
  if j->>'stage' <> 'WEFTING' then raise exception 'leader_fix: stage %', j->>'stage'; end if;
  j := public.leader_fix(current_setting('t.s3'), 'RSB', 'wrongly skipped');
  if j->>'stage' <> 'RSB' then raise exception 'leader_fix: stage %', j->>'stage'; end if;
  if not exists (select 1 from public.piece_events e join public.pieces p on p.id = e.piece_id
                  where p.serial = current_setting('t.s3') and e.event = 'FIX' and e.note = 'wrongly skipped' and e.to_stage = 'RSB') then
    raise exception 'leader_fix: FIX event missing';
  end if;
  j := public.station_scan(current_setting('t.s4'), 'manual');
  if not exists (select 1 from public.piece_events e join public.pieces p on p.id = e.piece_id
                  where p.serial = current_setting('t.s4') and e.method = 'manual') then
    raise exception 'manual scan not logged';
  end if;
  -- set_piece_status: leader may act on a piece at their own station (RSB) only
  perform pg_temp.expect_err(format('select public.set_piece_status(%L, ''CANCELED'', null)', current_setting('t.s3')), 'reason is required');
  j := public.set_piece_status(current_setting('t.s3'), 'ON_HOLD', 'check');
  if j->>'status' <> 'ON_HOLD' then raise exception 'set_piece_status: %', j->>'status'; end if;
  perform pg_temp.expect_err(format('select public.station_scan(%L, ''manual'')', current_setting('t.s3')), 'not active');
  perform pg_temp.expect_err(format('select public.set_piece_status(%L, ''ON_HOLD'', null)', current_setting('t.s2')), 'Permission denied', '42501');
end $$;
reset role;

-- ---- viewer_cannot_move
do $$
declare u text;
begin
  foreach u in array array['production', 'qauser'] loop
    perform pg_temp.as_user((select id from public.profiles where username = u));
    perform pg_temp.expect_err(format('select public.station_scan(%L, ''scanner'')', current_setting('t.s4')), 'Permission denied', '42501');
    perform pg_temp.expect_err('select public.receive_pieces(1)', 'Permission denied', '42501');
    execute 'reset role';
  end loop;
end $$;

-- ---- tables and helpers are closed to authenticated
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
do $$ begin
  perform pg_temp.expect_err('update public.pieces set stage = ''RSB''', 'permission denied');
  perform pg_temp.expect_err('select public._piece(''SS-000001'')', 'permission denied');
end $$;
reset role;

rollback;
