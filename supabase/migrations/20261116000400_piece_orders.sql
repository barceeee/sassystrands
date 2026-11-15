-- Station scanning, step 4: link pieces to client order lines, ship, receive to stock,
-- and the spreadsheet import creating pieces instead of production records.

-- ---------------------------------------------------------------- link / unlink
create function public.link_pieces(p_order_line_id bigint, p_serials text[])
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_line record; v_serial text; v_piece public.pieces; v_n int := 0; v_room int;
begin
  perform public.require_perm('receiving.manage');
  if p_serials is null or cardinality(p_serials) = 0 then raise exception 'Scan at least one piece.'; end if;
  select l.*, o.status as order_status into v_line
    from public.order_lines l join public.orders o on o.id = l.order_id
   where l.id = p_order_line_id for update of l;
  if not found then raise exception 'Order line not found.'; end if;
  if v_line.canceled or v_line.order_status <> 'OPEN' then raise exception 'This order line is not open.'; end if;
  v_room := v_line.qty_ordered - public.order_line_committed(p_order_line_id);
  if cardinality(p_serials) > v_room then
    raise exception 'Only % more pieces can be linked to this line, tried to link %.', v_room, cardinality(p_serials);
  end if;
  foreach v_serial in array p_serials loop
    v_piece := public._piece(v_serial);
    if v_piece.status = 'CANCELED' then raise exception '% is canceled.', v_piece.serial; end if;
    if v_piece.stage in ('SHIPPED', 'IN_STOCK') then raise exception '% is already finished.', v_piece.serial; end if;
    if v_piece.order_line_id is not null then raise exception '% is already linked to an order.', v_piece.serial; end if;
    update public.pieces set order_line_id = p_order_line_id, item_id = v_line.item_id where id = v_piece.id;
    insert into public.piece_events (piece_id, event, from_stage, to_stage, note)
    values (v_piece.id, 'LINK', v_piece.stage, v_piece.stage, (select order_no from public.orders where id = v_line.order_id));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function public.unlink_piece(p_serial text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_piece public.pieces;
begin
  perform public.require_perm('receiving.manage');
  v_piece := public._piece(p_serial);
  if v_piece.order_line_id is null then raise exception '% is not linked to an order.', v_piece.serial; end if;
  if v_piece.stage = 'SHIPPED' then raise exception '% was already shipped.', v_piece.serial; end if;
  update public.pieces set order_line_id = null where id = v_piece.id;
  insert into public.piece_events (piece_id, event, from_stage, to_stage)
  values (v_piece.id, 'UNLINK', v_piece.stage, v_piece.stage);
  return public._piece_json(v_piece.serial);
end $$;

-- ---------------------------------------------------------------- ship / stock
create function public.ship_pieces(p_serials text[])
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_serial text; v_piece public.pieces; v_n int := 0; g record;
  v_lines bigint[] := '{}'; v_counts int[] := '{}'; v_idx int;
begin
  perform public.require_perm('receiving.manage');
  if p_serials is null or cardinality(p_serials) = 0 then raise exception 'Scan at least one piece.'; end if;
  foreach v_serial in array p_serials loop
    v_piece := public._piece(v_serial);
    if v_piece.status <> 'ACTIVE' then raise exception '% is not active (%).', v_piece.serial, v_piece.status; end if;
    if v_piece.stage <> 'READY' then raise exception '% is not Ready (it is at %).', v_piece.serial, v_piece.stage; end if;
    if v_piece.order_line_id is null then raise exception '% is not linked to an order; receive it to stock instead.', v_piece.serial; end if;
    update public.pieces set stage = 'SHIPPED', stage_since = now() where id = v_piece.id;
    insert into public.piece_events (piece_id, event, from_stage, to_stage)
    values (v_piece.id, 'SHIP', 'READY', 'SHIPPED');
    v_idx := array_position(v_lines, v_piece.order_line_id);
    if v_idx is null then
      v_lines := v_lines || v_piece.order_line_id; v_counts := v_counts || 1;
    else
      v_counts[v_idx] := v_counts[v_idx] + 1;
    end if;
    v_n := v_n + 1;
  end loop;
  for g in select unnest(v_lines) as line_id, unnest(v_counts) as qty loop
    insert into public.stock_movements (item_id, location, movement_type, qty, movement_date, reference, note)
    select l.item_id, 'HQ', 'OUT', g.qty, current_date, o.order_no,
           'Shipped from production, order line ' || l.id
      from public.order_lines l join public.orders o on o.id = l.order_id where l.id = g.line_id;
  end loop;
  return v_n;
end $$;

create function public.receive_to_stock(p_serials text[], p_item_id bigint, p_location text default 'HQ')
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_serial text; v_piece public.pieces; v_n int := 0;
begin
  perform public.require_perm('receiving.manage');
  if p_serials is null or cardinality(p_serials) = 0 then raise exception 'Scan at least one piece.'; end if;
  perform 1 from public.items where id = p_item_id for update;
  if not found then raise exception 'Item not found.'; end if;
  foreach v_serial in array p_serials loop
    v_piece := public._piece(v_serial);
    if v_piece.status <> 'ACTIVE' then raise exception '% is not active (%).', v_piece.serial, v_piece.status; end if;
    if v_piece.stage <> 'READY' then raise exception '% is not Ready (it is at %).', v_piece.serial, v_piece.stage; end if;
    if v_piece.order_line_id is not null then raise exception '% belongs to a client order; ship it instead.', v_piece.serial; end if;
    update public.pieces set stage = 'IN_STOCK', stage_since = now(), item_id = p_item_id where id = v_piece.id;
    insert into public.piece_events (piece_id, event, from_stage, to_stage, note)
    values (v_piece.id, 'STOCK', 'READY', 'IN_STOCK', coalesce(p_location, 'HQ'));
    v_n := v_n + 1;
  end loop;
  insert into public.stock_movements (item_id, location, movement_type, qty, movement_date, reference, note)
  values (p_item_id, coalesce(p_location, 'HQ'), 'IN', v_n, current_date, 'RECEIVED-FROM-PRODUCTION', 'Received from production');
  return v_n;
end $$;

-- ---------------------------------------------------------------- import: pieces instead of production records
-- One transaction per workbook. The browser parses the file and sends normalised records plus
-- the row-level flags; this function checks the role, stores everything and links it to the batch
-- so the whole import can be rolled back with delete_import_batch().
create or replace function public.import_batch(p_kind text, p_file_name text, p_sha256 text, p_payload jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_batch bigint; v_items jsonb := '{}'; e jsonb; l jsonb; s jsonb; v_id bigint; v_order bigint; v_line bigint;
  v_client bigint; v_prod bigint;
begin
  perform public.require_perm('imports.manage');
  if exists (select 1 from public.import_batches where file_sha256 = p_sha256) then
    raise exception 'This exact file was already imported. Delete that import first to re-import it.';
  end if;
  insert into public.import_batches (file_kind, file_name, file_sha256, summary)
  values (p_kind, p_file_name, p_sha256, coalesce(p_payload -> 'summary', '{}'))
  returning id into v_batch;

  for e in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]')) loop
    v_items := v_items || jsonb_build_object(e ->> 'key', public._ensure_item(e));
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_payload -> 'movements', '[]')) loop
    insert into public.stock_movements (item_id, movement_type, qty, movement_date, reference, note, source_ref, import_batch_id)
    values ((v_items ->> (e ->> 'item'))::bigint, e ->> 'type', (e ->> 'qty')::int, (e ->> 'date')::date,
            'IMPORT-' || v_batch, e ->> 'note', e ->> 'ref', v_batch);
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_payload -> 'counts', '[]')) loop
    insert into public.stock_counts (item_id, count_date, counted_qty, unit_price, source, source_label, note, source_ref, import_batch_id)
    values ((v_items ->> (e ->> 'item'))::bigint, (e ->> 'date')::date, (e ->> 'qty')::int, (e ->> 'unit_price')::numeric,
            e ->> 'source', e ->> 'label', e ->> 'note', e ->> 'ref', v_batch);
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_payload -> 'bundles', '[]')) loop
    insert into public.sale_bundles (code, price, status, note, source_ref, import_batch_id)
    values (e ->> 'code', (e ->> 'price')::numeric, e ->> 'status', e ->> 'note', e ->> 'ref', v_batch)
    on conflict (code) do nothing
    returning id into v_id;
    if v_id is null then
      insert into public.import_flags (batch_id, sheet, row_num, severity, code, message, outcome)
      values (v_batch, coalesce(e ->> 'sheet', ''), (e ->> 'row')::int, 'WARNING', 'DUPLICATE_BUNDLE',
              'Sale bundle ' || (e ->> 'code') || ' already exists; skipped.', 'NOT_IMPORTED');
      continue;
    end if;
    for l in select * from jsonb_array_elements(coalesce(e -> 'components', '[]')) loop
      insert into public.sale_bundle_items (bundle_id, item_id, qty)
      values (v_id, (v_items ->> (l ->> 'item'))::bigint, (l ->> 'qty')::int);
    end loop;
    v_id := null;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_payload -> 'orders', '[]')) loop
    insert into public.clients (name) values (e ->> 'client')
    on conflict ((upper(name))) do update set name = public.clients.name
    returning id into v_client;
    insert into public.orders (order_no, client_id, notes, source_ref, import_batch_id)
    values (e ->> 'order_no', v_client, e ->> 'notes', e ->> 'ref', v_batch)
    returning id into v_order;
    for l in select * from jsonb_array_elements(coalesce(e -> 'lines', '[]')) loop
      insert into public.order_lines (order_id, item_id, group_label, qty_ordered, line_note, canceled, description_raw, source_ref)
      values (v_order, (v_items ->> (l ->> 'item'))::bigint, l ->> 'group_label', (l ->> 'qty')::int, l ->> 'line_note',
              coalesce((l ->> 'canceled')::boolean, false), l ->> 'description_raw', l ->> 'ref')
      returning id into v_line;
      for s in select * from jsonb_array_elements(coalesce(l -> 'stages', '[]')) loop
        with new_pieces as (
          insert into public.pieces (stage, order_line_id, item_id, import_batch_id)
          select s ->> 'stage', v_line, (v_items ->> (l ->> 'item'))::bigint, v_batch
            from generate_series(1, (s ->> 'qty')::int)
          returning id
        )
        insert into public.piece_events (piece_id, event, to_stage, note)
        select id, 'IMPORTED', s ->> 'stage', 'Imported from ' || p_file_name || ' ' || (l ->> 'ref') from new_pieces;
      end loop;
    end loop;
  end loop;

  insert into public.import_flags (batch_id, sheet, row_num, cell, severity, code, message, outcome, raw)
  select v_batch, f ->> 'sheet', (f ->> 'row')::int, f ->> 'cell', f ->> 'severity', f ->> 'code', f ->> 'message',
         f ->> 'outcome', f -> 'raw'
    from jsonb_array_elements(coalesce(p_payload -> 'flags', '[]')) f;

  return v_batch;
end $$;


-- Pieces cascade from the batch (pieces.import_batch_id on delete cascade), taking their events with them.
-- Pieces that were linked to the imported lines by hand are not part of the batch and would be silently
-- unlinked by the cascade (it bypasses order_lines_guard), so refuse instead.
create or replace function public.delete_import_batch(p_batch_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_perm('imports.manage');
  if exists (
    select 1 from public.pieces p
      join public.order_lines l on l.id = p.order_line_id
      join public.orders o on o.id = l.order_id
     where o.import_batch_id = p_batch_id and p.import_batch_id is distinct from p_batch_id
  ) then
    raise exception 'Cannot delete this import: pieces were linked to its orders since it was imported. Unlink them first.';
  end if;
  delete from public.import_batches where id = p_batch_id;
  if not found then raise exception 'Import not found.'; end if;
exception when foreign_key_violation then
  raise exception 'Cannot delete this import: stock was shipped or received against its orders since it was imported.';
end $$;

-- ---------------------------------------------------------------- privileges
revoke execute on function public.link_pieces(bigint, text[]), public.unlink_piece(text),
  public.ship_pieces(text[]), public.receive_to_stock(text[], bigint, text),
  public.import_batch(text, text, text, jsonb), public.delete_import_batch(bigint) from public, anon;
grant execute on function public.link_pieces(bigint, text[]), public.unlink_piece(text),
  public.ship_pieces(text[]), public.receive_to_stock(text[], bigint, text),
  public.import_batch(text, text, text, jsonb), public.delete_import_batch(bigint) to authenticated;
