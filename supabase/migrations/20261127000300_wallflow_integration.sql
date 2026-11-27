create table wallflow_private.google_account_bindings (
  owner_id uuid primary key references public.profiles (owner_id) on delete cascade,
  google_sub text not null unique check (google_sub collate pg_catalog."C" ~ '^[!-~]{1,255}$'),
  verified_at timestamptz not null default now()
);

alter table wallflow_private.google_account_bindings enable row level security;
revoke all on table wallflow_private.google_account_bindings from public, anon, authenticated, service_role;

create function wallflow_private.verified_google_subject(account_id uuid)
returns text
language sql stable security invoker
set search_path = ''
as $$
  select min(identity.provider_id) filter (
    where identity.provider = 'google'
      and identity.provider_id collate pg_catalog."C" ~ '^[!-~]{1,255}$'
      and identity.provider_id = identity.identity_data ->> 'sub'
  )
  from auth.identities as identity
  where identity.user_id = account_id
  having count(*) = 1;
$$;

revoke all on function wallflow_private.verified_google_subject(uuid) from public, anon, authenticated, service_role;

-- This operator-only statement approves a new development account or records a
-- legacy mapping. A mapped legacy account stays outside the preview.
create function wallflow_private.reconcile_google_account(account_id uuid, expected_google_sub text)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  verified_sub text;
  bound_sub text;
  legacy wallflow_private.legacy_account_map%rowtype;
begin
  if account_id is null or expected_google_sub is null then
    raise exception 'Verified Google account and subject required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(account_id::text, 0));
  select wallflow_private.verified_google_subject(account.id) into verified_sub
  from auth.users as account
  where account.id = account_id
    and not account.is_anonymous
    and (account.banned_until is null or account.banned_until <= statement_timestamp());

  if verified_sub is null or verified_sub <> expected_google_sub then
    raise exception 'Google identity could not be verified uniquely.' using errcode = '42501';
  end if;

  select binding.google_sub into bound_sub
  from wallflow_private.google_account_bindings as binding
  where binding.owner_id = account_id;
  if bound_sub is not null and bound_sub <> verified_sub then
    raise exception 'Account already has a different Google binding.' using errcode = '23505';
  end if;

  select * into legacy from wallflow_private.legacy_account_map where google_sub = verified_sub for update;
  if legacy.legacy_user_id is not null then
    if not legacy.legacy_is_active or (legacy.owner_id is not null and legacy.owner_id <> account_id) then
      raise exception 'Legacy account requires operator review.' using errcode = '42501';
    end if;
  end if;

  insert into public.profiles (owner_id, is_active)
  values (account_id, legacy.legacy_user_id is null)
  on conflict (owner_id) do nothing;

  insert into wallflow_private.google_account_bindings (owner_id, google_sub)
  values (account_id, verified_sub)
  on conflict (owner_id) do nothing;

  if legacy.legacy_user_id is not null then
    update public.profiles set is_active = false, updated_at = statement_timestamp()
    where owner_id = account_id and is_active;
    update wallflow_private.legacy_account_map set owner_id = account_id, verified_at = statement_timestamp()
    where legacy_user_id = legacy.legacy_user_id and owner_id is null;
  end if;

  return legacy.legacy_user_id;
end;
$$;

revoke all on function wallflow_private.reconcile_google_account(uuid, text) from public, anon, authenticated, service_role;

create or replace function wallflow_private.current_owner_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select profile.owner_id
  from public.profiles as profile
  join auth.users as account on account.id = profile.owner_id
  join auth.sessions as session on session.user_id = profile.owner_id
  left join wallflow_private.google_account_bindings as binding on binding.owner_id = profile.owner_id
  where profile.owner_id = (select auth.uid())
    and profile.is_active
    and not account.is_anonymous
    and (account.banned_until is null or account.banned_until <= statement_timestamp())
    and session.id = case
      when (select auth.jwt() ->> 'session_id') ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
        then (select (auth.jwt() ->> 'session_id')::uuid)
    end
    and session.created_at > statement_timestamp() - interval '336 hours'
    and (session.not_after is null or session.not_after > statement_timestamp())
    and (binding.google_sub is null or binding.google_sub = wallflow_private.verified_google_subject(profile.owner_id))
    and not exists (
      select 1 from wallflow_private.legacy_account_map as legacy
      where legacy.owner_id = profile.owner_id or legacy.google_sub = binding.google_sub
    );
$$;

create function public.read_wallflow_workspace_preview(expected_owner_id uuid)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', workspace.id, 'revision', workspace.revision::text, 'activeBoardId', workspace.active_board_id,
    'boards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', board.id, 'name', board.name, 'notes', coalesce((
          select jsonb_agg(jsonb_build_object('id', note.id, 'title', note.title) order by note.sort_index)
          from public.notes as note
          where note.board_id = board.id and note.archived is not true and note.deleted_at is null
        ), '[]'::jsonb)
      ) order by board.sort_index)
      from public.boards as board
      where board.workspace_id = workspace.id and board.is_live
    ), '[]'::jsonb)
  )
  from public.workspaces as workspace
  where workspace.owner_id = expected_owner_id;
$$;

revoke all on function public.read_wallflow_workspace_preview(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_wallflow_workspace_preview(uuid) to authenticated;
