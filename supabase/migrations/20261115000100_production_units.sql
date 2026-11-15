-- One serial number (barcode) per physical piece of hair.
-- Every production record holds `qty` units; each unit has its own serial (SS-000001 …).
-- Units follow their piece through splits, so a serial always points at the record it is in now.
-- Scanning a serial isolates that one piece into its own record (if it shared one) and then
-- moves it with the existing move_production / record_qa_inspection rules.

create table public.production_units (
  id             bigint generated always as identity primary key,
  serial         text generated always as ('SS-' || lpad(id::text, 6, '0')) stored unique,
  production_id  bigint not null references public.production_records (id) on delete cascade,
  created_at     timestamptz not null default now()
);
create index on public.production_units (production_id);

alter table public.production_units enable row level security;
create policy production_units_select on public.production_units for select to authenticated
  using ((select public.has_perm('production.view')));
grant select on public.production_units to authenticated;

-- New top-level records (created or imported) get one unit per piece. Split-off records
-- (parent_id set) receive units moved from their parent in _split_move instead.
create or replace function public._create_units()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.parent_id is null then
    insert into public.production_units (production_id) select new.id from generate_series(1, new.qty);
  end if;
  return new;
end $$;

create trigger create_units after insert on public.production_records
  for each row execute function public._create_units();

-- Backfill any records that existed before this migration.
insert into public.production_units (production_id)
select r.id from public.production_records r cross join lateral generate_series(1, r.qty)
 where not exists (select 1 from public.production_units u where u.production_id = r.id)
 order by r.id;

-- Same as before, plus: a partial move hands p_qty units (highest serials) to the new record.
create or replace function public._split_move(p_id bigint, p_to_stage text, p_qty int, p_event text, p_note text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_new bigint;
begin
  select * into r from public.production_records where id = p_id for update;
  if p_qty is null or p_qty = r.qty then
    update public.production_records set stage = p_to_stage where id = p_id;
    insert into public.production_events (production_id, event, from_stage, to_stage, qty, note)
    values (p_id, p_event, r.stage, p_to_stage, r.qty, p_note);
    return p_id;
  end if;
  if p_qty <= 0 or p_qty > r.qty then
    raise exception 'Quantity must be between 1 and %.', r.qty;
  end if;
  update public.production_records set qty = qty - p_qty where id = p_id;
  insert into public.production_records (order_line_id, item_id, qty, stage, status, parent_id, notes)
  values (r.order_line_id, r.item_id, p_qty, p_to_stage, 'ACTIVE', p_id, r.notes)
  returning id into v_new;
  update public.production_units set production_id = v_new
   where id in (select id from public.production_units where production_id = p_id order by id desc limit p_qty);
  insert into public.production_events (production_id, event, from_stage, to_stage, qty, note)
  values (p_id, 'SPLIT', r.stage, r.stage, p_qty, 'Split ' || p_qty || ' unit(s) into PR-' || lpad(v_new::text, 5, '0'));
  insert into public.production_events (production_id, event, from_stage, to_stage, qty, note)
  values (v_new, p_event, r.stage, p_to_stage, p_qty,
          coalesce(p_note || ' — ', '') || 'split from ' || r.record_no);
  return v_new;
end $$;

-- Puts one unit into a record of its own (same stage) and returns that record's id.
create or replace function public._isolate_unit(p_unit_id bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare u record; r record; v_new bigint;
begin
  select * into u from public.production_units where id = p_unit_id for update;
  select * into r from public.production_records where id = u.production_id for update;
  if r.qty = 1 then return r.id; end if;
  update public.production_records set qty = qty - 1 where id = r.id;
  insert into public.production_records (order_line_id, item_id, qty, stage, status, parent_id, notes)
  values (r.order_line_id, r.item_id, 1, r.stage, r.status, r.id, r.notes)
  returning id into v_new;
  update public.production_units set production_id = v_new where id = p_unit_id;
  insert into public.production_events (production_id, event, from_stage, to_stage, qty, note)
  values (r.id, 'SPLIT', r.stage, r.stage, 1, 'Scanned ' || u.serial || ' split into PR-' || lpad(v_new::text, 5, '0'));
  insert into public.production_events (production_id, event, from_stage, to_stage, qty, note)
  values (v_new, 'SPLIT', r.stage, r.stage, 1, 'Scanned ' || u.serial || ', split from ' || r.record_no);
  return v_new;
end $$;

create or replace function public._unit_by_serial(p_serial text)
returns public.production_units language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.production_units;
begin
  select * into u from public.production_units where serial = upper(btrim(p_serial)) for update;
  if not found then raise exception 'No piece with serial %.', upper(btrim(p_serial)); end if;
  return u;
end $$;

-- Scan: move one piece to a stage. Same permission rules as move_production.
create or replace function public.scan_move_unit(
  p_serial text, p_to_stage text, p_note text default null, p_location text default 'HQ'
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.production_units; r record;
begin
  perform public.require_perm('production.view');
  u := public._unit_by_serial(p_serial);
  select * into r from public.production_records where id = u.production_id;
  if r.stage = p_to_stage then raise exception 'This piece is already in that stage.'; end if;
  return public.move_production(public._isolate_unit(u.id), p_to_stage, null,
                                coalesce(p_note || ' — ', '') || 'scanned ' || u.serial, p_location);
end $$;

-- Scan: approve or reject one piece awaiting QA. Same rules as record_qa_inspection.
create or replace function public.scan_qa_unit(
  p_serial text, p_passed boolean, p_defects text default null, p_note text default null
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.production_units; v_rec bigint;
begin
  perform public.require_perm('qa.manage');
  u := public._unit_by_serial(p_serial);
  v_rec := public._isolate_unit(u.id);
  perform public.record_qa_inspection(v_rec, case when p_passed then 1 else 0 end, case when p_passed then 0 else 1 end,
                                      p_defects, coalesce(p_note || ' — ', '') || 'scanned ' || u.serial);
  return v_rec;
end $$;

revoke execute on function public._create_units() from public, anon, authenticated;
revoke execute on function public._isolate_unit(bigint) from public, anon, authenticated;
revoke execute on function public._unit_by_serial(text) from public, anon, authenticated;
revoke execute on function public._split_move(bigint, text, int, text, text) from public, anon, authenticated;
revoke execute on function public.scan_move_unit(text, text, text, text) from public, anon;
revoke execute on function public.scan_qa_unit(text, boolean, text, text) from public, anon;
grant execute on function public.scan_move_unit(text, text, text, text) to authenticated;
grant execute on function public.scan_qa_unit(text, boolean, text, text) to authenticated;
