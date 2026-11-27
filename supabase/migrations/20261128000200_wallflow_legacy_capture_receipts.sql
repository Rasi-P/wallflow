alter table wallflow_private.workspace_import_backups
  add column legacy_capture_manifest text,
  add constraint legacy_capture_manifest_is_django check (legacy_capture_manifest is null or source_kind = 'django');

-- The previous five-argument importer remains available for older snapshots.
-- Use this operator entry point for exports with an explicit capture inventory.
create function wallflow_private.import_django_workspace_with_captures(
  legacy_id uuid, expected_owner_id uuid, original_snapshot text, expected_digest text, source_manifest jsonb,
  original_captures text, captures_digest text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  captures jsonb;
  saved jsonb;
  archive wallflow_private.workspace_import_backups;
  receipt jsonb;
  request_key uuid;
  note_key uuid;
  capture_revision bigint;
  source_revision bigint;
begin
  if original_captures is null or captures_digest is null
    or captures_digest <> encode(sha256(convert_to(original_captures,'UTF8')),'hex')
  then raise exception 'Legacy capture checksum is invalid.' using errcode = '22023'; end if;
  captures := original_captures::jsonb;
  if jsonb_typeof(captures) is distinct from 'array' then
    raise exception 'Invalid legacy capture manifest.' using errcode = '22023';
  end if;

  saved := wallflow_private.import_django_workspace(legacy_id, expected_owner_id, original_snapshot, expected_digest, source_manifest);
  -- The workspace importer holds the owner advisory lock through this transaction.
  select * into strict archive from wallflow_private.workspace_import_backups b
  where b.owner_id = expected_owner_id and b.operation_id = legacy_id and b.source_kind = 'django' for update;
  if archive.legacy_capture_manifest is not null then
    if archive.legacy_capture_manifest <> original_captures then
      raise exception 'The legacy capture manifest was already reconciled.' using errcode = '23505';
    end if;
    return saved;
  end if;

  source_revision := (archive.original::jsonb ->> 'revision')::bigint;
  for receipt in select value from jsonb_array_elements(captures) loop
    perform wallflow_private.document_fields(receipt,
      '{"requestId":"string","contentDigest":"string","noteId":"string","revision":"string"}');
    request_key := (receipt ->> 'requestId')::uuid;
    note_key := (receipt ->> 'noteId')::uuid;
    if request_key::text <> receipt ->> 'requestId' or note_key::text <> receipt ->> 'noteId'
      or (receipt ->> 'contentDigest') !~ '^[0-9a-f]{64}$' or (receipt ->> 'revision') !~ '^[0-9]+$'
    then raise exception 'Invalid legacy capture receipt.' using errcode = '22023'; end if;
    capture_revision := (receipt ->> 'revision')::bigint;
    if capture_revision > source_revision then
      raise exception 'A capture receipt is newer than its source workspace.' using errcode = '22023';
    end if;
    insert into wallflow_private.operation_receipts
      (owner_id, workspace_id, operation_id, operation_kind, request_digest, revision, result)
    values (expected_owner_id, archive.workspace_id, request_key, 'quick_capture', receipt ->> 'contentDigest',
      capture_revision, jsonb_build_object('noteId', note_key));
  end loop;

  update wallflow_private.workspace_import_backups b set legacy_capture_manifest = original_captures
  where b.owner_id = expected_owner_id and b.operation_id = legacy_id;
  return saved;
end;
$$;

revoke all on function wallflow_private.import_django_workspace_with_captures(uuid,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
