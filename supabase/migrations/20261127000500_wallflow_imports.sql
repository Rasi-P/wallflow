alter table wallflow_private.legacy_account_map add column workspace_reconciled_at timestamptz;

create table wallflow_private.workspace_import_backups (
  workspace_id uuid not null,
  owner_id uuid not null,
  operation_id uuid not null,
  source_kind text not null check (source_kind in ('browser', 'django')),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  original text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id) on delete cascade
);
alter table wallflow_private.workspace_import_backups enable row level security;
revoke all on wallflow_private.workspace_import_backups from public, anon, authenticated, service_role;

create function wallflow_private.open_import_workspace(expected_owner_id uuid)
returns public.workspaces language plpgsql set search_path = '' as $$
declare
  target public.workspaces;
begin
  if expected_owner_id is null or expected_owner_id is distinct from wallflow_private.current_owner_id() then
    raise exception 'An eligible account session is required.' using errcode = '42501';
  end if;
  select * into target from public.workspaces where owner_id = expected_owner_id for update;
  if not found then raise exception 'Workspace unavailable.' using errcode = '42501'; end if;
  return target;
end;
$$;

create function wallflow_private.prepare_browser_import(expected_owner_id uuid, sources jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.workspaces := wallflow_private.open_import_workspace(expected_owner_id);
  session_key uuid := (auth.jwt() ->> 'session_id')::uuid;
  input jsonb;
  source_key uuid;
  intent_key uuid;
  seen uuid[] := '{}';
  intents jsonb := '[]';
begin
  if jsonb_typeof(sources) is distinct from 'array' or jsonb_array_length(sources) not between 1 and 250 then
    raise exception 'Invalid import selection.' using errcode = '22023';
  end if;
  for input in select value from jsonb_array_elements(sources) loop
    perform wallflow_private.document_fields(input, '{"sourceId":"string","snapshotDigest":"string"}');
    source_key := (input ->> 'sourceId')::uuid;
    if source_key = any(seen) or (input ->> 'snapshotDigest') !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid import source.' using errcode = '22023';
    end if;
    if exists(select 1 from wallflow_private.import_sources where source_id = source_key) then
      raise exception 'Import source is unavailable.' using errcode = '23505';
    end if;
    seen := array_append(seen, source_key);
    insert into wallflow_private.import_intents (owner_id, workspace_id, source_id, session_id, snapshot_digest, expires_at)
    values (target.owner_id, target.id, source_key, session_key, input ->> 'snapshotDigest', statement_timestamp() + interval '15 minutes')
    returning id into intent_key;
    intents := intents || jsonb_build_array(intent_key);
  end loop;
  return intents;
end;
$$;

create function wallflow_private.confirm_browser_import(
  expected_owner_id uuid, operation_id uuid, expected_revision text, reviewed jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.workspaces := wallflow_private.open_import_workspace(expected_owner_id);
  session_key uuid := (auth.jwt() ->> 'session_id')::uuid;
  before_document jsonb;
  next_document jsonb;
  input jsonb;
  board jsonb;
  requested_board text;
  board_key uuid;
  first_board uuid;
  intent wallflow_private.import_intents;
  receipt wallflow_private.operation_receipts;
  operation_digest text;
  source_keys uuid[] := '{}';
  board_keys uuid[] := '{}';
  intent_keys uuid[] := '{}';
begin
  if operation_id is null or expected_revision is null or jsonb_typeof(reviewed) is distinct from 'array'
    or jsonb_array_length(reviewed) not between 1 and 250 or octet_length(reviewed::text) > 6500000 then
    raise exception 'Invalid import confirmation.' using errcode = '22023';
  end if;
  operation_digest := encode(sha256(convert_to(jsonb_build_array(expected_revision,reviewed)::text,'UTF8')), 'hex');
  select * into receipt from wallflow_private.operation_receipts r
  where r.owner_id = target.owner_id and r.operation_id = confirm_browser_import.operation_id;
  if found then
    if receipt.operation_kind <> 'browser_import' or receipt.request_digest <> operation_digest then
      raise exception 'This operation ID was already used.' using errcode = '23505';
    end if;
    return wallflow_private.workspace_response(target);
  end if;
  if target.revision::text <> expected_revision then return jsonb_build_object('conflict',true); end if;
  before_document := wallflow_private.workspace_document(target);
  next_document := before_document;
  -- The untouched automatic placeholder can be replaced by the selected boards.
  if target.revision = 0 and jsonb_array_length(before_document -> 'boardOrder') = 1
    and before_document #> array['boards', target.active_board_id::text, 'document'] = '{"notes":[],"sections":[],"wallRotation":[0,0]}'::jsonb
  then
    next_document := '{"version":2,"boardOrder":[],"boards":{}}';
  end if;

  for input in select value from jsonb_array_elements(reviewed) loop
    perform wallflow_private.document_fields(input, '{"intentId":"string","snapshot":"string"}');
    select * into intent from wallflow_private.import_intents i
    where i.id = (input ->> 'intentId')::uuid and i.workspace_id = target.id and i.owner_id = target.owner_id
      and i.session_id = session_key and i.confirmed_revision is null and i.expires_at > statement_timestamp();
    if not found or intent.source_id = any(source_keys) or intent.snapshot_digest <>
      encode(sha256(convert_to(input ->> 'snapshot','UTF8')),'hex')
    then raise exception 'Import review is unavailable or has changed.' using errcode = '22023'; end if;
    board := (input ->> 'snapshot')::jsonb;
    requested_board := board ->> 'id';
    if requested_board is null or requested_board = '' then raise exception 'Board ID is missing.' using errcode = '22023'; end if;
    board_key := case when requested_board ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then requested_board::uuid else gen_random_uuid() end;
    if (next_document -> 'boards') ? board_key::text then
      raise exception 'Board ID is unavailable.' using errcode = '23505';
    end if;
    first_board := coalesce(first_board, board_key);
    next_document := jsonb_set(next_document, '{boardOrder}', (next_document -> 'boardOrder') || jsonb_build_array(board_key));
    next_document := jsonb_set(next_document, array['boards',board_key::text], jsonb_set(board, '{id}', to_jsonb(board_key)));
    source_keys := array_append(source_keys, intent.source_id);
    board_keys := array_append(board_keys, board_key);
    intent_keys := array_append(intent_keys, intent.id);
  end loop;

  next_document := jsonb_set(next_document, '{activeBoardId}', to_jsonb(first_board));
  target := wallflow_private.replace_workspace(target, before_document, next_document, target.revision + 1);
  insert into wallflow_private.import_sources (source_id,owner_id,workspace_id,board_id,claimed_board_id)
    select pair.source_key,target.owner_id,target.id,pair.board_key,pair.board_key
    from unnest(source_keys,board_keys) as pair(source_key,board_key);
  update wallflow_private.import_intents set confirmed_revision = target.revision where id = any(intent_keys);
  insert into wallflow_private.workspace_import_backups (workspace_id,owner_id,operation_id,source_kind,digest,original)
    values (target.id,target.owner_id,operation_id,'browser',operation_digest,reviewed::text);
  insert into wallflow_private.operation_receipts (owner_id,workspace_id,operation_id,operation_kind,request_digest,revision)
    values (target.owner_id,target.id,operation_id,'browser_import',operation_digest,target.revision);
  return wallflow_private.workspace_response(target);
end;
$$;

create function wallflow_private.recover_browser_import(expected_owner_id uuid, source_key uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  target public.workspaces := wallflow_private.open_import_workspace(expected_owner_id);
begin
  delete from wallflow_private.import_intents
    where owner_id = target.owner_id and workspace_id = target.id and source_id = source_key and confirmed_revision is null
      and session_id = (auth.jwt() ->> 'session_id')::uuid;
  if exists(select 1 from wallflow_private.import_sources where source_id = source_key and owner_id = target.owner_id) then
    return 'claimed';
  end if;
  if exists(select 1 from wallflow_private.import_sources where source_id = source_key)
    or exists(select 1 from wallflow_private.import_intents where source_id = source_key and confirmed_revision is null and expires_at > statement_timestamp())
  then return 'pending'; end if;
  return 'available';
end;
$$;

create function public.prepare_wallflow_browser_import(expected_owner_id uuid, sources jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select wallflow_private.prepare_browser_import(expected_owner_id,sources);
$$;
create function public.confirm_wallflow_browser_import(expected_owner_id uuid, operation_id uuid, expected_revision text, reviewed jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select wallflow_private.confirm_browser_import(expected_owner_id,operation_id,expected_revision,reviewed);
$$;
create function public.recover_wallflow_browser_import(expected_owner_id uuid, source_key uuid)
returns text language sql security invoker set search_path = '' as $$
  select wallflow_private.recover_browser_import(expected_owner_id,source_key);
$$;

-- The operator supplies a verified staged identity, the original Django API
-- envelope, and its independent source-to-board claim manifest from the export.
create function wallflow_private.import_django_workspace(
  legacy_id uuid, expected_owner_id uuid, original_snapshot text, expected_digest text, source_manifest jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  mapping wallflow_private.legacy_account_map;
  target public.workspaces;
  envelope jsonb;
  document jsonb;
  source jsonb;
  source_key uuid;
  board_key uuid;
  imported_revision bigint;
  archive_digest text;
begin
  if original_snapshot is null or octet_length(original_snapshot) > 6500000 or expected_digest is null
     or expected_digest <> encode(sha256(convert_to(original_snapshot,'UTF8')),'hex')
     or jsonb_typeof(source_manifest) is distinct from 'array'
  then raise exception 'Legacy snapshot checksum or manifest is invalid.' using errcode = '22023'; end if;
  archive_digest := encode(sha256(convert_to(jsonb_build_array(original_snapshot,source_manifest)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(expected_owner_id::text, 0));
  select * into mapping from wallflow_private.legacy_account_map m where m.legacy_user_id = legacy_id for update;
  if not found or not mapping.legacy_is_active or mapping.owner_id is null or mapping.owner_id is distinct from expected_owner_id
    or mapping.verified_at is null or wallflow_private.verified_google_subject(expected_owner_id) is distinct from mapping.google_sub
    or not exists(select 1 from wallflow_private.google_account_bindings b where b.owner_id = expected_owner_id and b.google_sub = mapping.google_sub)
    or not exists(select 1 from auth.users u where u.id = expected_owner_id and not u.is_anonymous
      and (u.banned_until is null or u.banned_until <= statement_timestamp()))
  then raise exception 'Legacy identity is not eligible for reconciliation.' using errcode = '42501'; end if;
  select * into target from public.workspaces where owner_id = expected_owner_id for update;
  if found then
    if mapping.workspace_reconciled_at is not null and exists (
      select 1 from wallflow_private.workspace_import_backups b
      where b.workspace_id = target.id and b.owner_id = expected_owner_id and b.operation_id = legacy_id
        and b.source_kind = 'django' and b.digest = archive_digest
    ) then return wallflow_private.workspace_response(target); end if;
    raise exception 'Destination already has a workspace. Review it separately.' using errcode = '23505';
  end if;
  if mapping.workspace_reconciled_at is not null then
    raise exception 'Legacy workspace was already reconciled.' using errcode = '23505';
  end if;
  envelope := original_snapshot::jsonb;
  perform wallflow_private.document_fields(envelope, '{"revision":"string","workspace":"object","claimedSources":"array"}');
  if envelope ->> 'revision' !~ '^[0-9]+$' then raise exception 'Invalid legacy revision.' using errcode = '22023'; end if;
  -- Ensure migration itself has a positive change revision, including an empty source at revision zero.
  imported_revision := greatest(1,(envelope ->> 'revision')::bigint);
  document := envelope -> 'workspace';
  if (select coalesce(jsonb_agg(s -> 'sourceId' order by s ->> 'sourceId'),'[]') from jsonb_array_elements(source_manifest) s)
      is distinct from (select coalesce(jsonb_agg(s order by s #>> '{}'),'[]') from jsonb_array_elements(envelope -> 'claimedSources') s)
  then raise exception 'Claimed sources and export manifest disagree.' using errcode = '22023'; end if;

  insert into public.workspaces (owner_id,active_board_id) values (expected_owner_id,(document ->> 'activeBoardId')::uuid)
    returning * into target;
  target := wallflow_private.replace_workspace(target, '{}', document, imported_revision);
  for source in select value from jsonb_array_elements(source_manifest) loop
    perform wallflow_private.document_fields(source, '{"sourceId":"string","boardId":"string"}');
    source_key := (source ->> 'sourceId')::uuid;
    board_key := (source ->> 'boardId')::uuid;
    insert into wallflow_private.import_sources (source_id,owner_id,workspace_id,board_id,claimed_board_id)
      values (source_key,target.owner_id,target.id,
        case when (document -> 'boards') ? board_key::text then board_key end,board_key);
  end loop;
  insert into wallflow_private.workspace_import_backups (workspace_id,owner_id,operation_id,source_kind,digest,original)
    values (target.id,target.owner_id,legacy_id,'django',archive_digest,original_snapshot);
  update wallflow_private.legacy_account_map set workspace_reconciled_at = statement_timestamp() where legacy_user_id = legacy_id;
  update public.profiles set is_active = true, updated_at = statement_timestamp() where owner_id = target.owner_id;
  return wallflow_private.workspace_response(target);
end;
$$;

create or replace function wallflow_private.current_owner_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select profile.owner_id
  from public.profiles profile
  join auth.users account on account.id = profile.owner_id
  join auth.sessions session on session.user_id = profile.owner_id
  left join wallflow_private.google_account_bindings binding on binding.owner_id = profile.owner_id
  where profile.owner_id = (select auth.uid()) and profile.is_active and not account.is_anonymous
    and (account.banned_until is null or account.banned_until <= statement_timestamp())
    and session.id = case when (select auth.jwt() ->> 'session_id') ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      then (select (auth.jwt() ->> 'session_id')::uuid) end
    and session.created_at > statement_timestamp() - interval '336 hours'
    and (session.not_after is null or session.not_after > statement_timestamp())
    and (binding.google_sub is null or binding.google_sub = wallflow_private.verified_google_subject(profile.owner_id))
    and not exists (select 1 from wallflow_private.legacy_account_map legacy
      where (legacy.owner_id = profile.owner_id or legacy.google_sub = binding.google_sub)
        and (not legacy.legacy_is_active or legacy.workspace_reconciled_at is null));
$$;

revoke all on function wallflow_private.open_import_workspace(uuid), wallflow_private.prepare_browser_import(uuid,jsonb),
  wallflow_private.confirm_browser_import(uuid,uuid,text,jsonb), wallflow_private.recover_browser_import(uuid,uuid),
  wallflow_private.import_django_workspace(uuid,uuid,text,text,jsonb), public.prepare_wallflow_browser_import(uuid,jsonb),
  public.confirm_wallflow_browser_import(uuid,uuid,text,jsonb), public.recover_wallflow_browser_import(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function wallflow_private.prepare_browser_import(uuid,jsonb), wallflow_private.confirm_browser_import(uuid,uuid,text,jsonb),
  wallflow_private.recover_browser_import(uuid,uuid), public.prepare_wallflow_browser_import(uuid,jsonb),
  public.confirm_wallflow_browser_import(uuid,uuid,text,jsonb), public.recover_wallflow_browser_import(uuid,uuid) to authenticated;
