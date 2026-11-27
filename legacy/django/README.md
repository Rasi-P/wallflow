# WALLFLOW legacy service and recovery toolkit

This archive preserves the Django API, PostgreSQL schema, linked-board recovery, Google verification, and Quick Capture contract. The active Vercel frontend builds from the repository root with Supabase.

## Run a reproducible legacy frontend and API

The last complete dual-backend source tree is Git revision `10fa22e`. Extract that revision into a new private directory with `git archive` when the legacy frontend, original development or production Compose stack, or archived frontend tests are needed. Use the pinned checkout's README and deployment files. The Compose and Docker recipes and archived frontend tests refer to the pinned source layout. Run them from the pinned tree. A local Compose instance that bind-mounts this checkout needs the pinned tree for continued legacy operation. Keep the original hostname, browser profile, legacy session configuration, and existing database connection for an approved recovery session. Never start an empty replacement database against that hostname as a recovery shortcut.

To materialize the pinned source locally, use a fresh private directory and extract the exact revision.

```sh
wallflow_legacy_tree=$(mktemp -d)
git archive 10fa22e393c75bcb32ffc4837ead2d90d152cc53 | tar -xf - -C "$wallflow_legacy_tree"
```

The archived Django server and CLI tools can also run without React. Install `backend/requirements.txt` from this archive in a dedicated Python 3.13 environment. For the compatibility API, go to `legacy/django/backend` and follow [its original setup](backend/README.md) with an approved database and same-origin session path. The old root and backend local environment files and database volumes are outside this archive.

## Rehearse with synthetic data

Run the [account exporter and receipt rehearsal](docs/backend-parity.md) and the [backup and restore rehearsal](docs/staging-rehearsal.md) from the repository root. Tool paths are `legacy/django/tools/export_django.py`, `legacy/django/tools/review_browser_recovery.py`, and `legacy/django/rehearsal/`. Keep all exported artifacts outside the checkout with limited access. The read-only exporter uses the legacy model and validation contracts to preserve original bytes and checksums. It performs no destination operations.

## Compatibility retention

The legacy service must stay available for any verified client that still uses session cookies, CSRF, the old board or workspace routes, or the Quick Capture endpoint. This repository confirms previous React, tests, and monitoring consumers. It contains no confirmed distributed shortcut or native client. Ask service owners and review approved method/path/status counts before scheduling retirement. Follow the [production cutover gates](../../docs/supabase-migration/recovery-and-cutover.md).
