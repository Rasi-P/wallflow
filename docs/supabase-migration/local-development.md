# Local development and safe migration application

## Current app

Use Node 24 and run `npm ci` from the repository root. If you previously used `.env.supabase-preview.local`, copy its URL and publishable key to the ignored `.env.local`. Set the local project URL and publishable key in an ignored `.env.local`. Use `npm run dev` for Vite and `npm run build` for the production build. `npm test`, `npm run typecheck`, and `npm run verify:build` cover the frontend and built assets.

## Isolated Supabase stack

Install or run a current Supabase CLI with a Docker-compatible runtime. This repository already has `supabase/config.toml` and versioned migrations. The local project is `wallflow-supabase-foundation` on API port 55321 and database port 55322. Use synthetic test data.

```sh
supabase start
supabase db push --local --dry-run
supabase db push --local
supabase test db --local
```

A fresh stack may apply migrations during startup. Review the dry run to verify the local target and pending files. The SQL tests use fixture Auth users and sessions inside rolled-back transactions. Run them as the local test administrator using the CLI.

The Data API test creates synthetic password accounts through local Auth, approves their fixture profiles through the local database container, and checks access through the real Data API and Realtime. It removes the accounts it creates. Use the Docker socket at `/var/run/docker.sock` and the project and ports in `config.toml`. Leave Realtime enabled on the local stack. Local email sign-in is enabled for this test harness. Use Google-only settings in hosted development.

```sh
wallflow_local_env=$(mktemp)
supabase status -o env > "$wallflow_local_env"
WALLFLOW_LOCAL_SUPABASE_ENV="$wallflow_local_env" npm run test:supabase:api
rm "$wallflow_local_env"
```

The CLI output file contains local secrets. Keep it private, and pass only the publishable key to the browser.

### Two-browser editor verification

Install Playwright and Chromium in your test environment. Start the isolated preview on loopback port 55329 using the local Supabase API URL and publishable key.

```sh
npm run dev --host 127.0.0.1 --port 55329
```

In another terminal, run the same Data API test with `WALLFLOW_PREVIEW_URL=http://127.0.0.1:55329`. If Playwright is installed outside the repository, also set `WALLFLOW_PLAYWRIGHT_MODULE` to its absolute `index.mjs` path. The test provisions two synthetic accounts and signs in with independent sessions before loading the real editor in laptop and phone viewports.

### Synthetic Django import rehearsal

Use an offline export of fixtures. Build the `{revision, workspace, claimedSources}` envelope from the Django workspace projection. For an unadopted linked board, project the board into a version-2 workspace with its original board UUID as the sole board and retain the original linked document separately. Export a source-to-board manifest with `{sourceId, boardId}` for each claimed source, including a deleted board’s historical UUID. Calculate SHA-256 over the original UTF-8 envelope and retain that export and its receipt manifest.

The development database operator calls `wallflow_private.import_django_workspace(legacy_id, expected_owner_id, original_snapshot, expected_digest, source_manifest)` after staging and verifying the synthetic Google-subject mapping. Use a destination without a workspace. Check the returned revision, exact workspace, source claims, and persisted original before considering the rehearsal successful. Existing Django accounts and unresolved Django browser import markers stay in the current Django workflow.

## Separate hosted development project

1. With approval for external changes, create a new Supabase project for WALLFLOW development. Record the development reference and region and choose a development database password. Use the new project dashboard to confirm the reference before any migration.
2. Review the repository migrations and their tests locally. Link the CLI to the development reference with `supabase link --project-ref <development-project-ref>` from a checkout dedicated to this work. Keep the CLI access token and database password in the CLI credential store or a trusted operations environment. Use the project's authorized migration administrator for the schema, custom role, and managed Auth read grants.
3. Preview the migration plan with `supabase db push --linked --dry-run` on CLI 2.113, or `supabase db push --remote --dry-run` on newer CLI versions that use explicit remote targeting. Verify the linked project reference and the pending WALLFLOW migrations. After approval for the write, apply using the same target flag without `--dry-run`.
4. Configure the development Google provider using the [OAuth setup](google-auth-setup.md). Set the Site URL and callback allowlist for the exact development app origin.
5. Create an ignored `.env.local` file and fill in the development values.

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

6. Start Vite with `npm run dev` and open the allowlisted origin. Build with `npm run build`. Follow the [Vercel runbook](vercel-staging.md) for an approved staging target.
7. For a physical laptop and phone, use an authorized HTTPS development preview origin reachable from both devices. Allowlist that origin’s callback and approve a new Google test account by verified subject. Sign in on each device with that account. Create separate notes, edit the same note from both devices, and disconnect one device before an edit. Reconnect and verify the sync status, the conflict choices, and convergence. Confirm a second test account opens its own workspace.

Use the disposable local stack for the SQL fixture suite. A linked project, a production endpoint, or a Django database connection string is outside that test workflow.

- [Supabase CLI setup](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Local and hosted CLI targets](https://supabase.com/docs/guides/local-development/local-and-hosted-projects)
- [Database tests](https://supabase.com/docs/guides/local-development/testing/overview)

See the [Milestone 4 staging rehearsal](../../legacy/django/docs/staging-rehearsal.md) for an executable synthetic Django export/import and backup/restore runbook, its evidence, and the hosted verification checklist.

The [Vercel HTTPS staging runbook](vercel-staging.md) specifies the dedicated build, callback configuration, migration prerequisites, and staging acceptance checks.
