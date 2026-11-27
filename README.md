# WALLFLOW

WALLFLOW is a 3D sticky-note workspace. The Vite frontend runs on Vercel, with Supabase Auth for Google sign-in and Supabase PostgreSQL for account workspaces.

## Local development

Use Node 24 and the npm lockfile. For an isolated local Supabase stack or an authorized development project, follow the [local setup](docs/supabase-migration/local-development.md).

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the ignored `.env.local` before sign-in. Use the same allowlisted origin throughout Google PKCE. **Use this browser only** opens device-local boards. Browser-only data belongs to that browser origin.

```sh
npm run typecheck
npm test
npm run build
npm run verify:build
```

## Use your wall

- **First launch:** choose **Set up my wall** to pick an environment, paper color, and starter notes, or open a blank wall immediately. The optional eight-step tour highlights live controls. Dismissing or completing setup keeps the welcome off on future visits.
- **Select (V):** drag a note in its wall plane. Double-click to edit. On mobile, tap a note and choose **Edit note**.
- **Pan (H):** drag the wall, right-drag with a mouse, or use two fingers on a touch screen.
- **Orbit (O):** drag to move the camera around the wall.
- **Zoom:** scroll, pinch with two fingers, or use the toolbar. **0** resets the camera.
- **Rotate wall:** adjust tilt and turn, then apply. This transforms the wall and all its children independently of the camera. Straighten resets only the wall.
- **Add (N):** start typing on a new note near the center of the view. Text saves as you type. Enter, Cmd/Ctrl+Enter, Done, or clicking outside finishes editing. Shift+Enter adds a line break. Escape removes an empty new note.
- **Selected note:** use the contextual tools to edit, recolor, rotate, resize, duplicate, or delete. Drag a corner to resize proportionally, or use the size buttons. Cmd/Ctrl+D duplicates the selected note.
- **Task details:** open this section in the inline note editor to write and reorder a checklist, set a priority or due date, and mark the note complete. The selected note's task menu also lets you reopen or archive it.
- **Today and daily plan:** open the calendar button in the header. Today shows due, overdue, and planned work and notes with reminders set for today. Check off items directly or jump back to their notes on the wall. Choose **Plan my day** to select whole notes or individual checklist items without changing their due dates. Planned notes and planned checklist items count separately toward the daily progress shown in the panel and on the calendar button.
- **Reminders:** set a date and time in a note’s **Task details**. The **Reminders** tab shows upcoming and overdue alerts for open notes. Use **Enable notifications** there to grant browser permission. Alerts require an open WALLFLOW tab. A missed, unsent reminder can be delivered when you reopen WALLFLOW, and a reminder sent by this tab stays recorded after refresh.
- **Deadlines and archive:** choose **Deadlines** for all active due dates. Open **Archive** to restore a note to its old position or confirm permanent deletion. You can undo archive and restore. Permanent deletion removes the note from undo history.
- **Undo / redo:** toolbar, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, or Ctrl+Y. A drag is a single history entry.
- **Search and filters:** open the search button or press Cmd/Ctrl+K. Search titles, descriptions, and checklists. Combine priority, completion, due date, section, and archive filters. Select an active result to focus it or an archived result to open it in Archive. Clear filters from the search panel or the wall footer.
- **Sections:** open **Sections** in search to create, rename, delete, or focus a section. Drag its label in Select mode or use the arrow buttons in the section editor. A dropped note joins the section under its center. Use **Note options** to assign a section without moving the note. Deleting a section leaves its notes on the wall.
- **Focus:** select a note and press **F** or choose **Focus note** from **Note options**. Select a section name in the directory to focus it. **0** or the reset button restores the home view.
- **Settings:** the default Personal Study Room includes a recessed daylight window, oak desk, and bookshelf. Professor’s Study, Creative Studio, and Scientist’s Lab remain available as wall finishes. Adjust plaster shade, lighting tone and intensity, and ambience, or set the color, title lettering, size, and rotation for new notes. Appearance settings apply immediately. **Reset appearance and note defaults** keeps your wall name, hints, notes, and their placement.
- **Help:** the bottom-right button or **?** opens the wall guide and keyboard shortcut reference. Start the walkthrough again from Help or Settings.

After signing in with Google, WALLFLOW opens the wall saved on this browser. Anyone who signs in on the same browser origin can access that local data. On first load, WALLFLOW copies existing `wallflow-wall-v1` data into the first board in `wallflow-workspace-v2` and retains the original key as a backup. The workspace is independent of the Google account. Sign out under **Wall settings → Google account**. The header shows when storage is unavailable and current changes are available only for the session.

## Architecture and deployment

- [Active architecture](docs/supabase-migration/architecture.md) and [database security](docs/supabase-migration/rls-security.md)
- [Vercel deployment](docs/supabase-migration/vercel-staging.md) and [Google OAuth](docs/supabase-migration/google-auth-setup.md)
- [Legacy recovery and cutover](docs/supabase-migration/recovery-and-cutover.md)
- [Quick Capture for external clients](docs/supabase-migration/quick-capture.md)
- [Archived Django compatibility service](legacy/django/README.md)

The workspace supports 60 active notes per board, 24 sections, and 24 checklist items per note. Undo history is device-session state. Reminders use the open browser and its notification permission. Account drafts are saved to a project- and account-scoped IndexedDB outbox and replayed after verification and reconnection. Keep exports before clearing browser storage.
