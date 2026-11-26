# WALLFLOW

A personal wall for ideas and reminders, with tactile paper notes on a 3D plaster wall.

## Run with Docker Compose

Docker Desktop runs the development stack as the `wallflow` project.

| Service | Container | Mac access | Container connection |
| --- | --- | --- | --- |
| Vite | `wallflow-frontend-1` | `http://localhost:5174` | Proxies `/api/` to `http://backend:8000` |
| Django | `wallflow-backend-1` | `http://localhost:8002` | Uses PostgreSQL at `db:5432` |
| PostgreSQL 17 | `wallflow-db-1` | Through `docker compose exec db` | Uses the named volume `wallflow_pg17_data` |

### Local configuration

- Keep your existing `backend/.env`. The Django container reads it at runtime for the Django secret key, Google OAuth credentials and preview flag. If the file is missing, copy `backend/.env.example` and follow the [backend setup guide](backend/README.md).
- The repository-root `.env` configures this stack's PostgreSQL role, password, database name and optional published ports. If the file is missing, copy `.env.example` and set `POSTGRES_PASSWORD` to a private value. Compose passes the same database credentials to PostgreSQL and Django. The settings inside Compose use the service hostname `db`. Your backend environment file remains usable for a native setup.
- Before starting, check `lsof -nP -iTCP:5174 -sTCP:LISTEN` and `lsof -nP -iTCP:8002 -sTCP:LISTEN`. Compose sets `WALLFLOW_ORIGIN` to port 5174 and `WALLFLOW_CALLBACK_ORIGIN` to port 8002. If you have a root `.env` from the previous setup, set `WALLFLOW_FRONTEND_PORT=5174` and `WALLFLOW_BACKEND_PORT=8002` there as well.

### Commands

```sh
docker compose config --quiet
docker compose up --build
docker compose ps
docker compose logs -f
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py test --settings=config.settings.test
docker compose exec frontend npm run typecheck
docker compose exec frontend npm test
docker compose exec frontend npm run build
docker compose down
```

Django waits for PostgreSQL to accept TCP connections and then applies pending migrations before starting. Vite waits for Django's database health endpoint. Edits to the mounted application sources reload the development servers. Run `docker compose up --build` after changing dependency files.

`docker compose down` leaves the named PostgreSQL data volume in place. Use the same database settings on subsequent runs. PostgreSQL uses the credentials in `.env` when it initializes an empty volume. To change a password on an existing volume, update the PostgreSQL role first and then the matching configuration. Browser wall data is origin-specific. A wall previously saved on port 5173 stays there. The app on `http://localhost:5174` uses separate browser storage.

### Google OAuth

In Google Cloud Console, register `http://localhost:8002/api/v1/auth/google/callback/` in the existing development Web client. Open the app at `http://localhost:5174` to sign in. Vite proxies the CSRF-protected sign-in request, and Google returns to Django on port 8002. Django redirects the browser to the frontend for a successful sign-in or error. Both URLs use the `localhost` hostname so the browser sends the host-scoped session cookie to both ports.

If port 8002 must change, deliberately set `WALLFLOW_BACKEND_PORT` and register the exact new callback URI in Google Cloud Console. If only the frontend port changes, the existing callback URI stays the same. Use `localhost` consistently in the browser. When the Django preview is enabled in `backend/.env`, its routes also remain available on the backend port.

### Smoke checks and database access

```sh
curl -fsS http://localhost:8002/api/v1/health/
curl -fsS http://localhost:5174/api/v1/health/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/api/v1/auth/csrf/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/api/v1/auth/me/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:8002/api/v1/auth/google/callback/
```

Expect both health requests to report `ok`, CSRF to return 200, and a session-free `/me/` to return 403. The callback smoke check without Google parameters returns 303 to `http://localhost:5174/sign-in?login=invalid`. Use the browser for a full sign-in and sign-out with your development Google account. To verify volume persistence, compare the PostgreSQL cluster identifier before and after `docker compose restart db`. Wait for `docker compose ps` to show the database is healthy again before checking.

```sh
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT system_identifier FROM pg_control_system()"'
```

For a local GUI database client, you can create `docker-compose.override.yml` containing the following mapping and then run Compose from the repository root. First check that 5434 is free.

```yaml
services:
  db:
    ports:
      - "127.0.0.1:5434:5432"
```

## Run locally

Requires Node.js 20.19+ or 22.12+, npm, and the Django authentication service.

1. Follow the [backend setup guide](backend/README.md) to configure PostgreSQL, apply migrations, and supply development Google OAuth credentials. Use the Google callback registration above.
2. From `backend/` with its virtual environment active, start Django with `WALLFLOW_ORIGIN=http://localhost:5174 WALLFLOW_CALLBACK_ORIGIN=http://localhost:8002 python manage.py runserver 127.0.0.1:8002`.
3. From the repository root, start Vite.

```sh
npm install
WALLFLOW_VITE_PROXY_TARGET=http://127.0.0.1:8002 npm run dev -- --port 5174
```

Open `http://localhost:5174`. Vite proxies `/api/` to Django. If you change the frontend port, update `WALLFLOW_ORIGIN`. If you change the backend port, update the Vite proxy target, `WALLFLOW_CALLBACK_ORIGIN` and the registered Google callback.

```sh
npm run typecheck
npm test
npm run build
```

`npm test` uses Node's built-in test runner and TypeScript stripping, so it requires Node 22.18+ (Node 24 LTS is recommended). The app itself supports Vite's Node requirements above.

## Use your wall

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
- **Settings:** wall name, daylight / warm lighting, and interaction hints.
- **Help:** the bottom-right button or **?**.

After Google sign-in, notes and settings remain in this browser's local storage. If storage is blocked or full, the header indicates that work is only available for the session.

## Source layout

```text
src/
  app/                      Application composition
  components/
    wall/                   Solid wall and its attached note group
    sticky-note/            Raycast paper mesh and accessible HTML editor
    toolbar/                Branding, creation tools, camera modes, wall controls
    ui/                     Dialogs, buttons, and rendering fallback
  three/                    Scene, camera rig, paper geometry, procedural textures
  stores/                   Typed Zustand state, persistence, undo and redo
  hooks/                    Keyboard shortcuts
  types/                    Shared domain types
  utils/                    Constants, bounds, and safe local storage
  styles/                   Tailwind entry point and responsive interface styles
tests/                      Store history, persistence, bounds, and 3D invariants
public/fonts/               Self-hosted DM Sans and its open font license
```

## Implementation notes

The wall is a thick Three.js box with a matte, procedurally textured material. Each note is a subdivided paper mesh with a slightly lifted lower edge, a high-resolution canvas texture, contact shading, and real directional-light shadows. Notes and the wall share a parent group. R3F raycasting and pointer capture project drag positions back into the wall's local space, including when the wall is rotated.

Camera controls use Drei OrbitControls with damped movement, responsive framing, bounded pan, orbit and zoom, and animated toolbar actions. The bounds follow the tilted wall and keep the center of the view on its front face. Select, pan, and orbit are explicit modes. Adding a second touch cancels an in-progress note move and hands the gesture to the camera. A completed note move commits one history entry.

The scene draws on demand. Camera, wall and paper motion schedule frames until they settle. Editing, resizing, texture changes and graphics-context recovery request a draw when needed. Reduced motion disables camera easing and wall rotation animation.

For a local comparison, append `?noteRendering=paper-ink` to the wall URL. The prototype uses one shared paper-finish texture and shares full-resolution ink masks across notes with the same writing and doodle, even when their colors differ. Remove the parameter to use the default baked renderer. If the prototype fails to load or its shader fails to link, the wall falls back to baked notes.

## Current limits

- Local storage only; no cross-device sync or collaboration. Clearing browser data removes saved work.
- 60 active notes and 50 undo steps per session. Archived notes take no space on the active wall. Undo history is not persisted.
- Up to 24 freely positioned sections. Filters are kept for the current session.
- One reminder per note and one planned day per note or checklist item. Plans follow the local calendar day. Reminders keep their original instant and display in the current time zone.
- Checklists support up to 24 items. The paper previews the first three and shows progress for the whole checklist.
- Note titles are limited to 72 characters and bodies to 240. The paper view may abbreviate long text; the editor retains it in full.
- Note titles use an installed handwriting face when available. Descriptions, checklists, and the interface use self-hosted DM Sans.
- Fresh walls start with seven sample tasks and a dismissible welcome. The starter arrangement fits around the controls. On mobile, zoom in to read small text. Existing saved walls keep their notes and positions.
- Wall rotation is bounded to ±25° tilt and ±30° turn, applied through its dedicated controls. Reset camera returns to the initial framing.
- WebGL and hardware acceleration are required. Shading and performance depend on the device; pixel density is capped and textures are generated locally.

Google is the supported sign-in provider. Account-based wall storage and import are planned separately.

## Milestone verification

`npm run typecheck`, `npm test`, and `npm run build` passed. Node tests exercise camera bounds at desktop and mobile aspect ratios, overlapping paper raycasts, synthetic touch input, and a 60-note workload. The lazy Three.js vendor chunk is 733 kB minified and 188 kB gzipped. Splitting Three.js core and WebGL into separate chunks or building from modular sources increased the combined gzip size in trial builds.

Use the Compose smoke checks above to verify the running stack and the browser sign-in flow.
# wallflow
