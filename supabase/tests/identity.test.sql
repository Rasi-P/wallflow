\set ON_ERROR_STOP on
begin;

select '1..4';

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
  raise exception 'Expected SQL state %', expected;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select format('30000000-0000-4000-8000-00000000000%s', n)::uuid,
  format('identity-test-%s@example.invalid', n),
  '{"sub":"legacy-google-subject","provider":"google"}'
from generate_series(1, 6) as n;

insert into auth.identities (id, user_id, provider, provider_id, identity_data) values
  (gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'google', 'legacy-google-subject', '{"sub":"legacy-google-subject"}'),
  (gen_random_uuid(), '30000000-0000-4000-8000-000000000002', 'google', 'new-google-subject', '{"sub":"new-google-subject"}'),
  (gen_random_uuid(), '30000000-0000-4000-8000-000000000003', 'google', 'ambiguous-subject', '{"sub":"ambiguous-subject"}'),
  (gen_random_uuid(), '30000000-0000-4000-8000-000000000003', 'email', 'email-identity-fixture-3', '{"sub":"email-identity-fixture-3"}'),
  (gen_random_uuid(), '30000000-0000-4000-8000-000000000004', 'email', 'email-identity-fixture-4', '{"sub":"legacy-google-subject"}'),
  (gen_random_uuid(), '30000000-0000-4000-8000-000000000005', 'google', 'disabled-legacy-subject', '{"sub":"disabled-legacy-subject"}'),
  (gen_random_uuid(), '30000000-0000-4000-8000-000000000006', 'google', 'mismatched-subject', '{"sub":"different-subject"}');

insert into wallflow_private.legacy_account_map (legacy_user_id, google_sub, legacy_is_active) values
  ('40000000-0000-4000-8000-000000000001', 'legacy-google-subject', true),
  ('40000000-0000-4000-8000-000000000005', 'disabled-legacy-subject', false);

do $$
declare
  owner_a constant uuid := '30000000-0000-4000-8000-000000000001';
  legacy_a constant uuid := '40000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.assert_true(wallflow_private.reconcile_google_account(owner_a, 'legacy-google-subject') = legacy_a, 'matched legacy id');
  perform pg_temp.assert_true(wallflow_private.reconcile_google_account(owner_a, 'legacy-google-subject') = legacy_a, 'idempotent match');
  perform pg_temp.assert_true((select owner_id = owner_a and verified_at is not null
    from wallflow_private.legacy_account_map where legacy_user_id = legacy_a), 'legacy provenance');
  perform pg_temp.assert_true((select not is_active from public.profiles where owner_id = owner_a), 'legacy profile remains inactive');
  perform pg_temp.assert_true(not exists(select 1 from public.workspaces where owner_id = owner_a), 'legacy reconciliation creates no workspace');
  perform pg_temp.expect_sqlstate(format(
    'insert into wallflow_private.legacy_account_map (legacy_user_id, google_sub, legacy_is_active, owner_id, verified_at)
     values (gen_random_uuid(), ''other-legacy-subject'', true, %L, now())', owner_a), '23505');
  perform pg_temp.expect_sqlstate(
    'insert into wallflow_private.legacy_account_map (legacy_user_id, google_sub, legacy_is_active)
     values (gen_random_uuid(), ''legacy-google-subject'', true)', '23505');
end;
$$;
select 'ok 1 - verified mapping is one to one, repeatable, and non-provisioning';

do $$
declare
  attempt record;
begin
  for attempt in select * from (values
    (2, 'legacy-google-subject'),
    (3, 'ambiguous-subject'),
    (4, 'legacy-google-subject'),
    (5, 'disabled-legacy-subject'),
    (6, 'mismatched-subject')
  ) as candidates(suffix, subject) loop
    perform pg_temp.expect_sqlstate(format('select wallflow_private.reconcile_google_account(%L, %L)',
      format('30000000-0000-4000-8000-00000000000%s', attempt.suffix), attempt.subject), '42501');
  end loop;
  perform pg_temp.assert_true((select count(*) = 1 from wallflow_private.google_account_bindings
    where owner_id::text like '30000000-0000-4000-8000-00000000000%'), 'denied attempts created no binding');
end;
$$;
select 'ok 2 - rejects wrong subjects, ambiguous identities, client metadata, and disabled legacy accounts';

do $$
declare
  owner_b constant uuid := '30000000-0000-4000-8000-000000000002';
begin
  perform pg_temp.assert_true(wallflow_private.reconcile_google_account(owner_b, 'new-google-subject') is null, 'new account approval');
  perform pg_temp.assert_true((select is_active from public.profiles where owner_id = owner_b), 'new account is active');
end;
$$;
insert into auth.sessions (id, user_id, created_at) values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', now()),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', now());

-- The recorded legacy mapping independently gates access until migration approval.
update public.profiles set is_active = true where owner_id = '30000000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"30000000-0000-4000-8000-000000000001","session_id":"50000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform pg_temp.expect_sqlstate(
    'select public.initialize_wallflow_workspace(''30000000-0000-4000-8000-000000000001'')', '42501');
  perform pg_temp.expect_sqlstate(
    'select wallflow_private.reconcile_google_account(''30000000-0000-4000-8000-000000000001'', ''legacy-google-subject'')', '42501');
  perform pg_temp.expect_sqlstate('select * from wallflow_private.google_account_bindings', '42501');
end;
$$;

set local "request.jwt.claims" = '{"sub":"30000000-0000-4000-8000-000000000002","session_id":"50000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare
  owner_b constant uuid := '30000000-0000-4000-8000-000000000002';
  workspace_id uuid := public.initialize_wallflow_workspace(owner_b);
begin
  perform pg_temp.assert_true(public.read_wallflow_workspace_preview(owner_b) ->> 'id' = workspace_id::text, 'own snapshot');
  perform pg_temp.assert_true(public.read_wallflow_workspace_preview('30000000-0000-4000-8000-000000000001') is null, 'other account snapshot denied');
end;
$$;
reset role;
select 'ok 3 - only the operator can reconcile and only eligible new accounts can open the preview';

update auth.identities set provider_id = 'replacement-subject', identity_data = '{"sub":"replacement-subject"}'
where provider_id = 'new-google-subject' and provider = 'google';
do $$
begin
  perform pg_temp.expect_sqlstate(
    'select wallflow_private.reconcile_google_account(''30000000-0000-4000-8000-000000000002'', ''replacement-subject'')', '23505');
end;
$$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert_true(
    public.read_wallflow_workspace_preview('30000000-0000-4000-8000-000000000002') is null, 'binding change conceals existing workspace'
  );
end;
$$;
reset role;
select 'ok 4 - changing a bound identity cannot rebind an existing workspace';

rollback;
