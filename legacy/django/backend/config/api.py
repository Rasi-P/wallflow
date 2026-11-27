import logging

from django.db import OperationalError, connection
from django.http import HttpResponseRedirect, JsonResponse
from django.views.decorators.http import require_safe
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import (
    APIException,
    AuthenticationFailed,
    MethodNotAllowed,
    NotAuthenticated,
    PermissionDenied,
)
from rest_framework.response import Response

logger = logging.getLogger("wallflow.api")


class CsrfFailed(PermissionDenied):
    pass


class ApiSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        try:
            super().enforce_csrf(request)
        except PermissionDenied:
            raise CsrfFailed() from None


def error_payload(code, message):
    return {"error": {"code": code, "message": message}}


def api_error(code, message, status):
    return JsonResponse(error_payload(code, message), status=status)


def login_start_failure(request, reason, code, message, status):
    if request.get_preferred_type(["application/json", "text/html"]) == "text/html":
        return HttpResponseRedirect(f"/sign-in?login={reason}", status=303)
    return api_error(code, message, status)


def csrf_failure(request, reason=""):
    logger.info("csrf_rejected")
    if request.resolver_match and request.resolver_match.url_name == "auth-google-start":
        return login_start_failure(request, "csrf", "csrf_failed", "CSRF validation failed.", 403)
    return api_error("csrf_failed", "CSRF validation failed.", 403)


def api_exception_handler(exc, context):
    from rest_framework.views import exception_handler

    response = exception_handler(exc, context)
    if isinstance(exc, CsrfFailed):
        response.data = error_payload("csrf_failed", "CSRF validation failed.")
    elif isinstance(exc, (AuthenticationFailed, NotAuthenticated)):
        response.data = error_payload("auth_required", "Sign in to continue.")
    elif isinstance(exc, MethodNotAllowed):
        response.data = error_payload("method_not_allowed", "HTTP method unsupported.")
    elif isinstance(exc, OperationalError):
        logger.warning("database_unavailable")
        return Response(error_payload("unavailable", "Service temporarily unavailable."), status=503)
    elif isinstance(exc, APIException):
        response.data = error_payload(exc.default_code, str(exc.default_detail))
    return response


def server_error(request):
    logger.error("server_error")
    return api_error("server_error", "An unexpected server error occurred.", 500)


@require_safe
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except OperationalError:
        logger.warning("health_database_unavailable")
        return api_error("unavailable", "Service temporarily unavailable.", 503)
    return JsonResponse({"status": "ok"})
