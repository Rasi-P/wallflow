from secrets import token_urlsafe

from .base import *

environ.Env.read_env(BACKEND_DIR / ".env")
SECRET_KEY = token_urlsafe(64)
WALLFLOW_ORIGIN = "http://localhost:8000"
ALLOWED_HOSTS = ["localhost", "testserver"]
CSRF_TRUSTED_ORIGINS = [WALLFLOW_ORIGIN]
SESSION_COOKIE_NAME = "wallflow-session"
CSRF_COOKIE_NAME = "wallflow-csrf"
WALLFLOW_AUTH_PREVIEW = True
GOOGLE_CLIENT_ID = ""
GOOGLE_CLIENT_SECRET = ""
DATABASES = {"default": database(production=False)}

LOGGING = {**LOGGING, "loggers": {**LOGGING["loggers"], "wallflow": {
    "handlers": ["discard"], "propagate": False,
}}}
