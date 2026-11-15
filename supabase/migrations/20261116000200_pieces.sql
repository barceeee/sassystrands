-- Station scanning, step 2: every hair piece is a row of its own (pieces), identified by a serial.
-- Replaces production records/units/events/QA inspections. The database holds no business data,
-- so the old objects are dropped rather than migrated.

-- ---------------------------------------------------------------- new tables
create table public.receipts (
  id           bigint generated always as identity primary key,
  received_at  timestamptz not null default now(),
  qty          int not null check (qty > 0),
  note         text,
  created_by   uuid references auth.users (id) on delete set null default auth.uid()
);

create table public.pieces (
  id               bigint generated always as identity primary key,
  serial           text generated always as ('SS-' || lpad(id::text, 6, '0')) stored unique,
  receipt_id       bigint references public.receipts (id) on delete set null,
  stage            text not null default 'RECEIVED' references public.production_stages (code),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'ON_HOLD', 'CANCELED')),
  item_id          bigint references public.items (id),
  order_line_id    bigint references public.order_lines (id) on delete set null,
  stage_since      timestamptz not null default now(),
  import_batch_id  bigint references public.import_batches (id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.pieces (order_line_id) where order_line_id is not null;
create index on public.pieces (stage) where status = 'ACTIVE';
create index on public.pieces (receipt_id);

create table public.piece_events (
  id            bigint generated always as identity primary key,
  piece_id      bigint not null references public.pieces (id) on delete cascade,
  event         text not null check (event in ('RECEIVED', 'IMPORTED', 'SCAN', 'QA', 'FIX', 'LINK', 'UNLINK', 'STATUS', 'SHIP', 'STOCK')),
  from_stage    text,
  to_stage      text,
  station       text,
  method        text check (method in ('scanner', 'camera', 'manual')),
  out_of_order  boolean not null default false,
  note          text,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index on public.piece_events (piece_id);

create table public.qa_results (
  id            bigint generated always as identity primary key,
  piece_id      bigint not null references public.pieces (id) on delete cascade,
  passed        boolean not null,
  defects       text,
  inspected_by  uuid references auth.users (id) on delete set null default auth.uid(),
  inspected_at  timestamptz not null default now()
);
create index on public.qa_results (piece_id);

alter table public.receipts     enable row level security;
alter table public.pieces       enable row level security;
alter table public.piece_events enable row level security;
alter table public.qa_results   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['receipts', 'pieces', 'piece_events', 'qa_results'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using ((select public.has_perm(''production.view'')))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create trigger audit after insert or update or delete on public.pieces
  for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.receipts
  for each row execute function public.audit_row();
create trigger touch before update on public.pieces
  for each row execute function public.touch_updated();

-- ---------------------------------------------------------------- stages
update public.production_stages set label = 'Received at HQ' where code = 'RECEIVED';
update public.production_stages set label = 'QA station' where code = 'FOR_QA';

-- ---------------------------------------------------------------- stock ledger link
-- v_movements selects m.*, so it must be rebuilt around the column swap.
drop view public.v_movements;
alter table public.stock_movements drop column production_id;
alter table public.stock_movements add column piece_id bigint references public.pieces (id) on delete restrict;
create view public.v_movements with (security_invoker = true) as
select m.*, i.sku, i.name as item_name, i.category, i.unit_price
  from public.stock_movements m join public.v_items i on i.id = m.item_id;

-- ---------------------------------------------------------------- read models that count pieces
create or replace function public.order_line_committed(p_line_id bigint)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select count(*) from public.pieces
                    where order_line_id = p_line_id and status <> 'CANCELED'), 0)::int
       + coalesce((select sum(qty) from public.stock_movements
                    where order_line_id = p_line_id and movement_type = 'OUT'), 0)::int
$$;

create or replace view public.v_order_lines with (security_invoker = true) as
with prod as (
  select order_line_id,
         count(*) filter (where stage = 'RECEIVED')       as allocated,
         count(*) filter (where stage in ('RSB', 'WEFTING')) as rsb_wefting,
         count(*) filter (where stage = 'VENT_MARINDUQUE') as vent_marinduque,
         count(*) filter (where stage = 'VENT_HQ_PCR')     as vent_hq_pcr,
         count(*) filter (where stage = 'VENT_HQ_FIXING')  as vent_hq_fixing,
         count(*) filter (where stage = 'CURLING')         as curling,
         count(*) filter (where stage in ('FOR_QA', 'REJECTED')) as in_qa,
         count(*) filter (where stage = 'READY')           as ready,
         count(*) filter (where stage = 'SHIPPED')         as shipped_prod,
         count(*)                                          as committed_prod
    from public.pieces
   where status <> 'CANCELED' and order_line_id is not null
   group by order_line_id
), stock as (
  select order_line_id, sum(qty) as shipped_stock
    from public.stock_movements where movement_type = 'OUT' and order_line_id is not null
   group by order_line_id
)
select l.id, l.order_id, o.order_no, o.client_id, c.name as client_name, o.status as order_status,
       l.item_id, i.sku, i.name as item_name, i.category, i.unit_price, l.group_label, l.qty_ordered,
       l.line_note, l.canceled, l.description_raw, l.source_ref,
       coalesce(p.allocated, 0)::int as allocated,
       coalesce(p.rsb_wefting, 0)::int as rsb_wefting,
       coalesce(p.vent_marinduque, 0)::int as vent_marinduque,
       coalesce(p.vent_hq_pcr, 0)::int as vent_hq_pcr,
       coalesce(p.vent_hq_fixing, 0)::int as vent_hq_fixing,
       coalesce(p.curling, 0)::int as curling,
       coalesce(p.in_qa, 0)::int as in_qa,
       coalesce(p.ready, 0)::int as ready,
       (coalesce(p.shipped_prod, 0) + coalesce(s.shipped_stock, 0))::int as shipped,
       coalesce(s.shipped_stock, 0)::int as shipped_from_stock,
       (l.qty_ordered - coalesce(p.committed_prod, 0) - coalesce(s.shipped_stock, 0))::int as remaining,
       case
         when l.canceled or o.status = 'CANCELED' then 'CANCELED'
         when coalesce(p.shipped_prod, 0) + coalesce(s.shipped_stock, 0) >= l.qty_ordered then 'FULFILLED'
         when coalesce(p.shipped_prod, 0) + coalesce(s.shipped_stock, 0) > 0 then 'PARTIALLY_SHIPPED'
         when coalesce(p.ready, 0) > 0 and coalesce(p.ready, 0) >= l.qty_ordered then 'READY_TO_SHIP'
         when coalesce(p.committed_prod, 0) > 0 then 'IN_PRODUCTION'
         else 'NOT_STARTED'
       end as line_status,
       (coalesce(p.committed_prod, 0) + coalesce(s.shipped_stock, 0) > l.qty_ordered) as over_allocated
  from public.order_lines l
  join public.orders o on o.id = l.order_id
  join public.clients c on c.id = o.client_id
  join public.v_items i on i.id = l.item_id
  left join prod p on p.order_line_id = l.id
  left join stock s on s.order_line_id = l.id;

-- Piece board for every role (client/order shown without granting access to the orders tables).
create function public.piece_board(p_serial text default null, p_include_closed boolean default false)
returns table (
  id bigint, serial text, stage text, stage_label text, stage_sort int, status text, stage_since timestamptz,
  item_id bigint, item_name text, order_line_id bigint, order_id bigint, order_no text, client_name text,
  group_label text, receipt_id bigint, last_event_at timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.serial, p.stage, ps.label, ps.sort_order, p.status, p.stage_since,
         p.item_id, i.name, p.order_line_id, o.id, o.order_no, c.name, l.group_label, p.receipt_id,
         (select max(e.created_at) from public.piece_events e where e.piece_id = p.id)
    from public.pieces p
    join public.production_stages ps on ps.code = p.stage
    left join public.v_items i on i.id = p.item_id
    left join public.order_lines l on l.id = p.order_line_id
    left join public.orders o on o.id = l.order_id
    left join public.clients c on c.id = o.client_id
   where public.has_perm('production.view')
     and (p_serial is null or p.serial = upper(btrim(p_serial)))
     and (p_serial is not null or p_include_closed or (p.stage not in ('SHIPPED', 'IN_STOCK') and p.status <> 'CANCELED'))
   order by ps.sort_order, p.id
$$;

revoke execute on function public.piece_board(text, boolean) from public, anon;
grant execute on function public.piece_board(text, boolean) to authenticated;

-- ---------------------------------------------------------------- drop the old production model
drop view public.v_qa_inspections;
drop trigger create_units on public.production_records;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('create_production_record', 'move_production', 'set_production_status',
                         'record_qa_inspection', '_split_move', '_isolate_unit', '_unit_by_serial',
                         '_create_units', 'scan_move_unit', 'scan_qa_unit')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

drop function public.production_board(bigint, boolean);
drop table public.production_units;
drop table public.qa_inspections;
drop table public.production_events;
drop table public.production_records;

delete from public.production_stages where code = 'ALLOCATED';
