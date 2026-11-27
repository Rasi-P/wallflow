\set ON_ERROR_STOP on
begin;
select '1..3';

insert into auth.users (id,email) values ('68000000-0000-4000-8000-000000000001','capture-fixture@example.invalid');
insert into auth.sessions (id,user_id,created_at)
values ('68000000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000001',now());
insert into public.profiles (owner_id,is_active) values ('68000000-0000-4000-8000-000000000001',true);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"68000000-0000-4000-8000-000000000001","session_id":"68000000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare
  owner constant uuid := '68000000-0000-4000-8000-000000000001';
  operation constant uuid := '68000000-0000-4000-8000-000000000003';
  captured jsonb;
  replayed jsonb;
  snapshot jsonb;
  board_id text;
  full_board jsonb;
begin
  perform public.initialize_wallflow_workspace(owner);
  captured := public.quick_capture_wallflow_note(owner, operation, E'  Hello\n');
  replayed := public.quick_capture_wallflow_note(owner, operation, 'Hello');
  if captured is distinct from replayed or captured ->> 'revision' is distinct from '1'
    or captured #>> '{note,body}' is distinct from 'Hello'
    or captured #>> '{note,id}' is distinct from captured ->> 'noteId'
    or captured #> '{note,position}' is distinct from '[0,-3.2]'::jsonb
  then raise exception 'Capture payload or replay was incorrect.'; end if;

  begin
    perform public.quick_capture_wallflow_note(owner, operation, 'Changed content');
    raise exception 'A changed request was accepted.';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.quick_capture_wallflow_note(owner, gen_random_uuid(), repeat('🔬',121));
    raise exception 'An overlong note was accepted.';
  exception when invalid_parameter_value then null;
  end;

  snapshot := public.read_wallflow_workspace(owner) -> 'workspace';
  board_id := snapshot ->> 'activeBoardId';
  select jsonb_agg(jsonb_build_object('id',n::text,'title','','body','','position','[0,0]'::jsonb,'rotation',0,'color','yellow')
    order by n) into full_board from generate_series(1,60) n;
  snapshot := jsonb_set(snapshot, array['boards',board_id,'document','notes'], full_board);
  perform public.commit_wallflow_workspace(owner, gen_random_uuid(), '1', snapshot, '[]');
  replayed := public.quick_capture_wallflow_note(owner, operation, 'Hello');
  if replayed -> 'note' is distinct from 'null'::jsonb or replayed ->> 'noteId' is distinct from captured ->> 'noteId'
    or replayed ->> 'revision' is distinct from '2'
  then raise exception 'Deleting a note lost its capture receipt.'; end if;
  begin
    perform public.quick_capture_wallflow_note(owner, gen_random_uuid(), 'One more');
    raise exception 'A full board accepted a new note.';
  exception when sqlstate 'PT409' then null;
  end;
  if public.read_wallflow_workspace(owner) ->> 'revision' is distinct from '2'
  then raise exception 'A replay or rejected command advanced the revision.'; end if;
end;
$$;
reset role;
select 'ok 1 - trimmed payload, placement, duplicate and changed-request enforcement';
select 'ok 2 - deleted capture replays its UUID and full boards reject new captures';

do $$
declare
  owner constant uuid := '68000000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.change_batches where owner_id=owner) <> 2
    or (select count(*) from wallflow_private.operation_receipts where owner_id=owner and operation_kind='quick_capture') <> 1
    or not exists (
      select 1 from wallflow_private.operation_receipts
      where owner_id=owner and operation_kind='quick_capture' and revision=1
        and request_digest=encode(sha256(convert_to('Hello','UTF8')),'hex')
        and result ? 'noteId' and result ? 'boardId'
    ) then raise exception 'The capture commit or receipt was not atomic.'; end if;
end;
$$;
select 'ok 3 - successful writes have one receipt and one revision each';
rollback;
