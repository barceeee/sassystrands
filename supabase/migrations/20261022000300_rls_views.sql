-- Row level security and read models.
-- No table is writable by anon. Tables whose changes carry business rules (stock_movements,
-- production_records, production_events, qa_inspections, or_numbers, import_*) have no write
-- policies at all: they change only through the functions in the previous migration.

alter table public.profiles            enable row level security;
alter table public.styles              enable row level security;
alter table public.lace_types          enable row level security;
alter table public.lace_sizes          enable row level security;
alter table public.locations           enable row level security;
alter table public.production_stages   enable row level security;
alter table public.import_batches      enable row level security;
alter table public.import_flags        enable row level security;
alter table public.items               enable row level security;
alter table public.clients             enable row level security;
alter table public.orders              enable row level security;
alter table public.order_lines         enable row level security;
alter table public.production_records  enable row level security;
alter table public.production_events   enable row level security;
alter table public.qa_inspections      enable row level security;
alter table public.stock_movements     enable row level security;
alter table public.stock_counts        enable row level security;
alter table public.sale_bundles        enable row level security;
alter table public.sale_bundle_items   enable row level security;
alter table public.or_numbers          enable row level security;
alter table public.audit_log           enable row level security;

-- profiles: you see yourself; Owner/Admin see everyone. Writes happen in the admin-users Edge Function.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.has_perm('users.manage')));

-- lookups: every active user reads; Owner/Admin/Inventory maintain.
do $$
declare t text;
begin
  foreach t in array array['styles', 'lace_types', 'lace_sizes', 'locations'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using ((select public.has_perm(''production.view'')))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check ((select public.has_perm(''lookups.manage'')))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using ((select public.has_perm(''lookups.manage'')))
                    with check ((select public.has_perm(''lookups.manage'')))', t);
  end loop;
end $$;

create policy production_stages_select on public.production_stages for select to authenticated
  using ((select public.has_perm('production.view')));

-- items: everyone reads (production/QA need product names); inventory roles maintain. No deletes; deactivate instead.
create policy items_select on public.items for select to authenticated
  using ((select public.has_perm('production.view')));
create policy items_insert on public.items for insert to authenticated
  with check ((select public.has_perm('inventory.manage')));
create policy items_update on public.items for update to authenticated
  using ((select public.has_perm('inventory.manage'))) with check ((select public.has_perm('inventory.manage')));

-- inventory ledger
create policy stock_movements_select on public.stock_movements for select to authenticated
  using ((select public.has_perm('inventory.view')));
create policy stock_counts_select on public.stock_counts for select to authenticated
  using ((select public.has_perm('inventory.view')));
create policy stock_counts_insert on public.stock_counts for insert to authenticated
  with check ((select public.has_perm('inventory.manage')) and adjustment_id is null and import_batch_id is null);

create policy sale_bundles_select on public.sale_bundles for select to authenticated
  using ((select public.has_perm('inventory.view')));
create policy sale_bundles_insert on public.sale_bundles for insert to authenticated
  with check ((select public.has_perm('inventory.manage')));
create policy sale_bundles_update on public.sale_bundles for update to authenticated
  using ((select public.has_perm('inventory.manage'))) with check ((select public.has_perm('inventory.manage')));
create policy sale_bundle_items_select on public.sale_bundle_items for select to authenticated
  using ((select public.has_perm('inventory.view')));
create policy sale_bundle_items_write on public.sale_bundle_items for all to authenticated
  using ((select public.has_perm('inventory.manage'))) with check ((select public.has_perm('inventory.manage')));

-- clients & orders
create policy clients_select on public.clients for select to authenticated
  using ((select public.has_perm('orders.view')));
create policy clients_insert on public.clients for insert to authenticated
  with check ((select public.has_perm('orders.manage')));
create policy clients_update on public.clients for update to authenticated
  using ((select public.has_perm('orders.manage'))) with check ((select public.has_perm('orders.manage')));

create policy orders_select on public.orders for select to authenticated
  using ((select public.has_perm('orders.view')));
create policy orders_insert on public.orders for insert to authenticated
  with check ((select public.has_perm('orders.manage')) and import_batch_id is null);
create policy orders_update on public.orders for update to authenticated
  using ((select public.has_perm('orders.manage'))) with check ((select public.has_perm('orders.manage')));

create policy order_lines_select on public.order_lines for select to authenticated
  using ((select public.has_perm('orders.view')));
create policy order_lines_insert on public.order_lines for insert to authenticated
  with check ((select public.has_perm('orders.manage')));
create policy order_lines_update on public.order_lines for update to authenticated
  using ((select public.has_perm('orders.manage'))) with check ((select public.has_perm('orders.manage')));
create policy order_lines_delete on public.order_lines for delete to authenticated
  using ((select public.has_perm('orders.manage')));

-- production & QA (read only; writes through functions)
create policy production_records_select on public.production_records for select to authenticated
  using ((select public.has_perm('production.view')));
create policy production_events_select on public.production_events for select to authenticated
  using ((select public.has_perm('production.view')));
create policy qa_inspections_select on public.qa_inspections for select to authenticated
  using ((select public.has_perm('production.view')));

-- OR numbers, imports, audit
create policy or_numbers_select on public.or_numbers for select to authenticated
  using ((select public.has_perm('or.manage')));
create policy import_batches_select on public.import_batches for select to authenticated
  using ((select public.has_perm('imports.manage')));
create policy import_flags_select on public.import_flags for select to authenticated
  using ((select public.has_perm('imports.manage')));
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.has_perm('reports.view')));

-- ---------------------------------------------------------------- read models (RLS of the caller applies)
create view public.v_items with (security_invoker = true) as
select i.*,
       s.label as style_label,
       lt.label as lace_type_label,
       case when i.category = 'BUNDLE'
         then i.draw || ' ' || s.label || ' ' || i.length_in || '"'
         else lower(i.lace_size) || ' ' || lt.label || ' ' || s.label || ' ' || i.length_in || '"'
       end || case when i.variant = '' then '' else ' (' || initcap(i.variant) || ')' end as name
  from public.items i
  join public.styles s on s.code = i.style
  left join public.lace_types lt on lt.code = i.lace_type;

create view public.v_stock_on_hand with (security_invoker = true) as
select i.id as item_id, i.sku, i.name, i.category, i.draw, i.style, i.style_label, i.lace_type, i.lace_size,
       i.length_in, i.variant, i.unit_price, i.reorder_level, i.active,
       coalesce(m.on_hand, 0)::int as on_hand,
       (coalesce(m.on_hand, 0) * i.unit_price)::numeric(14, 2) as stock_value,
       m.last_movement
  from public.v_items i
  left join (select item_id, sum(signed_qty) as on_hand, max(movement_date) as last_movement
               from public.stock_movements group by item_id) m on m.item_id = i.id;

create view public.v_stock_by_location with (security_invoker = true) as
select m.item_id, m.location, sum(m.signed_qty)::int as on_hand
  from public.stock_movements m group by m.item_id, m.location;

create view public.v_movements with (security_invoker = true) as
select m.*, i.sku, i.name as item_name, i.category, i.unit_price
  from public.stock_movements m join public.v_items i on i.id = m.item_id;

create view public.v_count_variance with (security_invoker = true) as
select c.*, i.sku, i.name as item_name, i.category,
       coalesce(b.balance, 0)::int as computed_qty,
       c.counted_qty - coalesce(b.balance, 0)::int as variance
  from public.stock_counts c
  join public.v_items i on i.id = c.item_id
  left join lateral (select sum(m.signed_qty) as balance from public.stock_movements m
                      where m.item_id = c.item_id and m.location = c.location
                        and m.movement_date <= c.count_date) b on true;

create view public.v_sale_bundles with (security_invoker = true) as
select b.*,
       coalesce((select sum(bi.qty) from public.sale_bundle_items bi where bi.bundle_id = b.id), 0)::int as total_qty,
       (select string_agg(bi.qty || ' × ' || i.name, '; ' order by bi.id)
          from public.sale_bundle_items bi join public.v_items i on i.id = bi.item_id
         where bi.bundle_id = b.id) as contents
  from public.sale_bundles b;

create view public.v_order_lines with (security_invoker = true) as
with prod as (
  select order_line_id,
         sum(qty) filter (where stage = 'ALLOCATED')       as allocated,
         sum(qty) filter (where stage in ('RSB', 'WEFTING')) as rsb_wefting,
         sum(qty) filter (where stage = 'VENT_MARINDUQUE') as vent_marinduque,
         sum(qty) filter (where stage = 'VENT_HQ_PCR')     as vent_hq_pcr,
         sum(qty) filter (where stage = 'VENT_HQ_FIXING')  as vent_hq_fixing,
         sum(qty) filter (where stage = 'CURLING')         as curling,
         sum(qty) filter (where stage in ('FOR_QA', 'REJECTED')) as in_qa,
         sum(qty) filter (where stage = 'READY')           as ready,
         sum(qty) filter (where stage = 'SHIPPED')         as shipped_prod,
         sum(qty)                                          as committed_prod
    from public.production_records
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

create view public.v_orders with (security_invoker = true) as
select o.id, o.order_no, o.client_id, c.name as client_name, o.order_date, o.status, o.notes, o.source_ref,
       o.import_batch_id, o.created_at, o.created_by,
       count(l.id) filter (where l.line_status <> 'CANCELED')::int as line_count,
       coalesce(sum(l.qty_ordered) filter (where l.line_status <> 'CANCELED'), 0)::int as qty_ordered,
       coalesce(sum(l.shipped) filter (where l.line_status <> 'CANCELED'), 0)::int as qty_shipped,
       coalesce(sum(l.ready) filter (where l.line_status <> 'CANCELED'), 0)::int as qty_ready,
       coalesce(sum(l.remaining) filter (where l.line_status <> 'CANCELED'), 0)::int as qty_unallocated,
       (coalesce(sum(l.qty_ordered) filter (where l.line_status <> 'CANCELED'), 0)
        - coalesce(sum(l.shipped) filter (where l.line_status <> 'CANCELED'), 0)
        - coalesce(sum(greatest(l.remaining, 0)) filter (where l.line_status <> 'CANCELED'), 0))::int as qty_in_production,
       coalesce(sum(l.qty_ordered * l.unit_price) filter (where l.line_status <> 'CANCELED'), 0)::numeric(14, 2) as order_value,
       case
         when o.status = 'CANCELED' then 'CANCELED'
         when count(l.id) filter (where l.line_status <> 'CANCELED') = 0 then 'NO_LINES'
         when bool_and(l.line_status = 'FULFILLED') filter (where l.line_status <> 'CANCELED') then 'FULFILLED'
         when bool_or(l.line_status in ('FULFILLED', 'PARTIALLY_SHIPPED')) then 'PARTIALLY_SHIPPED'
         when bool_and(l.line_status = 'READY_TO_SHIP') filter (where l.line_status <> 'CANCELED') then 'READY_TO_SHIP'
         when bool_or(l.line_status in ('IN_PRODUCTION', 'READY_TO_SHIP')) then 'IN_PRODUCTION'
         else 'NOT_STARTED'
       end as fulfillment_status,
       bool_or(l.over_allocated) as has_over_allocation
  from public.orders o
  join public.clients c on c.id = o.client_id
  left join public.v_order_lines l on l.order_id = o.id
 group by o.id, c.name;

create view public.v_qa_inspections with (security_invoker = true) as
select q.*, p.record_no, p.item_id, i.name as item_name, i.sku
  from public.qa_inspections q
  join public.production_records p on p.id = q.production_id
  join public.v_items i on i.id = p.item_id;

-- Production board for every role: production records with their product and (for order work)
-- the client and order number, without granting Production/QA access to the orders tables.
create or replace function public.production_board(p_id bigint default null, p_include_closed boolean default false)
returns table (
  id bigint, record_no text, item_id bigint, sku text, item_name text, category text, qty int, stage text,
  stage_label text, stage_sort int, status text, notes text, parent_id bigint, order_line_id bigint,
  order_no text, client_name text, group_label text, source_ref text, created_at timestamptz,
  updated_at timestamptz, updated_by uuid
) language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.record_no, p.item_id, i.sku, i.name, i.category, p.qty, p.stage, ps.label, ps.sort_order,
         p.status, p.notes, p.parent_id, p.order_line_id, o.order_no, c.name, l.group_label, p.source_ref,
         p.created_at, p.updated_at, p.updated_by
    from public.production_records p
    join public.v_items i on i.id = p.item_id
    join public.production_stages ps on ps.code = p.stage
    left join public.order_lines l on l.id = p.order_line_id
    left join public.orders o on o.id = l.order_id
    left join public.clients c on c.id = o.client_id
   where public.has_perm('production.view')
     and (p_id is null or p.id = p_id)
     and (p_id is not null or p_include_closed or (p.stage not in ('SHIPPED', 'IN_STOCK') and p.status <> 'CANCELED'))
   order by ps.sort_order, p.id
$$;

-- Open order lines that still have unallocated units, for the "new production record" picker.
create or replace function public.open_order_lines_for_production()
returns table (order_line_id bigint, order_no text, client_name text, item_id bigint, item_name text, remaining int)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, o.order_no, c.name, l.item_id, i.name,
         (l.qty_ordered - public.order_line_committed(l.id))::int
    from public.order_lines l
    join public.orders o on o.id = l.order_id
    join public.clients c on c.id = o.client_id
    join public.v_items i on i.id = l.item_id
   where public.has_perm('production.manage')
     and not l.canceled and o.status = 'OPEN'
     and l.qty_ordered - public.order_line_committed(l.id) > 0
   order by c.name, o.order_no, l.id
$$;

revoke execute on function public.production_board(bigint, boolean) from public, anon;
revoke execute on function public.open_order_lines_for_production() from public, anon;
grant execute on function public.production_board(bigint, boolean) to authenticated;
grant execute on function public.open_order_lines_for_production() to authenticated;

-- anon gets nothing at all.
revoke all on all tables in schema public from anon;
