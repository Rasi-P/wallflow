\set ON_ERROR_STOP on
begin;
select '1..3';

insert into auth.users (id,email) values ('60000000-0000-4000-8000-000000000001','workspace-migration-fixture@example.invalid');
insert into auth.identities (id,user_id,provider,provider_id,identity_data)
values (gen_random_uuid(),'60000000-0000-4000-8000-000000000001','google','workspace-migration-subject','{"sub":"workspace-migration-subject"}');
insert into wallflow_private.legacy_account_map (legacy_user_id,google_sub,legacy_is_active)
values ('60000000-0000-4000-8000-000000000002','workspace-migration-subject',true);
select wallflow_private.reconcile_google_account('60000000-0000-4000-8000-000000000001','workspace-migration-subject') as ignored \gset

do $$
declare
  owner constant uuid := '60000000-0000-4000-8000-000000000001';
  legacy constant uuid := '60000000-0000-4000-8000-000000000002';
  first_board constant uuid := '60000000-0000-4000-8000-000000000003';
  second_board constant uuid := '60000000-0000-4000-8000-000000000004';
  source constant uuid := '60000000-0000-4000-8000-000000000005';
  board jsonb := '{
    "name":"Synthetic export",
    "document":{"wallRotation":[-12,4],"sections":[{"id":"section-old","name":"Planning","position":[0,0]}],
      "notes":[{"id":"old-id","title":"Mixed workspace","body":"a\nb","position":[1,2],"rotation":0.4,"color":"pink",
        "size":[3,3],"sectionId":"section-old","checklist":[{"id":"item-old","text":"First","done":true}],
        "plannedOn":"2026-11-27","dueDate":"2026-12-03","reminder":{"id":"rem-old","at":1795773600123},"archived":true}]},
    "preferences":{"showHints":false,"onboardingComplete":true,"noteDefaults":{"color":"mint","typography":"sans","size":"compact","rotation":"straight"}},
    "presentation":{"lighting":"warm","appearance":{"theme":"study","photoWorkspace":"scientist","shade":"mist","intensity":110,"ambience":"airy"}},
    "notifiedReminders":["rem-old","historical"]}';
  saved jsonb;
  result jsonb;
  original text;
  digest text;
  manifest jsonb;
begin
  saved := jsonb_build_object('version',2,'boardOrder',jsonb_build_array(second_board,first_board),
    'activeBoardId',first_board,'boards',jsonb_build_object(
      first_board,board || jsonb_build_object('id',first_board),
      second_board,board || jsonb_build_object('id',second_board,'name','Second board')));
  original := jsonb_build_object('revision','23','workspace',saved,'claimedSources',jsonb_build_array(source))::text || E'\n';
  digest := encode(sha256(convert_to(original,'UTF8')),'hex');
  manifest := jsonb_build_array(jsonb_build_object('sourceId',source,'boardId',second_board));

  begin
    perform wallflow_private.import_django_workspace(legacy,owner,original,repeat('0',64),manifest);
    raise exception 'Wrong digest was accepted.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform wallflow_private.import_django_workspace(legacy,gen_random_uuid(),original,digest,manifest);
    raise exception 'Wrong owner was accepted.';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.workspaces where owner_id=owner) then raise exception 'Rejected import created a workspace.'; end if;

  result := wallflow_private.import_django_workspace(legacy,owner,original,digest,manifest);
  if result ->> 'revision' <> '23' or result -> 'workspace' is distinct from saved
     or result -> 'claimedSources' is distinct from jsonb_build_array(source) then raise exception 'Import did not round-trip.'; end if;
  if (select b.original from wallflow_private.workspace_import_backups b where b.owner_id=owner and b.operation_id=legacy) is distinct from original
    then raise exception 'Original export bytes were not retained.'; end if;
  if (select n.scheduled_at from public.reminder_occurrences n where n.board_id=first_board and n.id='rem-old')
    is distinct from timestamptz '1970-01-01 00:00:00+00' + 1795773600123::numeric * interval '1 millisecond'
    then raise exception 'Reminder projection lost precision.'; end if;

  if wallflow_private.import_django_workspace(legacy,owner,original,digest,manifest) is distinct from result
    then raise exception 'Identical export replay changed the result.'; end if;
  perform wallflow_private.reconcile_google_account(owner,'workspace-migration-subject');
  if not (select is_active from public.profiles where owner_id=owner) then raise exception 'Reconciliation retry disabled the workspace.'; end if;
end;
$$;
select 'ok 1 - verified migration preserves board and note IDs, features, original bytes, and claims';
select 'ok 2 - migration rejects mismatched owners and checksums and retries safely';

insert into auth.sessions (id,user_id,created_at)
values ('60000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000001',now());
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"60000000-0000-4000-8000-000000000001","session_id":"60000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  if public.read_wallflow_workspace('60000000-0000-4000-8000-000000000001') ->> 'revision' <> '23'
    then raise exception 'Verified owner could not open the migrated workspace.'; end if;
  if has_table_privilege('wallflow_private.workspace_import_backups','SELECT')
    then raise exception 'The browser can access migration originals.'; end if;
  if has_function_privilege('wallflow_private.import_django_workspace(uuid,uuid,text,text,jsonb)','EXECUTE')
    then raise exception 'The browser can run an operator migration.'; end if;
end;
$$;
reset role;
select 'ok 3 - migrated owner can read and the operator payloads stay private';
rollback;
