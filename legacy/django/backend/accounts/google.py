import base64
import hashlib
import re
from dataclasses import dataclass
from urllib.parse import urlencode

import jwt
import requests
from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils.crypto import constant_time_compare

ISSUER = "https://accounts.google.com"
DISCOVERY_URL = f"{ISSUER}/.well-known/openid-configuration"
ENDPOINTS = {
    "authorization_endpoint": f"{ISSUER}/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
}
CALLBACK_PATH = "/api/v1/auth/google/callback/"
HTTP_TIMEOUT = (3, 5)
CLOCK_SKEW_SECONDS = 30


class GoogleUnavailable(Exception):
    pass


class InvalidGoogleIdentity(Exception):
    pass


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str | None
    display_name: str | None


def _get_document(url, *, refresh=False):
    cache_key = f"wallflow:google:{url}"
    if not refresh:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached
    try:
        response = requests.get(url, timeout=HTTP_TIMEOUT, allow_redirects=False)
        if response.status_code != 200:
            raise GoogleUnavailable
        document = response.json()
    except (requests.RequestException, ValueError):
        raise GoogleUnavailable from None
    if not isinstance(document, dict):
        raise GoogleUnavailable

    directives = response.headers.get("Cache-Control", "")
    max_age = re.search(r"\bmax-age\s*=\s*(\d{1,9})\b", directives, flags=re.I)
    if "no-store" not in directives.lower() and "no-cache" not in directives.lower():
        lifetime = min(int(max_age[1]), 3600) if max_age else 300
        age = response.headers.get("Age", "")
        if age.isascii() and age.isdigit() and len(age) <= 9:
            lifetime -= int(age)
        if lifetime > 0:
            cache.set(cache_key, document, timeout=lifetime)
    return document


def _metadata():
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise GoogleUnavailable
    data = _get_document(DISCOVERY_URL)
    methods = data.get("code_challenge_methods_supported")
    if (
        data.get("issuer") != ISSUER
        or any(data.get(field) != url for field, url in ENDPOINTS.items())
        or not isinstance(methods, list)
        or "S256" not in methods
    ):
        raise GoogleUnavailable
    return data


def callback_uri():
    return (settings.WALLFLOW_CALLBACK_ORIGIN or settings.WALLFLOW_ORIGIN) + CALLBACK_PATH


def authorization_url(state, nonce, verifier):
    metadata = _metadata()
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": callback_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii"),
        "code_challenge_method": "S256",
    }
    return f"{metadata['authorization_endpoint']}?{urlencode(params)}"


def _signing_key(encoded, jwks_uri):
    header = jwt.get_unverified_header(encoded)
    kid = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(kid, str) or not kid or len(kid) > 128:
        raise InvalidGoogleIdentity

    for refresh in (False, True):
        keys = _get_document(jwks_uri, refresh=refresh).get("keys")
        if not isinstance(keys, list) or not keys:
            raise GoogleUnavailable
        matches = [key for key in keys if isinstance(key, dict) and key.get("kid") == kid]
        if len(matches) == 1:
            key = matches[0]
            if key.get("kty") != "RSA" or key.get("use", "sig") != "sig" or key.get("alg", "RS256") != "RS256":
                raise InvalidGoogleIdentity
            return jwt.PyJWK.from_dict(key, algorithm="RS256").key
        if matches:
            raise GoogleUnavailable
    raise InvalidGoogleIdentity


def _verified_claims(encoded, jwks_uri, nonce):
    try:
        claims = jwt.decode(
            encoded,
            key=_signing_key(encoded, jwks_uri),
            algorithms=["RS256"],
            issuer=(ISSUER, "accounts.google.com"),
            audience=settings.GOOGLE_CLIENT_ID,
            leeway=CLOCK_SKEW_SECONDS,
            options={"require": ["iss", "aud", "exp", "iat", "sub", "nonce"]},
        )
    except (jwt.PyJWTError, TypeError, ValueError, OverflowError):
        raise InvalidGoogleIdentity from None

    jwt_nonce = claims["nonce"]
    if not isinstance(jwt_nonce, str) or not constant_time_compare(jwt_nonce, nonce):
        raise InvalidGoogleIdentity
    if type(claims["iat"]) is not int or type(claims["exp"]) is not int or claims["exp"] <= claims["iat"]:
        raise InvalidGoogleIdentity
    if (
        "azp" in claims or (isinstance(claims["aud"], list) and len(claims["aud"]) > 1)
    ) and claims.get("azp") != settings.GOOGLE_CLIENT_ID:
        raise InvalidGoogleIdentity
    if not isinstance(claims["sub"], str) or not re.fullmatch(r"[!-~]{1,255}", claims["sub"]):
        raise InvalidGoogleIdentity
    return claims


def _profile_text(value, limit):
    if not isinstance(value, str) or "\x00" in value:
        return None
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return None
    return value.strip()[:limit] or None


def exchange_identity(code, nonce, verifier):
    metadata = _metadata()
    try:
        response = requests.post(
            metadata["token_endpoint"],
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": callback_uri(),
                "grant_type": "authorization_code",
                "code_verifier": verifier,
            },
            timeout=HTTP_TIMEOUT,
            allow_redirects=False,
        )
        if response.status_code == 400 and response.json().get("error") == "invalid_grant":
            raise InvalidGoogleIdentity
        if response.status_code != 200:
            raise GoogleUnavailable
        token = response.json()
    except (requests.RequestException, ValueError, AttributeError):
        raise GoogleUnavailable from None
    encoded = token.get("id_token") if isinstance(token, dict) else None
    if not isinstance(encoded, str) or not encoded or len(encoded) > 16384:
        raise InvalidGoogleIdentity
    claims = _verified_claims(encoded, metadata["jwks_uri"], nonce)

    email = _profile_text(claims.get("email"), 255) if claims.get("email_verified") is True else None
    if email:
        try:
            validate_email(email)
        except ValidationError:
            email = None
        if email and len(email) > 254:
            email = None
    return GoogleIdentity(claims["sub"], email, _profile_text(claims.get("name"), 150))
