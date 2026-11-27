# WALLFLOW HTTPS staging

## Vercel setup after approval

Use a dedicated Vercel staging project and one stable HTTPS hostname, written here as `https://<staging-host>`. Select an approved source snapshot that includes the Supabase preview and [Vercel routing configuration](../../vercel.json). The current feature work is local and uncommitted. A Git deployment of the branch's current commit would omit it.

| Vercel setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | Repository root |
| Node.js | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build -- --mode supabase-preview` |
| Output Directory | `dist` |
| `VITE_WALLFLOW_SUPABASE_PREVIEW` | `true` |
| `VITE_SUPABASE_URL` | `https://cxxpjrkzlhjaqxalkyct.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The `sb_publishable_` key from development project `cxxpjrkzlhjaqxalkyct` |

Scope the build settings and variables to the dedicated staging target. Keep Google client credentials in the development Supabase provider and Supabase secret keys, legacy service-role JWTs, and database credentials in the operator's private environment. Supply only the three values above to the static frontend build. Exclude private `.env` files and credential artifacts from any build upload. A preview-mode build fails when the flag is absent or false or when required configuration is missing. Vite validates the key format and project origin before emitting assets. [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel environment scopes](https://vercel.com/docs/environment-variables) · [Supabase API key types](https://supabase.com/docs/guides/getting-started/api-keys)

The route config uses internal rewrites to `/index.html` for `/`, `/sign-in`, `/auth/callback`, `/app`, and `/app/`. These rewrites leave the path and query in the browser until the app processes them. The callback has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Leave slash canonicalization off so a request to `/auth/callback` reaches the exact path the handler expects. Assets are served directly. The static staging host has no Django proxy or catch-all API rewrite. The ordinary `npm run dev`, Compose workflow, and local Supabase `npm run dev -- --mode supabase-preview` stay available. [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json)

## OAuth configuration after approval

| Setting | Exact value |
| --- | --- |
| Google development OAuth web client, authorized redirect URI | `https://cxxpjrkzlhjaqxalkyct.supabase.co/auth/v1/callback` |
| Development Supabase Auth Site URL | `https://<staging-host>` |
| Development Supabase Auth Redirect URLs | `https://<staging-host>/auth/callback` and `http://localhost:5173/auth/callback` |

Keep existing intentional local allowlist entries and use the same stable hostname on laptop and phone. The app derives its return URL from the browser origin. Start and finish each PKCE sign-in in the same browser on that origin. If Vercel deployment protection is enabled, make sure both test devices can complete the callback while authorized. Browse and test only as synthetic development accounts. Approve new synthetic identities through the documented verified Google-subject workflow. [WALLFLOW Google setup](google-auth-setup.md) · [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) · [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)

## Hosted migration prerequisites

The repository review covered these nine files in order. Milestone 5 recorded a successful application on a disposable local PostgreSQL 17 stack. Milestone 7 checked the SQL and its dependencies without applying migrations or querying the linked project. Before staging, an authorized operator must confirm the target reference, migration history, existing object ownership and grants, managed schema compatibility, and backup or recovery arrangements. Use the project's migration administrator for DDL and verified-account onboarding. Keep the Data API exposure restricted to `public` for WALLFLOW and verify private Realtime channels. [Supabase CLI targets](https://supabase.com/docs/guides/local-development/local-and-hosted-projects) · [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)

| Migration | Prerequisite or check for hosted development |
| --- | --- |
| `20261127000100_wallflow_schema.sql` | The migration account can create the app tables and private schema and reference managed `auth.users`. Confirm the target has no conflicting WALLFLOW objects outside recorded migrations. |
| `20261127000200_wallflow_access.sql` | The migration account can create and grant the restricted `wallflow_workspace_writer` role, transfer initializer ownership, and define the API grants and RLS. The owner helper reads `auth.users` and `auth.sessions`. |
| `20261127000300_wallflow_integration.sql` | Managed `auth.identities` provides `provider`, `provider_id`, and `identity_data`. Keep reconciliation operator-only and check eligible users have the expected verified Google binding. |
| `20261127000400_wallflow_workspace_commands.sql` | The earlier workspace schema and eligible-owner helper are present. Confirm the Data API exposes the authenticated read and commit wrappers with direct writes still denied. |
| `20261127000500_wallflow_imports.sql` | Depends on the earlier receipts, claim tables, and workspace writer. Validate session-bound intents, private original snapshots, and restricted operator imports. |
| `20261127000600_wallflow_realtime.sql` | Managed Realtime provides `realtime.messages` with RLS, `realtime.topic()`, and `realtime.send(jsonb,text,text,boolean)`. The migrator needs the privileges for the managed policy and commit trigger. |
| `20261127000700_preserve_reconciled_workspace_access.sql` | Depends on the Google binding and reconciliation timestamp added in earlier migrations. Verify the effective operator routine preserves access on an identical retry. |
| `20261128000100_wallflow_quick_capture.sql` | Depends on the locked workspace writer, private receipts and revision feed. Verify the Quick Capture RPC is visible to eligible authenticated users. |
| `20261128000200_wallflow_legacy_capture_receipts.sql` | Depends on the earlier private import archive, legacy importer, and receipt contract. Verify the receipt-aware function stays operator-only. This is required for the synthetic legacy capture rehearsal. |

A missing migration or hosted prerequisite blocks the corresponding acceptance check. Review and authorize any hosted application separately.

## Deployment verification checklist

Record the host, deployment revision, device and browser, synthetic account alias, and observed result for each check. Until it has been performed, leave it pending.

- [ ] **HTTPS and routing.** Open all five routes directly. They serve the SPA. Assets serve normally and `/api/v1/health/` does not return the SPA. Request `/auth/callback?code=synthetic-routing-check` and verify a direct HTML response with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and no `Location` redirect. In the browser, verify the callback receives the query and then clears it. Inspect callback telemetry for query redaction using synthetic requests.
- [ ] **Google PKCE.** Start sign-in from the stable HTTPS hostname on the laptop and physical phone. Verify the authorize request uses the exact callback and an S256 challenge. Sign in, test cancellation, and verify successful return to the editor after callback cleanup. Keep the existing localhost Google flow in the smoke test.
- [ ] **Eligibility and sessions.** A verified, approved synthetic account opens the editor. An unapproved or disabled account stays blocked. Verify retry after approved onboarding, session persistence on reload, token refresh or expiry, and sign-out and account switching.
- [ ] **Workspace initialization.** For a fresh approved account, confirm the first board is created. Refresh and sign in on the second device and confirm the same workspace and first-board IDs.
- [ ] **Notes, boards and Quick Capture.** Create, edit, and archive a note, create and switch boards, and confirm changes on the other device. Run Quick Capture through the documented RPC using the user's session. Test the default and explicit targets, then retry a request UUID and verify the same note ID without duplication. [Quick Capture contract](backend-parity.md#quick-capture-api)
- [ ] **Realtime and offline recovery.** Verify private revision notifications and updates in both directions. Disconnect one device during an edit, verify the local draft, then reconnect and confirm convergence. Exercise a same-note conflict and check that the local draft stays recoverable.
- [ ] **Two-account isolation.** The second synthetic account sees only its own workspace, cannot read or write the first account's boards, cannot subscribe to its private topic, and does not replay its IndexedDB outbox.
- [ ] **Zero Django API requests.** Record method and path only while signing in, opening the workspace, editing, importing synthetic browser boards, capturing, syncing, and signing out. Confirm no requests hit `/api/v1/` or the legacy backend. Verify the original Django development entry point separately.

The checklist is for staging acceptance. Legacy client retirement and unresolved Django browser recovery remain separate cutover work.
