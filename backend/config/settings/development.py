from .base import *

environ.Env.read_env(BACKEND_DIR / ".env")
SECRET_KEY = env.str("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY is required.")
WALLFLOW_ORIGIN = public_origin(production=False)
WALLFLOW_CALLBACK_ORIGIN = public_origin(
    production=False, variable="WALLFLOW_CALLBACK_ORIGIN", default=WALLFLOW_ORIGIN
)
app_origin, callback_origin = urlsplit(WALLFLOW_ORIGIN), urlsplit(WALLFLOW_CALLBACK_ORIGIN)
if (app_origin.scheme, app_origin.hostname) != (callback_origin.scheme, callback_origin.hostname):
    raise ImproperlyConfigured("WALLFLOW_CALLBACK_ORIGIN must use the app's scheme and hostname.")
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]
CSRF_TRUSTED_ORIGINS = [WALLFLOW_ORIGIN]
SESSION_COOKIE_NAME = "wallflow-session"
CSRF_COOKIE_NAME = "wallflow-csrf"
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = WALLFLOW_ORIGIN.startswith("https://")
WALLFLOW_AUTH_PREVIEW = env.bool("WALLFLOW_AUTH_PREVIEW", default=False)
GOOGLE_CLIENT_ID = env.str("GOOGLE_CLIENT_ID", default="")
GOOGLE_CLIENT_SECRET = env.str("GOOGLE_CLIENT_SECRET", default="")
DATABASES = {"default": database(production=False)}
