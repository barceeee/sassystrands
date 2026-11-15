-- Task 2 test: pieces schema. Runs in a rolled-back transaction.
begin;

insert into public.pieces default values;

do $$ begin
  if not exists (select 1 from public.pieces where serial ~ '^SS-\d{6}$') then
    raise exception 'serial not shaped SS-nnnnnn';
  end if;
  if to_regclass('public.production_records') is not null then
    raise exception 'production_records still exists';
  end if;
  if exists (select 1 from public.production_stages where code = 'ALLOCATED') then
    raise exception 'ALLOCATED stage still exists';
  end if;
  if (select label from public.production_stages where code = 'FOR_QA') <> 'QA station' then
    raise exception 'FOR_QA not relabelled';
  end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = 'inventory'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$ begin
  if (select stage_label from public.piece_board() limit 1) is distinct from 'Received at HQ' then
    raise exception 'piece_board did not return the piece as Received at HQ';
  end if;
  if (select count(*) from public.pieces) < 1 then raise exception 'authenticated cannot read pieces'; end if;
  begin
    insert into public.pieces default values;
    raise exception 'authenticated insert should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
