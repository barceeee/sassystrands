-- Station scanning, step 3: the only functions that receive hair and move pieces between stations.

-- Tighten the new tables: RLS already blocks writes, but also drop Supabase's default write grants.
revoke all on public.pieces, public.receipts, public.piece_events, public.qa_results from anon, authenticated;
grant select on public.pieces, public.receipts, public.piece_events, public.qa_results to authenticated;

-- ---------------------------------------------------------------- helpers
-- Locks and returns the piece for a scanned/typed serial (strips the ]C0 scanner prefix, case/space-insensitive).
create function public._piece(p_serial text)
returns public.pieces language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_serial text := upper(btrim(regexp_replace(btrim(coalesce(p_serial, '')), '^\]C0', '')));
  v_piece  public.pieces;
begin
  select * into v_piece from public.pieces where serial = v_serial for update;
  if not found then raise exception 'No piece with serial %.', v_serial; end if;
  return v_piece;
end $$;

create function public._piece_json(p_serial text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(b) from public.piece_board(p_serial) b
$$;

-- Sort order of the station stage immediately before p_stage (RECEIVED counts as before RSB).
create function public._prev_station_sort(p_stage text)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select max(sort_order) from public.production_stages
   where code in ('RECEIVED', 'RSB', 'WEFTING', 'VENT_MARINDUQUE', 'VENT_HQ_PCR', 'VENT_HQ_FIXING', 'CURLING', 'FOR_QA')
     and sort_order < (select sort_order from public.production_stages where code = p_stage)
$$;

-- ---------------------------------------------------------------- receiving
create function public.receive_pieces(p_qty int, p_note text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_receipt bigint;
begin
  perform public.require_perm('receiving.manage');
  if p_qty is null or p_qty < 1 or p_qty > 500 then
    raise exception 'Quantity must be between 1 and 500.';
  end if;
  insert into public.receipts (qty, note) values (p_qty, nullif(btrim(p_note), ''))
    returning id into v_receipt;
  with new_pieces as (
    insert into public.pieces (receipt_id)
    select v_receipt from generate_series(1, p_qty)
    returning id
  )
  insert into public.piece_events (piece_id, event, to_stage, note)
  select id, 'RECEIVED', 'RECEIVED', nullif(btrim(p_note), '') from new_pieces;
  return v_receipt;
end $$;

-- ---------------------------------------------------------------- station scan
create function public.station_scan(p_serial text, p_method text)
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

-- ---------------------------------------------------------------- QA
create function public.qa_result(p_serial text, p_passed boolean, p_defects text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_piece public.pieces;
  v_to    text;
begin
  perform public.require_perm('station.scan');
  if public.my_station() is distinct from 'FOR_QA' then
    raise exception 'Only the QA station can record QA results.' using errcode = '42501';
  end if;
  if p_passed is null then raise exception 'Pass or reject is required.'; end if;
  if not p_passed and coalesce(btrim(p_defects), '') = '' then
    raise exception 'Describe the defects when rejecting a piece.';
  end if;
  v_piece := public._piece(p_serial);
  if v_piece.status <> 'ACTIVE' then
    raise exception '% is not active (%).', v_piece.serial, v_piece.status;
  end if;
  if v_piece.stage <> 'FOR_QA' then
    raise exception '% is not at the QA station.', v_piece.serial;
  end if;
  v_to := case when p_passed then 'READY' else 'REJECTED' end;
  insert into public.qa_results (piece_id, passed, defects)
  values (v_piece.id, p_passed, case when p_passed then null else btrim(p_defects) end);
  update public.pieces set stage = v_to, stage_since = now() where id = v_piece.id;
  insert into public.piece_events (piece_id, event, from_stage, to_stage, station, note)
  values (v_piece.id, 'QA', 'FOR_QA', v_to, 'FOR_QA', case when p_passed then null else btrim(p_defects) end);
  return public._piece_json(v_piece.serial);
end $$;

-- ---------------------------------------------------------------- leader fix
create function public.leader_fix(p_serial text, p_to_stage text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_piece public.pieces;
begin
  perform public.require_perm('station.lead');
  if p_to_stage is null or p_to_stage not in ('RECEIVED', 'RSB', 'WEFTING', 'VENT_MARINDUQUE', 'VENT_HQ_PCR', 'VENT_HQ_FIXING', 'CURLING', 'FOR_QA') then
    raise exception 'A piece can only be moved to Received or a station stage.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required for a fix.';
  end if;
  v_piece := public._piece(p_serial);
  if v_piece.status = 'CANCELED' then
    raise exception '% is canceled.', v_piece.serial;
  end if;
  if v_piece.stage in ('SHIPPED', 'IN_STOCK') then
    raise exception '% is already finished.', v_piece.serial;
  end if;
  if v_piece.stage = p_to_stage then
    raise exception '% is already at %.', v_piece.serial, p_to_stage;
  end if;
  update public.pieces set stage = p_to_stage, stage_since = now() where id = v_piece.id;
  insert into public.piece_events (piece_id, event, from_stage, to_stage, station, note)
  values (v_piece.id, 'FIX', v_piece.stage, p_to_stage, public.my_station(), btrim(p_reason));
  return public._piece_json(v_piece.serial);
end $$;

-- ---------------------------------------------------------------- hold / cancel / reactivate
create function public.set_piece_status(p_serial text, p_status text, p_reason text default null)
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

-- ---------------------------------------------------------------- privileges
revoke execute on function public._piece(text), public._piece_json(text), public._prev_station_sort(text)
  from public, anon, authenticated;
revoke execute on function public.receive_pieces(int, text), public.station_scan(text, text),
  public.qa_result(text, boolean, text), public.leader_fix(text, text, text),
  public.set_piece_status(text, text, text) from public, anon;
grant execute on function public.receive_pieces(int, text), public.station_scan(text, text),
  public.qa_result(text, boolean, text), public.leader_fix(text, text, text),
  public.set_piece_status(text, text, text) to authenticated;
