from pathlib import Path
from urllib.parse import urlsplit

import environ
from django.core.exceptions import ImproperlyConfigured

BACKEND_DIR = Path(__file__).resolve().parents[2]
env = environ.Env()


def public_origin(*, production, variable="WALLFLOW_ORIGIN", default=None):
    if default is None:
        default = "" if production else "http://localhost:8000"
    origin = env.str(variable, default=default)
    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except ValueError as exc:
        raise ImproperlyConfigured(f"{variable} is invalid.") from exc
    if (
        parsed.scheme not in ({"https"} if production else {"http", "https"})
        or not parsed.hostname
        or parsed.username is not None
        or port == 0
        or parsed.path
        or parsed.query
        or parsed.fragment
        or origin != f"{parsed.scheme}://{parsed.netloc}"
    ):
        raise ImproperlyConfigured(f"{variable} must be a canonical origin with no path.")
    if not production and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ImproperlyConfigured(f"Development settings require a loopback {variable}.")
    return origin


DEBUG = False
WALLFLOW_CALLBACK_ORIGIN = None
APPEND_SLASH = False
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = ["accounts.backends.GoogleSessionBackend"]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    "accounts",
    "walls",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "config.middleware.ApiResponseHeaders",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
}]
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["config.api.ApiSessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "config.api.api_exception_handler",
}

TIME_ZONE = "UTC"
USE_TZ = True
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 14 * 24 * 60 * 60
SESSION_SAVE_EVERY_REQUEST = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_PATH = "/"
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_PATH = "/"
CSRF_FAILURE_VIEW = "config.api.csrf_failure"
SECURE_REFERRER_POLICY = "no-referrer"
X_FRAME_OPTIONS = "DENY"


def database(*, production):
    options = {
        "connect_timeout": 5,
        "sslmode": env.str("POSTGRES_SSLMODE", default="verify-full" if production else "disable"),
    }
    if root_certificate := env.str("POSTGRES_SSLROOTCERT", default=""):
        options["sslrootcert"] = root_certificate
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env.str("POSTGRES_DB", default="wallflow"),
        "USER": env.str("POSTGRES_USER", default="wallflow"),
        "PASSWORD": env.str("POSTGRES_PASSWORD", default=""),
        "HOST": env.str("POSTGRES_HOST", default="127.0.0.1"),
        "PORT": env.int("POSTGRES_PORT", default=5432),
        "OPTIONS": options,
    }


LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "{levelname} {name} {message}", "style": "{"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
        "discard": {"class": "logging.NullHandler"},
    },
    "loggers": {
        "wallflow": {"handlers": ["console"], "level": "INFO", "propagate": False},
        # The development access logger includes the OAuth callback query string.
        "django.server": {"handlers": ["discard"], "propagate": False},
        "django.request": {"handlers": ["discard"], "propagate": False},
        "django.security.csrf": {"handlers": ["discard"], "propagate": False},
    },
}
