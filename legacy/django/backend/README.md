# WALLFLOW backend

Milestone 11 adds Google sign-in, Django REST Framework session APIs, and the PostgreSQL account schema described in the [architecture document](../docs/architecture/backend-architecture.md). React uses these session APIs before opening the browser wall. The browser wall keeps its local persistence, and the optional Django sign-in preview runs separately.

## Local setup

For the Docker development stack, see the [Compose workflow](../README.md#run-with-docker-compose). The steps below also support a native Django run.

Use Python 3.12 or newer and PostgreSQL 17. From the repository root:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt

cd backend
cp -n .env.example .env
python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())'
```

Put the generated key in `DJANGO_SECRET_KEY` in `backend/.env`. Keep that file private and choose a local database password. Set `POSTGRES_PASSWORD` to the same password.

### PostgreSQL

Start a local PostgreSQL 17 service. An optional Docker example from a shell with access to Docker:

```sh
read -r -s POSTGRES_PASSWORD
export POSTGRES_PASSWORD
docker run --detach --name wallflow-postgres \
  --publish 127.0.0.1:5432:5432 \
  --env POSTGRES_DB=wallflow --env POSTGRES_USER=wallflow --env POSTGRES_PASSWORD \
  --volume wallflow-postgres-data:/var/lib/postgresql/data postgres:17
unset POSTGRES_PASSWORD
docker exec wallflow-postgres pg_isready -U wallflow -d wallflow
```

Alternatively, open `psql` as a local PostgreSQL administrator and create an isolated development database and role. The password prompt keeps the password out of SQL history.

```sql
CREATE ROLE wallflow LOGIN CREATEDB;
\password wallflow
CREATE DATABASE wallflow OWNER wallflow;
```

The development role needs `CREATEDB` for Django's disposable test database. Use a dedicated local database and role when running the test commands.

### Google Cloud Console

1. Select your development project in Google Cloud Console and open **Google Auth Platform**. Configure the consent screen, audience and the scopes for Google sign-in. For an external app in testing, add your Google account as a test user.
2. Use the development OAuth client of type **Web application**. Under **Authorized redirect URIs**, add exactly `http://localhost:8002/api/v1/auth/google/callback/` for Compose and the local steps below.
3. Copy the Console's client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. The preview uses a server-side OAuth flow and needs the redirect URI registration. Keep a separate OAuth client for another environment. [Google OpenID Connect setup](https://developers.google.com/identity/openid-connect/openid-connect)

### Run and verify

From `backend/` with the environment activated:

```sh
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py migrate
WALLFLOW_ORIGIN=http://localhost:8002 WALLFLOW_CALLBACK_ORIGIN=http://localhost:8002 python manage.py runserver localhost:8002
```

Visit `http://localhost:8002/sign-in` with `WALLFLOW_AUTH_PREVIEW=true` to try the isolated flow. `GET /api/v1/health/` returns database connectivity. Django's PostgreSQL tests use provider mocks and synthetic signing keys. The isolated test settings read PostgreSQL variables from the environment or your local `backend/.env`. They use an ephemeral Django key and ignore any Google credentials.

```sh
python manage.py test --settings=config.settings.test
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DJANGO_SECRET_KEY` | Required unique Django signing secret. The isolated test settings generate an ephemeral key. |
| `WALLFLOW_ORIGIN` | Exact frontend origin with optional port, no trailing slash. Compose sets it to `http://localhost:5174`. Production requires HTTPS. |
| `WALLFLOW_CALLBACK_ORIGIN` | Optional development-only OAuth callback origin. Defaults to `WALLFLOW_ORIGIN` and must share its loopback hostname and scheme. Compose sets it to `http://localhost:8002` by default. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Required for Google sign-in. Automated tests use stubs and require neither credential. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT` | PostgreSQL connection and role. Development defaults are database and role `wallflow`, host `127.0.0.1` and port `5432`. Supply the password for your role. |
| `POSTGRES_SSLMODE` | Defaults to `disable` locally and `verify-full` in production. Install the database server CA as required by libpq for verification. |
| `WALLFLOW_AUTH_PREVIEW` | Opt-in development preview at `/sign-in` and protected `/app/`. |
| `DJANGO_SETTINGS_MODULE` | Defaults to `config.settings.development` for management commands and `config.settings.production` for WSGI. Production reads injected environment variables. |
| `TRUST_PROXY_HTTPS` | Production only. Enable when a trusted TLS proxy strips client-supplied forwarding headers and sets `X-Forwarded-Proto`. |
| `HSTS_INCLUDE_SUBDOMAINS`, `HSTS_PRELOAD` | Production opt-ins. Enable only after confirming HTTPS for the domain and all its subdomains. |

## Authentication API

| Method and path | Behavior |
| --- | --- |
| `GET /api/v1/health/` | Public. Returns 200 `{"status":"ok"}` when a database query succeeds, or 503 `unavailable`. |
| `GET /api/v1/auth/csrf/` | Public. Returns a masked `csrfToken` and sets the HttpOnly CSRF cookie. |
| `POST /api/v1/auth/google/start/` | Send a top-level form with `csrfmiddlewaretoken`. Returns 303 to Google. JSON clients receive 403 `csrf_failed` or 503 `unavailable`. Browser form failures redirect to `/sign-in?login=csrf` or `/sign-in?login=unavailable`. |
| `GET /api/v1/auth/google/callback/` | Google redirects with `code` and `state`, or a rejection. Returns 303 to `/app/` or `/sign-in?login=invalid\|expired\|denied\|unavailable`. |
| `GET /api/v1/auth/me/` | Returns `{"id":"uuid","displayName":null,"email":null}` with profile values when available. Returns 403 `auth_required` without a valid session. |
| `POST /api/v1/auth/logout/` | Authenticated POST with `X-CSRFToken`. Returns 204, deletes the session, expires its cookie and rotates CSRF. |

Serve the API and React on the same origin. For local development use the [React setup](https://github.com/Rasi-P/wallflow/blob/10fa22e393c75bcb32ffc4837ead2d90d152cc53/README.md#run-locally) and keep `WALLFLOW_AUTH_PREVIEW=false` in Django when using React. The frontend checks `/auth/me/` before loading the workspace, reads a fresh masked CSRF token for sign-in or logout, and leaves the browser's saved wall in place. With the development callback on port 8002 and React on port 5174, Django sends the browser back to the frontend after handling the callback. A production reverse proxy should route `/api/` to Django and serve the React entry document for `/app/` and `/sign-in`.

Django validates the Google response against pinned Discovery endpoints and Google signing keys. It validates issuer, audience, authorized party where applicable, expiry, issue time, nonce and signature. A ten-minute server-side attempt binds the callback to the browser with one-time state and PKCE S256. The stable Google subject uniquely identifies the account and is never returned by `/auth/me/`. The first successful login creates the account, empty primary wall and default preferences in one transaction. Later sign-ins reuse them. [Google OIDC Discovery](https://accounts.google.com/.well-known/openid-configuration) · [PyJWT validation](https://pyjwt.readthedocs.io/en/stable/api.html)

Cookies are host-only, HttpOnly and SameSite Lax, with Secure and `__Host-` names in production. The default session lifetime is 14 days absolute. The API sends no CORS allow headers and only the configured same-origin URL is listed as a trusted CSRF origin. Auth responses are uncacheable. Keep any future reverse proxy logs free of OAuth callback queries, cookies and request bodies. Operations should schedule `python manage.py clearsessions` and configure edge rate limits for the public auth routes before exposing them. [Django sessions](https://docs.djangoproject.com/en/5.2/topics/http/sessions/) · [Django CSRF](https://docs.djangoproject.com/en/5.2/howto/csrf/)
