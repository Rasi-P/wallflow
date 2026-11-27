import hashlib
import json
import re
import uuid
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .cloud_documents import initial_workspace, save_workspace, source_claimed, validate_workspace
from .documents import InvalidDocument, array, fields, validate_board
from .models import ImportedBoardSource, WallDocument, WallLinkIntent
from .views import WallError, claim_conflict, error, etag, fail, locked_wall, require_account, session_digest, uuid_value

MAX_IMPORT_CHARACTERS = 1_500_000


def account_document(wall):
    document, _ = WallDocument.objects.get_or_create(wall=wall, defaults={"source_id": uuid.uuid4})
    document.wall = wall
    if document.cloud_workspace is None:
        document.cloud_workspace = initial_workspace(document)
        document.save(update_fields=("cloud_workspace",))
    return document


def workspace_response(document, request=None):
    revision = str(document.wall.revision)
    headers = {"ETag": etag(revision)}
    if request and request.headers.get("If-None-Match") == headers["ETag"]:
        return Response(status=304, headers=headers)
    sources = ImportedBoardSource.objects.filter(wall=document.wall).exclude(source_id=document.source_id).values_list("source_id", flat=True)
    return Response({
        "revision": revision,
        "workspace": document.cloud_workspace,
        "claimedSources": [str(document.source_id), *(str(source) for source in sources)],
    }, headers=headers)


@api_view(["GET", "PATCH"])
def account_workspace(request):
    try:
        if request.method == "GET":
            require_account(request, request.headers.get("X-Wallflow-Account"))
            with transaction.atomic():
                document = account_document(locked_wall(request.user))
                return workspace_response(document, request)
        data = fields(request.data, ("expectedAccountId", "workspace", "removedBoards"), "workspace edit")
        require_account(request, data["expectedAccountId"])
        workspace = validate_workspace(data["workspace"])
        with transaction.atomic():
            wall = locked_wall(request.user)
            document = account_document(wall)
            match = request.headers.get("If-Match")
            if not match:
                fail("revision_required", "An account workspace revision is required.", 428)
            if match != etag(str(wall.revision)):
                fail("revision_conflict", "The account workspace changed on another device.", 412)
            removed = data["removedBoards"]
            if not isinstance(removed, list) or not all(isinstance(id, str) for id in removed):
                raise InvalidDocument("Invalid board removals.")
            missing = set(document.cloud_workspace["boards"]) - set(workspace["boards"])
            if len(removed) != len(set(removed)) or set(removed) != missing:
                raise InvalidDocument("Explicit board removals are required.")
            save_workspace(document, workspace)
            return workspace_response(document)
    except (WallError, InvalidDocument) as exc:
        return error(exc)


@api_view(["POST"])
def import_prepare(request):
    try:
        data = fields(request.data, ("expectedAccountId", "sources"), "import review")
        require_account(request, data["expectedAccountId"])
        reviewed = []
        seen = set()
        for candidate in array(data["sources"], "import sources"):
            fields(candidate, ("sourceId", "snapshotDigest"), "import source")
            source = uuid_value(candidate["sourceId"], "sourceId")
            digest = candidate["snapshotDigest"]
            if source in seen or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise InvalidDocument("Invalid import review.")
            reviewed.append((source, digest))
            seen.add(source)
        if not reviewed:
            raise InvalidDocument("Choose at least one board to import.")
        now = timezone.now()
        bound_session = session_digest(request)
        with transaction.atomic():
            wall = locked_wall(request.user)
            WallLinkIntent.objects.filter(wall=wall, expires_at__lte=now, confirmed_revision__isnull=True).delete()
            intents = []
            for source, digest in reviewed:
                if source_claimed(source):
                    claim_conflict()
                intent, _ = WallLinkIntent.objects.get_or_create(
                    wall=wall, source_id=source, snapshot_digest=digest, session_digest=bound_session,
                    defaults={"expires_at": now + timedelta(minutes=10)},
                )
                intents.append(str(intent.pk))
        return Response({"intentIds": intents})
    except (WallError, InvalidDocument) as exc:
        return error(exc)


def reviewed_snapshots(value):
    reviewed = {}
    total = 0
    for item in array(value, "import boards"):
        fields(item, ("intentId", "snapshot"), "import board")
        intent_id = uuid_value(item["intentId"], "intentId")
        snapshot = item["snapshot"]
        if not isinstance(snapshot, str) or intent_id in reviewed:
            raise InvalidDocument("Invalid import snapshot.")
        total += len(snapshot)
        if total > MAX_IMPORT_CHARACTERS:
            fail("invalid_request", "These boards are too large to import together. Choose fewer boards.", 400)
        try:
            reviewed[intent_id] = (hashlib.sha256(snapshot.encode("utf-8")).hexdigest(), validate_board(json.loads(snapshot)))
        except (UnicodeError, json.JSONDecodeError, RecursionError):
            raise InvalidDocument("Invalid import snapshot.") from None
    if not reviewed:
        raise InvalidDocument("Choose at least one board to import.")
    return reviewed


@api_view(["POST"])
def import_confirm(request):
    sources = set()
    try:
        data = fields(request.data, ("expectedAccountId", "boards"), "import confirmation")
        require_account(request, data["expectedAccountId"])
        reviewed = reviewed_snapshots(data["boards"])
        bound_session = session_digest(request)
        with transaction.atomic():
            wall = locked_wall(request.user)
            document = account_document(wall)
            intents = {
                item.pk: item for item in WallLinkIntent.objects.filter(
                    pk__in=reviewed, wall=wall, session_digest=bound_session,
                )
            }
            if len(intents) != len(reviewed):
                fail("review_expired", "Review the boards again before importing.")
            for key, (digest, _) in reviewed.items():
                intent = intents[key]
                if intent.snapshot_digest != digest or intent.source_id in sources:
                    fail("board_changed", "The import changed after review.")
                if intent.confirmed_revision is None and intent.expires_at <= timezone.now():
                    fail("review_expired", "Review the boards again before importing.")
                sources.add(intent.source_id)
            if all(intent.confirmed_revision is not None for intent in intents.values()):
                return workspace_response(document)
            if any(intent.confirmed_revision is not None for intent in intents.values()) or any(map(source_claimed, sources)):
                claim_conflict()

            # Revision zero is the untouched empty workspace provisioned by Django.
            workspace = document.cloud_workspace
            if wall.revision == 0:
                workspace = {"version": 2, "boardOrder": [], "boards": {}, "activeBoardId": ""}
            imported = []
            for key, (_, board) in reviewed.items():
                board_id = uuid.uuid4()
                id = str(board_id)
                workspace["boardOrder"].append(id)
                workspace["boards"][id] = {**board, "id": id}
                imported.append(id)
                ImportedBoardSource.objects.create(source_id=intents[key].source_id, wall=wall, board_id=board_id)
            workspace["activeBoardId"] = imported[0]
            save_workspace(document, workspace)
            WallLinkIntent.objects.filter(pk__in=reviewed).update(confirmed_revision=wall.revision)
            return workspace_response(document)
    except (WallError, InvalidDocument) as exc:
        return error(exc)
    except IntegrityError:
        if any(map(source_claimed, sources)):
            return error(WallError("board_link_conflict", "A selected browser board has already been imported.", 409))
        raise
