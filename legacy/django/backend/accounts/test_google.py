import json
import time
from unittest.mock import Mock, patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.conf import settings
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from . import google

TEST_CLIENT = "test-client"
TEST_NONCE = "test-nonce"


def json_response(data, status=200):
    return Mock(status_code=status, headers={"Cache-Control": "max-age=300"}, json=Mock(return_value=data))


@override_settings(GOOGLE_CLIENT_ID=TEST_CLIENT, GOOGLE_CLIENT_SECRET="stub")
class GoogleProtocolTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.private_key.public_key()))
        cls.jwks = {"keys": [{**public_key, "kid": "new-key", "use": "sig"}]}
        cls.discovery = {
            **google.ENDPOINTS,
            "issuer": google.ISSUER,
            "code_challenge_methods_supported": ["S256"],
        }

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def token(self, *, key=None, **overrides):
        now = int(time.time())
        payload = {
            "iss": google.ISSUER, "aud": TEST_CLIENT, "nonce": TEST_NONCE,
            "iat": now, "exp": now + 600, "sub": "signed-subject",
            "name": "Signed Name", "email": "signed@example.test", "email_verified": True,
            **overrides,
        }
        return jwt.encode(payload, key or self.private_key, algorithm="RS256", headers={"kid": "new-key"})

    def verify_claims(self, token):
        with patch("accounts.google._get_document", return_value=self.jwks):
            return google._verified_claims(token, google.ENDPOINTS["jwks_uri"], TEST_NONCE)

    @override_settings(WALLFLOW_ORIGIN="http://localhost:5174", WALLFLOW_CALLBACK_ORIGIN="http://localhost:8002")
    def test_exchange_checks_signed_identity_and_refreshes_unknown_key(self):
        old_key = {**self.jwks["keys"][0], "kid": "old-key"}
        responses = [json_response(self.discovery), json_response({"keys": [old_key]}), json_response(self.jwks)]
        with (
            patch("accounts.google.requests.get", side_effect=responses) as fetch,
            patch("accounts.google.requests.post", return_value=json_response({"id_token": self.token()})) as post,
        ):
            self.assertEqual(
                google.exchange_identity("provided-code", TEST_NONCE, "session-verifier"),
                google.GoogleIdentity("signed-subject", "signed@example.test", "Signed Name"),
            )
        self.assertEqual(fetch.call_count, 3)
        self.assertFalse(fetch.call_args.kwargs["allow_redirects"])
        self.assertEqual(post.call_args.args, (google.ENDPOINTS["token_endpoint"],))
        self.assertEqual(post.call_args.kwargs["data"]["code_verifier"], "session-verifier")
        self.assertEqual(post.call_args.kwargs["data"]["redirect_uri"], settings.WALLFLOW_CALLBACK_ORIGIN + google.CALLBACK_PATH)
        self.assertFalse(post.call_args.kwargs["allow_redirects"])

    def test_bad_issuer_audience_nonce_time_and_subject_are_rejected(self):
        now = int(time.time())
        for claims in (
            {"iss": "https://other.test"},
            {"aud": "other-client"},
            {"aud": [TEST_CLIENT, "other-client"]},
            {"azp": "other-client"},
            {"nonce": "other-nonce"},
            {"exp": now - 60},
            {"iat": now + 60},
            {"sub": ""},
            {"sub": "é"},
        ):
            with self.subTest(claims=claims), self.assertRaises(google.InvalidGoogleIdentity):
                self.verify_claims(self.token(**claims))

    def test_wrong_signature_is_rejected(self):
        with self.assertRaises(google.InvalidGoogleIdentity):
            self.verify_claims(self.token(key=self.other_key))

    def test_email_must_be_verified_and_valid(self):
        for claims in ({"email_verified": False}, {"email": "invalid"}):
            with (
                self.subTest(claims=claims),
                patch("accounts.google._get_document", side_effect=[self.discovery, self.jwks]),
                patch("accounts.google.requests.post", return_value=json_response({"id_token": self.token(**claims)})),
            ):
                self.assertIsNone(google.exchange_identity("code", TEST_NONCE, "verifier").email)

    def test_non_google_discovery_endpoint_is_rejected(self):
        with patch(
            "accounts.google.requests.get",
            return_value=json_response({**self.discovery, "jwks_uri": "https://other.test/keys"}),
        ):
            with self.assertRaises(google.GoogleUnavailable):
                google.authorization_url("state", TEST_NONCE, "verifier")

    def test_google_rejected_code_is_distinct_from_outage(self):
        for status, data, expected in (
            (400, {"error": "invalid_grant"}, google.InvalidGoogleIdentity),
            (503, {}, google.GoogleUnavailable),
            (302, {}, google.GoogleUnavailable),
        ):
            with (
                self.subTest(status=status),
                patch("accounts.google._get_document", return_value=self.discovery),
                patch("accounts.google.requests.post", return_value=json_response(data, status)),
                self.assertRaises(expected),
            ):
                google.exchange_identity("code", TEST_NONCE, "verifier")
