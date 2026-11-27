import logging
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import logout
from django.db import OperationalError
from django.http import HttpResponseRedirect, JsonResponse
from django.middleware.csrf import get_token, rotate_token
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST
from rest_framework.decorators import api_view
from rest_framework.response import Response

from config.api import login_start_failure

from . import attempts, google
from .services import AccountInactive

logger = logging.getLogger("wallflow.auth")


def _callback_redirect(path):
    if settings.WALLFLOW_CALLBACK_ORIGIN and settings.WALLFLOW_CALLBACK_ORIGIN != settings.WALLFLOW_ORIGIN:
        path = settings.WALLFLOW_ORIGIN + path
    return HttpResponseRedirect(path, status=303)


def _login_error(reason):
    logger.info("google_login_%s", reason)
    return _callback_redirect(f"/sign-in?{urlencode({'login': reason})}")


@require_GET
def csrf_token(request):
    return JsonResponse({"csrfToken": get_token(request)})


@require_POST
@csrf_protect
def google_start(request):
    state, attempt = attempts.new_attempt()
    try:
        url = google.authorization_url(state, attempt["nonce"], attempt["verifier"])
        attempts.store_attempt(request, attempt)
    except (google.GoogleUnavailable, OperationalError):
        logger.warning("google_start_unavailable")
        return login_start_failure(
            request, "unavailable", "unavailable", "Google sign-in is temporarily unavailable.", 503
        )
    return HttpResponseRedirect(url, status=303)


@require_GET
def google_callback(request):
    states = request.GET.getlist("state")
    codes = request.GET.getlist("code")
    errors = request.GET.getlist("error")
    if len(states) != 1 or not states[0] or len(states[0]) > 128:
        return _login_error("invalid")
    if len(codes) > 1 or len(errors) > 1 or (codes and errors):
        return _login_error("invalid")
    code = codes[0] if codes else ""
    if not errors and (not code or len(code) > 2048):
        return _login_error("invalid")

    try:
        attempt = attempts.claim_attempt(request, states[0], exchange=not errors)
        if attempt is None:
            return _login_error("expired")
        if errors:
            return _login_error("denied" if errors[0] == "access_denied" else "unavailable")
        try:
            identity = google.exchange_identity(code, attempt["nonce"], attempt["verifier"])
            if not attempts.finish_attempt(request, attempt["state_hash"], identity=identity):
                return _login_error("expired")
        except google.GoogleUnavailable:
            attempts.finish_attempt(request, attempt["state_hash"])
            return _login_error("unavailable")
        except (google.InvalidGoogleIdentity, AccountInactive):
            attempts.finish_attempt(request, attempt["state_hash"])
            return _login_error("invalid")
    except attempts.LoginAttemptError as exc:
        return _login_error(exc.reason)
    except OperationalError:
        return _login_error("unavailable")

    logger.info("google_login_succeeded")
    return _callback_redirect("/app/")


@api_view(["GET"])
def current_user(request):
    user = request.user
    return Response({"id": str(user.id), "displayName": user.display_name, "email": user.email})


@api_view(["POST"])
def logout_session(request):
    logout(request)
    rotate_token(request)
    return Response(status=204)
