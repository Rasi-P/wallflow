-- This uses Supabase Auth's subject and session claims as trusted by its Data API.
-- The definer only returns the caller's eligible owner ID.
create function wallflow_private.current_owner_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select profile.owner_id
  from public.profiles as profile
  join auth.users as account on account.id = profile.owner_id
  join auth.sessions as session on session.user_id = profile.owner_id
  where profile.owner_id = (select auth.uid())
    and profile.is_active
    and (account.banned_until is null or account.banned_until <= statement_timestamp())
    and session.id = case
      when (select auth.jwt() ->> 'session_id') ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
        then (select (auth.jwt() ->> 'session_id')::uuid)
    end
    and session.created_at > statement_timestamp() - interval '336 hours'
    and (session.not_after is null or session.not_after > statement_timestamp());
$$;

revoke all on function wallflow_private.current_owner_id() from public, anon, authenticated, service_role;
grant usage on schema wallflow_private to authenticated;
grant execute on function wallflow_private.current_owner_id() to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'workspaces', 'boards', 'board_preferences', 'sections',
    'notes', 'checklist_items', 'reminder_occurrences', 'reminder_receipts', 'change_batches'
  ] loop
    execute format('grant select on public.%I to authenticated', table_name);
    execute format(
      'create policy owner_read on public.%I for select to authenticated
       using (owner_id = (select wallflow_private.current_owner_id()))',
      table_name
    );
  end loop;
end;
$$;

-- Give the workspace initializer insert-only privileges under owner-scoped RLS.
create role wallflow_workspace_writer nologin noinherit nobypassrls;
grant wallflow_workspace_writer to current_user;
grant usage on schema public, wallflow_private to wallflow_workspace_writer;
grant create on schema wallflow_private to wallflow_workspace_writer;
grant execute on function wallflow_private.current_owner_id() to wallflow_workspace_writer;
grant execute on function wallflow_private.utf16_length(text),
  wallflow_private.trim_legacy_text(text) to wallflow_workspace_writer;

grant select (id, owner_id), insert (id, owner_id, active_board_id)
  on public.workspaces to wallflow_workspace_writer;
grant insert (id, workspace_id, owner_id, sort_index) on public.boards to wallflow_workspace_writer;
grant insert (board_id, owner_id) on public.board_preferences to wallflow_workspace_writer;

create policy initializer_read on public.workspaces for select to wallflow_workspace_writer
  using (owner_id = (select wallflow_private.current_owner_id()));
create policy initializer_insert on public.workspaces for insert to wallflow_workspace_writer
  with check (owner_id = (select wallflow_private.current_owner_id()));
create policy initializer_insert on public.boards for insert to wallflow_workspace_writer
  with check (owner_id = (select wallflow_private.current_owner_id()));
create policy initializer_insert on public.board_preferences for insert to wallflow_workspace_writer
  with check (owner_id = (select wallflow_private.current_owner_id()));

create function wallflow_private.initialize_workspace(expected_owner_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := wallflow_private.current_owner_id();
  new_board_id uuid := gen_random_uuid();
  workspace_id uuid;
begin
  if caller is null or expected_owner_id is distinct from caller then
    raise exception 'An eligible account session is required.' using errcode = '42501';
  end if;

  insert into public.workspaces (id, owner_id, active_board_id)
  values (gen_random_uuid(), caller, new_board_id)
  on conflict (owner_id) do nothing
  returning id into workspace_id;

  if workspace_id is null then
    select workspace.id into strict workspace_id
    from public.workspaces as workspace
    where workspace.owner_id = caller;
    return workspace_id;
  end if;

  insert into public.boards (id, workspace_id, owner_id, sort_index)
    values (new_board_id, workspace_id, caller, 0);
  insert into public.board_preferences (board_id, owner_id) values (new_board_id, caller);
  return workspace_id;
end;
$$;

alter function wallflow_private.initialize_workspace(uuid) owner to wallflow_workspace_writer;
revoke create on schema wallflow_private from wallflow_workspace_writer;
revoke all on function wallflow_private.initialize_workspace(uuid) from public, anon, authenticated, service_role;
grant execute on function wallflow_private.initialize_workspace(uuid) to authenticated;

create function public.initialize_wallflow_workspace(expected_owner_id uuid)
returns uuid
language sql security invoker
set search_path = ''
as $$
  select wallflow_private.initialize_workspace(expected_owner_id);
$$;

revoke all on function public.initialize_wallflow_workspace(uuid) from public, anon, authenticated, service_role;
grant execute on function public.initialize_wallflow_workspace(uuid) to authenticated;
