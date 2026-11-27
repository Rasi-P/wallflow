# Row level security and database access

All WALLFLOW tables enable RLS. Authenticated browser clients can select eligible rows in the ten tables in `public`. A policy permits a row only when the row owner matches the verified session owner. Before returning that owner, a private database helper checks the active profile, Supabase Auth ban state, and the matching, current `auth.sessions` row. The session must be younger than 14 days and within any Supabase session cutoff. Missing, revoked, malformed, mismatched, expired, and inactive sessions fail closed.

Anonymous clients have no application table or initializer grants. Authenticated clients have no direct table writes. The private schema is excluded from the Data API. Authenticated clients have schema usage for the narrow function calls used by policies and the initializer. The private tables have neither client grants nor client policies. The migrations explicitly remove automatic API role grants on new tables and functions.

The initializer remains a security-invoker wrapper around a private function with limited column grants. The full document read, commit, and browser import functions use explicit grants on fixed-search-path wrappers. The private functions resolve the owner from the eligible Auth session, compare the expected owner, and scope all workspace and board mutations to that owner. Direct browser writes, access to original import payloads, and execution of the Django migration function are denied.

The migration administrator alone can reconcile an account through `wallflow_private.reconcile_google_account`. The function checks the trusted Google identity in `auth.identities`, locks approval for that account, and preserves one-to-one subject and UUID mappings. Bound profiles lose access if their identity changes or becomes ambiguous. Legacy matches remain ineligible until the snapshot, source claims, and reconciliation marker commit. The local test operator enables synthetic password profiles to exercise RLS with real Auth sessions. Approve hosted preview profiles through reconciliation.

Composite keys guard child writes at the database level. They cover active-board selection, notes and sections, checklist items, reminder occurrences and receipts, workspace receipts and changes, and imported source targets. The public owner policies include the owner’s recoverable records. Future UI projections should filter deleted content as appropriate. Privileged roles and project database credentials belong in the migration or operations environment.

Realtime uses private `wallflow-workspace:<owner UUID>` topics. RLS authorizes subscriptions and revision hints carry no note or board content. Data reads verify eligibility on each request, including when an existing WebSocket's authorization has not refreshed. Drafts live in IndexedDB under the exact Supabase project origin and Auth UUID. Another account's session cannot mount or submit that outbox. Keep the preview behind an authorized browser profile because browser storage is accessible to scripts running on the same origin.

- [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Data API grants and function security](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)
