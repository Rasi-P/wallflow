# Account workspaces

A signed-in account opens its PostgreSQL workspace on every browser. Google OpenID Connect identifies the user. The authenticated Django session determines the owner for all reads and writes. The expected-account value on requests rejects stale tabs. One shared database holds all users' workspaces with a unique account-owned Wall for each user.

The Wall stores the shared revision and its WallDocument stores the ordered boards, notes, sections, checklist and reminder data, and preferences. Opening the workspace initializes an empty account board for a new user. The first open after an upgrade adopts any board already linked on the server. Compatibility document and Quick Capture paths use the same workspace and revision after adoption.

The client loads this workspace before opening the existing editor. It writes account changes with If-Match and refreshes on focus and every 15 seconds in visible tabs. Conflicts preserve the pending in-memory document with an explicit download and reload path. Signing out clears account data from the view. Browser-only mode is available while signed out.

## One-time browser import

Use **Manage boards → Import browser boards** to review names, note counts, layouts, selected boards, and the destination account. Confirmation adds the selected boards to the existing account workspace in one transaction. When a workspace only has the untouched initial empty board, the selected boards take its place. Imported boards receive cloud board IDs. Note IDs and note data are carried over. Browser storage is retained as a recovery copy.

The browser records durable per-source protection before confirming, including account ID, without writing cloud documents to shared browser storage. The server binds the reviewed snapshot hashes to the current authenticated session and claims each source UUID once. Claims and boards commit together. A lost response can recover from the account workspace without duplicating boards. An interrupted claim stays protected until the server confirms it or fences the pending intent. Browser storage is a local record, so copies made before an import cannot be identified as the same source.

## API

All routes below are under `/api/v1/`. They use the existing Django session and CSRF protection.

| Route | Contract |
| --- | --- |
| GET `workspace/` | Opens the authenticated user's workspace. Uses `X-Wallflow-Account` and supports `If-None-Match`. |
| PATCH `workspace/` | Accepts the workspace, expected account and explicit removed board IDs. Requires the last `If-Match`. A stale save returns 412. |
| POST `workspace/import/prepare/` | Binds the selected source UUIDs and SHA-256 snapshot digests to the account session. |
| POST `workspace/import/confirm/` | Commits the reviewed snapshots and source claims atomically, with idempotent replay. |
| POST `wall/link/recover/` | Fences the caller's unconfirmed intent and reports `claimed`, `pending` or `available`. It returns no other account data. |
| POST `mobile/quick-capture/` | Accepts `content` and an optional `boardId` from the same workspace. It uses the active board by default. Requires an account header and UUID idempotency key. |

## Local verification and setup

Run both the Vite frontend and Django backend from the same checkout. The API must include `/api/v1/workspace/`. A build that serves the older local-only frontend will still report **Saved on this device**.

Run the Django migrations before loading the new frontend. Test with PostgreSQL rather than treating SQLite as a concurrency check.

```sh
cd backend
python manage.py migrate
python manage.py test --settings=config.settings.test --noinput
```
