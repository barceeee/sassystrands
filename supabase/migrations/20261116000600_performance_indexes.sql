-- Performance: indexes for the foreign keys the app actually joins or filters on, and one RLS fix.
-- "created_by"-style audit columns are deliberately left unindexed: nothing searches by them, and each
-- extra index slows every insert.

-- Orders and order lines (order pages, v_order_lines, reports)
create index if not exists order_lines_item_id_idx on public.order_lines (item_id);
create index if not exists orders_client_id_idx on public.orders (client_id);
create index if not exists orders_import_batch_id_idx on public.orders (import_batch_id) where import_batch_id is not null;
create index if not exists or_numbers_order_id_idx on public.or_numbers (order_id) where order_id is not null;

-- Pieces (import labels, product lookups) and the leader dashboard's scan counts per station
create index if not exists pieces_item_id_idx on public.pieces (item_id) where item_id is not null;
create index if not exists pieces_import_batch_id_idx on public.pieces (import_batch_id) where import_batch_id is not null;
create index if not exists piece_events_station_scans_idx on public.piece_events (station, created_at) where event = 'SCAN';

-- Stock (balances by location, import rollback, piece lookups)
create index if not exists stock_movements_location_idx on public.stock_movements (location);
create index if not exists stock_movements_piece_id_idx on public.stock_movements (piece_id) where piece_id is not null;
create index if not exists stock_movements_import_batch_id_idx on public.stock_movements (import_batch_id) where import_batch_id is not null;
create index if not exists stock_counts_location_idx on public.stock_counts (location);
create index if not exists stock_counts_import_batch_id_idx on public.stock_counts (import_batch_id) where import_batch_id is not null;

-- Sale bundles
create index if not exists sale_bundles_order_id_idx on public.sale_bundles (order_id) where order_id is not null;
create index if not exists sale_bundles_import_batch_id_idx on public.sale_bundles (import_batch_id) where import_batch_id is not null;
create index if not exists sale_bundle_items_item_id_idx on public.sale_bundle_items (item_id);

-- sale_bundle_items had two permissive policies for SELECT (the read policy plus a FOR ALL write policy),
-- so every read evaluated both. Split the write policy into insert/update/delete only.
drop policy if exists sale_bundle_items_write on public.sale_bundle_items;
create policy sale_bundle_items_insert on public.sale_bundle_items for insert to authenticated
  with check ((select public.has_perm('inventory.manage')));
create policy sale_bundle_items_update on public.sale_bundle_items for update to authenticated
  using ((select public.has_perm('inventory.manage'))) with check ((select public.has_perm('inventory.manage')));
create policy sale_bundle_items_delete on public.sale_bundle_items for delete to authenticated
  using ((select public.has_perm('inventory.manage')));
