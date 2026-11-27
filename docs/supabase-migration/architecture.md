# WALLFLOW architecture

Vercel builds the React frontend with Vite. Supabase Auth handles Google OAuth with PKCE. The frontend exchanges the code at `/auth/callback`, scrubs callback parameters, verifies the user through Auth, and opens the workspace only after the database eligibility check. Browser-only mode opens local boards without cloud credentials or network writes.

`src/types/auth.ts` and `src/types/workspace.ts` define the shared account and workspace contracts. The Supabase adapter verifies owner, revision, and command results. Workspace commands enforce ownership in PostgreSQL and commit the document, normalized projections, revision, and idempotency receipt atomically. Direct writes remain restricted by role grants and RLS.

Private Realtime broadcasts carry revision notifications. The client reads committed state after broadcasts and on focus or reconnect. IndexedDB stores a project- and account-scoped base, draft, and any in-flight operation. Independent edits merge. Overlapping edits allow the account owner to download the draft, use the saved version, or keep their changes. A cold start requires online account verification before opening cloud data.

The browser storage readers and recovery markers support existing v1 and v2 boards. New cross-origin exports preserve source UUIDs, and imports use the same reviewed, transactional procedures as in-browser imports. Operator tooling handles historical claims and unsigned recovery files. Quick Capture uses the account's Supabase session and the documented RPC.

- [Schema and relationships](schema.md)
- [Ownership and RLS](rls-security.md)
- [Local development](local-development.md)
- [Vercel and OAuth](vercel-staging.md)
- [Recovery and cutover](recovery-and-cutover.md)
- [Legacy archive](../../legacy/django/README.md)
