# Milestone 5 Quick Capture and migration preparation

Supabase serves the active app. The isolated Django service retains the original endpoint and export tooling. Hosted migrations and real-account export require separate approval.

## Quick Capture API

The Supabase adapter exposes `createSupabaseWorkspaceCommands(client, ownerId, signal).quickCapture(requestId, content, boardId?)`. A mobile shortcut or other supported client can call the same PostgREST RPC with its signed-in Supabase session and the project's publishable key. The project must have both Milestone 5 migrations applied for migrated receipts to be replayable. Existing Django clients can continue to use their current endpoint and session.

```ts
const { data, error } = await supabase.rpc('quick_capture_wallflow_note', {
  expected_owner_id: verifiedSupabaseUserId,
  operation_id: requestId,
  content,
  board_id: boardId ?? null,
})
```

Open the workspace through the ordinary Supabase initializer before capture. Generate and persist the request UUID before the first send. Reuse it and the same text if the outcome is uncertain. Omit `board_id` or pass null to use the active board at the time a new capture commits. The operation verifies the session and board owner and uses the board's color, typography, size, rotation and placement defaults. Whitespace trimming and the 240 UTF-16-unit limit match Django. The receipt hashes the trimmed UTF-8 body, consistent with the Django contract. Retrying the same key and body keeps the original capture even if the active board or optional target changed.

Both a successful capture and its replay return `{ note, noteId, revision }`. The revision is the current workspace revision. A replay after note or board deletion returns `note: null` and the original `noteId`. A changed body under the same request ID returns HTTP 409 with `details: capture_conflict`. A full board returns HTTP 409 with `details: board_full`. A missing or foreign destination for a new capture returns HTTP 404. The workspace lock serializes captures and editor saves. The transaction advances the revision and writes the document, projection, receipt and change batch. The existing Realtime trigger broadcasts its revision. The workspace read catches up if a notification is missed. [PostgREST database errors](https://docs.postgrest.org/en/stable/references/errors.html)

## Read-only Django exporter

Use a database role with SELECT access to the Django account, wall, preference, document, claim, intent and capture-receipt tables. Set `WALLFLOW_EXPORT_DJANGO_DSN` through a trusted environment. Supply an explicit database, user and host. A non-loopback source requires `sslmode=verify-full`. The exporter does not load Django's application env files or open a Supabase or other destination connection. It enables read-only transactions on the connection and verifies a repeatable-read, read-only source transaction at startup. [PostgreSQL transaction modes](https://www.postgresql.org/docs/17/sql-set-transaction.html)

Run these commands from the repository root with the existing Django virtual environment. Use a new destination directory under a private parent directory outside the repository.

```sh
umask 077
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python legacy/django/tools/export_django.py export "$wallflow_export_dir"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python legacy/django/tools/export_django.py verify "$wallflow_export_dir"
```

The output includes:

- `manifest.json` with all legacy account UUIDs, active status, stored Google subjects, identity candidates, workspace origins, ordered IDs, dispositions and per-file SHA-256 and byte lengths. A subject from this export must still be matched to a verified destination Google identity by the existing operator reconciliation.
- Per-account workspace envelopes, source claims, actual source rows, intent states and capture receipts. Valid linked boards and empty provisioned walls are exported without adopting them in Django. Incomplete data retains its raw artifacts and observed IDs.
- The exact UTF-8 bytes of the PostgreSQL JSON text for stored cloud, notes, sections and reminder receipts, plus legacy wall metadata and preferences. PostgreSQL JSONB has already normalized the original request representation. Preserve this bundle before any further transformation.
- `verification.json` with a manifest SHA-256, artifact validation results and aggregate counts. Keep the bundle private. Google subjects and board contents appear only in the bundle. The exporter excludes database passwords, OAuth/session tokens, Django password data and legacy session digests.

A nonzero exit or a missing verification report leaves the export incomplete. File hashes detect corruption and need an independently retained manifest digest to establish trust in the bundle. Quarantined records require operator review. Exported pending intents are inventory for later disposition. Their Django sessions are unsuitable for confirming an import in Supabase, so they remain outside active Supabase intents.

## Receipt-aware operator import

The existing `wallflow_private.import_django_workspace` remains available for older rehearsal exports. For a bundle with inventoried receipts, call `wallflow_private.import_django_workspace_with_captures` as the database migration operator, with these parameterized inputs in order:

1. Legacy account UUID and verified destination Auth UUID.
2. Exact UTF-8 text from `workspace.json` and its SHA-256.
3. Parsed JSON from `source-claims.json`.
4. Exact UTF-8 text from `capture-receipts.json` and its SHA-256, including an empty array when the source has zero receipts.

The wrapper reuses the existing verified-subject importer and its owner advisory lock. It commits the snapshot, source claims, exact capture manifest and receipts together. It rejects receipt collisions and mismatched checksums. Retry with the identical originals. The existing importer maps an original revision zero to destination revision one and retains the original envelope. Already-populated destinations require operator review. Keep unresolved records outside the import and retain the original files for recovery.

## Repeat the local rehearsal

Copy `supabase/config.toml`, `supabase/migrations/` and `supabase/tests/` to a private scratch root and set the copied `project_id` to `wallflow-m5-verify`. Use the local API and database ports in the checked-in config. Work with an empty throwaway stack, without linking the copy to any hosted project. The following commands create and guard the two synthetic database targets. The source receives Django fixtures and the destination is the local Supabase project's `postgres` database.

```sh
umask 077
supabase start --workdir "$wallflow_rehearsal_root"
supabase status --workdir "$wallflow_rehearsal_root" -o env > "$wallflow_rehearsal_root/local.env"
. "$wallflow_rehearsal_root/local.env"

docker exec supabase_db_wallflow-m5-verify createdb -U postgres wallflow_m5_django_source
docker exec supabase_db_wallflow-m5-verify psql -Xq -U postgres -d wallflow_m5_django_source -v ON_ERROR_STOP=1 -c 'create table public.wallflow_m5_rehearsal_guard (synthetic_only boolean not null check (synthetic_only))'
docker exec supabase_db_wallflow-m5-verify psql -Xq -U postgres -d postgres -v ON_ERROR_STOP=1 -c "comment on database postgres is 'WALLFLOW M5 disposable synthetic rehearsal'"

export WALLFLOW_REHEARSAL_LOCAL_DB_URL="$DB_URL" PYTHONDONTWRITEBYTECODE=1
.venv/bin/python legacy/django/rehearsal/backend_parity.py export "$wallflow_rehearsal_root/export"
.venv/bin/python legacy/django/rehearsal/backend_parity.py import "$wallflow_rehearsal_root/export"
.venv/bin/python legacy/django/rehearsal/backend_parity.py django-tests "$wallflow_rehearsal_root/export"
supabase test db --local --workdir "$wallflow_rehearsal_root"
WALLFLOW_LOCAL_SUPABASE_ENV="$wallflow_rehearsal_root/local.env" \
WALLFLOW_LOCAL_DB_CONTAINER=supabase_db_wallflow-m5-verify npm run test:supabase:api
```

Keep the CLI status file private. The Data API harness uses only loopback and a recognized local container. The browser integration can be enabled using the existing [local development runbook](../../../docs/supabase-migration/local-development.md).

## Next approval gate

Approve HTTPS verification and complete the external-client inventory before retiring the legacy service. Verify the capture contract with any supported shortcut or client and rehearse managed backup and restore. Resolve pending Django browser markers, conflicting or populated destinations, and the production account approval process before any real-account migration.
