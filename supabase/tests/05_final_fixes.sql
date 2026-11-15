-- Final review fixes: QA rescan, piece_board filters + stage counts, set_piece_status on finished
-- pieces, ship_pieces on closed lines/orders. Runs in a rolled-back transaction and only looks at
-- the rows it creates, so pieces already in the database do not matter.
begin;

create function pg_temp.expect_err(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected failure matching "%" but statement succeeded: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'expected failure matching%' then raise; end if;
  if sqlerrm not like '%' || p_pattern || '%' then
    raise exception 'wrong error for %: got "%" wanted "%"', p_sql, sqlerrm, p_pattern;
  end if;
end $$;

create function pg_temp.as_user(p_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from public.profiles where username = p_name), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- fixtures (superuser): one receipt of 8 pieces, an order with two lines, an import batch with 2 pieces
insert into public.items (category, draw, style, length_in) values ('BUNDLE', 'SD', 'STRAIGHT', 26);
insert into public.clients (name) values ('T5 CLIENT');
insert into public.orders (order_no, client_id) values ('T5-1', (select id from public.clients where name = 'T5 CLIENT'));
insert into public.order_lines (order_id, item_id, qty_ordered, group_label)
select (select id from public.orders where order_no = 'T5-1'), id, 3, g
  from public.items, (values ('T5-A'), ('T5-B')) v(g) where sku = 'SD-STRAIGHT-26';
insert into public.receipts (qty, note) values (8, 't5');
insert into public.pieces (receipt_id, stage)
select (select id from public.receipts where note = 't5'),
       case when g = 1 then 'FOR_QA' when g = 2 then 'RSB' when g in (3, 4) then 'SHIPPED' else 'READY' end
  from generate_series(1, 8) g;
update public.pieces set stage = 'IN_STOCK' where id = (select max(id) from public.pieces where stage = 'SHIPPED'
  and receipt_id = (select id from public.receipts where note = 't5'));
-- p1 FOR_QA, p2 RSB, p3 SHIPPED, p4 IN_STOCK, p5..p8 READY
create temp table t5_p as select (row_number() over (order by id))::int as n, serial, id from public.pieces
 where receipt_id = (select id from public.receipts where note = 't5');
grant select on t5_p to authenticated;
create function pg_temp.s(n int) returns text language sql as $$ select serial from t5_p where t5_p.n = $1 $$;
create temp table t5_l as select l.id as line_id, l.group_label from public.order_lines l
  join public.orders o on o.id = l.order_id where o.order_no = 'T5-1';
grant select on t5_l to authenticated;
-- p5, p6 on line A; p7 on line B
update public.pieces set order_line_id = (select line_id from t5_l where group_label = 'T5-A') where id in (select id from t5_p where n in (5, 6));
update public.pieces set order_line_id = (select line_id from t5_l where group_label = 'T5-B') where id = (select id from t5_p where n = 7);
insert into public.import_batches (file_kind, file_name, file_sha256) values ('ORDERS', 't5.xlsx', 't5-sha');
insert into public.pieces (stage, import_batch_id)
select 'CURLING', (select id from public.import_batches where file_sha256 = 't5-sha') from generate_series(1, 2);
-- ids captured as superuser: the test roles cannot read orders / import_batches directly
create temp table t5_ids as select
  (select id from public.receipts where note = 't5') as receipt_id,
  (select id from public.orders where order_no = 'T5-1') as order_id,
  (select id from public.import_batches where file_sha256 = 't5-sha') as batch_id;
grant select on t5_ids to authenticated;

-- ---- qa_rescan_returns_piece_without_event
select pg_temp.as_user('station.qa');
do $$
declare j jsonb; before int;
begin
  before := (select count(*) from public.piece_events where piece_id = (select id from t5_p where n = 1));
  j := public.station_scan(pg_temp.s(1), 'scanner');
  if j ->> 'serial' <> pg_temp.s(1) or j ->> 'stage' <> 'FOR_QA' then raise exception 'qa_rescan: wrong piece %', j; end if;
  if (j ->> 'already_here')::boolean is not true then raise exception 'qa_rescan: already_here missing %', j; end if;
  if (select count(*) from public.piece_events where piece_id = (select id from t5_p where n = 1)) <> before then
    raise exception 'qa_rescan: an event was written';
  end if;
  -- a fresh scan into QA does not carry the flag
  j := public.station_scan(pg_temp.s(2), 'scanner');
  if j ? 'already_here' then raise exception 'qa_rescan: fresh scan flagged already_here'; end if;
  -- the rescanned piece can still be judged
  j := public.qa_result(pg_temp.s(1), true, null);
  if j ->> 'stage' <> 'READY' then raise exception 'qa_rescan: pass after rescan gave %', j ->> 'stage'; end if;
end $$;
reset role;

-- other stations still refuse a piece already there
update public.pieces set stage = 'RSB' where id = (select id from t5_p where n = 2);
select pg_temp.as_user('station.rsb');
do $$
begin
  perform pg_temp.expect_err(format('select public.station_scan(%L, %L)', pg_temp.s(2), 'scanner'), 'already at this station');
end $$;
reset role;

-- ---- piece_board_filters
select pg_temp.as_user('production');
do $$
declare r record; v_receipt bigint; v_order bigint; v_batch bigint;
begin
  select receipt_id, order_id, batch_id into v_receipt, v_order, v_batch from t5_ids;
  if v_order is null or v_batch is null then raise exception 'filters: fixture ids missing'; end if;
  if (select count(*) from public.piece_board(p_receipt_id => v_receipt)) <> 6 then
    raise exception 'filters: receipt (open) gave %', (select count(*) from public.piece_board(p_receipt_id => v_receipt));
  end if;
  if (select count(*) from public.piece_board(p_receipt_id => v_receipt, p_include_closed => true)) <> 8 then
    raise exception 'filters: receipt (closed) wrong';
  end if;
  if (select count(*) from public.piece_board(p_order_id => v_order)) <> 3 then raise exception 'filters: order wrong'; end if;
  if exists (select 1 from public.piece_board(p_order_id => v_order) where order_id <> v_order) then raise exception 'filters: order leak'; end if;
  if (select count(*) from public.piece_board(p_receipt_id => v_receipt, p_stage => 'READY')) <> 5 then
    raise exception 'filters: stage gave %', (select count(*) from public.piece_board(p_receipt_id => v_receipt, p_stage => 'READY'));
  end if;
  if (select count(*) from public.piece_board(p_import_batch_id => v_batch)) <> 2 then raise exception 'filters: import wrong'; end if;
  if exists (select 1 from public.piece_board(p_import_batch_id => v_batch) where import_batch_id is distinct from v_batch) then
    raise exception 'filters: import_batch_id column wrong';
  end if;
  select * into r from public.piece_board(p_serial => (select serial from t5_p where n = 3));
  if r.stage <> 'SHIPPED' then raise exception 'filters: serial lookup of a closed piece failed'; end if;
end $$;

-- ---- piece_stage_counts matches the board
do $$
declare v_total int; v_board int;
begin
  v_total := (select sum(pieces) from public.piece_stage_counts());
  v_board := (select count(*) from public.piece_board(p_include_closed => true));
  if v_total <> v_board then raise exception 'stage_counts: % vs board %', v_total, v_board; end if;
  if (select pieces from public.piece_stage_counts() where stage = 'IN_STOCK' and status = 'ACTIVE')
     <> (select count(*) from public.pieces where stage = 'IN_STOCK' and status = 'ACTIVE') then
    raise exception 'stage_counts: IN_STOCK wrong';
  end if;
end $$;
reset role;
set local role anon;
do $$
begin
  perform pg_temp.expect_err('select * from public.piece_stage_counts()', 'permission denied');
end $$;
reset role;

-- ---- set_piece_status_refuses_finished
select pg_temp.as_user('inventory');
do $$
begin
  perform pg_temp.expect_err(format('select public.set_piece_status(%L, %L, %L)', pg_temp.s(3), 'CANCELED', 'x'), 'already finished');
  perform pg_temp.expect_err(format('select public.set_piece_status(%L, %L)', pg_temp.s(4), 'ON_HOLD'), 'already finished');
  -- an unfinished piece still works
  if public.set_piece_status(pg_temp.s(8), 'CANCELED', 'test') ->> 'status' <> 'CANCELED' then raise exception 'set_status: cancel failed'; end if;
end $$;

reset role;

-- ---- ship_refuses_closed_lines (line B canceled, then the whole order closed)
update public.order_lines set canceled = true where id = (select line_id from t5_l where group_label = 'T5-B');
select pg_temp.as_user('inventory');
do $$
begin
  perform pg_temp.expect_err(format('select public.ship_pieces(array[%L])', pg_temp.s(7)), 'This order line is not open');
end $$;
reset role;
update public.orders set status = 'CLOSED' where order_no = 'T5-1';
select pg_temp.as_user('inventory');
do $$
begin
  perform pg_temp.expect_err(format('select public.ship_pieces(array[%L])', pg_temp.s(5)), 'This order line is not open');
  if (select count(*) from public.pieces where id in (select id from t5_p) and stage = 'SHIPPED') <> 1 then
    raise exception 'ship_refuses_closed_lines: a piece was shipped';
  end if;
end $$;
reset role;
update public.orders set status = 'OPEN' where order_no = 'T5-1';
select pg_temp.as_user('inventory');
do $$
begin
  if public.ship_pieces(array[pg_temp.s(5), pg_temp.s(6)]) <> 2 then raise exception 'ship on open line failed'; end if;
end $$;
reset role;

-- ---- dead function dropped
do $$
begin
  if to_regprocedure('public.open_order_lines_for_production()') is not null then
    raise exception 'open_order_lines_for_production still exists';
  end if;
end $$;

rollback;
