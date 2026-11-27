import hashlib
import json
import math
import re
import secrets
from types import SimpleNamespace
import uuid
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.decorators import api_view
from rest_framework.response import Response

from config.api import error_payload
from .cloud_documents import legacy_board, save_workspace, source_claimed
from .documents import (
    InvalidDocument, MAX_ACTIVE_NOTES, NOTE_HEIGHT, NOTE_WIDTH, SCHEMA_VERSION,
    fields, text, validate_board, write_board,
)
from .models import CaptureReceipt, ImportedBoardSource, Wall, WallDocument, WallLinkIntent


class WallError(ValueError):
    def __init__(self, code, message, status):
        self.code, self.status = code, status
        super().__init__(message)


def error(exc):
    if isinstance(exc, InvalidDocument):
        return Response(error_payload("invalid_document", str(exc)), status=400)
    return Response(error_payload(exc.code, str(exc)), status=exc.status)


def fail(code, message, status=409):
    raise WallError(code, message, status)


def uuid_value(value, field):
    try:
        return uuid.UUID(value)
    except (TypeError, ValueError, AttributeError):
        fail("invalid_request", f"{field} must be a UUID.", 400)


def require_account(request, expected):
    if expected != str(request.user.pk):
        fail("account_changed", "The signed-in account changed. Review the request again.")


def session_digest(request):
    key = request.session.session_key
    if not key:
        fail("auth_required", "Sign in to continue.", 403)
    return salted_hmac("wallflow.wall-link", key, algorithm="sha256").hexdigest()


def locked_wall(user):
    wall = Wall.objects.select_for_update().filter(owner=user).first()
    if wall is None:
        fail("wall_unavailable", "Your account wall is unavailable.", 404)
    return wall


def etag(revision):
    return f'"{revision}"'


def owner_document(wall):
    document = WallDocument.objects.filter(wall=wall).first()
    if document is None:
        fail("board_not_linked", "Connect a browser board first.", 404)
    document.wall = wall
    return document


def document_response(document, request=None):
    revision = str(document.wall.revision)
    headers = {"ETag": etag(revision)}
    if request and request.headers.get("If-None-Match") == headers["ETag"]:
        return Response(status=304, headers=headers)
    return Response({
        "schemaVersion": document.schema_version, "sourceId": str(document.source_id),
        "revision": revision, "board": legacy_board(document),
    }, headers=headers)


def claim_conflict():
    fail("board_link_conflict", "This board or your account wall is already connected.")


@api_view(["GET"])
def link_status(request):
    try:
        require_account(request, request.headers.get("X-Wallflow-Account"))
    except WallError as exc:
        return error(exc)
    document = WallDocument.objects.select_related("wall").filter(wall__owner=request.user).first()
    return Response({
        "linked": True, "wallId": str(document.wall_id), "sourceId": str(document.source_id),
        "revision": str(document.wall.revision),
    } if document else {"linked": False})


@api_view(["POST"])
def link_prepare(request):
    try:
        payload = fields(request.data, ("sourceId", "expectedAccountId", "schemaVersion", "snapshotDigest"), "review")
        require_account(request, payload["expectedAccountId"])
        source = uuid_value(payload["sourceId"], "sourceId")
        digest = payload["snapshotDigest"]
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or type(payload["schemaVersion"]) is not int or payload["schemaVersion"] != SCHEMA_VERSION:
            fail("invalid_request", "Unsupported board review format.", 400)
        bound_session = session_digest(request)
        now = timezone.now()
        with transaction.atomic():
            wall = locked_wall(request.user)
            existing = WallDocument.objects.filter(wall=wall).first()
            if existing or source_claimed(source):
                claim_conflict()
            WallLinkIntent.objects.filter(wall=wall, expires_at__lte=now, confirmed_revision__isnull=True).delete()
            intent, _ = WallLinkIntent.objects.get_or_create(
                wall=wall, source_id=source, snapshot_digest=digest, session_digest=bound_session,
                defaults={"expires_at": now + timedelta(minutes=10)},
            )
        return Response({"intentId": str(intent.pk), "expiresAt": intent.expires_at})
    except (WallError, InvalidDocument) as exc:
        return error(exc)


@api_view(["POST"])
def link_confirm(request):
    source = None
    try:
        payload = fields(request.data, ("intentId", "expectedAccountId", "snapshot"), "confirmation")
        require_account(request, payload["expectedAccountId"])
        intent_id = uuid_value(payload["intentId"], "intentId")
        snapshot = payload["snapshot"]
        # Leave room under Django's default request-body limit for JSON escaping.
        if not isinstance(snapshot, str) or len(snapshot) > 1500000:
            fail("invalid_request", "This board is too large to connect.", 400)
        try:
            raw = snapshot.encode("utf-8")
            board = validate_board(json.loads(snapshot))
        except (UnicodeError, json.JSONDecodeError, RecursionError):
            raise InvalidDocument("Invalid board snapshot.") from None
        digest = hashlib.sha256(raw).hexdigest()
        bound_session = session_digest(request)
        with transaction.atomic():
            wall = locked_wall(request.user)
            intent = WallLinkIntent.objects.filter(pk=intent_id, wall=wall, session_digest=bound_session).first()
            if not intent or (intent.confirmed_revision is None and intent.expires_at <= timezone.now()):
                fail("review_expired", "Review the board again before connecting.")
            if digest != intent.snapshot_digest:
                fail("board_changed", "The board changed after review. Review it again.")
            source = intent.source_id
            if intent.confirmed_revision is not None:
                return Response({"wallId": str(wall.pk), "revision": str(intent.confirmed_revision)})
            if WallDocument.objects.filter(wall=wall).exists() or source_claimed(source):
                claim_conflict()
            ImportedBoardSource.objects.create(source_id=source, wall=wall, board_id=wall.pk)
            document = WallDocument(wall=wall, source_id=source)
            write_board(document, board)
            intent.confirmed_revision = wall.revision
            intent.save(update_fields=("confirmed_revision",))
            return Response({"wallId": str(wall.pk), "revision": str(wall.revision)}, status=201)
    except (WallError, InvalidDocument) as exc:
        return error(exc)
    except IntegrityError:
        # Claims for different destination walls acquire different row locks.
        # The globally unique source constraint resolves a cross-account race.
        if source and source_claimed(source):
            return error(WallError("board_link_conflict", "This board or your account wall is already connected.", 409))
        raise


@api_view(["POST"])
def link_recover(request):
    try:
        payload = fields(request.data, ("sourceId", "expectedAccountId"), "recovery")
        require_account(request, payload["expectedAccountId"])
        source = uuid_value(payload["sourceId"], "sourceId")
        with transaction.atomic():
            wall = locked_wall(request.user)
            intents = WallLinkIntent.objects.filter(source_id=source, confirmed_revision__isnull=True)
            # Confirm locks the same wall. An uncertain request has either committed
            # by now or can no longer succeed once its unconfirmed intent is removed.
            intents.filter(wall=wall).delete()
            pending = intents.exists()
            # Check the claim last. An in-flight confirmation on another wall
            # either left an unresolved intent above or has now committed.
            claimed = source_claimed(source)
        return Response({"status": "claimed" if claimed else "pending" if pending else "available"})
    except (WallError, InvalidDocument) as exc:
        return error(exc)


def check_removals(previous, current, removals):
    fields(removals, ("notes", "sections"), "removed")
    for name in ("notes", "sections"):
        submitted = removals[name]
        if not isinstance(submitted, list) or not all(isinstance(value, str) for value in submitted):
            raise InvalidDocument(f"Invalid removals for {name}.")
        before = {record["id"] for record in getattr(previous, name)}
        after = {record["id"] for record in current["document"][name]}
        if len(submitted) != len(set(submitted)) or set(submitted) != before - after:
            raise InvalidDocument(f"Explicit removals are required for {name}.")


@api_view(["GET", "PATCH"])
def wall_document(request):
    try:
        if request.method == "GET":
            require_account(request, request.headers.get("X-Wallflow-Account"))
            document = WallDocument.objects.select_related("wall__preferences").filter(wall__owner=request.user).first()
            if document is None:
                fail("board_not_linked", "Connect a browser board first.", 404)
            return document_response(document, request)
        payload = fields(request.data, ("expectedAccountId", "board", "removed"), "edit")
        require_account(request, payload["expectedAccountId"])
        board = validate_board(payload["board"])
        with transaction.atomic():
            wall = locked_wall(request.user)
            document = owner_document(wall)
            previous = legacy_board(document)
            if board["id"] != previous["id"]:
                fail("wall_unavailable", "Your account wall is unavailable.", 404)
            match = request.headers.get("If-Match")
            if not match:
                fail("revision_required", "An account wall revision is required.", 428)
            if match != etag(str(wall.revision)):
                fail("revision_conflict", "The account board changed on another device.", 412)
            check_removals(SimpleNamespace(**previous["document"]), board, payload["removed"])
            if document.cloud_workspace is None:
                write_board(document, board)
            else:
                document.cloud_workspace["boards"][board["id"]] = board
                save_workspace(document, document.cloud_workspace)
            return document_response(document)
    except (WallError, InvalidDocument) as exc:
        return error(exc)


def footprint(size, rotation):
    x, y = size
    c, s = abs(math.cos(rotation)), abs(math.sin(rotation))
    return c * x + s * y, s * x + c * y


def capture_note(board, body):
    active = [note for note in board["document"]["notes"] if not note.get("archived", False)]
    if len(active) >= MAX_ACTIVE_NOTES:
        fail("board_full", "The board has 60 active notes. Archive a note before capturing another.")
    prefs = board["preferences"]["noteDefaults"]
    scale = {"compact": .78, "standard": 1, "large": 1.3}[prefs["size"]]
    size = [NOTE_WIDTH * scale, NOTE_HEIGHT * scale]
    rotation = 0 if prefs["rotation"] == "straight" else (secrets.randbelow(10801) - 5400) / 100000
    width, height = footprint(size, rotation)
    bound_x, bound_y = 16 - max(NOTE_WIDTH, width / 2 + .15), 11 - max(NOTE_HEIGHT, height / 2 + .15)
    old = [(note["position"], footprint(note.get("size", [NOTE_WIDTH, NOTE_HEIGHT]), note["rotation"])) for note in active]
    columns = [0, -3.2, 3.2, -6.4, 6.4, -9.6, 9.6, -12.8, 12.8]

    def clamp(x, y):
        return [max(-bound_x, min(x, bound_x)), max(-bound_y, min(y, bound_y))]

    def free(point):
        x, y = point
        return all(abs(x - px) >= (w + width) / 2 + .12 or abs(y - py) >= (h + height) / 2 + .12 for (px, py), (w, h) in old)

    candidates = (clamp(x, y) for y in [-3.2, 0, 3.2, -6.4, 6.4] for x in columns)
    position = next((point for point in candidates if free(point)), clamp(columns[len(active) % len(columns)], -8))
    note = {"id": str(uuid.uuid4()), "title": "", "body": body, "position": position, "rotation": rotation, "color": prefs["color"]}
    if scale != 1:
        note["size"] = size
    if prefs["typography"] != "handwritten":
        note["typography"] = prefs["typography"]
    x, y = position
    containing = [section for section in board["document"]["sections"] if abs(x - section["position"][0]) <= 3.7 and abs(y - section["position"][1]) <= 2.8]
    if containing:
        note["sectionId"] = min(containing, key=lambda section: (x - section["position"][0]) ** 2 + (y - section["position"][1]) ** 2)["id"]
    return note


@api_view(["POST"])
def quick_capture(request):
    try:
        payload = fields(request.data, ("content",), "capture", ("boardId",))
        require_account(request, request.headers.get("X-Wallflow-Account"))
        text(payload["content"], "content", nonempty=True)
        body = payload["content"].strip()
        text(body, "content", 240, nonempty=True)
        operation = uuid_value(request.headers.get("Idempotency-Key"), "Idempotency-Key")
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        with transaction.atomic():
            wall = locked_wall(request.user)
            document = owner_document(wall)
            workspace = document.cloud_workspace
            if "boardId" in payload:
                board_id = str(uuid_value(payload["boardId"], "boardId"))
                board = workspace["boards"].get(board_id) if workspace else None
                if board is None:
                    fail("board_unavailable", "The board is unavailable.", 404)
            else:
                board = workspace["boards"][workspace["activeBoardId"]] if workspace else legacy_board(document)
            notes = board["document"]["notes"]
            receipt = CaptureReceipt.objects.filter(wall=wall, request_id=operation).first()
            if receipt:
                if receipt.content_digest != digest:
                    fail("capture_conflict", "This capture request was already used for different text.")
                all_notes = (note for item in workspace["boards"].values() for note in item["document"]["notes"]) if workspace else notes
                note = next((item for item in all_notes if item["id"] == str(receipt.note_id)), None)
                return Response({"note": note, "noteId": str(receipt.note_id), "revision": str(wall.revision)})
            note = capture_note(board, body)
            notes.append(note)
            if workspace:
                save_workspace(document, workspace)
            else:
                document.notes = notes
                document.save(update_fields=("notes",))
                wall.revision += 1
                wall.save(update_fields=("revision", "updated_at"))
            CaptureReceipt.objects.create(wall=wall, request_id=operation, content_digest=digest, note_id=note["id"], revision=wall.revision)
            return Response({"note": note, "noteId": note["id"], "revision": str(wall.revision)}, status=201)
    except (WallError, InvalidDocument) as exc:
        return error(exc)
