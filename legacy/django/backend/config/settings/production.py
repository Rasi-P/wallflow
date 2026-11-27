from .base import *

SECRET_KEY = env.str("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY is required.")

WALLFLOW_ORIGIN = public_origin(production=True)
public_host = urlsplit(WALLFLOW_ORIGIN).hostname
ALLOWED_HOSTS = [f"[{public_host}]" if ":" in public_host else public_host]
CSRF_TRUSTED_ORIGINS = [WALLFLOW_ORIGIN]
SESSION_COOKIE_NAME = "__Host-wallflow-session"
CSRF_COOKIE_NAME = "__Host-wallflow-csrf"
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True
WALLFLOW_AUTH_PREVIEW = False
GOOGLE_CLIENT_ID = env.str("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = env.str("GOOGLE_CLIENT_SECRET")
if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
    raise ImproperlyConfigured("Google OAuth credentials are required in production.")

SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("HSTS_INCLUDE_SUBDOMAINS", default=False)
SECURE_HSTS_PRELOAD = env.bool("HSTS_PRELOAD", default=False)
if env.bool("TRUST_PROXY_HTTPS", default=False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
DATABASES = {"default": database(production=True)}
