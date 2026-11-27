# WALLFLOW migration progress

## Milestone 1 — Supabase foundation

- Versioned PostgreSQL schema for all 14 application tables, including indexes, ownership relationships, existing content limits, and legacy identity and import records.
- Owner-scoped RLS, session eligibility checks, and an atomic and repeatable workspace initializer.
- Centralized, opt-in Supabase client with PKCE and optional Vite placeholders.
- Test coverage for client configuration, ownership constraints, row isolation, anonymous access, and direct-write denial.
- At Milestone 1 the application used the existing Django login, APIs, and workspaces.

All 193 frontend tests, TypeScript checks, and the Vite build passed at the foundation milestone. Both migrations and all six SQL test groups ran in disposable PostgreSQL 17 using synthetic Auth tables, claims, and API roles.

## Milestone 2 — local Supabase integration and authentication

- The local Supabase CLI applied all three migrations. Both SQL suites passed with ten TAP checks against PostgreSQL and the actual local Auth schema.
- All 201 frontend tests, TypeScript checks, the default Vite production build, and the opt-in preview build passed.
- The Data API test passed using real local Supabase Auth sessions. It covered two-account isolation, anonymous denial, direct-write denial, workspace initialization, a second session on the same account, refresh, revoked-session access, switching accounts, expiry, and disabled profiles.
- The opt-in preview implements Google PKCE, callback cleanup, account selection, and a read-only workspace list. Frontend tests simulate callback success, denial, and failure. Live Google consent and the callback round trip are pending a separate development project and Google OAuth credentials.
- Reconciliation preserves the Django UUID and blocks ambiguous subjects and matched legacy workspaces. Verification used synthetic identity rows and made no changes to the Django database or existing data.

## Milestone 3 — workspace migration and cross-device sync

- Phase A adds full editor snapshots, transactional version-checked writes, idempotency, reviewed browser imports, operator-only Django snapshot import, and workspace export and restore. The legacy export test verifies IDs, order, archive, task data, reminder precision, claims, and original payload retention.
- Phase B adds account-private Realtime revision hints, IndexedDB recovery, reconnect and revision checks, and conflict handling with draft export and explicit resolution. An editor that loses browser storage keeps its draft in the open tab and offers download. One tab per browser profile and account can edit at a time.
- The local Supabase stack exercised synthetic accounts and separate sessions, access isolation, imports, same-note and delete-versus-edit conflicts, and real private Realtime authorization. The preview stays opt-in, with Django as the default.
- Verification passed with 208 frontend tests, 13 SQL checks, the local Data API suite, Chromium laptop and phone viewports, TypeScript checks, and both builds. The browser run covered IndexedDB reload, reconnection, offline sign-out and account switching, and the draft download path when IndexedDB was blocked.
- Live Google consent, physical-device verification, and rehearsal against an approved production-shaped export are separate rollout gates. Any real migration and cutover remain subject to approval.

## Milestone 4

The local staging rehearsal and security verification are recorded in the [Milestone 4 report](../../legacy/django/docs/staging-rehearsal.md). Production cutover is **NO-GO** pending hosted OAuth, physical-device evidence, and operational recovery and rollout sign-off.

## Milestone 5

The [backend parity runbook](../../legacy/django/docs/backend-parity.md) covers Quick Capture, the read-only Django exporter, receipt-aware import and the disposable rehearsal. Django handled the default app during Milestone 5. Hosted application and legacy browser-marker reconciliation are separate approval gates.

## Supabase-only frontend

The ordinary development and production build select Supabase. The former backend and data tools are isolated under [legacy/django](../../legacy/django/README.md). Browser and account recovery, external-client verification, and production data disposition remain separate operational gates. See [recovery and cutover](recovery-and-cutover.md).

## Retirement verification

Supabase is the sole active backend. Backup restore validates ownership and checks the reviewed cloud revision before queuing a replacement. The older import and rehearsal runbooks are archived with the compatibility service.

Local Linux Node 24.22.0 passed clean install, TypeScript, 171 frontend tests, the ordinary production build, and the nine-asset scan. A fresh local Supabase database applied the nine unchanged migrations and passed the read-only catalog check, 20 SQL assertions, and two Data API tests including Chromium, Realtime, offline and cross-origin recovery, and Quick Capture. The isolated legacy rehearsal verified eight synthetic exported accounts, receipt-aware retries and quarantine, 54 Django regression tests, and a restore with matching checksums across 17 application tables.

Hosted migration history, dashboard settings, live Google OAuth, physical phone acceptance, production account migration, old-origin service availability, and external-client sign-off remain operator gates. See the [staging checks](vercel-staging.md) and [retirement procedure](recovery-and-cutover.md).
