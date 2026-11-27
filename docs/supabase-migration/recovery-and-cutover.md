# Recovery and cutover

## Browser data

Keep the old origin and the user's original browser profile available. Local storage and IndexedDB belong to the exact scheme, hostname, and port. A new Vercel host cannot read the old origin's data.

1. Keep an original copy of `wallflow-wall-v1` or `wallflow-workspace-v2` and the old-origin recovery records. Do not clear browser storage. At the old origin, serve the Supabase frontend only after preserving an accessible legacy recovery entry point.
2. For local, unclaimed boards, use **Use this browser only → Manage boards → Export browser boards** on the original origin. The existing readers hydrate v1 or v2 data. Export uses persisted board snapshots and assigns stable source UUIDs. It skips linked, pending, and unknown boards.
3. At the new origin, verify the signed-in destination account. Use **Manage boards → Import browser export**, review the selected boards, and confirm. The import keeps the original file and adds approved boards through the owner-scoped prepare and confirm transaction. The server keeps source claims across repeated uploads, checks revisions, and retains the original board payload. Where a local board ID cannot become a cloud UUID or collides, verify the destination ID via its source claim. Note and section contents and IDs remain part of the imported document.
4. Inspect the destination and compare board order, note and checklist IDs, reminders, appearance, and archive state. Keep the original export and source browser. Avoid editing both the old and migrated board copies after verification.

## Protected sources and old downloads

Preserve `wallflow-board-link-v1:<boardId>` and the `wallflow-board-link-recovery` IndexedDB entries. Treat pending and phase-less entries as protected. Reconcile their source UUID, intent, verified legacy owner, and any historical claim on the legacy system. Use the original authenticated recovery path to resolve or fence a late confirm. Missing Supabase records alone cannot release protection.

For `wallflow-unsaved-workspace.json` and `wallflow-browser-recovery.json`, keep the unsigned original and obtain an operator review. The first is a workspace draft. The second is a board array which can contain already-claimed sources. For each board, establish consent and provenance, verify the original Google subject if account-linked, and compare it against the committed source and target. A validated already-claimed board should be restored on its verified account through a reviewed reconciliation of missing edits. Keep both versions of conflicts and compare explicitly. Never upload an old draft as a full replacement for a populated workspace.

For positively verified **unclaimed** boards in a v2 file or board array, the isolated tool can prepare a portable import. Run it from a private working directory using the archive's Python environment.

```sh
python legacy/django/tools/review_browser_recovery.py /private/path/original.json
python legacy/django/tools/review_browser_recovery.py /private/path/original.json --review /private/path/review.json --output /private/path/wallflow-browser-export.json
```

Use the SHA-256 printed by the first command in the review file. Record only positively verified source decisions, for example `{"sha256":"<original-sha256>","boards":[{"boardId":"<original-board-id>","sourceId":"<original-source-uuid>","status":"verified-unclaimed"}]}`. The tool verifies the exact input bytes, board contract, source uniqueness, and selected IDs. Operator review is the source of the claim decision. The tool uses neither database and creates only a new private output file. Import that output through the same review UI. For raw v1 files, use the old-origin reader and portable export above. If the old origin or original claims cannot be verified, hold the file for manual recovery.

Current Supabase account backups restore only into the source account and project after validation and explicit confirmation. Restore requires a synced online workspace. If the cloud revision changed during review, export the latest head and review the backup again. Export the current head before replacing it. Project/account-scoped outboxes are separate from cloud backups. Resolve or export conflict drafts before clearing browser data, moving origins, or replacing a workspace.

## Quick Capture clients

- Confirmed in repository history: Django HTTP and Supabase RPC contract tests, and documented API examples.
- Possible consumers: previously distributed shortcuts, manual scripts, or an older first-party deployment. Their owners and usage remain unverified.
- Keep the isolated endpoint available until each confirmed consumer has a documented retirement or has passed its new [Quick Capture RPC contract](quick-capture.md) test. Check legacy access counts using method, path, and status only. Never use cookies, tokens, bodies, or OAuth query strings as inventory.

## Required production approvals and manual steps

1. Inventory legacy production accounts, origins, clients, jobs, monitors, and retention obligations. Assign an owner and disposition to each unresolved case. Approve a recovery window and a rollback operator.
2. Verify a restore from immutable legacy backups. Run the read-only exporter with an authorized SELECT-only DSN. Retain original bytes, source and receipt manifests, checksums, and the verification report. Inventory existing destination workspaces before approving any legacy mapping.
3. Rehearse the receipt-aware import, pending markers and backup restore using synthetic data. Confirm the target Supabase migration ledger, managed Auth read grants, private Realtime, and exposed API schemas. Obtain separate approval for real data or any hosted migration. Establish a final legacy write fence during the approved window before taking the final snapshot.
4. Reconcile only verified Google subjects, with a review for disabled, ambiguous, incomplete, or populated accounts. Import with the original snapshot checksum and source/receipt manifests. Compare counts, IDs, ordering, claims, and receipts. Confirm retries and the ability to restore. Retain the source and legacy service through the verification and recovery period.
5. Deploy the approved revision with Vercel Node 24 and only the target URL and publishable key. Follow the [Vercel acceptance checklist](vercel-staging.md) on a laptop and physical HTTPS phone. Verify Google sign-in, session expiry and revocation, isolation, sync and conflicts, exports and restore, and the supported capture client. Keep both origins reachable for recovery.
6. Retire the legacy runtime only after the migration, recovery, external-client, and rollback owners sign off. Keep the archived tooling and backups through the approved retention period.
