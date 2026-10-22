-- Sassy Strands inventory & production tracker: core schema.
-- Totals are never stored; balances, values and order progress are computed in views.

-- ---------------------------------------------------------------- users
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name   text not null,
  role        text not null check (role in ('OWNER', 'ADMIN', 'INVENTORY', 'PRODUCTION', 'QA')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- controlled lookups
create table public.styles (
  code        text primary key check (code ~ '^[A-Z0-9_]+$'),
  label       text not null,
  sort_order  int not null default 100,
  active      boolean not null default true
);

create table public.lace_types (
  code        text primary key check (code ~ '^[A-Z0-9_]+$'),
  label       text not null,
  sort_order  int not null default 100,
  active      boolean not null default true
);

create table public.lace_sizes (
  code        text primary key check (code ~ '^[0-9]{1,2}X[0-9]{1,2}$'),
  label       text not null,
  is_standard boolean not null default true,
  sort_order  int not null default 100,
  active      boolean not null default true
);

create table public.locations (
  code        text primary key check (code ~ '^[A-Z0-9_]+$'),
  label       text not null,
  sort_order  int not null default 100,
  active      boolean not null default true
);

create table public.production_stages (
  code        text primary key,
  label       text not null,
  sort_order  int not null,
  -- stages the Production role may move a record into
  production_can_set boolean not null default false
);

-- ---------------------------------------------------------------- import bookkeeping
create table public.import_batches (
  id           bigint generated always as identity primary key,
  file_kind    text not null check (file_kind in ('TRACKER', 'LEDGER', 'ORDERS')),
  file_name    text not null,
  file_sha256  text not null unique,
  summary      jsonb not null default '{}',
  imported_by  uuid references auth.users (id) on delete set null default auth.uid(),
  imported_at  timestamptz not null default now()
);

-- One row per problem found while importing. Rows that imported cleanly are not listed.
create table public.import_flags (
  id               bigint generated always as identity primary key,
  batch_id         bigint not null references public.import_batches (id) on delete cascade,
  sheet            text not null,
  row_num          int,
  cell             text,
  severity         text not null check (severity in ('INFO', 'WARNING', 'ERROR')),
  code             text not null,
  message          text not null,
  outcome          text not null check (outcome in ('IMPORTED', 'IMPORTED_WITH_ASSUMPTION', 'NOT_IMPORTED')),
  raw              jsonb,
  resolved         boolean not null default false,
  resolved_by      uuid references auth.users (id) on delete set null,
  resolved_at      timestamptz,
  resolution_note  text
);
create index on public.import_flags (batch_id);

-- ---------------------------------------------------------------- items
create table public.items (
  id            bigint generated always as identity primary key,
  category      text not null check (category in ('BUNDLE', 'CLOSURE')),
  draw          text check (draw in ('SD', 'DD')),
  style         text not null references public.styles (code),
  lace_type     text references public.lace_types (code),
  lace_size     text references public.lace_sizes (code),
  length_in     int not null check (length_in between 1 and 40),
  variant       text not null default '' check (variant = upper(variant)),
  sku           text generated always as (
                  case when category = 'BUNDLE'
                    then coalesce(draw, '?') || '-' || style || '-' || length_in::text
                    else 'CL-' || coalesce(lace_type, '?') || '-' || coalesce(lace_size, '?') || '-' || style || '-' || length_in::text
                  end || case when variant = '' then '' else '-' || replace(variant, ' ', '_') end
                ) stored unique,
  unit_price    numeric(12, 2) check (unit_price >= 0),
  reorder_level int not null default 0 check (reorder_level >= 0),
  active        boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  check (category <> 'BUNDLE' or (draw is not null and lace_type is null and lace_size is null)),
  check (category <> 'CLOSURE' or (lace_type is not null and lace_size is not null))
);

-- ---------------------------------------------------------------- clients & orders
create table public.clients (
  id          bigint generated always as identity primary key,
  name        text not null check (name = btrim(name) and name <> ''),
  notes       text,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index clients_name_key on public.clients (upper(name));

create table public.orders (
  id               bigint generated always as identity primary key,
  order_no         text not null unique,
  client_id        bigint not null references public.clients (id),
  order_date       date,
  status           text not null default 'OPEN' check (status in ('OPEN', 'CANCELED', 'CLOSED')),
  notes            text,
  source_ref       text,
  import_batch_id  bigint references public.import_batches (id) on delete cascade,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);

create table public.order_lines (
  id               bigint generated always as identity primary key,
  order_id         bigint not null references public.orders (id) on delete cascade,
  item_id          bigint not null references public.items (id),
  group_label      text,
  qty_ordered      int not null check (qty_ordered > 0),
  line_note        text,
  canceled         boolean not null default false,
  description_raw  text,
  source_ref       text,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);
create index on public.order_lines (order_id);

-- ---------------------------------------------------------------- production & QA
create table public.production_records (
  id               bigint generated always as identity primary key,
  record_no        text generated always as ('PR-' || lpad(id::text, 5, '0')) stored unique,
  order_line_id    bigint references public.order_lines (id) on delete cascade,
  item_id          bigint not null references public.items (id),
  qty              int not null check (qty > 0),
  stage            text not null references public.production_stages (code),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'ON_HOLD', 'CANCELED')),
  parent_id        bigint references public.production_records (id) on delete set null,
  notes            text,
  source_ref       text,
  import_batch_id  bigint references public.import_batches (id) on delete cascade,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at       timestamptz not null default now()
);
create index on public.production_records (order_line_id);
create index on public.production_records (stage) where status = 'ACTIVE';

create table public.production_events (
  id             bigint generated always as identity primary key,
  production_id  bigint not null references public.production_records (id) on delete cascade,
  event          text not null check (event in ('CREATED', 'MOVED', 'SPLIT', 'STATUS', 'QA', 'IMPORTED')),
  from_stage     text,
  to_stage       text,
  qty            int,
  note           text,
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index on public.production_events (production_id);

create table public.qa_inspections (
  id             bigint generated always as identity primary key,
  production_id  bigint not null references public.production_records (id) on delete cascade,
  passed_qty     int not null check (passed_qty >= 0),
  rejected_qty   int not null check (rejected_qty >= 0),
  inspected_qty  int generated always as (passed_qty + rejected_qty) stored,
  result         text generated always as (
                   case when rejected_qty = 0 then 'APPROVED'
                        when passed_qty = 0 then 'REJECTED'
                        else 'PARTIAL' end
                 ) stored,
  defects        text,
  note           text,
  inspected_by   uuid references auth.users (id) on delete set null default auth.uid(),
  inspected_at   timestamptz not null default now(),
  check (passed_qty + rejected_qty > 0)
);
create index on public.qa_inspections (production_id);

-- ---------------------------------------------------------------- inventory ledger
create table public.stock_movements (
  id               bigint generated always as identity primary key,
  item_id          bigint not null references public.items (id),
  location         text not null default 'HQ' references public.locations (code),
  movement_type    text not null check (movement_type in ('OPENING', 'IN', 'OUT', 'ADJUST')),
  qty              int not null check (qty <> 0 and (movement_type = 'ADJUST' or qty > 0)),
  signed_qty       int generated always as (case when movement_type = 'OUT' then -qty else qty end) stored,
  movement_date    date not null default current_date,
  reference        text,
  note             text,
  order_line_id    bigint references public.order_lines (id) on delete restrict,
  production_id    bigint references public.production_records (id) on delete restrict,
  source_ref       text,
  import_batch_id  bigint references public.import_batches (id) on delete cascade,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);
create index on public.stock_movements (item_id, location, movement_date);
create index on public.stock_movements (order_line_id) where order_line_id is not null;

-- Physical counts and spreadsheet snapshots. They never change balances by themselves;
-- reconciliation compares them with the computed balance and can post an ADJUST.
create table public.stock_counts (
  id               bigint generated always as identity primary key,
  item_id          bigint not null references public.items (id),
  location         text not null default 'HQ' references public.locations (code),
  count_date       date not null,
  counted_qty      int not null check (counted_qty >= 0),
  unit_price       numeric(12, 2),
  source           text not null check (source in ('AUDIT', 'SNAPSHOT', 'LEDGER', 'MANUAL')),
  source_label     text,
  note             text,
  adjustment_id    bigint references public.stock_movements (id) on delete set null,
  source_ref       text,
  import_batch_id  bigint references public.import_batches (id) on delete cascade,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);
create index on public.stock_counts (item_id, count_date);

create table public.sale_bundles (
  id               bigint generated always as identity primary key,
  code             text not null unique,
  price            numeric(12, 2) check (price >= 0),
  status           text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'SOLD')),
  sold_on          date,
  order_id         bigint references public.orders (id) on delete set null,
  note             text,
  source_ref       text,
  import_batch_id  bigint references public.import_batches (id) on delete cascade,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);

create table public.sale_bundle_items (
  id         bigint generated always as identity primary key,
  bundle_id  bigint not null references public.sale_bundles (id) on delete cascade,
  item_id    bigint not null references public.items (id),
  qty        int not null check (qty > 0)
);
create index on public.sale_bundle_items (bundle_id);

-- ---------------------------------------------------------------- OR numbers
create table public.or_numbers (
  id           bigint generated always as identity primary key,
  or_no        text not null unique,
  seq          bigint not null,
  status       text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'ISSUED', 'VOIDED')),
  order_id     bigint references public.orders (id) on delete restrict,
  amount       numeric(12, 2) check (amount >= 0),
  payer        text,
  issued_on    date,
  issued_by    uuid references auth.users (id) on delete set null,
  issued_at    timestamptz,
  void_reason  text,
  voided_by    uuid references auth.users (id) on delete set null,
  voided_at    timestamptz,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  check (status <> 'ISSUED' or issued_on is not null),
  check (status <> 'VOIDED' or void_reason is not null)
);
create index on public.or_numbers (status, seq);

-- ---------------------------------------------------------------- audit trail
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  action      text not null,
  table_name  text not null,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb
);
create index on public.audit_log (table_name, record_id);
create index on public.audit_log (at desc);

-- ---------------------------------------------------------------- seed lookups
insert into public.styles (code, label, sort_order) values
  ('STRAIGHT', 'Straight', 10),
  ('NATURAL_WAVY', 'Natural Wavy', 20),
  ('BLACKENING_STRAIGHT', 'Blackening Straight', 30),
  ('BLACKENING_NATURAL_WAVY', 'Blackening Natural Wavy', 40),
  ('SIARGAO_NATURAL_WAVY', 'Siargao (SGO) Natural Wavy', 50),
  ('MANILA_CURLS', 'Manila Curls', 60),
  ('ALABANG_CURLS', 'Alabang Curls', 70),
  ('LAGUNA_CURLS', 'Laguna Curls', 80),
  ('BIG_LAGUNA_CURLS', 'Big Laguna Curls', 90),
  ('SIARGAO_CURLS', 'Siargao Curls', 100),
  ('CEBU_CURLS', 'Cebu Curls', 110);

insert into public.lace_types (code, label, sort_order) values
  ('TRANSPARENT', 'Transparent Lace', 10),
  ('SWISS', 'Swiss Lace', 20),
  ('HD', 'HD Lace', 30);

insert into public.lace_sizes (code, label, sort_order) values
  ('2X6', '2x6', 10), ('4X4', '4x4', 20), ('5X5', '5x5', 30), ('6X6', '6x6', 40), ('7X7', '7x7', 50),
  ('9X6', '9x6', 60), ('13X4', '13x4', 70), ('13X5', '13x5', 80), ('13X6', '13x6', 90);

insert into public.locations (code, label, sort_order) values ('HQ', 'HQ (main stockroom)', 10);

insert into public.production_stages (code, label, sort_order, production_can_set) values
  ('ALLOCATED', 'Allocated hair', 10, true),
  ('RSB', 'RSB', 20, true),
  ('WEFTING', 'Wefting', 30, true),
  ('VENT_MARINDUQUE', 'Ventilation – Marinduque', 40, true),
  ('VENT_HQ_PCR', 'Ventilation – HQ/PCR', 50, true),
  ('VENT_HQ_FIXING', 'Ventilation – HQ fixing/checking', 60, true),
  ('CURLING', 'Curling (Curl/Evo)', 70, true),
  ('FOR_QA', 'Awaiting QA', 80, true),
  ('REJECTED', 'QA rejected – rework', 85, false),
  ('READY', 'Ready (QA approved)', 90, false),
  ('SHIPPED', 'Shipped', 100, false),
  ('IN_STOCK', 'Received to stock', 110, false);
