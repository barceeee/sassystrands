-- production_board(): also return the order id so screens can link straight to the order.
drop function public.production_board(bigint, boolean);

create function public.production_board(p_id bigint default null, p_include_closed boolean default false)
returns table (
  id bigint, record_no text, item_id bigint, sku text, item_name text, category text, qty int, stage text,
  stage_label text, stage_sort int, status text, notes text, parent_id bigint, order_line_id bigint,
  order_id bigint, order_no text, client_name text, group_label text, source_ref text, created_at timestamptz,
  updated_at timestamptz, updated_by uuid
) language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.record_no, p.item_id, i.sku, i.name, i.category, p.qty, p.stage, ps.label, ps.sort_order,
         p.status, p.notes, p.parent_id, p.order_line_id, o.id, o.order_no, c.name, l.group_label, p.source_ref,
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

revoke execute on function public.production_board(bigint, boolean) from public, anon;
grant execute on function public.production_board(bigint, boolean) to authenticated;
