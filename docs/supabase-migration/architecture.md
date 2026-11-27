# WALLFLOW Supabase architecture

The Supabase foundation includes a versioned schema, owner-scoped reads, an atomic workspace initializer, and an opt-in browser preview. Django handles the default app’s Google sign-in, sessions, workspace sync, browser-board import, and Quick Capture.

The preview requires both Vite mode `supabase-preview` and `VITE_WALLFLOW_SUPABASE_PREVIEW=true`. Its Google PKCE adapter verifies the session and opens the existing editor through the Supabase workspace adapter. The Django editor transport remains the default. Preview reads, edits, and reviewed imports use separate owner-checked Supabase functions.

The target is the existing Vite SPA on Vercel with Google sign-in through Supabase Auth. PostgreSQL will hold the account’s workspace and boards. The editor will keep using the current `Board` and `SavedWorkspace` formats. An adapter will assemble those formats from database rows and translate committed edits into operations.

| Target path | Responsibility |
| --- | --- |
| Vercel SPA | Editor, 3D scenes, task views, device-only mode, and the future OAuth callback route |
| Supabase Auth | Google OAuth, token refresh, and an account UUID for each verified user |
| PostgreSQL | Owner and relationship checks, workspace revisions, transactional writes, import claims, and replay receipts |
| Supabase Realtime | Private notifications of committed revisions. Devices fetch updates from PostgreSQL and catch up after reconnect. |
| Browser IndexedDB | Per-project, per-account snapshots, drafts, and outbox commands. Browser-only data and import markers keep their existing storage and protections. |

Workspace commands compare the expected revision under a row lock and apply once per account and operation ID. The exact editor document, changed board rows, revision, change batch, and receipt commit together. The client rebases nonoverlapping note edits against the latest document. Same-note edits, delete-versus-edit, and incompatible reorders keep both versions until the user resolves them. The existing editor continues to handle undo and redo for the current board session. Applying a changed remote board rebuilds its local history to prevent undo from restoring stale peer data.

Devices receive private revision hints and use conditional document reads to catch up. Reconnect, focus, and periodic checks recover when a hint is missed. A mounted, verified editor can continue offline. Reloading after a cold start requires online session verification before the editor opens an account cache.

Keep each legacy account under one write authority during transition. Reconcile cloud documents and browser source claims before switching an account to Supabase. Django remains the existing runtime and the source for legacy provenance and rollback during cutover.

- [Current Django workspace contract](../architecture/linked-boards.md)
- [Schema](schema.md)
- [RLS and database access](rls-security.md)
- [Google OAuth and legacy identity](google-auth-setup.md)
- [Milestone status](migration-progress.md)
