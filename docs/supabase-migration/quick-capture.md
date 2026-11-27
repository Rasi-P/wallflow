# Quick Capture

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

## External client migration

The original compatibility endpoint is `POST /api/v1/mobile/quick-capture/`. It uses a Django session, CSRF, the `X-Wallflow-Account` header and a UUID `Idempotency-Key`. The Supabase RPC uses the user's verified Supabase session and the publishable key. The body is `{"content":"...","boardId":"<optional UUID>"}`. The response is `{note,noteId,revision}`, with HTTP 201 for a newly created note and 200 for a replay. The legacy endpoint validates an explicit board before receipt lookup. The Supabase RPC can replay an existing receipt even after that board was deleted. Adapt clients to the RPC response and its error details. See the [archived legacy contract](../../legacy/django/docs/architecture/linked-boards.md#api) for the original endpoint.

For each supported client, authorize a dedicated synthetic account in a development project. Update sign-in and refresh, switch the request to the RPC, and persist the request UUID before sending. If a legacy request is still uncertain, verify its receipt migration before replaying it with the same UUID and content. Test the active board, an explicit board, a full board, another account's board, changed content, and replay after deletion. Keep both endpoints available to known consumers until their migration or retirement has been signed off.

The repository confirms contract tests and documented examples. Installed shortcuts, external scripts, and old deployments still require owner confirmation. Use the [retirement gates](recovery-and-cutover.md) to record their disposition.
