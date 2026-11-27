-- Read-only catalog checks. This file is an operator check, separate from migrations.
begin transaction read only;

do $$
declare
  required record;
  expected_versions constant text[] := array[
    '20261127000100', '20261127000200', '20261127000300',
    '20261127000400', '20261127000500', '20261127000600',
    '20261127000700', '20261128000100', '20261128000200'
  ];
  missing text;
begin
  select string_agg(expected.version, ', ' order by expected.version) into missing
  from unnest(expected_versions) as expected(version)
  where not exists (
    select from supabase_migrations.schema_migrations as applied where applied.version = expected.version
  );
  if missing is not null then
    raise exception 'Missing WALLFLOW migration records: %', missing;
  end if;

  foreach missing in array array[
    'public.profiles', 'public.workspaces', 'public.boards', 'public.board_preferences',
    'public.sections', 'public.notes', 'public.checklist_items', 'public.reminder_occurrences',
    'public.reminder_receipts', 'public.change_batches', 'wallflow_private.workspace_documents',
    'wallflow_private.operation_receipts', 'wallflow_private.import_sources', 'wallflow_private.import_intents',
    'wallflow_private.legacy_account_map', 'wallflow_private.google_account_bindings',
    'wallflow_private.workspace_import_backups'
  ] loop
    if to_regclass(missing) is null then
      raise exception 'Missing WALLFLOW table %', missing;
    end if;
  end loop;

  for required in
    select * from (values
      ('auth', 'users', 'id'), ('auth', 'users', 'is_anonymous'), ('auth', 'users', 'banned_until'),
      ('auth', 'sessions', 'id'), ('auth', 'sessions', 'user_id'), ('auth', 'sessions', 'created_at'), ('auth', 'sessions', 'not_after'),
      ('auth', 'identities', 'user_id'), ('auth', 'identities', 'provider'),
      ('auth', 'identities', 'provider_id'), ('auth', 'identities', 'identity_data'),
      ('wallflow_private', 'legacy_account_map', 'workspace_reconciled_at'),
      ('wallflow_private', 'workspace_import_backups', 'legacy_capture_manifest')
    ) as columns(table_schema, table_name, column_name)
  loop
    if not exists (
      select from information_schema.columns as actual
      where actual.table_schema = required.table_schema and actual.table_name = required.table_name and actual.column_name = required.column_name
    ) then
      raise exception 'Cannot verify required column %.%.%', required.table_schema, required.table_name, required.column_name;
    end if;
  end loop;

  if not exists (
    select from pg_catalog.pg_roles
    where rolname = 'wallflow_workspace_writer' and not rolcanlogin and not rolinherit and not rolbypassrls and not rolsuper
  ) then
    raise exception 'Required restricted workspace writer role is missing or too permissive.';
  end if;

  foreach missing in array array[
    'public.initialize_wallflow_workspace(uuid)',
    'public.read_wallflow_workspace_preview(uuid)',
    'public.read_wallflow_workspace(uuid,text)',
    'public.commit_wallflow_workspace(uuid,uuid,text,jsonb,jsonb)',
    'public.prepare_wallflow_browser_import(uuid,jsonb)',
    'public.confirm_wallflow_browser_import(uuid,uuid,text,jsonb)',
    'public.recover_wallflow_browser_import(uuid,uuid)',
    'public.quick_capture_wallflow_note(uuid,uuid,text,uuid)'
  ] loop
    if to_regprocedure(missing) is null or not has_function_privilege('authenticated', missing, 'EXECUTE')
      or has_function_privilege('anon', missing, 'EXECUTE') then
      raise exception 'Missing or incorrect browser RPC grant for %', missing;
    end if;
  end loop;

  foreach missing in array array[
    'wallflow_private.reconcile_google_account(uuid,text)',
    'wallflow_private.import_django_workspace(uuid,uuid,text,text,jsonb)',
    'wallflow_private.import_django_workspace_with_captures(uuid,uuid,text,text,jsonb,text,text)'
  ] loop
    if to_regprocedure(missing) is null or has_function_privilege('authenticated', missing, 'EXECUTE')
      or has_function_privilege('anon', missing, 'EXECUTE') or has_function_privilege('service_role', missing, 'EXECUTE') then
      raise exception 'Missing or exposed operator function %', missing;
    end if;
  end loop;

  if to_regprocedure('realtime.topic()') is null
    or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or not exists (
      select from pg_catalog.pg_trigger
      where tgrelid = 'public.change_batches'::regclass and tgname = 'wallflow_workspace_committed'
        and tgenabled in ('O', 'A')
    ) then
    raise exception 'The required Realtime functions or workspace broadcast trigger are missing.';
  end if;
end;
$$;

select 'WALLFLOW catalog prerequisites passed for nine migrations.' as result;
rollback;
