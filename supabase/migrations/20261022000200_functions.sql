-- Permission helpers, audit triggers and the workflow functions (RPCs).
-- Every state change that has business rules goes through a SECURITY DEFINER function
-- that checks the caller's role first; tables with such rules have no write policies.

-- ---------------------------------------------------------------- permissions
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- Permission map (mirrored in src/lib/perms.js for hiding navigation):
--   users.manage                       OWNER, ADMIN
--   production.view                    every active role
--   production.manage                  OWNER, ADMIN, INVENTORY, PRODUCTION
--   qa.manage                          OWNER, ADMIN, INVENTORY, QA
--   everything else (inventory.*, orders.*, or.manage, reports.view, imports.manage, lookups.manage)
--                                      OWNER, ADMIN, INVENTORY
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when p = 'users.manage' then role in ('OWNER', 'ADMIN')
      when p = 'production.view' then true
      when p = 'production.manage' then role in ('OWNER', 'ADMIN', 'INVENTORY', 'PRODUCTION')
      when p = 'qa.manage' then role in ('OWNER', 'ADMIN', 'INVENTORY', 'QA')
      else role in ('OWNER', 'ADMIN', 'INVENTORY')
    end
    from public.profiles where id = auth.uid() and active
  ), false)
$$;

create or replace function public.require_perm(p text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_perm(p) then
    raise exception 'Permission denied (%)', p using errcode = '42501';
  end if;
end $$;

-- Names of staff for display (created_by / inspected_by columns). Any active user.
create or replace function public.staff_directory()
returns table (id uuid, username text, full_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.username, p.full_name from public.profiles p where public.has_perm('production.view')
$$;

-- ---------------------------------------------------------------- audit trail
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (actor, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(), tg_op, tg_table_name,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'items', 'stock_movements', 'stock_counts', 'sale_bundles', 'clients', 'orders',
    'order_lines', 'production_records', 'qa_inspections', 'or_numbers', 'import_batches',
    'styles', 'lace_types', 'lace_sizes', 'locations'
  ] loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

create or replace function public.touch_updated()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if tg_table_name = 'production_records' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end $$;

create trigger touch before update on public.profiles for each row execute function public.touch_updated();
create trigger touch before update on public.production_records for each row execute function public.touch_updated();

-- ---------------------------------------------------------------- orders
create or replace function public.orders_default_no()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.order_no is null or btrim(new.order_no) = '' then
    new.order_no := 'SO-' || lpad(new.id::text, 5, '0');
  end if;
  return new;
end $$;

create trigger default_no before insert on public.orders for each row execute function public.orders_default_no();

-- Units of an order line already allocated to production or shipped from stock.
create or replace function public.order_line_committed(p_line_id bigint)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select sum(qty) from public.production_records
                    where order_line_id = p_line_id and status <> 'CANCELED'), 0)::int
       + coalesce((select sum(qty) from public.stock_movements
                    where order_line_id = p_line_id and movement_type = 'OUT'), 0)::int
$$;

create or replace function public.order_lines_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_committed int;
begin
  -- Cascading deletes (e.g. rolling back an import) remove the whole order with its production records.
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  v_committed := public.order_line_committed(coalesce(new.id, old.id));
  if tg_op = 'DELETE' then
    if v_committed > 0 then
      raise exception 'This line already has production or shipments; cancel it instead of deleting.';
    end if;
    return old;
  end if;
  if new.item_id <> old.item_id and v_committed > 0 then
    raise exception 'Cannot change the product of a line that is already in production or shipped.';
  end if;
  if new.qty_ordered < v_committed then
    raise exception 'Ordered quantity (%) cannot be less than the % units already allocated or shipped.',
      new.qty_ordered, v_committed;
  end if;
  return new;
end $$;

create trigger guard before update or delete on public.order_lines
  for each row execute function public.order_lines_guard();

-- ---------------------------------------------------------------- stock
create or replace function public.item_balance(p_item_id bigint, p_location text default null, p_as_of date default null)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(signed_qty), 0)::int from public.stock_movements
   where item_id = p_item_id
     and (p_location is null or location = p_location)
     and (p_as_of is null or movement_date <= p_as_of)
$$;

create or replace function public.record_movement(
  p_item_id bigint, p_type text, p_qty int, p_date date default current_date,
  p_location text default 'HQ', p_reference text default null, p_note text default null
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; v_balance int;
begin
  perform public.require_perm('inventory.manage');
  if p_type not in ('OPENING', 'IN', 'OUT', 'ADJUST') then raise exception 'Unknown movement type %', p_type; end if;
  if p_qty is null or p_qty = 0 then raise exception 'Quantity is required.'; end if;
  if p_type <> 'ADJUST' and p_qty < 0 then raise exception 'Quantity must be positive.'; end if;
  if p_type = 'ADJUST' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Adjustments need a note explaining why.';
  end if;
  perform 1 from public.items where id = p_item_id for update;   -- serialise balance checks per item
  if not found then raise exception 'Item not found.'; end if;
  if p_type = 'OUT' or (p_type = 'ADJUST' and p_qty < 0) then
    v_balance := public.item_balance(p_item_id, p_location);
    if v_balance < abs(p_qty) then
      raise exception 'Not enough stock: % on hand at %, tried to remove %.', v_balance, p_location, abs(p_qty);
    end if;
  end if;
  insert into public.stock_movements (item_id, location, movement_type, qty, movement_date, reference, note)
  values (p_item_id, coalesce(p_location, 'HQ'), p_type, p_qty, coalesce(p_date, current_date), p_reference, p_note)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ship_from_stock(
  p_line_id bigint, p_qty int, p_location text default 'HQ', p_date date default current_date, p_note text default null
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_line record; v_balance int; v_id bigint;
begin
  perform public.require_perm('orders.manage');
  select l.*, o.order_no, o.status as order_status into v_line
    from public.order_lines l join public.orders o on o.id = l.order_id
   where l.id = p_line_id for update of l;
  if not found then raise exception 'Order line not found.'; end if;
  if v_line.canceled or v_line.order_status <> 'OPEN' then raise exception 'This order line is not open.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive.'; end if;
  if p_qty > v_line.qty_ordered - public.order_line_committed(p_line_id) then
    raise exception 'Only % units of this line are still unallocated.', v_line.qty_ordered - public.order_line_committed(p_line_id);
  end if;
  perform 1 from public.items where id = v_line.item_id for update;
  v_balance := public.item_balance(v_line.item_id, p_location);
  if v_balance < p_qty then
    raise exception 'Not enough stock: % on hand at %.', v_balance, p_location;
  end if;
  insert into public.stock_movements (item_id, location, movement_type, qty, movement_date, reference, note, order_line_id)
  values (v_line.item_id, p_location, 'OUT', p_qty, coalesce(p_date, current_date), v_line.order_no, p_note, p_line_id)
  returning id into v_id;
  return v_id;
end $$;

-- Post the difference between a count and the computed balance on the count date as an ADJUST.
create or replace function public.apply_count(p_count_id bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count record; v_diff int; v_id bigint;
begin
  perform public.require_perm('inventory.manage');
  select * into v_count from public.stock_counts where id = p_count_id for update;
  if not found then raise exception 'Count not found.'; end if;
  if v_count.adjustment_id is not null then raise exception 'This count was already applied.'; end if;
  v_diff := v_count.counted_qty - public.item_balance(v_count.item_id, v_count.location, v_count.count_date);
  if v_diff = 0 then raise exception 'Count already matches the computed balance.'; end if;
  insert into public.stock_movements (item_id, location, movement_type, qty, movement_date, reference, note)
  values (v_count.item_id, v_count.location, 'ADJUST', v_diff, v_count.count_date,
          'COUNT-' || v_count.id, 'Count reconciliation (' || coalesce(v_count.source_label, v_count.source) || ')')
  returning id into v_id;
  update public.stock_counts set adjustment_id = v_id where id = p_count_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- production
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
  insert into public.production_events (production_id, event, from_stage, to_stage, qty, note)
  values (p_id, 'SPLIT', r.stage, r.stage, p_qty, 'Split ' || p_qty || ' unit(s) into PR-' || lpad(v_new::text, 5, '0'));
  insert into public.production_events (production_id, event, from_stage, to_stage, qty, note)
  values (v_new, p_event, r.stage, p_to_stage, p_qty,
          coalesce(p_note || ' — ', '') || 'split from ' || r.record_no);
  return v_new;
end $$;

create or replace function public.create_production_record(
  p_item_id bigint, p_qty int, p_order_line_id bigint default null,
  p_stage text default 'ALLOCATED', p_notes text default null
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_line record; v_item bigint := p_item_id; v_id bigint;
begin
  perform public.require_perm('production.manage');
  if not exists (select 1 from public.production_stages where code = p_stage and production_can_set) then
    raise exception 'New records must start in a production stage (not %).', p_stage;
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive.'; end if;
  if p_order_line_id is not null then
    select l.*, o.status as order_status into v_line
      from public.order_lines l join public.orders o on o.id = l.order_id
     where l.id = p_order_line_id for update of l;
    if not found then raise exception 'Order line not found.'; end if;
    if v_line.canceled or v_line.order_status <> 'OPEN' then raise exception 'This order line is not open.'; end if;
    if p_qty > v_line.qty_ordered - public.order_line_committed(p_order_line_id) then
      raise exception 'Only % units of this line are still unallocated.',
        v_line.qty_ordered - public.order_line_committed(p_order_line_id);
    end if;
    v_item := v_line.item_id;
  end if;
  if v_item is null then raise exception 'Choose a product.'; end if;
  insert into public.production_records (order_line_id, item_id, qty, stage, notes)
  values (p_order_line_id, v_item, p_qty, p_stage, p_notes)
  returning id into v_id;
  insert into public.production_events (production_id, event, to_stage, qty, note)
  values (v_id, 'CREATED', p_stage, p_qty, p_notes);
  return v_id;
end $$;

-- Move all (p_qty null) or part of a record to another stage. Partial moves split the record.
--   Production stages (ALLOCATED … FOR_QA): production.manage; the Production role cannot pull
--     records back out of FOR_QA or READY (those belong to QA / inventory).
--   READY / REJECTED: only through record_qa_inspection.
--   SHIPPED (order records) and IN_STOCK (stock records, posts an IN movement): inventory.manage, from READY.
create or replace function public.move_production(
  p_id bigint, p_to_stage text, p_qty int default null, p_note text default null, p_location text default 'HQ'
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_target record; v_id bigint; v_manager boolean := public.has_perm('inventory.manage');
begin
  select * into v_target from public.production_stages where code = p_to_stage;
  if not found then raise exception 'Unknown stage %.', p_to_stage; end if;
  select * into r from public.production_records where id = p_id for update;
  if not found then raise exception 'Production record not found.'; end if;
  if r.status <> 'ACTIVE' then raise exception 'Record % is %; reactivate it first.', r.record_no, lower(r.status); end if;
  if r.stage = p_to_stage then raise exception 'Record is already in that stage.'; end if;
  if r.stage in ('SHIPPED', 'IN_STOCK') then raise exception 'Record % is already completed.', r.record_no; end if;
  if p_to_stage in ('READY', 'REJECTED') then
    raise exception 'Use a QA inspection to approve or reject finished products.';
  end if;

  if p_to_stage in ('SHIPPED', 'IN_STOCK') then
    perform public.require_perm('inventory.manage');
    if r.stage <> 'READY' then raise exception 'Only QA-approved (Ready) records can be %.', lower(v_target.label); end if;
    if p_to_stage = 'SHIPPED' and r.order_line_id is null then
      raise exception 'This record is not for a client order; receive it to stock instead.';
    end if;
    if p_to_stage = 'IN_STOCK' and r.order_line_id is not null then
      raise exception 'This record belongs to a client order; ship it instead.';
    end if;
  else
    perform public.require_perm('production.manage');
    if not v_manager and r.stage in ('FOR_QA', 'READY') then
      raise exception 'Record % is with QA / ready; production cannot move it back.', r.record_no;
    end if;
  end if;

  v_id := public._split_move(p_id, p_to_stage, p_qty, 'MOVED', p_note);

  if p_to_stage = 'IN_STOCK' then
    insert into public.stock_movements (item_id, location, movement_type, qty, movement_date, reference, note, production_id)
    select item_id, coalesce(p_location, 'HQ'), 'IN', qty, current_date, record_no, 'Received from production', id
      from public.production_records where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.set_production_status(p_id bigint, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  perform public.require_perm('production.manage');
  if p_status not in ('ACTIVE', 'ON_HOLD', 'CANCELED') then raise exception 'Unknown status %.', p_status; end if;
  select * into r from public.production_records where id = p_id for update;
  if not found then raise exception 'Production record not found.'; end if;
  if r.stage in ('SHIPPED', 'IN_STOCK') then raise exception 'Completed records cannot change status.'; end if;
  if r.status = 'CANCELED' and not public.has_perm('inventory.manage') then
    raise exception 'Only Owner/Admin/Inventory can reopen a canceled record.';
  end if;
  if p_status = 'CANCELED' and coalesce(btrim(p_note), '') = '' then raise exception 'Give a reason for canceling.'; end if;
  update public.production_records set status = p_status where id = p_id;
  insert into public.production_events (production_id, event, from_stage, to_stage, qty, note)
  values (p_id, 'STATUS', r.stage, r.stage, r.qty, r.status || ' → ' || p_status || coalesce(': ' || p_note, ''));
end $$;

create or replace function public.record_qa_inspection(
  p_id bigint, p_passed int, p_rejected int, p_defects text default null, p_note text default null
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_id bigint;
begin
  perform public.require_perm('qa.manage');
  select * into r from public.production_records where id = p_id for update;
  if not found then raise exception 'Production record not found.'; end if;
  if r.stage <> 'FOR_QA' or r.status <> 'ACTIVE' then raise exception 'Record % is not awaiting QA.', r.record_no; end if;
  p_passed := coalesce(p_passed, 0); p_rejected := coalesce(p_rejected, 0);
  if p_passed < 0 or p_rejected < 0 or p_passed + p_rejected = 0 or p_passed + p_rejected > r.qty then
    raise exception 'Passed + rejected must be between 1 and % (units in this record).', r.qty;
  end if;
  if p_rejected > 0 and coalesce(btrim(p_defects), '') = '' then raise exception 'Describe the defects for rejected units.'; end if;
  insert into public.qa_inspections (production_id, passed_qty, rejected_qty, defects, note)
  values (p_id, p_passed, p_rejected, p_defects, p_note) returning id into v_id;
  if p_rejected > 0 then
    perform public._split_move(p_id, 'REJECTED', case when p_rejected = r.qty then null else p_rejected end,
                               'QA', 'Rejected: ' || p_defects);
  end if;
  if p_passed > 0 then
    perform public._split_move(p_id, 'READY', case when p_passed = r.qty - p_rejected then null else p_passed end,
                               'QA', coalesce('Approved: ' || p_note, 'Approved'));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- OR numbers
create or replace function public.register_or_range(p_prefix text, p_start bigint, p_end bigint, p_pad int default 0)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  perform public.require_perm('or.manage');
  if p_start is null or p_end is null or p_start <= 0 or p_end < p_start then raise exception 'Enter a valid range.'; end if;
  if p_end - p_start >= 5000 then raise exception 'Register at most 5000 numbers at a time.'; end if;
  insert into public.or_numbers (or_no, seq)
  select coalesce(p_prefix, '') || lpad(n::text, greatest(coalesce(p_pad, 0), length(n::text)), '0'), n
    from generate_series(p_start, p_end) n
  on conflict (or_no) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.issue_or(
  p_id bigint, p_issued_on date, p_amount numeric, p_payer text, p_order_id bigint default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  perform public.require_perm('or.manage');
  select * into r from public.or_numbers where id = p_id for update;
  if not found then raise exception 'OR number not found.'; end if;
  if r.status <> 'AVAILABLE' then raise exception 'OR % is already %.', r.or_no, lower(r.status); end if;
  if coalesce(btrim(p_payer), '') = '' and p_order_id is null then raise exception 'Enter the payer or choose an order.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter the amount.'; end if;
  update public.or_numbers
     set status = 'ISSUED', issued_on = coalesce(p_issued_on, current_date), amount = p_amount,
         payer = coalesce(nullif(btrim(p_payer), ''),
                          (select c.name from public.orders o join public.clients c on c.id = o.client_id where o.id = p_order_id)),
         order_id = p_order_id, issued_by = auth.uid(), issued_at = now()
   where id = p_id;
end $$;

create or replace function public.void_or(p_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  perform public.require_perm('or.manage');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for voiding.'; end if;
  select * into r from public.or_numbers where id = p_id for update;
  if not found then raise exception 'OR number not found.'; end if;
  if r.status = 'VOIDED' then raise exception 'OR % is already voided.', r.or_no; end if;
  update public.or_numbers set status = 'VOIDED', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
   where id = p_id;
end $$;

-- ---------------------------------------------------------------- import
create or replace function public._ensure_item(p jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; v_size text := nullif(p ->> 'lace_size', '');
begin
  if v_size is not null and not exists (select 1 from public.lace_sizes where code = v_size) then
    insert into public.lace_sizes (code, label, is_standard, sort_order) values (v_size, lower(v_size), false, 200);
  end if;
  insert into public.items (category, draw, style, lace_type, lace_size, length_in, variant, unit_price)
  values (p ->> 'category', nullif(p ->> 'draw', ''), p ->> 'style', nullif(p ->> 'lace_type', ''), v_size,
          (p ->> 'length_in')::int, coalesce(p ->> 'variant', ''), (p ->> 'unit_price')::numeric)
  on conflict (sku) do update
    set unit_price = coalesce(public.items.unit_price, excluded.unit_price)
  returning id into v_id;
  return v_id;
end $$;

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
        insert into public.production_records (order_line_id, item_id, qty, stage, source_ref, import_batch_id)
        values (v_line, (v_items ->> (l ->> 'item'))::bigint, (s ->> 'qty')::int, s ->> 'stage', l ->> 'ref', v_batch)
        returning id into v_prod;
        insert into public.production_events (production_id, event, to_stage, qty, note)
        values (v_prod, 'IMPORTED', s ->> 'stage', (s ->> 'qty')::int, 'Imported from ' || p_file_name || ' ' || (l ->> 'ref'));
      end loop;
    end loop;
  end loop;

  insert into public.import_flags (batch_id, sheet, row_num, cell, severity, code, message, outcome, raw)
  select v_batch, f ->> 'sheet', (f ->> 'row')::int, f ->> 'cell', f ->> 'severity', f ->> 'code', f ->> 'message',
         f ->> 'outcome', f -> 'raw'
    from jsonb_array_elements(coalesce(p_payload -> 'flags', '[]')) f;

  return v_batch;
end $$;

create or replace function public.delete_import_batch(p_batch_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_perm('imports.manage');
  delete from public.import_batches where id = p_batch_id;
  if not found then raise exception 'Import not found.'; end if;
exception when foreign_key_violation then
  raise exception 'Cannot delete this import: stock was shipped or received against its orders/production records since it was imported.';
end $$;

create or replace function public.resolve_import_flag(p_flag_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_perm('imports.manage');
  update public.import_flags
     set resolved = true, resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
   where id = p_flag_id;
end $$;

-- ---------------------------------------------------------------- function privileges
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._split_move(bigint, text, int, text, text) from authenticated;
revoke execute on function public._ensure_item(jsonb) from authenticated;
revoke execute on function public.audit_row() from authenticated;
revoke execute on function public.touch_updated() from authenticated;
revoke execute on function public.orders_default_no() from authenticated;
revoke execute on function public.order_lines_guard() from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
