\set ON_ERROR_STOP on
begin;
select '1..2';

insert into auth.users (id,email) values ('69000000-0000-4000-8000-000000000001','capture-checklist@example.invalid');
insert into auth.sessions (id,user_id,created_at)
values ('69000000-0000-4000-8000-000000000002','69000000-0000-4000-8000-000000000001',now());
insert into public.profiles (owner_id,is_active) values ('69000000-0000-4000-8000-000000000001',true);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"69000000-0000-4000-8000-000000000001","session_id":"69000000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare
  owner constant uuid := '69000000-0000-4000-8000-000000000001';
  other_owner constant uuid := '69000000-0000-4000-8000-000000000005';
  op constant uuid := '69000000-0000-4000-8000-000000000003';
  board_key constant uuid := '69000000-0000-4000-8000-000000000004';
  document jsonb;
  board jsonb;
  captured jsonb;
  replayed jsonb;
begin
  perform public.initialize_wallflow_workspace(owner);
  document := public.read_wallflow_workspace(owner) -> 'workspace';
  board := (document #> array['boards', document ->> 'activeBoardId'])
    || jsonb_build_object('id', board_key, 'name', 'Checklist destination');
  document := jsonb_set(document, array['boards', board_key::text], board);
  document := jsonb_set(document, '{boardOrder}', (document -> 'boardOrder') || jsonb_build_array(board_key));
  perform public.commit_wallflow_workspace(owner, gen_random_uuid(), '0', document, '[]');

  captured := public.quick_capture_wallflow_note(owner, op, '', board_key, '[" First ", "Second"]');
  replayed := public.quick_capture_wallflow_note(owner, op, ' ', null, '["First", "Second"]');
  if captured is distinct from replayed or captured ->> 'revision' <> '2'
    or captured #>> '{note,checklist,0,text}' <> 'First' or captured #>> '{note,checklist,1,done}' <> 'false'
    or (select count(*) from public.checklist_items where board_id=board_key and note_id=captured ->> 'noteId') <> 2
  then raise exception 'Checklist request was not committed and replayed atomically on the chosen board.'; end if;
  begin
    perform public.quick_capture_wallflow_note(owner, op, '', board_key, '["Second", "First"]');
    raise exception 'A changed checklist was accepted.';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.quick_capture_wallflow_note(owner, gen_random_uuid(), 'body', board_key, '[null]');
    raise exception 'Invalid checklist content was accepted.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.quick_capture_wallflow_note(owner, gen_random_uuid(), 'body', gen_random_uuid(), '["Item"]');
    raise exception 'An unknown board was accepted.';
  exception when sqlstate 'PT404' then null;
  end;
  begin
    perform public.quick_capture_wallflow_note(other_owner, gen_random_uuid(), 'body', board_key, '["Item"]');
    raise exception 'An unexpected owner was accepted.';
  exception when insufficient_privilege then null;
  end;
  select public.read_wallflow_workspace(owner)->'workspace' into document;
  document := jsonb_set(document, array['boards', board_key::text, 'document', 'notes'], '[]');
  perform public.commit_wallflow_workspace(owner, gen_random_uuid(), '2', document, '[]');
  replayed := public.quick_capture_wallflow_note(owner, op, '', board_key, '["First","Second"]');
  if replayed -> 'note' is distinct from 'null'::jsonb or replayed ->> 'noteId' <> captured ->> 'noteId'
    or replayed ->> 'revision' <> '3' then raise exception 'Deleted checklist receipt was lost.'; end if;
end;
$$;
select 'ok 1 - selected board, authenticated owner, atomic checklist and stable receipts';
select 'ok 2 - changed and invalid inputs fail and deleted-note receipts are replayed';
rollback;
