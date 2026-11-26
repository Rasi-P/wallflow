import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from urllib.parse import parse_qs, urlsplit
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.contrib.sessions.models import Session
from django.db import OperationalError, connection, connections
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from walls.models import Wall, WallPreference

from . import attempts, google
from .models import User

IDENTITY = google.GoogleIdentity("google-subject", "first@example.test", "First User")


def start(client):
    token = client.get(reverse("auth-csrf")).json()["csrfToken"]
    response = client.post(reverse("auth-google-start"), {"csrfmiddlewaretoken": token})
    state = parse_qs(urlsplit(response["Location"]).query)["state"][0]
    return state


def callback(client, state, **query):
    return client.get(reverse("auth-google-callback"), {"state": state, **query})


@patch("accounts.google._metadata", return_value=google.ENDPOINTS)
@patch("accounts.google.exchange_identity", return_value=IDENTITY)
class AuthTests(TestCase):
    def setUp(self):
        self.browser = Client(enforce_csrf_checks=True)

    def login(self, client=None):
        client = client or self.browser
        return callback(client, start(client), code="stub-code")

    def test_login_provisions_user_wall_and_preferences(self, exchange, metadata):
        state = start(self.browser)
        key = self.browser.cookies[settings.SESSION_COOKIE_NAME].value
        data = Session.objects.get(pk=key).get_decoded()
        attempt = data[attempts.SESSION_KEY]
        self.assertNotIn(state, str(data))

        response = callback(self.browser, state, code="stub-code", email="untrusted@example.test")
        self.assertEqual((response.status_code, response["Location"]), (303, "/app/"))
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        self.assertIn("no-store", response["Cache-Control"])
        exchange.assert_called_once_with("stub-code", attempt["nonce"], attempt["verifier"])

        user = User.objects.get(google_sub=IDENTITY.sub)
        self.assertFalse(user.has_usable_password())
        self.assertFalse(user.is_staff)
        self.assertEqual(user.wall.revision, 0)
        self.assertEqual(user.wall.preferences.theme, "minimal")
        self.assertFalse(user.wall.preferences.onboarding_complete)
        self.assertFalse(Session.objects.filter(pk=key).exists())
        cookie = response.cookies[settings.SESSION_COOKIE_NAME]
        self.assertNotEqual(cookie.value, key)
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertEqual(self.browser.get(reverse("auth-me")).json(), {
            "id": str(user.id), "email": IDENTITY.email, "displayName": IDENTITY.display_name,
        })

    def test_repeat_login_reuses_account_and_wall_even_when_profile_changes(self, exchange, metadata):
        self.login()
        user = User.objects.get()
        wall_id = user.wall.id
        exchange.return_value = google.GoogleIdentity(IDENTITY.sub, "new@example.test", "Renamed")
        new_browser = Client(enforce_csrf_checks=True)
        self.login(new_browser)
        user.refresh_from_db()
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(Wall.objects.get().id, wall_id)
        self.assertEqual(WallPreference.objects.count(), 1)
        self.assertEqual(user.email, "new@example.test")
        self.assertEqual(new_browser.get(reverse("auth-me")).json()["id"], str(user.id))

    def test_same_email_is_not_shared_identity(self, exchange, metadata):
        self.login()
        exchange.return_value = google.GoogleIdentity("other-subject", IDENTITY.email, "Second User")
        second = Client(enforce_csrf_checks=True)
        self.login(second)

        first_user = User.objects.get(google_sub=IDENTITY.sub)
        other_user = User.objects.get(google_sub="other-subject")
        self.assertNotEqual(first_user.wall.id, other_user.wall.id)
        self.assertEqual(
            self.browser.get(reverse("auth-me"), {"userId": other_user.id}).json()["id"],
            str(first_user.id),
        )
        self.assertEqual(second.get(reverse("auth-me")).json()["id"], str(other_user.id))

    def test_wrong_state_and_wrong_browser_cannot_use_attempt(self, exchange, metadata):
        state = start(self.browser)
        self.assertEqual(callback(self.browser, "wrong", code="stub-code")["Location"], "/sign-in?login=invalid")
        second = Client(enforce_csrf_checks=True)
        self.assertEqual(callback(second, state, code="stub-code")["Location"], "/sign-in?login=expired")
        exchange.assert_not_called()
        self.assertEqual(callback(self.browser, state, code="stub-code")["Location"], "/app/")

    def test_callback_replay_is_rejected(self, exchange, metadata):
        state = start(self.browser)
        old_cookie = self.browser.cookies[settings.SESSION_COOKIE_NAME].value
        callback(self.browser, state, code="stub-code")
        another = Client()
        another.cookies[settings.SESSION_COOKIE_NAME] = old_cookie
        self.assertEqual(callback(another, state, code="stub-code")["Location"], "/sign-in?login=expired")
        self.assertEqual(exchange.call_count, 1)

    def test_replay_is_rejected_before_the_first_exchange_returns(self, exchange, metadata):
        state = start(self.browser)
        parallel = Client()
        parallel.cookies[settings.SESSION_COOKIE_NAME] = self.browser.cookies[settings.SESSION_COOKIE_NAME].value

        def exchange_identity(*args):
            response = callback(parallel, state, code="replayed-code")
            self.assertEqual(response["Location"], "/sign-in?login=invalid")
            return IDENTITY

        exchange.side_effect = exchange_identity
        self.assertEqual(callback(self.browser, state, code="stub-code")["Location"], "/app/")
        exchange.assert_called_once()

    def test_replaced_in_flight_attempt_does_not_provision_or_authenticate(self, exchange, metadata):
        first = start(self.browser)
        parallel = Client()
        parallel.cookies[settings.SESSION_COOKIE_NAME] = self.browser.cookies[settings.SESSION_COOKIE_NAME].value

        def exchange_identity(*args):
            start(parallel)
            return IDENTITY

        exchange.side_effect = exchange_identity
        self.assertEqual(callback(self.browser, first, code="stub-code")["Location"], "/sign-in?login=invalid")
        self.assertFalse(User.objects.exists())
        self.assertEqual(self.browser.get(reverse("auth-me")).status_code, 403)

    def test_replaced_attempt_uses_latest_state(self, exchange, metadata):
        first = start(self.browser)
        second = start(self.browser)
        self.assertEqual(callback(self.browser, first, code="old-code")["Location"], "/sign-in?login=invalid")
        self.assertEqual(callback(self.browser, second, code="new-code")["Location"], "/app/")
        self.assertEqual(exchange.call_count, 1)

    def test_expired_attempt_is_rejected(self, exchange, metadata):
        state = start(self.browser)
        future = timezone.now() + timedelta(minutes=11)
        with patch("accounts.attempts.timezone.now", return_value=future):
            self.assertEqual(callback(self.browser, state, code="stub-code")["Location"], "/sign-in?login=expired")
        exchange.assert_not_called()

    def test_denial_and_invalid_identity_create_no_session_or_account(self, exchange, metadata):
        state = start(self.browser)
        response = callback(self.browser, state, error="access_denied", error_description="private message")
        self.assertEqual(response["Location"], "/sign-in?login=denied")
        self.assertEqual(callback(self.browser, state, code="stub-code")["Location"], "/sign-in?login=invalid")
        exchange.assert_not_called()

        exchange.side_effect = google.InvalidGoogleIdentity
        self.assertEqual(self.login()["Location"], "/sign-in?login=invalid")
        self.assertEqual(self.browser.get(reverse("auth-me")).status_code, 403)
        self.assertFalse(User.objects.exists())
        self.assertFalse(Wall.objects.exists())

    def test_provider_outage_returns_bounded_failure(self, exchange, metadata):
        exchange.side_effect = google.GoogleUnavailable("sensitive provider details")
        response = self.login()
        self.assertEqual(response["Location"], "/sign-in?login=unavailable")
        self.assertFalse(User.objects.exists())

    def test_start_reports_unavailable_when_the_first_session_cannot_be_saved(self, exchange, metadata):
        client = Client(enforce_csrf_checks=True, raise_request_exception=False)
        token = client.get(reverse("auth-csrf")).json()["csrfToken"]
        with patch("accounts.attempts.SessionStore.create", side_effect=OperationalError("private database detail")):
            response = client.post(reverse("auth-google-start"), {"csrfmiddlewaretoken": token})

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "unavailable")
        self.assertNotContains(response, "private database detail", status_code=503)
        self.assertNotIn("Location", response.headers)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, response.cookies)
        self.assertFalse(Session.objects.exists())

    def test_browser_login_start_failures_redirect_to_sign_in(self, exchange, metadata):
        denied = self.browser.post(reverse("auth-google-start"), HTTP_ACCEPT="text/html,application/xhtml+xml,*/*")
        self.assertEqual((denied.status_code, denied["Location"]), (303, "/sign-in?login=csrf"))
        metadata.side_effect = google.GoogleUnavailable
        token = self.browser.get(reverse("auth-csrf")).json()["csrfToken"]
        failed = self.browser.post(
            reverse("auth-google-start"), {"csrfmiddlewaretoken": token}, HTTP_ACCEPT="text/html,application/xhtml+xml,*/*"
        )
        self.assertEqual((failed.status_code, failed["Location"]), (303, "/sign-in?login=unavailable"))
        self.assertNotIn(settings.SESSION_COOKIE_NAME, failed.cookies)
        exchange.assert_not_called()

    def test_absolute_expiry_is_saved_and_expired_session_is_rejected(self, exchange, metadata):
        self.login()
        key = self.browser.cookies[settings.SESSION_COOKIE_NAME].value
        row = Session.objects.get(pk=key)
        remaining = row.expire_date - timezone.now()
        self.assertGreater(remaining.total_seconds(), settings.SESSION_COOKIE_AGE - 5)
        self.assertLessEqual(remaining.total_seconds(), settings.SESSION_COOKIE_AGE)
        self.browser.get(reverse("auth-me"))
        self.assertEqual(Session.objects.get(pk=key).expire_date, row.expire_date)
        Session.objects.filter(pk=key).update(expire_date=timezone.now() - timedelta(seconds=1))
        response = self.browser.get(reverse("auth-me"))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "auth_required")

    def test_disabled_account_loses_access_and_cannot_login_again(self, exchange, metadata):
        self.login()
        User.objects.update(is_active=False)
        self.assertEqual(self.browser.get(reverse("auth-me")).status_code, 403)
        self.assertEqual(self.login()["Location"], "/sign-in?login=invalid")

    def test_csrf_rejection_and_logout_invalidate_session(self, exchange, metadata):
        stale_token = self.browser.get(reverse("auth-csrf")).json()["csrfToken"]
        denied = self.browser.post(reverse("auth-google-start"))
        self.assertEqual((denied.status_code, denied.json()["error"]["code"]), (403, "csrf_failed"))
        denied = self.browser.post(
            reverse("auth-google-start"), {"csrfmiddlewaretoken": stale_token}, HTTP_ORIGIN="https://other.test"
        )
        self.assertEqual(denied.status_code, 403)

        self.login()
        key = self.browser.cookies[settings.SESSION_COOKIE_NAME].value
        denied = self.browser.post(reverse("auth-logout"), HTTP_X_CSRFTOKEN=stale_token)
        self.assertEqual((denied.status_code, denied.json()["error"]["code"]), (403, "csrf_failed"))
        token = self.browser.get(reverse("auth-csrf")).json()["csrfToken"]
        logged_out = self.browser.post(reverse("auth-logout"), HTTP_X_CSRFTOKEN=token)
        self.assertEqual(logged_out.status_code, 204)
        self.assertEqual(logged_out.cookies[settings.SESSION_COOKIE_NAME]["max-age"], 0)
        self.assertFalse(Session.objects.filter(pk=key).exists())
        self.assertEqual(self.browser.get(reverse("auth-me")).status_code, 403)

    def test_unauthenticated_routes_and_optional_preview(self, exchange, metadata):
        self.assertEqual(self.browser.get(reverse("auth-me")).json()["error"]["code"], "auth_required")
        self.assertEqual(self.browser.post(reverse("auth-logout")).status_code, 403)
        self.assertEqual(self.browser.get("/app/")["Location"], "/sign-in")
        preview = self.browser.get("/sign-in")
        self.assertContains(preview, "Continue with Google")
        self.assertTrue(preview.cookies[settings.CSRF_COOKIE_NAME]["httponly"])
        self.assertNotIn("Access-Control-Allow-Origin", self.browser.get(reverse("auth-csrf")).headers)
        self.assertEqual(self.browser.get(reverse("auth-csrf"), HTTP_HOST="foreign.test").status_code, 400)
        self.login()
        self.assertContains(self.browser.get("/app/"), "First User")

    def test_start_binds_s256_to_server_side_verifier(self, exchange, metadata):
        token = self.browser.get(reverse("auth-csrf")).json()["csrfToken"]
        response = self.browser.post(reverse("auth-google-start"), {"csrfmiddlewaretoken": token})
        self.assertEqual(response.status_code, 303)
        query = parse_qs(urlsplit(response["Location"]).query)
        key = self.browser.cookies[settings.SESSION_COOKIE_NAME].value
        attempt = Session.objects.get(pk=key).get_decoded()[attempts.SESSION_KEY]
        digest = hashlib.sha256(attempt["verifier"].encode()).digest()
        self.assertEqual(query["code_challenge"], [base64.urlsafe_b64encode(digest).rstrip(b"=").decode()])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["nonce"], [attempt["nonce"]])
        self.assertEqual(query["redirect_uri"], [settings.WALLFLOW_ORIGIN + google.CALLBACK_PATH])
        self.assertNotIn("code_verifier", query)

    @override_settings(
        WALLFLOW_ORIGIN="http://localhost:5174",
        WALLFLOW_CALLBACK_ORIGIN="http://localhost:8002",
        CSRF_TRUSTED_ORIGINS=["http://localhost:5174"],
    )
    def test_compose_oauth_callback_returns_to_the_frontend(self, exchange, metadata):
        frontend = {"HTTP_HOST": "localhost:5174", "HTTP_ORIGIN": "http://localhost:5174"}
        backend = {"HTTP_HOST": "localhost:8002"}
        token = self.browser.get(reverse("auth-csrf"), **frontend).json()["csrfToken"]
        start = self.browser.post(reverse("auth-google-start"), {"csrfmiddlewaretoken": token}, **frontend)
        params = parse_qs(urlsplit(start["Location"]).query)
        self.assertEqual(params["redirect_uri"], ["http://localhost:8002/api/v1/auth/google/callback/"])

        response = self.browser.get(reverse("auth-google-callback"), {"state": params["state"][0], "code": "stub-code"}, **backend)
        self.assertEqual(response["Location"], "http://localhost:5174/app/")
        self.assertEqual(self.browser.get(reverse("auth-me"), **frontend).status_code, 200)

        token = self.browser.get(reverse("auth-csrf"), **frontend).json()["csrfToken"]
        self.assertEqual(self.browser.post(reverse("auth-logout"), HTTP_X_CSRFTOKEN=token, **frontend).status_code, 204)
        self.assertEqual(self.browser.get(reverse("auth-me"), **frontend).status_code, 403)
        failed = self.browser.get(reverse("auth-google-callback"), **backend)
        self.assertEqual(failed["Location"], "http://localhost:5174/sign-in?login=invalid")

    def test_secure_cookie_delivery(self, exchange, metadata):
        with self.settings(SESSION_COOKIE_SECURE=True, CSRF_COOKIE_SECURE=True):
            response = self.login()
            for name in (settings.SESSION_COOKIE_NAME, settings.CSRF_COOKIE_NAME):
                cookie = response.cookies[name]
                self.assertTrue(cookie["secure"])
                self.assertTrue(cookie["httponly"])
                self.assertEqual(cookie["path"], "/")
                self.assertEqual(cookie["samesite"], "Lax")
                self.assertFalse(cookie["domain"])


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row locks are required")
class ConcurrentAuthTests(TransactionTestCase):
    @patch("accounts.google._metadata", return_value=google.ENDPOINTS)
    def test_two_first_logins_share_one_account_and_wall(self, metadata):
        first, second = Client(), Client()
        first_state, second_state = start(first), start(second)
        barrier = Barrier(2)

        def identity(*args):
            barrier.wait(timeout=5)
            return IDENTITY

        def request(browser, state):
            try:
                return callback(browser, state, code="stub-code")["Location"]
            finally:
                connections.close_all()

        with patch("accounts.google.exchange_identity", side_effect=identity), ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(request, browser, state) for browser, state in ((first, first_state), (second, second_state))]
            self.assertEqual([future.result(timeout=12) for future in futures], ["/app/", "/app/"])
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(Wall.objects.count(), 1)
        self.assertEqual(WallPreference.objects.count(), 1)
