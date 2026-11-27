\set ON_ERROR_STOP on
begin;

select '1..6';

create function pg_temp.assert_true(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'Assertion failed: %', description;
  end if;
end;
$$;

create function pg_temp.expect_sqlstate(statement text, expected text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected then
      return;
    end if;
    raise;
  end;
  raise exception 'Expected SQL state % executing %', expected, statement;
end;
$$;

insert into auth.users (id, email, banned_until) values
  ('10000000-0000-4000-8000-000000000001', 'wallflow-owner-a@example.invalid', null),
  ('10000000-0000-4000-8000-000000000002', 'wallflow-owner-b@example.invalid', null),
  ('10000000-0000-4000-8000-000000000003', 'wallflow-inactive@example.invalid', null),
  ('10000000-0000-4000-8000-000000000004', 'wallflow-banned@example.invalid', now() + interval '1 hour');

insert into auth.sessions (id, user_id, created_at, not_after) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', now(), null),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', now(), null),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', now(), null),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', now(), null),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', now() - interval '15 days', null),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', now(), now() - interval '1 minute');

insert into public.profiles (owner_id, is_active)
  select id, id <> '10000000-0000-4000-8000-000000000003'
  from auth.users
  where id in (
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'
  );

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  workspace_a uuid;
begin
  workspace_a := public.initialize_wallflow_workspace('10000000-0000-4000-8000-000000000001');
  perform pg_temp.assert_true(
    workspace_a = public.initialize_wallflow_workspace('10000000-0000-4000-8000-000000000001'),
    'initialization is idempotent'
  );
  perform pg_temp.assert_true((select revision = 0 from public.workspaces), 'initial revision is zero');
  perform pg_temp.assert_true((select count(*) = 1 from public.boards), 'one board initialized');
  perform pg_temp.assert_true((select count(*) = 1 from public.board_preferences), 'board preferences initialized');
  perform pg_temp.expect_sqlstate(
    $sql$select public.initialize_wallflow_workspace('10000000-0000-4000-8000-000000000002')$sql$, '42501'
  );
end;
$$;

set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
begin
  perform pg_temp.assert_true((select count(*) = 0 from public.workspaces), 'B cannot read A workspace');
  perform public.initialize_wallflow_workspace('10000000-0000-4000-8000-000000000002');
  perform pg_temp.assert_true((select count(*) = 1 from public.workspaces), 'B sees only its own workspace');
end;
$$;
reset role;
set constraints all immediate;

create temp table fixture_boards as
  select owner_id, id as workspace_id, active_board_id as board_id from public.workspaces
  where owner_id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');

insert into public.sections (board_id, owner_id, id, sort_index, name, x, y)
  select board_id, owner_id, 'shared-section-id', 0, 'Plan', 0, 0 from fixture_boards;
insert into public.notes (board_id, owner_id, id, sort_index, active_slot, section_id, title, color, x, y, planned_on)
  select board_id, owner_id, 'legacy-note-id', 0, 1, 'shared-section-id', repeat('😀', 36), 'yellow', 0, 0, date '2026-11-27'
  from fixture_boards;
insert into public.checklist_items (board_id, owner_id, note_id, id, sort_index, text)
  select board_id, owner_id, 'legacy-note-id', 'legacy-item-id', 0, 'Test item' from fixture_boards;
insert into public.reminder_occurrences (board_id, owner_id, note_id, id, scheduled_at)
  select board_id, owner_id, 'legacy-note-id', 'reminder-id', timestamptz '2026-11-27 12:30:01.123+00' from fixture_boards;
insert into public.reminder_receipts (board_id, owner_id, reminder_id, occurrence_id)
  select board_id, owner_id, 'reminder-id', 'reminder-id' from fixture_boards;
insert into public.reminder_receipts (board_id, owner_id, reminder_id)
  select board_id, owner_id, 'imported-receipt-without-occurrence' from fixture_boards;
update public.workspaces set revision = 1 where id in (select workspace_id from fixture_boards);
insert into public.change_batches (workspace_id, owner_id, revision, changes)
  select workspace_id, owner_id, 1, '[]' from fixture_boards;
select 'ok 1 - atomic workspace initialization and independent owners';

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000001';
  b constant uuid := '10000000-0000-4000-8000-000000000002';
  board_a uuid := (select board_id from fixture_boards where owner_id = a);
  board_b uuid := (select board_id from fixture_boards where owner_id = b);
  workspace_a uuid := (select workspace_id from fixture_boards where owner_id = a);
begin
  perform pg_temp.expect_sqlstate(format('update public.workspaces set active_board_id = %L where id = %L', board_b, workspace_a), '23503');
  perform pg_temp.expect_sqlstate(format('update public.boards set deleted_at = now() where id = %L', board_a), '23503');
  perform pg_temp.expect_sqlstate(format('update public.boards set owner_id = %L where id = %L', b, board_a), '23503');
  perform pg_temp.expect_sqlstate(format('update public.sections set owner_id = %L where board_id = %L', b, board_a), '23503');
  perform pg_temp.expect_sqlstate(format('update public.notes set owner_id = %L where board_id = %L', b, board_a), '23503');
  insert into public.sections (board_id, owner_id, id, sort_index, name, x, y)
    values (board_b, b, 'section-only-on-b', 1, 'Other section', 0, 0);
  perform pg_temp.expect_sqlstate(format(
    'update public.notes set section_id = %L where board_id = %L', 'section-only-on-b', board_a), '23503');
  perform pg_temp.expect_sqlstate(format('update public.checklist_items set owner_id = %L where board_id = %L', b, board_a), '23503');
  perform pg_temp.expect_sqlstate(format('update public.reminder_occurrences set owner_id = %L where board_id = %L', b, board_a), '23503');
  perform pg_temp.expect_sqlstate(format('update public.reminder_receipts set owner_id = %L where board_id = %L', b, board_a), '23503');
  perform pg_temp.expect_sqlstate(format(
    'insert into wallflow_private.import_sources (source_id, workspace_id, owner_id, board_id, claimed_board_id)
     values (gen_random_uuid(), %L, %L, %L, %L)', workspace_a, a, board_b, board_b), '23503');
  perform pg_temp.expect_sqlstate(format('update public.change_batches set owner_id = %L where workspace_id = %L', b, workspace_a), '23503');
end;
$$;
select 'ok 2 - same-owner foreign keys and live active board';

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000001';
  board_a uuid := (select board_id from fixture_boards where owner_id = a);
begin
  perform pg_temp.expect_sqlstate(format('update public.boards set name = E''\t '' where id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.boards set tilt_deg = 26 where id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.board_preferences set light_intensity = 99 where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.sections set sort_index = 24 where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.sections set width = 10 where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.sections set x = 15 where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set title = repeat(%L, 37) where board_id = %L', '😀', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set body = repeat(%L, 241) where board_id = %L', 'a', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set due_date = ''infinity'' where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set rotation_rad = ''Infinity'' where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set x = ''NaN'' where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set x = 13.35, width = 5.5, height = 5.5, rotation_rad = 0.8 where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set width = 3 where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set active_slot = 61 where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.notes set archived = true where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.checklist_items set sort_index = 24 where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format('update public.checklist_items set text = repeat(%L, 61) where board_id = %L', '😀', board_a), '23514');
  perform pg_temp.expect_sqlstate(format(
    'update public.reminder_occurrences set scheduled_at = scheduled_at + interval ''1 microsecond'' where board_id = %L', board_a), '23514');
  perform pg_temp.expect_sqlstate(format(
    'insert into public.reminder_occurrences (board_id, owner_id, note_id, id, scheduled_at)
     values (%L, %L, ''legacy-note-id'', ''duplicate-active'', now()::timestamptz(3))', board_a, a), '23505');

  insert into public.notes (board_id, owner_id, id, sort_index, active_slot, color, x, y)
    select board_a, a, 'note-' || slot, slot - 1, slot, 'yellow', 0, 0
    from generate_series(2, 60) as slot;
  perform pg_temp.expect_sqlstate(format(
    'insert into public.notes (board_id, owner_id, id, sort_index, active_slot, color, x, y)
     values (%L, %L, ''extra-note'', 60, 60, ''yellow'', 0, 0)', board_a, a), '23505');
  update public.notes set active_slot = null, archived = true where board_id = board_a and id = 'note-60';
  insert into public.notes (board_id, owner_id, id, sort_index, active_slot, color, x, y)
    values (board_a, a, 'extra-note', 60, 60, 'yellow', 0, 0);
  perform pg_temp.assert_true(
    (select count(*) = 61 and count(active_slot) = 60 from public.notes where board_id = board_a),
    'archived notes retain order without consuming an active slot'
  );
end;
$$;
select 'ok 3 - geometry, text, dates, reminders, enums, and capacity limits';

set local role authenticated;
do $$
declare
  suffix text;
  actor uuid;
  relation record;
  visible_count bigint;
  expected_count bigint;
begin
  foreach suffix in array array['1', '2'] loop
    actor := ('10000000-0000-4000-8000-00000000000' || suffix)::uuid;
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', actor, 'session_id', '20000000-0000-4000-8000-00000000000' || suffix, 'role', 'authenticated'
    )::text, true);
    for relation in select * from (values
      ('profiles', 1, 1), ('workspaces', 1, 1), ('boards', 1, 1), ('board_preferences', 1, 1),
      ('sections', 1, 2), ('notes', 61, 1), ('checklist_items', 1, 1), ('reminder_occurrences', 1, 1),
      ('reminder_receipts', 2, 2), ('change_batches', 1, 1)
    ) as expected(name, count_a, count_b) loop
      execute format('select count(*) from public.%I', relation.name) into visible_count;
      expected_count := case suffix when '1' then relation.count_a else relation.count_b end;
      perform pg_temp.assert_true(visible_count = expected_count, relation.name || ' visible row count');
      execute format('select count(*) from public.%I where owner_id <> $1', relation.name) into visible_count using actor;
      perform pg_temp.assert_true(visible_count = 0, relation.name || ' cross-account rows');
      perform pg_temp.assert_true(
        not has_table_privilege('authenticated', 'public.' || relation.name, 'INSERT, UPDATE, DELETE, TRUNCATE'),
        relation.name || ' direct DML privileges'
      );
    end loop;
  end loop;
  perform pg_temp.expect_sqlstate('update public.notes set body = ''blocked''', '42501');
  perform pg_temp.expect_sqlstate('insert into public.boards default values', '42501');
  perform pg_temp.expect_sqlstate('select * from wallflow_private.operation_receipts', '42501');
  perform pg_temp.expect_sqlstate('select * from wallflow_private.import_sources', '42501');
  perform pg_temp.expect_sqlstate('select * from wallflow_private.import_intents', '42501');
  perform pg_temp.expect_sqlstate('select * from wallflow_private.legacy_account_map', '42501');
end;
$$;
select 'ok 4 - two-account row isolation and direct writes denied';

set local role anon;
set local "request.jwt.claims" = '{}';
do $$
begin
  perform pg_temp.expect_sqlstate('select * from public.notes', '42501');
  perform pg_temp.expect_sqlstate('select * from public.workspaces', '42501');
  perform pg_temp.expect_sqlstate(
    'select public.initialize_wallflow_workspace(''10000000-0000-4000-8000-000000000001'')', '42501'
  );
end;
$$;
reset role;
select 'ok 5 - anonymous table and function access denied';

set local role authenticated;
do $$
declare
  session_case record;
  user_id uuid;
begin
  for session_case in select * from (values
    ('1', '20000000-0000-4000-8000-000000000002'),
    ('3', '20000000-0000-4000-8000-000000000003'),
    ('4', '20000000-0000-4000-8000-000000000004'),
    ('1', '20000000-0000-4000-8000-000000000005'),
    ('1', '20000000-0000-4000-8000-000000000006'),
    ('1', '20000000-0000-4000-8000-000000000099'),
    ('1', 'malformed'),
    ('1', null)
  ) as cases(subject_suffix, session_id) loop
    user_id := ('10000000-0000-4000-8000-00000000000' || session_case.subject_suffix)::uuid;
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', user_id, 'session_id', session_case.session_id, 'role', 'authenticated'
    )::text, true);
    perform pg_temp.assert_true((select count(*) = 0 from public.profiles), 'ineligible profile access');
    perform pg_temp.assert_true((select count(*) = 0 from public.notes), 'ineligible note access');
    perform pg_temp.expect_sqlstate(format('select public.initialize_wallflow_workspace(%L)', user_id), '42501');
  end loop;
end;
$$;
reset role;
select 'ok 6 - stale, expired, missing, mismatched, and ineligible sessions denied';

rollback;
