import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import login
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare

from .services import provision_account

SESSION_KEY = "wallflow_google_attempt"
ATTEMPT_LIFETIME = timedelta(minutes=10)


class LoginAttemptError(Exception):
    def __init__(self, reason):
        self.reason = reason


def _hash_state(state):
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def new_attempt():
    state = secrets.token_urlsafe(32)
    return state, {
        "state_hash": _hash_state(state),
        "nonce": secrets.token_urlsafe(32),
        "verifier": secrets.token_urlsafe(48),
        "expires_at": (timezone.now() + ATTEMPT_LIFETIME).timestamp(),
    }


def _lock_session(key):
    return Session.objects.select_for_update().filter(session_key=key, expire_date__gt=timezone.now()).first()


def _save_session_data(row, data):
    row.session_data = SessionStore().encode(data)
    row.save(update_fields=["session_data"])


@transaction.atomic
def store_attempt(request, attempt):
    key = request.session.session_key
    if key and (row := _lock_session(key)):
        data = row.get_decoded()
        data[SESSION_KEY] = attempt
        _save_session_data(row, data)
        return

    request.session = SessionStore()
    request.session[SESSION_KEY] = attempt
    request.session.set_expiry(timezone.now() + ATTEMPT_LIFETIME)
    request.session.save()


@transaction.atomic
def claim_attempt(request, state, *, exchange):
    if not request.session.session_key or not (row := _lock_session(request.session.session_key)):
        raise LoginAttemptError("expired")
    data = row.get_decoded()
    attempt = data.get(SESSION_KEY, {})
    if not attempt.get("nonce") or not constant_time_compare(attempt.get("state_hash", ""), _hash_state(state)):
        raise LoginAttemptError("invalid")
    expired = attempt["expires_at"] <= timezone.now().timestamp()
    if exchange and not expired:
        data[SESSION_KEY] = {"state_hash": attempt["state_hash"], "expires_at": attempt["expires_at"]}
    else:
        del data[SESSION_KEY]
    _save_session_data(row, data)
    # Return so removal commits before the error redirect is built.
    return None if expired else attempt


@transaction.atomic
def finish_attempt(request, state_hash, *, identity=None):
    key = request.session.session_key
    if not key or not (row := _lock_session(key)):
        raise LoginAttemptError("expired")
    data = row.get_decoded()
    attempt = data.get(SESSION_KEY, {})
    if attempt.get("state_hash") != state_hash or "nonce" in attempt:
        raise LoginAttemptError("invalid")

    del data[SESSION_KEY]
    _save_session_data(row, data)
    if identity is None or attempt["expires_at"] <= timezone.now().timestamp():
        return False

    # Reload after claiming the row so Django cannot restore stale attempt data.
    request.session = SessionStore(session_key=key)
    login(request, provision_account(identity), backend=settings.AUTHENTICATION_BACKENDS[0])
    if request.session.session_key == key:
        request.session.cycle_key()
    request.session.set_expiry(timezone.now() + timedelta(seconds=settings.SESSION_COOKIE_AGE))
    request.session.save()
    return True
