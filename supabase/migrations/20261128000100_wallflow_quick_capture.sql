-- Quick Capture uses the same workspace lock, snapshot writer, and change feed as the editor.
create function wallflow_private.capture_note(target public.workspaces, board_key uuid, body text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  defaults public.board_preferences;
  occupied integer;
  scale double precision;
  angle double precision;
  paper_width double precision;
  paper_height double precision;
  footprint_width double precision;
  footprint_height double precision;
  bound_x double precision;
  bound_y double precision;
  columns double precision[] := array[0, -3.2, 3.2, -6.4, 6.4, -9.6, 9.6, -12.8, 12.8];
  note_x double precision;
  note_y double precision;
  section_key text;
  note jsonb;
begin
  select * into strict defaults from public.board_preferences p
  where p.board_id = board_key and p.owner_id = target.owner_id;

  select count(*) into occupied from public.notes n
  where n.board_id = board_key and n.owner_id = target.owner_id and n.active_slot is not null;
  if occupied >= 60 then
    raise exception 'The board has 60 active notes. Archive a note before capturing another.'
      using errcode = 'PT409', detail = 'board_full';
  end if;

  scale := case defaults.default_note_size when 'compact' then .78 when 'large' then 1.3 else 1 end;
  angle := case when defaults.default_note_rotation = 'straight' then 0
    else (floor(random() * 10801) - 5400) / 100000 end;
  paper_width := 2.62 * scale;
  paper_height := 2.78 * scale;
  footprint_width := abs(cos(angle)) * paper_width + abs(sin(angle)) * paper_height;
  footprint_height := abs(sin(angle)) * paper_width + abs(cos(angle)) * paper_height;
  bound_x := 16 - greatest(2.62, footprint_width / 2 + .15);
  bound_y := 11 - greatest(2.78, footprint_height / 2 + .15);

  with existing as materialized (
    select n.x, n.y, n.rotation_rad, coalesce(n.width, 2.62) as width, coalesce(n.height, 2.78) as height
    from public.notes n where n.board_id = board_key and n.owner_id = target.owner_id and n.active_slot is not null
  ), candidates as (
    select greatest(-bound_x, least(bound_x, col.value)) as x,
      greatest(-bound_y, least(bound_y, row.value)) as y, row.ord as row_order, col.ord as col_order
    from unnest(array[-3.2, 0, 3.2, -6.4, 6.4]::double precision[]) with ordinality row(value, ord)
    cross join unnest(columns) with ordinality col(value, ord)
  )
  select c.x, c.y into note_x, note_y from candidates c
  where not exists (
    select 1 from existing e
    where abs(c.x - e.x) < (abs(cos(e.rotation_rad)) * e.width + abs(sin(e.rotation_rad)) * e.height + footprint_width) / 2 + .12
      and abs(c.y - e.y) < (abs(sin(e.rotation_rad)) * e.width + abs(cos(e.rotation_rad)) * e.height + footprint_height) / 2 + .12
  )
  order by c.row_order, c.col_order limit 1;
  if not found then
    note_x := greatest(-bound_x, least(bound_x, columns[1 + occupied % cardinality(columns)]));
    note_y := greatest(-bound_y, least(bound_y, -8));
  end if;

  select s.id into section_key from public.sections s
  where s.board_id = board_key and s.owner_id = target.owner_id
    and abs(note_x - s.x) <= coalesce(s.width, 7.4) / 2
    and abs(note_y - s.y) <= coalesce(s.height, 5.6) / 2
  order by (note_x - s.x)^2 + (note_y - s.y)^2, s.sort_index limit 1;

  note := jsonb_build_object('id', gen_random_uuid(), 'title', '', 'body', body,
    'position', jsonb_build_array(note_x, note_y), 'rotation', angle, 'color', defaults.default_note_color);
  return note || jsonb_strip_nulls(jsonb_build_object(
    'size', case when scale <> 1 then jsonb_build_array(paper_width, paper_height) end,
    'typography', nullif(defaults.default_note_typography, 'handwritten'),
    'sectionId', section_key));
end;
$$;

create function wallflow_private.quick_capture(expected_owner_id uuid, operation_id uuid, content text, board_id uuid)
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
begin
  if caller is null or caller is distinct from expected_owner_id then
    raise exception 'An eligible account session is required.' using errcode = '42501';
  end if;
  if operation_id is null or body is null or wallflow_private.utf16_length(body) not between 1 and 240 then
    raise exception 'Capture requires a request UUID and 1 to 240 UTF-16 units of text.'
      using errcode = '22023';
  end if;

  select * into target from public.workspaces w where w.owner_id = caller for update;
  if not found then raise exception 'Workspace unavailable.' using errcode = 'PT404'; end if;

  current_document := wallflow_private.workspace_document(target);
  -- Django keyed retries on the trimmed body, independent of the selected board.
  digest := encode(sha256(convert_to(body, 'UTF8')), 'hex');
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

create function public.quick_capture_wallflow_note(expected_owner_id uuid, operation_id uuid, content text, board_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select wallflow_private.quick_capture(expected_owner_id, operation_id, content, board_id);
$$;

revoke all on function wallflow_private.capture_note(public.workspaces,uuid,text),
  wallflow_private.quick_capture(uuid,uuid,text,uuid), public.quick_capture_wallflow_note(uuid,uuid,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function wallflow_private.quick_capture(uuid,uuid,text,uuid),
  public.quick_capture_wallflow_note(uuid,uuid,text,uuid) to authenticated;
