-- Store the exact editor document alongside its relational projection. All writes
-- below update both in one transaction under the workspace row lock.
create table wallflow_private.workspace_documents (
  workspace_id uuid primary key,
  owner_id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id) on delete cascade
);
alter table wallflow_private.workspace_documents enable row level security;
revoke all on wallflow_private.workspace_documents from public, anon, authenticated, service_role;

create function wallflow_private.document_fields(value jsonb, required jsonb, optional jsonb default '{}')
returns void language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(value) is distinct from 'object'
     or not value ?& array(select jsonb_object_keys(required))
     or exists (
       select 1 from jsonb_each(value) as entry
       where jsonb_typeof(entry.value) is distinct from ((required || optional) ->> entry.key)
     ) then
    raise exception 'Invalid workspace document shape.' using errcode = '22023';
  end if;
end;
$$;

create function wallflow_private.document_pair(value jsonb)
returns double precision[] language plpgsql immutable strict set search_path = '' as $$
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) <> 2
     or jsonb_typeof(value -> 0) <> 'number' or jsonb_typeof(value -> 1) <> 'number' then
    raise exception 'Invalid workspace coordinates.' using errcode = '22023';
  end if;
  return array[(value ->> 0)::double precision, (value ->> 1)::double precision];
end;
$$;

create function wallflow_private.document_day(value text)
returns date language plpgsql immutable strict set search_path = '' as $$
begin
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid workspace calendar date.' using errcode = '22023';
  end if;
  return value::date;
end;
$$;

create function wallflow_private.write_board_document(
  target public.workspaces, board_id uuid, board_order bigint, document jsonb, new_revision bigint
)
returns void language plpgsql set search_path = '' as $$
declare
  prefs jsonb := document -> 'preferences';
  defaults jsonb := prefs -> 'noteDefaults';
  presentation jsonb := document -> 'presentation';
  appearance jsonb := presentation -> 'appearance';
  wall jsonb := document -> 'document';
  angle double precision[];
  position double precision[];
  dimensions double precision[];
  row_value record;
  section jsonb;
  note jsonb;
  item jsonb;
  receipt jsonb;
  reminder jsonb;
  reminder_at numeric;
  item_index integer;
  slot integer := 0;
  note_slot integer;
begin
  perform wallflow_private.document_fields(document, '{"id":"string","name":"string","document":"object","preferences":"object","presentation":"object","notifiedReminders":"array"}');
  perform wallflow_private.document_fields(prefs, '{"showHints":"boolean","onboardingComplete":"boolean","noteDefaults":"object"}');
  perform wallflow_private.document_fields(defaults, '{"color":"string","typography":"string","size":"string","rotation":"string"}');
  perform wallflow_private.document_fields(presentation, '{"lighting":"string","appearance":"object"}');
  perform wallflow_private.document_fields(appearance, '{"theme":"string","shade":"string","intensity":"number","ambience":"string"}', '{"photoWorkspace":"string"}');
  perform wallflow_private.document_fields(wall, '{"notes":"array","sections":"array","wallRotation":"array"}');
  if document ->> 'id' <> board_id::text or (appearance ->> 'intensity') !~ '^[0-9]+$' then
    raise exception 'Invalid board identity or appearance.' using errcode = '22023';
  end if;
  angle := wallflow_private.document_pair(wall -> 'wallRotation');

  insert into public.boards as existing
    (id, workspace_id, owner_id, sort_index, name, tilt_deg, turn_deg, version)
  values (board_id, target.id, target.owner_id, board_order, document ->> 'name', angle[1], angle[2], new_revision)
  on conflict (id) do update set sort_index = excluded.sort_index, name = excluded.name,
    tilt_deg = excluded.tilt_deg, turn_deg = excluded.turn_deg,
    version = excluded.version, updated_at = statement_timestamp()
  where existing.owner_id = target.owner_id and existing.workspace_id = target.id and existing.is_live;
  if not found then raise exception 'Board ID is unavailable.' using errcode = '23505'; end if;

  -- Only changed boards are rebuilt. IDs, array order, and optional fields stay
  -- in the editor snapshot, and the tables enforce the existing domain limits.
  delete from public.board_preferences b where b.board_id = write_board_document.board_id and b.owner_id = target.owner_id;
  delete from public.reminder_receipts r where r.board_id = write_board_document.board_id and r.owner_id = target.owner_id;
  delete from public.notes n where n.board_id = write_board_document.board_id and n.owner_id = target.owner_id;
  delete from public.sections s where s.board_id = write_board_document.board_id and s.owner_id = target.owner_id;
  insert into public.board_preferences (
    board_id, owner_id, theme, photo_workspace, wall_shade, light_intensity, ambience, lighting,
    default_note_color, default_note_typography, default_note_size, default_note_rotation, show_hints, onboarding_complete, version
  ) values (
    board_id, target.owner_id, appearance ->> 'theme', coalesce(appearance ->> 'photoWorkspace', 'professor'),
    appearance ->> 'shade', (appearance ->> 'intensity')::smallint, appearance ->> 'ambience', presentation ->> 'lighting',
    defaults ->> 'color', defaults ->> 'typography', defaults ->> 'size', defaults ->> 'rotation',
    (prefs ->> 'showHints')::boolean, (prefs ->> 'onboardingComplete')::boolean, new_revision
  );

  for row_value in select * from jsonb_array_elements(wall -> 'sections') with ordinality loop
    section := row_value.value;
    perform wallflow_private.document_fields(section, '{"id":"string","name":"string","position":"array"}', '{"size":"array"}');
    position := wallflow_private.document_pair(section -> 'position');
    dimensions := wallflow_private.document_pair(section -> 'size');
    insert into public.sections (board_id, owner_id, id, sort_index, name, x, y, width, height, version)
    values (board_id, target.owner_id, section ->> 'id', row_value.ordinality - 1, section ->> 'name',
      position[1], position[2], dimensions[1], dimensions[2], new_revision);
  end loop;

  for row_value in select * from jsonb_array_elements(wall -> 'notes') with ordinality loop
    note := row_value.value;
    perform wallflow_private.document_fields(note,
      '{"id":"string","title":"string","body":"string","color":"string","position":"array","rotation":"number"}',
      '{"size":"array","typography":"string","doodle":"string","inlineSketches":"boolean","archived":"boolean","sectionId":"string","plannedOn":"string","reminder":"object","checklist":"array","priority":"string","dueDate":"string","completed":"boolean"}');
    position := wallflow_private.document_pair(note -> 'position');
    dimensions := wallflow_private.document_pair(note -> 'size');
    note_slot := null;
    if (note ->> 'archived')::boolean is not true then
      slot := slot + 1;
      note_slot := slot;
    end if;
    insert into public.notes (
      board_id, owner_id, id, sort_index, active_slot, section_id, title, body, color, typography, doodle, inline_sketches,
      x, y, rotation_rad, width, height, priority, due_date, planned_on, completed, archived, version
    ) values (
      board_id, target.owner_id, note ->> 'id', row_value.ordinality - 1, note_slot, note ->> 'sectionId',
      note ->> 'title', note ->> 'body', note ->> 'color', note ->> 'typography', note ->> 'doodle',
      (note ->> 'inlineSketches')::boolean, position[1], position[2], (note ->> 'rotation')::double precision,
      dimensions[1], dimensions[2], note ->> 'priority', wallflow_private.document_day(note ->> 'dueDate'),
      wallflow_private.document_day(note ->> 'plannedOn'), (note ->> 'completed')::boolean, (note ->> 'archived')::boolean, new_revision
    );
    item_index := 0;
    for item in select value from jsonb_array_elements(coalesce(note -> 'checklist', '[]')) loop
      perform wallflow_private.document_fields(item, '{"id":"string","text":"string","done":"boolean"}', '{"plannedOn":"string"}');
      insert into public.checklist_items (board_id, owner_id, note_id, id, sort_index, text, done, planned_on, version)
      values (board_id, target.owner_id, note ->> 'id', item ->> 'id', item_index, item ->> 'text',
        (item ->> 'done')::boolean, wallflow_private.document_day(item ->> 'plannedOn'), new_revision);
      item_index := item_index + 1;
    end loop;
    if note ? 'reminder' then
      reminder := note -> 'reminder';
      perform wallflow_private.document_fields(reminder, '{"id":"string","at":"number"}');
      reminder_at := (reminder ->> 'at')::numeric;
      if trunc(reminder_at) <> reminder_at or reminder_at not between -62135596800000 and 253402300799999 then
        raise exception 'Invalid reminder instant.' using errcode = '22023';
      end if;
      insert into public.reminder_occurrences (board_id, owner_id, note_id, id, scheduled_at, version)
      values (board_id, target.owner_id, note ->> 'id', reminder ->> 'id',
        timestamptz '1970-01-01 00:00:00+00' + reminder_at * interval '1 millisecond', new_revision);
    end if;
  end loop;

  for receipt in select value from jsonb_array_elements(document -> 'notifiedReminders') loop
    if jsonb_typeof(receipt) <> 'string' then raise exception 'Invalid reminder receipt.' using errcode = '22023'; end if;
    insert into public.reminder_receipts (board_id, owner_id, reminder_id, occurrence_id)
    values (board_id, target.owner_id, receipt #>> '{}', (
      select r.id from public.reminder_occurrences r
      where r.board_id = write_board_document.board_id and r.id = receipt #>> '{}'
    ));
  end loop;
end;
$$;

-- Workspaces created by the preview initializer have no document until first write.
create function wallflow_private.initial_workspace_document(target public.workspaces)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('version', 2, 'activeBoardId', target.active_board_id,
    'boardOrder', coalesce(jsonb_agg(b.id order by b.sort_index), '[]'),
    'boards', coalesce(jsonb_object_agg(b.id, jsonb_build_object(
      'id', b.id, 'name', b.name,
      'document', jsonb_build_object('wallRotation', jsonb_build_array(b.tilt_deg, b.turn_deg), 'notes', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', n.id, 'title', n.title, 'body', n.body, 'color', n.color, 'typography', n.typography,
          'doodle', n.doodle, 'inlineSketches', n.inline_sketches, 'archived', n.archived, 'sectionId', n.section_id,
          'position', jsonb_build_array(n.x, n.y), 'rotation', n.rotation_rad,
          'size', case when n.width is not null then jsonb_build_array(n.width,n.height) end,
          'priority', n.priority, 'dueDate', n.due_date, 'plannedOn', n.planned_on, 'completed', n.completed,
          'reminder', (select jsonb_build_object('id', r.id, 'at', (extract(epoch from r.scheduled_at) * 1000)::bigint)
            from public.reminder_occurrences r where r.board_id = b.id and r.note_id = n.id and r.cancelled_at is null),
          'checklist', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.id, 'text', c.text, 'done', c.done, 'plannedOn', c.planned_on)) order by c.sort_index)
            from public.checklist_items c where c.board_id = b.id and c.note_id = n.id)
        )) order by n.sort_index) from public.notes n where n.board_id = b.id and n.deleted_at is null
      ), '[]'), 'sections', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', s.id, 'name', s.name, 'position', jsonb_build_array(s.x,s.y),
          'size', case when s.width is not null then jsonb_build_array(s.width,s.height) end)) order by s.sort_index)
        from public.sections s where s.board_id = b.id
      ), '[]')),
      'preferences', jsonb_build_object('showHints', p.show_hints, 'onboardingComplete', p.onboarding_complete,
        'noteDefaults', jsonb_build_object('color', p.default_note_color, 'typography', p.default_note_typography, 'size', p.default_note_size, 'rotation', p.default_note_rotation)),
      'presentation', jsonb_build_object('lighting', p.lighting, 'appearance', jsonb_strip_nulls(jsonb_build_object(
        'theme', p.theme, 'shade', p.wall_shade, 'intensity', p.light_intensity, 'ambience', p.ambience,
        'photoWorkspace', nullif(p.photo_workspace, 'professor')))),
      'notifiedReminders', coalesce((select jsonb_agg(r.reminder_id order by r.reminder_id)
        from public.reminder_receipts r where r.board_id = b.id), '[]')
    )), '{}'))
  from public.boards b join public.board_preferences p on p.board_id = b.id
  where b.workspace_id = target.id and b.owner_id = target.owner_id and b.is_live;
$$;

create function wallflow_private.workspace_document(target public.workspaces)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce((select d.snapshot from wallflow_private.workspace_documents d where d.workspace_id = target.id and d.owner_id = target.owner_id),
    wallflow_private.initial_workspace_document(target));
$$;

create function wallflow_private.workspace_response(target public.workspaces)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('revision', target.revision::text, 'workspace', wallflow_private.workspace_document(target),
    'claimedSources', coalesce((select jsonb_agg(s.source_id) from wallflow_private.import_sources s
      where s.workspace_id = target.id and s.owner_id = target.owner_id), '[]'));
$$;

create function wallflow_private.replace_workspace(
  target public.workspaces, before_document jsonb, next_document jsonb, new_revision bigint
)
returns public.workspaces language plpgsql set search_path = '' as $$
declare
  entry record;
  board_key uuid;
  changed_ids jsonb := '[]';
begin
  perform wallflow_private.document_fields(next_document, '{"version":"number","activeBoardId":"string","boardOrder":"array","boards":"object"}');
  if next_document -> 'version' <> '2'::jsonb
    or jsonb_array_length(next_document -> 'boardOrder') = 0
    or (select count(*) from jsonb_object_keys(next_document -> 'boards')) <> jsonb_array_length(next_document -> 'boardOrder')
    or not (next_document -> 'boards') ? (next_document ->> 'activeBoardId')
    or exists (select 1 from jsonb_array_elements(next_document -> 'boardOrder') a
      where jsonb_typeof(a) <> 'string' or not (next_document -> 'boards') ? (a #>> '{}'))
    or (select count(distinct a) from jsonb_array_elements(next_document -> 'boardOrder') a)
      <> jsonb_array_length(next_document -> 'boardOrder')
  then raise exception 'Invalid workspace board order.' using errcode = '22023'; end if;

  set constraints public.workspaces_active_board_fkey, public.boards_workspace_id_sort_index_key deferred;
  delete from public.boards b where b.workspace_id = target.id and b.owner_id = target.owner_id
    and not (next_document -> 'boards') ? b.id::text;
  for entry in select * from jsonb_array_elements_text(next_document -> 'boardOrder') with ordinality loop
    board_key := entry.value::uuid;
    if entry.value <> board_key::text then raise exception 'Board IDs must use canonical UUIDs.' using errcode = '22023'; end if;
    if (before_document -> 'boards' -> entry.value) is distinct from (next_document -> 'boards' -> entry.value) then
      perform wallflow_private.write_board_document(target, board_key, entry.ordinality - 1, next_document -> 'boards' -> entry.value, new_revision);
      changed_ids := changed_ids || jsonb_build_array(board_key);
    else
      update public.boards b set sort_index = entry.ordinality - 1
      where b.id = board_key and b.workspace_id = target.id and b.owner_id = target.owner_id and b.sort_index <> entry.ordinality - 1;
    end if;
  end loop;
  update public.workspaces w set revision = new_revision, active_board_id = (next_document ->> 'activeBoardId')::uuid,
    updated_at = statement_timestamp() where w.id = target.id and w.owner_id = target.owner_id returning w.* into target;
  insert into wallflow_private.workspace_documents as d (workspace_id, owner_id, snapshot)
  values (target.id, target.owner_id, next_document)
  on conflict (workspace_id) do update set snapshot = excluded.snapshot;
  insert into public.change_batches (workspace_id, owner_id, revision, changes)
  values (target.id, target.owner_id, target.revision, changed_ids);
  return target;
end;
$$;

create function wallflow_private.read_workspace(expected_owner_id uuid, known_revision text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := wallflow_private.current_owner_id();
  target public.workspaces;
begin
  if caller is null or caller is distinct from expected_owner_id then
    raise exception 'An eligible account session is required.' using errcode = '42501';
  end if;
  select * into target from public.workspaces where owner_id = caller;
  if not found or target.revision::text = known_revision then return null; end if;
  return wallflow_private.workspace_response(target);
end;
$$;

create function wallflow_private.commit_workspace(
  expected_owner_id uuid, operation_id uuid, expected_revision text, next_document jsonb, removed_boards jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := wallflow_private.current_owner_id();
  target public.workspaces;
  receipt wallflow_private.operation_receipts;
  previous_document jsonb;
  digest text;
  actual_removals jsonb;
begin
  if caller is null or caller is distinct from expected_owner_id then
    raise exception 'An eligible account session is required.' using errcode = '42501';
  end if;
  if operation_id is null or expected_revision is null or expected_revision !~ '^[0-9]+$'
    or next_document is null or octet_length(next_document::text) > 6500000 or jsonb_typeof(removed_boards) is distinct from 'array'
  then raise exception 'Invalid workspace command.' using errcode = '22023'; end if;
  select * into target from public.workspaces where owner_id = caller for update;
  if not found then raise exception 'Workspace unavailable.' using errcode = '42501'; end if;

  digest := encode(sha256(convert_to(jsonb_build_array(expected_revision,next_document,removed_boards)::text,'UTF8')), 'hex');
  select * into receipt from wallflow_private.operation_receipts r
    where r.owner_id = caller and r.operation_id = commit_workspace.operation_id;
  if found then
    if receipt.operation_kind <> 'workspace_edit' or receipt.request_digest <> digest then
      raise exception 'This operation ID was already used.' using errcode = '23505';
    end if;
    return wallflow_private.workspace_response(target);
  end if;
  if target.revision::text <> expected_revision then return jsonb_build_object('conflict', true); end if;

  previous_document := wallflow_private.workspace_document(target);
  perform wallflow_private.document_fields(next_document, '{"version":"number","activeBoardId":"string","boardOrder":"array","boards":"object"}');
  select coalesce(jsonb_agg(key order by key), '[]') into actual_removals
    from jsonb_object_keys(previous_document -> 'boards') as key where not (next_document -> 'boards') ? key;
  if actual_removals is distinct from (select coalesce(jsonb_agg(value order by value #>> '{}'), '[]') from jsonb_array_elements(removed_boards))
  then raise exception 'Explicit board removals are required.' using errcode = '22023'; end if;
  target := wallflow_private.replace_workspace(target, previous_document, next_document, target.revision + 1);
  insert into wallflow_private.operation_receipts (owner_id, workspace_id, operation_id, operation_kind, request_digest, revision)
  values (caller, target.id, operation_id, 'workspace_edit', digest, target.revision);
  return wallflow_private.workspace_response(target);
end;
$$;

create function public.read_wallflow_workspace(expected_owner_id uuid, known_revision text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select wallflow_private.read_workspace(expected_owner_id, known_revision);
$$;

create function public.commit_wallflow_workspace(expected_owner_id uuid, operation_id uuid, expected_revision text, next_document jsonb, removed_boards jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select wallflow_private.commit_workspace(expected_owner_id, operation_id, expected_revision, next_document, removed_boards);
$$;

revoke all on function wallflow_private.document_fields(jsonb,jsonb,jsonb), wallflow_private.document_pair(jsonb),
  wallflow_private.document_day(text), wallflow_private.write_board_document(public.workspaces,uuid,bigint,jsonb,bigint),
  wallflow_private.initial_workspace_document(public.workspaces), wallflow_private.workspace_document(public.workspaces),
  wallflow_private.workspace_response(public.workspaces), wallflow_private.replace_workspace(public.workspaces,jsonb,jsonb,bigint),
  wallflow_private.read_workspace(uuid,text), wallflow_private.commit_workspace(uuid,uuid,text,jsonb,jsonb),
  public.read_wallflow_workspace(uuid,text), public.commit_wallflow_workspace(uuid,uuid,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function wallflow_private.read_workspace(uuid,text), wallflow_private.commit_workspace(uuid,uuid,text,jsonb,jsonb),
  public.read_wallflow_workspace(uuid,text), public.commit_wallflow_workspace(uuid,uuid,text,jsonb,jsonb) to authenticated;
