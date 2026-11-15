-- Task 4 test: link/unlink, ship, receive to stock, import creating pieces. Runs in a rolled-back transaction.
begin;

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

create function pg_temp.as_user(p_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from public.profiles where username = p_name), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- fixtures (superuser): items, client, order with two lines (qty 2 and 5), 12 pieces
insert into public.items (category, draw, style, length_in) values ('BUNDLE', 'SD', 'STRAIGHT', 20), ('BUNDLE', 'SD', 'STRAIGHT', 22);
insert into public.clients (name) values ('T4 CLIENT');
insert into public.orders (order_no, client_id) values ('T4-1', (select id from public.clients where name = 'T4 CLIENT'));
insert into public.order_lines (order_id, item_id, qty_ordered)
select (select id from public.orders where order_no = 'T4-1'), id, 2 from public.items where sku = 'SD-STRAIGHT-20';
insert into public.order_lines (order_id, item_id, qty_ordered)
select (select id from public.orders where order_no = 'T4-1'), id, 5 from public.items where sku = 'SD-STRAIGHT-22';
insert into public.receipts (qty, note) values (12, 't4');
insert into public.pieces (receipt_id, stage)
select (select id from public.receipts where note = 't4'), case when g <= 8 then 'READY' else 'RSB' end from generate_series(1, 12) g;
-- p1..p8 READY, p9..p12 RSB
create temp table t4_p as select (row_number() over (order by id))::int as n, serial, id from public.pieces
 where receipt_id = (select id from public.receipts where note = 't4');
grant select on t4_p to authenticated;
create function pg_temp.s(n int) returns text language sql as $$ select serial from t4_p where t4_p.n = $1 $$;
create temp table t4_l as select id as line_id, (row_number() over (order by id))::int as n from public.order_lines;
grant select on t4_l to authenticated;
create function pg_temp.line(n int) returns bigint language sql as $$ select line_id from t4_l where t4_l.n = $1 $$;

-- ---- link_too_many_refused, link_sets_item
select pg_temp.as_user('inventory');
do $$
declare c int;
begin
  perform pg_temp.expect_err(format('select public.link_pieces(%s, array[%L,%L,%L])', pg_temp.line(1), pg_temp.s(1), pg_temp.s(2), pg_temp.s(3)), 'Only 2 more');
  if (select count(*) from public.pieces where order_line_id is not null) <> 0 then raise exception 'link_too_many_refused: partial link'; end if;
  c := public.link_pieces(pg_temp.line(1), array[pg_temp.s(1), pg_temp.s(2)]);
  if c <> 2 then raise exception 'link_sets_item: count %', c; end if;
  if (select count(*) from public.pieces p join public.order_lines l on l.id = p.order_line_id
       where p.order_line_id = pg_temp.line(1) and p.item_id = l.item_id) <> 2 then raise exception 'link_sets_item: item not set'; end if;
  if (select count(*) from public.piece_events where event = 'LINK') <> 2 then raise exception 'link_sets_item: LINK events'; end if;
  perform pg_temp.expect_err(format('select public.link_pieces(%s, array[%L])', pg_temp.line(1), pg_temp.s(3)), 'Only 0 more');
  perform pg_temp.expect_err(format('select public.link_pieces(%s, array[%L])', pg_temp.line(2), pg_temp.s(1)), 'already linked');
  perform pg_temp.expect_err(format('select public.link_pieces(%s, array[%L,%L])', pg_temp.line(2), pg_temp.s(3), pg_temp.s(3)), 'already linked');
  if (select count(*) from public.pieces where order_line_id = pg_temp.line(2)) <> 0 then raise exception 'duplicate serial: partial link'; end if;
end $$;
reset role;
-- canceled and finished pieces refused
update public.pieces set status = 'CANCELED' where id = (select id from t4_p where n = 4);
update public.pieces set stage = 'IN_STOCK' where id = (select id from t4_p where n = 5);
select pg_temp.as_user('inventory');
do $$
begin
  perform pg_temp.expect_err(format('select public.link_pieces(%s, array[%L])', pg_temp.line(2), pg_temp.s(4)), 'canceled');
  perform pg_temp.expect_err(format('select public.link_pieces(%s, array[%L])', pg_temp.line(2), pg_temp.s(5)), 'already finished');
  perform pg_temp.expect_err(format('select public.link_pieces(%s, array[%L])', pg_temp.line(2), 'SS-999999'), 'No piece');
end $$;
reset role;
update public.pieces set status = 'ACTIVE', stage = 'READY' where id in (select id from t4_p where n in (4, 5));

-- ---- ship_requires_ready_and_linked
select pg_temp.as_user('inventory');
do $$
declare c int; j jsonb;
begin
  perform pg_temp.expect_err(format('select public.ship_pieces(array[%L])', pg_temp.s(3)), 'not linked');
  perform public.link_pieces(pg_temp.line(2), array[pg_temp.s(9)]);
  perform pg_temp.expect_err(format('select public.ship_pieces(array[%L])', pg_temp.s(9)), 'not Ready');
  c := public.ship_pieces(array[pg_temp.s(1), pg_temp.s(2)]);
  if c <> 2 then raise exception 'ship: count %', c; end if;
  if (select count(*) from public.pieces where id in (select id from t4_p where n in (1, 2)) and stage = 'SHIPPED') <> 2 then
    raise exception 'ship: pieces not SHIPPED';
  end if;
  if exists (select 1 from public.stock_movements) then raise exception 'ship: must not post any stock movement'; end if;
  if (select shipped from public.v_order_lines where id = pg_temp.line(1)) <> 2
     or (select line_status from public.v_order_lines where id = pg_temp.line(1)) <> 'FULFILLED' then
    raise exception 'ship: v_order_lines does not reflect shipped pieces';
  end if;
  if (select count(*) from public.piece_events where event = 'SHIP') <> 2 then raise exception 'ship: SHIP events'; end if;
  perform pg_temp.expect_err(format('select public.unlink_piece(%L)', pg_temp.s(1)), 'already shipped');
  j := public.unlink_piece(pg_temp.s(9));
  if j ->> 'order_line_id' is not null then raise exception 'unlink: still linked'; end if;
  perform pg_temp.expect_err(format('select public.unlink_piece(%L)', pg_temp.s(9)), 'not linked');
  if (select count(*) from public.piece_events where event = 'UNLINK') <> 1 then raise exception 'unlink: UNLINK event'; end if;
end $$;
reset role;

-- ---- stock_requires_unlinked
select pg_temp.as_user('inventory');
do $$
declare c int; v_item bigint := (select id from public.items where sku = 'SD-STRAIGHT-20');
begin
  perform public.link_pieces(pg_temp.line(2), array[pg_temp.s(6)]);
  perform pg_temp.expect_err(format('select public.receive_to_stock(array[%L], %s)', pg_temp.s(6), v_item), 'ship it instead');
  perform pg_temp.expect_err(format('select public.receive_to_stock(array[%L], %s)', pg_temp.s(10), v_item), 'not Ready');
  c := public.receive_to_stock(array[pg_temp.s(3), pg_temp.s(4)], v_item);
  if c <> 2 then raise exception 'stock: count %', c; end if;
  if (select count(*) from public.pieces where id in (select id from t4_p where n in (3, 4)) and stage = 'IN_STOCK' and item_id = v_item) <> 2 then
    raise exception 'stock: pieces not IN_STOCK with item';
  end if;
  if (select count(*) from public.stock_movements where movement_type = 'IN' and item_id = v_item and qty = 2) <> 1 then
    raise exception 'stock: expected one IN movement of qty 2';
  end if;
  if (select count(*) from public.piece_events where event = 'STOCK') <> 2 then raise exception 'stock: STOCK events'; end if;
end $$;
reset role;

-- ---- permissions
do $$
declare u text;
begin
  foreach u in array array['production', 'qauser'] loop
    perform pg_temp.as_user(u);
    perform pg_temp.expect_err(format('select public.link_pieces(%s, array[%L])', pg_temp.line(2), pg_temp.s(7)), 'Permission denied', '42501');
    perform pg_temp.expect_err(format('select public.ship_pieces(array[%L])', pg_temp.s(6)), 'Permission denied', '42501');
    perform pg_temp.expect_err(format('select public.unlink_piece(%L)', pg_temp.s(6)), 'Permission denied', '42501');
    perform pg_temp.expect_err(format('select public.receive_to_stock(array[%L], 1)', pg_temp.s(7)), 'Permission denied', '42501');
    execute 'reset role';
  end loop;
end $$;

-- ---- import_creates_pieces, delete_import_removes_pieces
select pg_temp.as_user('admin');
do $$
declare
  v_batch bigint; v_line bigint; v_other bigint;
  v_payload jsonb := '{
    "items": [{"key": "a", "category": "BUNDLE", "draw": "DD", "style": "NATURAL_WAVY", "length_in": 16, "variant": ""}],
    "orders": [{"order_no": "T4-IMP", "client": "T4 IMPORT CLIENT", "ref": "S!1", "lines": [
      {"item": "a", "qty": 5, "ref": "S!2", "stages": [{"stage": "RSB", "qty": 2}, {"stage": "READY", "qty": 1}]}]}]
  }';
begin
  v_batch := public.import_batch('ORDERS', 't4.xlsx', 'sha-t4-1', v_payload);
  select id into v_line from public.order_lines where order_id = (select id from public.orders where order_no = 'T4-IMP');
  if (select count(*) from public.pieces where import_batch_id = v_batch and stage = 'RSB' and order_line_id = v_line
        and item_id = (select item_id from public.order_lines where id = v_line)) <> 2 then
    raise exception 'import_creates_pieces: expected 2 RSB pieces';
  end if;
  if (select count(*) from public.pieces where import_batch_id = v_batch and stage = 'READY') <> 1 then
    raise exception 'import_creates_pieces: expected 1 READY piece';
  end if;
  if (select count(*) from public.piece_events e join public.pieces p on p.id = e.piece_id
       where p.import_batch_id = v_batch and e.event = 'IMPORTED') <> 3 then
    raise exception 'import_creates_pieces: expected 3 IMPORTED events';
  end if;
  if (select remaining from public.v_order_lines where id = v_line) <> 2 then raise exception 'import_creates_pieces: remaining <> 2'; end if;

  -- a piece linked by hand to an imported line blocks deleting the import
  select p.id into v_other from public.pieces p where p.stage = 'READY' and p.order_line_id is null limit 1;
  perform set_config('t4.other', v_other::text, true);
end $$;
reset role;
-- (superuser link, bypassing the function: the case delete_import_batch must refuse)
update public.pieces set order_line_id = (select id from public.order_lines where order_id = (select id from public.orders where order_no = 'T4-IMP'))
 where id = current_setting('t4.other')::bigint;
select pg_temp.as_user('admin');
do $$
declare v_batch bigint := (select id from public.import_batches where file_sha256 = 'sha-t4-1');
begin
  perform pg_temp.expect_err(format('select public.delete_import_batch(%s)', v_batch), 'were linked');
end $$;
reset role;
update public.pieces set order_line_id = null where id = current_setting('t4.other')::bigint;
select pg_temp.as_user('admin');
do $$
declare v_batch bigint := (select id from public.import_batches where file_sha256 = 'sha-t4-1');
begin
  perform public.delete_import_batch(v_batch);
  if exists (select 1 from public.pieces where import_batch_id = v_batch) then
    raise exception 'delete_import_removes_pieces: pieces remain';
  end if;
  if exists (select 1 from public.piece_events e where e.event = 'IMPORTED' and not exists (select 1 from public.pieces p where p.id = e.piece_id)) then
    raise exception 'delete_import_removes_pieces: orphan events';
  end if;
  if exists (select 1 from public.orders where order_no = 'T4-IMP') then raise exception 'delete_import_removes_pieces: order remains'; end if;
  if (select count(*) from public.pieces where id = current_setting('t4.other')::bigint) <> 1 then
    raise exception 'delete_import_removes_pieces: unrelated piece removed';
  end if;
end $$;
reset role;

rollback;
