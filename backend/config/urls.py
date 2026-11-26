from django.conf import settings
from django.urls import include, path

from .api import health

urlpatterns = [
    path("api/v1/health/", health, name="health"),
    path("api/v1/auth/", include("accounts.urls")),
]
handler500 = "config.api.server_error"

if settings.WALLFLOW_AUTH_PREVIEW:
    from accounts import preview

    urlpatterns += [
        path("sign-in", preview.sign_in, name="preview-sign-in"),
        path("app/", preview.workspace, name="preview-workspace"),
    ]
