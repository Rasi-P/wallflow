\set ON_ERROR_STOP on
begin transaction read only;
select '1..4';

do $$
declare
  relation record;
begin
  for relation in
    select c.oid, c.relname, c.relrowsecurity, n.nspname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and (n.nspname='wallflow_private' or
      (n.nspname='public' and c.relname in (
        'profiles','workspaces','boards','board_preferences','sections','notes','checklist_items',
        'reminder_occurrences','reminder_receipts','change_batches'
      )))
  loop
    if not relation.relrowsecurity or has_table_privilege('anon',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege('authenticated',relation.oid,'INSERT,UPDATE,REFERENCES')
      or has_any_column_privilege('anon',relation.oid,'SELECT,INSERT,UPDATE,REFERENCES')
      or has_table_privilege('authenticated',relation.oid,'SELECT') is distinct from (relation.nspname='public')
      or (relation.nspname='wallflow_private' and has_any_column_privilege('authenticated',relation.oid,'SELECT'))
    then raise exception 'Unexpected browser privileges on %.%',relation.nspname,relation.relname; end if;
  end loop;
end;
$$;
select 'ok 1 - application tables have RLS and only expected browser read grants';

do $$
declare
  routine record;
  allowed_public text[] := array['initialize_wallflow_workspace','read_wallflow_workspace_preview',
    'read_wallflow_workspace','commit_wallflow_workspace','prepare_wallflow_browser_import',
    'confirm_wallflow_browser_import','recover_wallflow_browser_import','quick_capture_wallflow_note'];
  allowed_private text[] := array['current_owner_id','initialize_workspace','read_workspace','commit_workspace',
    'prepare_browser_import','confirm_browser_import','recover_browser_import','quick_capture'];
begin
  for routine in
    select p.oid,p.proname,p.proconfig,p.prosecdef,n.nspname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='wallflow_private' or (n.nspname='public' and p.proname like '%wallflow%')
  loop
    if not coalesce(routine.proconfig @> array['search_path=""'],false)
      or has_function_privilege('anon',routine.oid,'EXECUTE')
      or has_function_privilege('service_role',routine.oid,'EXECUTE')
      or (routine.nspname='public' and (routine.prosecdef or not (routine.proname=any(allowed_public))))
      or has_function_privilege('authenticated',routine.oid,'EXECUTE') is distinct from
        (case routine.nspname when 'public' then routine.proname=any(allowed_public) else routine.proname=any(allowed_private) end)
    then raise exception 'Unexpected RPC privileges on %.%',routine.nspname,routine.proname; end if;
  end loop;
end;
$$;
select 'ok 2 - only reviewed browser RPCs are granted and search paths are explicit';

do $$
declare
  policy record;
begin
  select p.polcmd,p.polroles,c.relrowsecurity into strict policy
  from pg_policy p join pg_class c on c.oid=p.polrelid
  where p.polrelid='realtime.messages'::regclass and p.polname='wallflow_workspace_notifications';
  if not policy.relrowsecurity or policy.polcmd <> 'r' or policy.polroles <> array['authenticated'::regrole::oid] then
    raise exception 'Unexpected Realtime policy scope.';
  end if;
  if exists (select from pg_policy where polrelid='realtime.messages'::regclass and polcmd in ('a','*')
      and polroles && array[0::oid,'anon'::regrole::oid,'authenticated'::regrole::oid]) then
    raise exception 'Unexpected client publication policy on Realtime.';
  end if;
end;
$$;
select 'ok 3 - private Realtime authorization grants receive only';

do $$
begin
  if pg_has_role('authenticated','wallflow_workspace_writer','MEMBER')
    or pg_has_role('anon','wallflow_workspace_writer','MEMBER')
    or has_schema_privilege('authenticated','wallflow_private','CREATE')
    or has_schema_privilege('anon','wallflow_private','USAGE')
  then raise exception 'Unexpected ability to assume or change a trusted database role.'; end if;
end;
$$;
select 'ok 4 - browser roles cannot assume or change the trusted writer';
rollback;
