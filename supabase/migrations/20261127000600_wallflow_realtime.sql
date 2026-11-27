-- Only an eligible owner can receive this topic. No client publication policy
-- is granted. Broadcasts carry an invalidation revision and no workspace data.
create policy wallflow_workspace_notifications on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'wallflow-workspace:' || (select wallflow_private.current_owner_id())::text
  );

create function wallflow_private.broadcast_workspace_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('revision', new.revision::text), 'workspace_revision',
    'wallflow-workspace:' || new.owner_id::text, true);
  return new;
exception when others then
  -- This is an optimization. A failed delivery cannot roll back the workspace.
  raise warning 'A workspace revision notification could not be queued (%).', sqlstate;
  return new;
end;
$$;

revoke all on function wallflow_private.broadcast_workspace_revision() from public, anon, authenticated, service_role;

create trigger wallflow_workspace_committed after insert on public.change_batches
  for each row execute function wallflow_private.broadcast_workspace_revision();
