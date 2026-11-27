# Supabase database schema

The migrations create WALLFLOW tables in `public` and internal tables in `wallflow_private`. The workspace initializer creates an eligible account’s first board and preferences in one transaction. The development reconciliation function establishes eligibility for a verified new Google identity. Existing legacy mappings are held for the migration milestone.

| Table | Schema and invariant |
| --- | --- |
| `profiles` | Owner UUID derives from `auth.users.id`. Holds display name and active status. Supabase Auth provides the account email. |
| `workspaces` | One workspace per owner. Holds a nonnegative revision and required active board. A deferred composite foreign key requires an active board in the same workspace and owner. |
| `boards` | UUID, owner, workspace, name, order, rotation, version, and reversible deletion timestamp. Preserve existing cloud board UUIDs. |
| `board_preferences` | One row per configured board with theme, photo workspace, shade, light and ambience, note defaults, hints, onboarding, and its own version. |
| `sections` | Text IDs scoped to the board, display order, name, position, optional dimensions, and version. |
| `notes` | Text IDs scoped to the board, title, body, color, artwork, optional typography and dimensions, position, rotation, tasks, section, archive, deletion, order, and version. Sections must belong to the same board. Deleting a section clears the section ID on its notes. |
| `checklist_items` | Text IDs scoped to the parent note, text, completion, order, planned day, and version. |
| `reminder_occurrences` | Board-scoped text IDs, note, precise due instant, cancellation, and version. A partial unique index permits one current occurrence per note. |
| `reminder_receipts` | Board-scoped reminder IDs. An optional occurrence link allows legacy acknowledgements with an unknown time or missing occurrence. An occurrence link, when present, matches the owner, board, and reminder ID. |
| `change_batches` | Workspace revision, commit time, and an array for change metadata. Writers will record affected entity IDs and removals for replay and keep note text out of this feed. |
| `operation_receipts` | Private workspace, owner, operation ID, kind, request digest, revision, and result metadata. Supports workspace and import retries, plus Quick Capture receipts with an original note UUID. The receipt-aware legacy importer retains the original receipt manifest. |
| `import_sources` | Private, globally unique source UUID and workspace ownership. A claim can retain the historical board ID after deletion. |
| `import_intents` | Private source ID, workspace ownership, digest, expiry, confirmed revision, and binding to a Supabase session ID or a legacy session digest. The future import functions must prove the session and claim the source in the same transaction. |
| `legacy_account_map` | Private legacy user UUID, unique Google subject, active status, verified owner UUID, and verification timestamp. Unmatched legacy accounts have no owner UUID. |
| `google_account_bindings` | Private, one-to-one binding between an Auth user UUID and a verified Google subject. Keeps the preview tied to the identity the operator approved. |
| `workspace_documents` | Private version-2 document with the exact editor shape, including optional fields and array order. Transactions maintain its relational projection in the existing board and child tables. |
| `workspace_import_backups` | Private original import text and digest. Browser imports retain the reviewed source text and Django imports retain the original API envelope. |

## Validation and write boundaries

- Each live, unarchived note occupies a unique slot from 1 to 60 per board. Archiving or soft deletion releases the slot while retaining note order. A future create or restore operation must assign an available slot in its transaction.
- Sections and checklist items use unique order indices from 0 to 23 per board and per note, respectively. Order uniqueness can be deferred for an atomic reorder. Board and note order support gaps.
- The schema enforces finite geometry, rotated note bounds, paired dimensions, and the existing appearance, task, and sketch values. Text limits use UTF-16 code units for parity with the browser and Django document validator. ISO calendar days belong in `date` columns. Reminder instants belong in `timestamptz` and must fall on millisecond boundaries.
- A normalized projection can preserve optional legacy values, including absent dimensions, explicit false flags, and non-UUID entity IDs. A browser-only board such as `first-board` receives a cloud UUID during verified import. Keep its source identity and raw snapshot for reconciliation.
- Composite foreign keys enforce parent ownership independently of RLS. Workspace edits and imports advance the revision, refresh changed board rows, record operation receipts, and append change batches together. Legacy account mappings record when the approved workspace was reconciled.
