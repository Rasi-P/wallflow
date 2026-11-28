-- Extend Quick Capture while keeping its existing signature and receipt hashes.
create function wallflow_private.quick_capture(expected_owner_id uuid, operation_id uuid, content text, board_id uuid, checklist jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := wallflow_private.current_owner_id();
  body text := wallflow_private.trim_legacy_text(content);
  target public.workspaces;
  current_document jsonb;
  next_document jsonb;
  receipt wallflow_private.operation_receipts;
  board_key uuid;
  selected_note jsonb;
  note_id uuid;
  digest text;
  items jsonb := coalesce(checklist, '[]'::jsonb);
  texts jsonb;
  task_items jsonb;
begin
  if caller is null or caller is distinct from expected_owner_id then
    raise exception 'An eligible account session is required.' using errcode = '42501';
  end if;
  if operation_id is null or body is null or wallflow_private.utf16_length(body) > 240 then
    raise exception 'Capture requires a request UUID and at most 240 UTF-16 units of text.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(items) <> 'array' then
    raise exception 'Capture checklist must be an array of strings.' using errcode = '22023';
  end if;
  if jsonb_array_length(items) > 24 or exists (
    select 1 from jsonb_array_elements(items) as entry(value)
    where jsonb_typeof(value) <> 'string'
      or wallflow_private.utf16_length(wallflow_private.trim_legacy_text(value #>> '{}')) not between 1 and 120
  ) then
    raise exception 'Capture checklist supports up to 24 items of 1 to 120 UTF-16 units each.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(wallflow_private.trim_legacy_text(value) order by ord), '[]'::jsonb)
    into texts from jsonb_array_elements_text(items) with ordinality as entry(value, ord);
  if body = '' and texts = '[]' then
    raise exception 'Enter note text or a checklist item.' using errcode = '22023';
  end if;

  select * into target from public.workspaces w where w.owner_id = caller for update;
  if not found then raise exception 'Workspace unavailable.' using errcode = 'PT404'; end if;

  current_document := wallflow_private.workspace_document(target);
  -- Django keyed retries on the trimmed body, independent of the selected board.
  digest := case when texts = '[]' then encode(sha256(convert_to(body, 'UTF8')), 'hex')
    else encode(sha256(decode('00', 'hex') || convert_to(jsonb_build_array(body, texts)::text, 'UTF8')), 'hex')
    end;
  select * into receipt from wallflow_private.operation_receipts r
  where r.owner_id = caller and r.operation_id = quick_capture.operation_id;
  if found then
    if receipt.operation_kind <> 'quick_capture' or receipt.request_digest <> digest then
      raise exception 'This capture request was already used.' using errcode = 'PT409', detail = 'capture_conflict';
    end if;
    note_id := (receipt.result ->> 'noteId')::uuid;
    select n.note into selected_note
    from jsonb_array_elements_text(current_document -> 'boardOrder') with ordinality b(key, ord)
    cross join lateral jsonb_array_elements(current_document #> array['boards', b.key, 'document', 'notes']) n(note)
    where n.note ->> 'id' = note_id::text
      and (not receipt.result ? 'boardId' or b.key = receipt.result ->> 'boardId')
    order by b.ord limit 1;
    return jsonb_build_object('note', selected_note, 'noteId', note_id, 'revision', target.revision::text);
  end if;

  board_key := coalesce(board_id, target.active_board_id);
  if not (current_document -> 'boards') ? board_key::text then
    raise exception 'The board is unavailable.' using errcode = 'PT404', detail = 'board_unavailable';
  end if;

  selected_note := wallflow_private.capture_note(target, board_key, body);
  if texts <> '[]' then
    select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'text', value, 'done', false) order by ord)
      into task_items from jsonb_array_elements_text(texts) with ordinality as entry(value, ord);
    selected_note := selected_note || jsonb_build_object('checklist', task_items);
  end if;
  note_id := (selected_note ->> 'id')::uuid;
  next_document := jsonb_set(current_document, array['boards', board_key::text, 'document', 'notes'],
    (current_document #> array['boards', board_key::text, 'document', 'notes']) || jsonb_build_array(selected_note));
  if octet_length(next_document::text) > 6500000 then
    raise exception 'The account workspace is too large.' using errcode = '22023';
  end if;
  target := wallflow_private.replace_workspace(target, current_document, next_document, target.revision + 1);
  insert into wallflow_private.operation_receipts
    (owner_id, workspace_id, operation_id, operation_kind, request_digest, revision, result)
  values (caller, target.id, operation_id, 'quick_capture', digest, target.revision,
    jsonb_build_object('noteId', note_id, 'boardId', board_key));
  return jsonb_build_object('note', selected_note, 'noteId', note_id, 'revision', target.revision::text);
end;
$$;

create or replace function wallflow_private.quick_capture(expected_owner_id uuid, operation_id uuid, content text, board_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select wallflow_private.quick_capture(expected_owner_id, operation_id, content, board_id, null);
$$;

create function public.quick_capture_wallflow_note(expected_owner_id uuid, operation_id uuid, content text, board_id uuid, checklist jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select wallflow_private.quick_capture(expected_owner_id, operation_id, content, board_id, checklist);
$$;

revoke all on function wallflow_private.quick_capture(uuid,uuid,text,uuid,jsonb),
  public.quick_capture_wallflow_note(uuid,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function wallflow_private.quick_capture(uuid,uuid,text,uuid,jsonb),
  public.quick_capture_wallflow_note(uuid,uuid,text,uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
