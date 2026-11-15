-- Station scanning, final review fixes:
--   * piece_board takes server-side filters (receipt, order, stage, import) so screens stop
--     loading the whole board (PostgREST caps a response at 1000 rows); piece_stage_counts for totals.
--   * station_scan at the QA station returns a piece already waiting there instead of refusing it,
--     so a rescan reopens Pass / Reject.
--   * set_piece_status refuses shipped / in-stock pieces.
--   * ship_pieces refuses pieces on a canceled line or a closed/canceled order.
--   * drops the unused open_order_lines_for_production.

-- ---------------------------------------------------------------- piece board with filters
drop function public.piece_board(text, boolean);

create function public.piece_board(
  p_serial          text    default null,
  p_include_closed  boolean default false,
  p_receipt_id      bigint  default null,
  p_order_id        bigint  default null,
  p_stage           text    default null,
  p_import_batch_id bigint  default null
)
returns table (
  id bigint, serial text, stage text, stage_label text, stage_sort int, status text, stage_since timestamptz,
  item_id bigint, item_name text, order_line_id bigint, order_id bigint, order_no text, client_name text,
  group_label text, receipt_id bigint, last_event_at timestamptz, import_batch_id bigint
) language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.serial, p.stage, ps.label, ps.sort_order, p.status, p.stage_since,
         p.item_id, i.name, p.order_line_id, o.id, o.order_no, c.name, l.group_label, p.receipt_id,
         (select max(e.created_at) from public.piece_events e where e.piece_id = p.id),
         p.import_batch_id
    from public.pieces p
    join public.production_stages ps on ps.code = p.stage
    left join public.v_items i on i.id = p.item_id
    left join public.order_lines l on l.id = p.order_line_id
    left join public.orders o on o.id = l.order_id
    left join public.clients c on c.id = o.client_id
   where public.has_perm('production.view')
     and (p_serial is null or p.serial = upper(btrim(p_serial)))
     and (p_receipt_id is null or p.receipt_id = p_receipt_id)
     and (p_order_id is null or l.order_id = p_order_id)
     and (p_stage is null or p.stage = p_stage)
     and (p_import_batch_id is null or p.import_batch_id = p_import_batch_id)
     and (p_serial is not null or p_include_closed or (p.stage not in ('SHIPPED', 'IN_STOCK') and p.status <> 'CANCELED'))
   order by ps.sort_order, p.id
$$;

revoke execute on function public.piece_board(text, boolean, bigint, bigint, text, bigint) from public, anon;
grant execute on function public.piece_board(text, boolean, bigint, bigint, text, bigint) to authenticated;

-- _piece_json called piece_board positionally; rebind it to the new signature by name.
create or replace function public._piece_json(p_serial text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(b) from public.piece_board(p_serial => p_serial) b
$$;
revoke execute on function public._piece_json(text) from public, anon, authenticated;

-- Totals for dashboards: one row per stage and status, every piece (closed ones too).
create function public.piece_stage_counts()
returns table (stage text, stage_label text, stage_sort int, status text, pieces int)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.stage, ps.label, ps.sort_order, p.status, count(*)::int
    from public.pieces p
    join public.production_stages ps on ps.code = p.stage
   where public.has_perm('production.view')
   group by p.stage, ps.label, ps.sort_order, p.status
   order by ps.sort_order, p.status
$$;

revoke execute on function public.piece_stage_counts() from public, anon;
grant execute on function public.piece_stage_counts() to authenticated;

-- ---------------------------------------------------------------- station scan: QA rescan
create or replace function public.station_scan(p_serial text, p_method text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_station text;
  v_piece   public.pieces;
  v_ooo     boolean;
begin
  perform public.require_perm('station.scan');
  if p_method is null or p_method not in ('scanner', 'camera', 'manual') then
    raise exception 'Unknown scan method %.', p_method;
  end if;
  if p_method = 'manual' and not public.has_perm('station.lead') then
    raise exception 'Manual entry is for leaders only. Scan the label instead.';
  end if;
  v_station := public.my_station();
  v_piece := public._piece(p_serial);
  if v_piece.status <> 'ACTIVE' then
    raise exception '% is not active (%).', v_piece.serial, v_piece.status;
  end if;
  if v_piece.stage in ('READY', 'SHIPPED', 'IN_STOCK') then
    raise exception '% is already finished.', v_piece.serial;
  end if;
  if v_piece.stage = v_station then
    -- At QA the piece still needs a result: hand it back so the screen can offer Pass / Reject.
    if v_station = 'FOR_QA' then
      return public._piece_json(v_piece.serial) || '{"already_here": true}'::jsonb;
    end if;
    raise exception '% is already at this station.', v_piece.serial;
  end if;
  v_ooo := v_piece.stage <> 'REJECTED'
    and (select sort_order from public.production_stages where code = v_piece.stage)
        is distinct from public._prev_station_sort(v_station);
  update public.pieces set stage = v_station, stage_since = now() where id = v_piece.id;
  insert into public.piece_events (piece_id, event, from_stage, to_stage, station, method, out_of_order)
  values (v_piece.id, 'SCAN', v_piece.stage, v_station, v_station, p_method, v_ooo);
  return public._piece_json(v_piece.serial);
end $$;

-- ---------------------------------------------------------------- hold / cancel / reactivate
create or replace function public.set_piece_status(p_serial text, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_piece public.pieces;
begin
  if p_status is null or p_status not in ('ACTIVE', 'ON_HOLD', 'CANCELED') then
    raise exception 'Unknown status %.', p_status;
  end if;
  v_piece := public._piece(p_serial);
  if not (public.has_perm('receiving.manage')
          or (public.has_perm('station.lead') and v_piece.stage = public.my_station())) then
    raise exception 'Permission denied (receiving.manage)' using errcode = '42501';
  end if;
  if v_piece.stage in ('SHIPPED', 'IN_STOCK') then
    raise exception '% is already finished.', v_piece.serial;
  end if;
  if p_status = 'CANCELED' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel a piece.';
  end if;
  if v_piece.status = p_status then
    raise exception '% is already %.', v_piece.serial, p_status;
  end if;
  update public.pieces set status = p_status where id = v_piece.id;
  insert into public.piece_events (piece_id, event, from_stage, to_stage, station, note)
  values (v_piece.id, 'STATUS', v_piece.stage, v_piece.stage, public.my_station(),
          p_status || coalesce(': ' || nullif(btrim(p_reason), ''), ''));
  return public._piece_json(v_piece.serial);
end $$;

-- ---------------------------------------------------------------- ship: only open lines
create or replace function public.ship_pieces(p_serials text[])
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_serial text; v_piece public.pieces; v_open boolean; v_n int := 0;
begin
  perform public.require_perm('receiving.manage');
  if p_serials is null or cardinality(p_serials) = 0 then raise exception 'Scan at least one piece.'; end if;
  foreach v_serial in array p_serials loop
    v_piece := public._piece(v_serial);
    if v_piece.status <> 'ACTIVE' then raise exception '% is not active (%).', v_piece.serial, v_piece.status; end if;
    if v_piece.stage <> 'READY' then raise exception '% is not Ready (it is at %).', v_piece.serial, v_piece.stage; end if;
    if v_piece.order_line_id is null then raise exception '% is not linked to an order; receive it to stock instead.', v_piece.serial; end if;
    select not l.canceled and o.status = 'OPEN' into v_open
      from public.order_lines l join public.orders o on o.id = l.order_id
     where l.id = v_piece.order_line_id;
    if not coalesce(v_open, false) then raise exception 'This order line is not open.'; end if;
    update public.pieces set stage = 'SHIPPED', stage_since = now() where id = v_piece.id;
    insert into public.piece_events (piece_id, event, from_stage, to_stage)
    values (v_piece.id, 'SHIP', 'READY', 'SHIPPED');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- dead code
-- Fed the retired "New production record" form; nothing calls it any more.
drop function public.open_order_lines_for_production();
