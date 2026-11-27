-- Retrying identity reconciliation after snapshot import must preserve access.
create or replace function wallflow_private.reconcile_google_account(account_id uuid, expected_google_sub text)
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
    where owner_id = account_id and is_active and legacy.workspace_reconciled_at is null;
    update wallflow_private.legacy_account_map set owner_id = account_id, verified_at = statement_timestamp()
    where legacy_user_id = legacy.legacy_user_id and owner_id is null;
  end if;

  return legacy.legacy_user_id;
end;
$$;

revoke all on function wallflow_private.reconcile_google_account(uuid, text) from public, anon, authenticated, service_role;
