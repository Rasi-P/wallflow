# Milestone 4 staging rehearsal

**Historical Milestone 4 record.** The opt-in preview had passed local verification at this milestone. Hosted Google OAuth, physical device testing, and hosted recovery still require sign-off. Django handles ordinary builds and the existing production flow.

## Evidence

| Check | Environment | Result |
| --- | --- | --- |
| Migrations | Fresh isolated Supabase CLI stack and PostgreSQL 17 | Seven migrations applied in filename order, `20261127000100` through `20261127000700`. Local dry run reported zero pending migrations. |
| Build isolation | Vite production and opt-in preview builds | Both built successfully. Ordinary mode selected Django with the preview flag present. Preview build excluded an unrelated synthetic `VITE_` value. Build config rejects a privileged key supplied in the publishable-key variable. |
| Database authorization | Local Supabase SQL suite, then the restored database | 17 assertions across four files passed in each database. They cover owner-only reads, PostgreSQL grants and foreign keys, private operator RPCs and archives, explicit function search paths, and receive-only Realtime policy. |
| Data API and Realtime | Local Supabase Auth and Data API with two synthetic password accounts and independent sessions | Owner initialization, revision and idempotency, cross-account and anonymous denial, denied direct writes, private revision broadcasts, session refresh, logout/revocation, application session expiry, and disabled-profile denial passed. SQL fixtures separately exercised verified Google-subject mapping. |
| Browser editor | Independent Chromium sessions on a laptop, with desktop and mobile viewports | Two-way note creation and sync passed. Account export was downloaded and restored, and the second account's normal restore flow rejected the first account's file. Pending edits survived refresh and reconnect. Offline account switching and blocked IndexedDB passed. Same-note, disjoint-note and delete-versus-edit concurrency also passed at the command layer. |
| Browser data | The local storage parser and local Data API | Legacy `wallflow-wall-v1` and `wallflow-workspace-v2` originals remained byte-for-byte in the fixture store. V2 board UUID and note IDs survived import. The v1 placeholder ID `first-board` obtained a cloud UUID. Pending import session fences, abandoned-intent recovery, altered-snapshot rejection, and an idempotent confirmation retry passed. |
| Export and migration | PostgreSQL Django scratch database and a separate Supabase database | Four synthetic records exported using Django's actual workspace validator and response shape inside a read-only transaction. A multi-board workspace and a legacy linked wall imported. One incomplete record was quarantined and one disabled account stayed ineligible. Wrong subject, owner, checksum, conflicting source manifest and changed replay were rejected. An interrupted transaction left zero workspace or archive rows and no active profile. Retry and post-commit replay passed. |
| Logical backup and restore | Fresh scratch database in the isolated local PostgreSQL 17 cluster | `pg_dump` archive SHA-256 verified before a single-transaction `pg_restore`. Workspace JSON, board and note IDs, board and note ordering, geometry, preferences, archives, checklist and section projections, reminders and surviving or orphaned receipts matched. Source claims, original export bytes, import checksums, identity eligibility and SQL permissions passed after restore. Cron was outside the dump scope. |
| Live Google OAuth | Hosted development project and dedicated Google OAuth client | **Pending.** No dedicated provider configuration or project credentials were available. Local password sessions and synthetic identity rows cover the application and database controls. |
| Physical laptop and phone | Staging HTTPS origin and physical phone browser | **Pending.** No accessible phone or staging origin was available. Chromium laptop and mobile viewports used independent local Auth sessions. |

The rehearsal preserves the legacy linked wall projection, source claims for a deleted board, the original cloud export and its checksum. An unconfirmed Django link intent and a Django quick-capture receipt were inventoried in the export manifest. Those two record types require separate cutover dispositions. The already-open browser import flow retains unresolved source protection until an eligible owner and session can recover it.

All 210 frontend tests and 54 Django tests passed. TypeScript checks and the two production builds passed. Vite emitted its large-chunk warning.

## Repeat the synthetic rehearsal

Use a disposable local stack on ports 55321 and 55322. The rehearsal tools recognize the local project ID `wallflow-m4-rehearsal`. First make a private scratch directory and copy the repository's `supabase/config.toml`, `supabase/migrations` and `supabase/tests` into its `supabase/` directory. Set the copied config's `project_id` to `wallflow-m4-rehearsal`. Start that copy using `supabase start --workdir "$wallflow_rehearsal_root"` after checking that both ports are free. Keep Auth, Data API and Realtime enabled. Set up the backend virtual environment with Django and psycopg using the existing backend requirements, then run from the repository root.

```sh
umask 077
supabase status --workdir "$wallflow_rehearsal_root" -o env > "$wallflow_rehearsal_root/local.env"
. "$wallflow_rehearsal_root/local.env"
export WALLFLOW_REHEARSAL_LOCAL_DB_URL="$DB_URL" PYTHONDONTWRITEBYTECODE=1

docker exec supabase_db_wallflow-m4-rehearsal createdb -U postgres wallflow_m4_django_source
docker exec supabase_db_wallflow-m4-rehearsal createdb -U supabase_admin -T template0 wallflow_m4_restore
docker exec supabase_db_wallflow-m4-rehearsal psql -Xq -U postgres -d wallflow_m4_django_source -v ON_ERROR_STOP=1 -c 'create table public.wallflow_m4_rehearsal_guard (synthetic_only boolean not null check (synthetic_only))'

wallflow_rehearsal_export="$wallflow_rehearsal_root/export"
.venv/bin/python legacy/django/rehearsal/django_round_trip.py export "$wallflow_rehearsal_export"
.venv/bin/python legacy/django/rehearsal/django_round_trip.py import "$wallflow_rehearsal_export"
supabase db push --local --dry-run --workdir "$wallflow_rehearsal_root"
supabase test db --local --workdir "$wallflow_rehearsal_root"

docker exec supabase_db_wallflow-m4-rehearsal pg_dump -Fc -U supabase_admin -d postgres --exclude-schema=cron > "$wallflow_rehearsal_root/workspace.pgdump"
shasum -a 256 "$wallflow_rehearsal_root/workspace.pgdump" > "$wallflow_rehearsal_root/workspace.pgdump.sha256"
shasum -a 256 -c "$wallflow_rehearsal_root/workspace.pgdump.sha256"
docker exec -i supabase_db_wallflow-m4-rehearsal pg_restore --single-transaction --exit-on-error -U supabase_admin -d wallflow_m4_restore < "$wallflow_rehearsal_root/workspace.pgdump"
.venv/bin/python legacy/django/rehearsal/django_round_trip.py restore-compare "$wallflow_rehearsal_export"
.venv/bin/python legacy/django/rehearsal/django_round_trip.py django-tests "$wallflow_rehearsal_export"
```

Keep the status file, export and archive private. The script uses a local database guard, fixed fixture IDs, a fresh export directory and a dedicated Django source database. Repeating the import against the same original verifies a replay. For Data API and Chromium tests, follow the local-development runbook with `WALLFLOW_LOCAL_DB_CONTAINER=supabase_db_wallflow-m4-rehearsal` and the copied stack's private status file. [Local development runbook](../../../docs/supabase-migration/local-development.md)

## Hosted development prerequisites and test cards

1. Provide the development Supabase project reference, URL and publishable key, and a project operator with authorized CLI migration and Auth provider access. Store the CLI access token and database credential in the operator's private credential store.
2. Create a dedicated Google OAuth **Web application** client and add two dedicated test users to its consent configuration. Enter its client ID and secret in that development project's Google provider settings. Register the project's provider callback `https://<dev-project-ref>.supabase.co/auth/v1/callback` in Google Cloud. In Supabase Auth, set the approved development HTTPS origin as Site URL and allowlist the exact `https://<dev-origin>/auth/callback` URL. Add `http://localhost:5173/auth/callback` only for intentional development tests.
3. Make the authorized preview origin reachable from the laptop and phone. Run ordinary Vite with the development `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Serve `/auth/callback`, `/sign-in` and `/app/` via the SPA fallback. Set `Referrer-Policy: no-referrer` and exclude OAuth query strings and credentials from app, proxy and analytics logs. Expose the `public` Data API schema and require private Realtime channels. [Google setup](../../../docs/supabase-migration/google-auth-setup.md) · [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
4. Sign in once with both test accounts. Approve them in the development database through their exact verified Google subjects. Include an unapproved or disabled test identity and a synthetic Django legacy mapping. Check successful sign-in, cancellation, callback cleanup, refresh persistence, a real token refresh, expiry, logout/revocation, account chooser switching, disabled denial and subject-gated legacy reconciliation. Verify that logout revokes that device session and that an independent same-account session can still read its workspace. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)
5. In two physical browsers, sign in with the same approved account. Record browser/OS versions, direction, account alias and expected/observed outcome. Create on laptop and edit on phone, create and switch boards, update sections and checklists, change theme and preferences, interrupt the network, reload pending edits, reconnect, and resolve an edit/edit and an edit/delete conflict. Sign out and switch accounts with a pending offline draft. Check that account B cannot see account A's data or recover its backup. Record each case as passed, failed, or unperformed.

## Security review and production gates

- The build exposes three documented application environment variables. It rejects privileged keys and credentials embedded in the project URL before compiling client assets. Reserved names with extra suffixes fail configuration, and unrelated `VITE_` variables stay private. [Vite environment handling](https://vite.dev/guide/env-and-mode)
- A failed initial IndexedDB read now prevents writes to the unread outbox and blocks browser imports for that editor session. Account and project scope the outbox and enforce the normal restore flow. New memory-only edits can be downloaded before reloading. Exports contain workspace data in plaintext, so keep the files private.
- The database binds each authoritative read and write to the authenticated UUID and an eligible session. Trusted Google subjects are sourced from managed identities, with the original Django UUID retained in the private mapping. Private Realtime messages contain only a revision and trigger a fresh authorized read. Offline sign-out locks the local browser. Remote session revocation requires connectivity or an administrator.
- The credential scan searched tracked and non-ignored working-tree files and locally reachable Git history for recognizable key and token patterns. Hosted service settings, provider integrations, ingress logs and telemetry still require inspection with the development operator. Keep SQL operator errors containing account data or originals in restricted operational logs.

Complete the hosted and physical-device test cards before a production decision. Confirm the distinct production project reference, authorized operators, migration privileges, Google provider credentials and callback, preview configuration, SPA routes, privacy headers, disabled unused sign-in providers, and private Realtime. Check that all deployed eligible production profiles have verified Google bindings. Verify secure-context Web Locks and IndexedDB on supported mobile browsers. Agree on browser-session storage, CSP, token lifetime and revocation response with the security owner.

Prepare a protected Django source export job and dry-run reconciliation report, including duplicate or ambiguous identities, incomplete records, already-populated Supabase workspaces, source collisions and devices with pending local imports. Assign dispositions to Django link intents and quick-capture receipts and verify caller compatibility for the Django quick-capture API. Run the production-shaped suite against hosted development, including realistic workspace sizes and retry load.

Approve the backup schedule, retention, recovery-point and recovery-time objectives, encryption and access controls. Restore a managed backup into an approved separate target and measure recovery. Rehearse the write freeze, final export, checksum and ownership verification, single-writer handoff, and rollback with synthetic changes created after the handoff. Define who can stop the rollout and how post-handoff edits would be recovered into Django if the rollback is invoked. Require separate approval for production deployment and migration. [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
