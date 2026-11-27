"""Export the legacy WALLFLOW database without writing to it or opening a destination."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
SUBJECT = re.compile(r"[!-~]{1,255}", re.ASCII)
FORMAT = "wallflow-django-export-v1"
ARTIFACTS = {
    "workspace", "source-claims", "source-inventory", "link-intents", "capture-receipts", "stored-cloud",
    "stored-notes", "stored-sections", "stored-reminder-receipts", "stored-wall", "stored-preferences",
}


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def file_record(root, path, raw):
    with (root / path).open("xb") as stream:
        stream.write(raw)
    return {"file": path.as_posix(), "bytes": len(raw), "sha256": digest(raw)}


def verify_bundle(root):
    """Verify a closed bundle without connecting to any database."""
    manifest_raw = (root / "manifest.json").read_bytes()
    manifest = json.loads(manifest_raw)
    if manifest["format"] != FORMAT:
        raise ValueError("Unsupported export format.")
    report = json.loads((root / "verification.json").read_bytes())
    observed = verify_files(root, manifest, manifest_raw)
    if observed != report:
        raise ValueError("The export verification report does not match the inventory.")
    return observed


def verify_files(root, manifest, manifest_raw):
    dispositions = Counter()
    totals = Counter({"accounts": 0, "workspaces": 0, "files": 0, "sources": 0, "intents": 0, "captureReceipts": 0})
    owners = set()
    for account in manifest["accounts"]:
        user = account["legacyUserId"]
        if str(UUID(user)) != user or user in owners:
            raise ValueError("Invalid or duplicate account in export manifest.")
        owners.add(user)
        totals["accounts"] += 1
        dispositions[account["disposition"]] += 1
        records = account["artifacts"]
        for kind, record in records.items():
            expected = Path("accounts", user, kind + ".json")
            path = root / expected
            if kind not in ARTIFACTS or record["file"] != expected.as_posix() or path.resolve() != path:
                raise ValueError("Unexpected artifact path.")
            raw = path.read_bytes()
            if len(raw) != record["bytes"] or digest(raw) != record["sha256"]:
                raise ValueError("Export artifact checksum or size mismatch.")
            totals["files"] += 1

        def read(kind):
            return json.loads((root / records[kind]["file"]).read_bytes())

        captures = read("capture-receipts")
        intents = read("link-intents")
        sources = read("source-claims")
        totals["captureReceipts"] += len(captures)
        totals["intents"] += len(intents)
        totals["sources"] += len(sources)
        if (len(captures), len(intents), len(sources)) != (
            account["captureReceiptCount"], account["intentCount"], account["sourceClaimCount"]
        ):
            raise ValueError("Export record counts differ from the manifest.")
        if "workspace" in records:
            totals["workspaces"] += 1
            workspace = read("workspace")
            if (board_inventory(workspace["workspace"]) != account["boards"]
                or sorted(workspace["claimedSources"]) != [row["sourceId"] for row in sources]
                or workspace["revision"] != account["legacyRevision"]):
                raise ValueError("Workspace IDs, source claims, or revision differ from the manifest.")

    return {"format": FORMAT, "verified": True, "manifestSha256": digest(manifest_raw),
            "totals": dict(totals), "dispositions": dict(dispositions)}


def board_inventory(workspace):
    result = []
    for key in workspace["boardOrder"]:
        board = workspace["boards"][key]
        document = board["document"]
        result.append({
            "id": key, "active": workspace["activeBoardId"] == key,
            "sectionIds": [section["id"] for section in document["sections"]],
            "reminderReceiptIds": board["notifiedReminders"],
            "notes": [
                {"id": note["id"], "checklistItemIds": [item["id"] for item in note.get("checklist", [])],
                 "reminderId": note.get("reminder", {}).get("id")}
                for note in document["notes"]
            ],
        })
    return result


def observed_ids(boards):
    """Report identifiable rows even when the stored document fails validation."""
    result = {}
    if not isinstance(boards, dict):
        return result

    def records(value):
        return (row for row in value if isinstance(row, dict)) if isinstance(value, list) else ()

    for key, board in boards.items():
        if not isinstance(board, dict) or not isinstance(board.get("document"), dict):
            result[key] = None
            continue
        document = board["document"]
        result[key] = {
            "sections": [row.get("id") for row in records(document.get("sections"))],
            "notes": [
                {"id": row.get("id"), "checklist": [item.get("id") for item in records(row.get("checklist"))],
                 "reminder": row["reminder"].get("id") if isinstance(row.get("reminder"), dict) else None}
                for row in records(document.get("notes"))
            ],
        }
    return result


def configure_source(dsn):
    from psycopg.conninfo import conninfo_to_dict
    try:
        params = conninfo_to_dict(dsn)
    except ValueError:
        raise ValueError("Invalid WALLFLOW_EXPORT_DJANGO_DSN.") from None
    supported = {"dbname", "user", "password", "host", "port", "sslmode", "sslrootcert", "connect_timeout"}
    if set(params) - supported or not all(params.get(key) for key in ("dbname", "user", "host")):
        raise ValueError("Provide an explicit PostgreSQL database, user, and host for the export.")
    sslmode = params.get("sslmode", "verify-full")
    if sslmode != "verify-full" and params["host"] not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("A non-loopback source requires sslmode=verify-full.")

    sys.path.insert(0, str(ROOT / "backend"))
    import django
    from django.conf import settings

    settings.configure(
        INSTALLED_APPS=["django.contrib.auth", "django.contrib.contenttypes", "accounts", "walls"],
        AUTH_USER_MODEL="accounts.User",
        USE_TZ=True,
        TIME_ZONE="UTC",
        DATABASES={"default": {
            "ENGINE": "django.db.backends.postgresql", "NAME": params["dbname"], "HOST": params["host"],
            "USER": params["user"], "PASSWORD": params.get("password", ""), "PORT": params.get("port", ""),
            "OPTIONS": {"sslmode": sslmode, "connect_timeout": params.get("connect_timeout", 5),
                        "options": "-c default_transaction_read_only=on",
                        **({"sslrootcert": params["sslrootcert"]} if "sslrootcert" in params else {})},
        }},
    )
    django.setup()


def source_index(WallDocument, ImportedBoardSource):
    claims = defaultdict(set)
    for source, wall in WallDocument.objects.values_list("source_id", "wall_id").iterator():
        claims[str(source)].add(str(wall))
    for source, wall in ImportedBoardSource.objects.values_list("source_id", "wall_id").iterator():
        claims[str(source)].add(str(wall))
    return claims


def export_accounts(root):
    from django.db import connection, transaction
    from django.db.models import TextField
    from django.db.models.functions import Cast
    from accounts.models import User
    from walls.models import CaptureReceipt, ImportedBoardSource, WallDocument, WallPreference
    from walls.cloud_documents import initial_workspace, validate_workspace
    from walls.documents import InvalidDocument

    accounts = []
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            cursor.execute("select current_setting('transaction_read_only'), transaction_timestamp()")
            read_only, started = cursor.fetchone()
            if read_only != "on":
                raise RuntimeError("The export transaction must be read-only.")
        subject_counts = Counter(User.objects.values_list("google_sub", flat=True).iterator())
        global_sources = source_index(WallDocument, ImportedBoardSource)
        for owner in User.objects.select_related("wall__preferences").order_by("pk").iterator():
            owner_id = str(owner.pk)
            path = Path("accounts", owner_id)
            (root / path).mkdir(parents=True, mode=0o700)
            artifacts = {}

            def archive(kind, raw):
                artifacts[kind] = file_record(root, path / (kind + ".json"), raw)

            issues = []
            identity_state = "candidate"
            if not SUBJECT.fullmatch(owner.google_sub or ""):
                identity_state = "invalid_subject"
                issues.append(identity_state)
            elif subject_counts[owner.google_sub] != 1:
                identity_state = "ambiguous_subject"
                issues.append(identity_state)

            wall = getattr(owner, "wall", None)
            document = None
            workspace = None
            sources = {}
            intents = []
            captures = []
            linked_ids = {}
            origin = "missing_wall"
            if wall is None:
                issues.append(origin)
            else:
                archive("stored-wall", json_bytes({
                    "id": str(wall.id), "ownerId": owner_id, "name": wall.name, "tiltDeg": wall.tilt_deg,
                    "turnDeg": wall.turn_deg, "revision": str(wall.revision),
                    "nextNoteOrder": str(wall.next_note_order), "nextSectionOrder": str(wall.next_section_order),
                }))
                prefs = getattr(wall, "preferences", None)
                if prefs is not None:
                    archive("stored-preferences", json_bytes({
                        field.attname: getattr(prefs, field.attname)
                        for field in WallPreference._meta.concrete_fields
                        if field.attname not in {"wall_id", "created_at", "updated_at"}
                    }))
                document = WallDocument.objects.filter(wall_id=wall.id).annotate(
                    cloud_bytes=Cast("cloud_workspace", TextField()), notes_bytes=Cast("notes", TextField()),
                    sections_bytes=Cast("sections", TextField()), reminders_bytes=Cast("reminder_receipts", TextField()),
                ).first()
                if document is not None:
                    for kind, raw in (
                        ("stored-cloud", document.cloud_bytes), ("stored-notes", document.notes_bytes),
                        ("stored-sections", document.sections_bytes), ("stored-reminder-receipts", document.reminders_bytes),
                    ):
                        if raw is not None:
                            archive(kind, raw.encode("utf-8"))
                    sources[str(document.source_id)] = str(wall.id)
                    origin = "linked" if document.cloud_workspace is None else "cloud"
                    linked_ids = observed_ids({str(wall.id): {"document": {
                        "notes": document.notes, "sections": document.sections,
                    }}})
                else:
                    origin = "uninitialized"

                imported_sources = [{"sourceId": str(source), "boardId": str(board)} for source, board in
                                    wall.imported_sources.order_by("source_id").values_list("source_id", "board_id")]
                for claim in imported_sources:
                    key, board_key = claim["sourceId"], claim["boardId"]
                    if key in sources and sources[key] != board_key:
                        issues.append("contradictory_source_board")
                    sources.setdefault(key, board_key)
                if any(global_sources[key] != {str(wall.id)} for key in sources):
                    issues.append("source_claimed_by_multiple_accounts")
                if document is None and (wall.revision != 0 or sources):
                    issues.append("missing_document_with_existing_history")

                for intent in wall.link_intents.order_by("pk").iterator():
                    key = str(intent.source_id)
                    state = ("confirmed" if intent.confirmed_revision is not None
                             else "expired" if intent.expires_at <= started else "pending")
                    intents.append({
                        "id": str(intent.pk), "sourceId": key, "snapshotDigest": intent.snapshot_digest,
                        "expiresAt": intent.expires_at.isoformat(), "state": state,
                        "confirmedRevision": None if intent.confirmed_revision is None else str(intent.confirmed_revision),
                        "claim": ("owned" if key in sources else "other" if key in global_sources else "unclaimed"),
                    })
                    if state == "confirmed" and (key not in sources or intent.confirmed_revision > wall.revision):
                        issues.append("inconsistent_confirmed_intent")
                for receipt in CaptureReceipt.objects.filter(wall=wall).order_by("request_id").iterator():
                    captures.append({"requestId": str(receipt.request_id), "noteId": str(receipt.note_id),
                                     "contentDigest": receipt.content_digest, "revision": str(receipt.revision)})
                    if not re.fullmatch("[0-9a-f]{64}", receipt.content_digest) or receipt.revision > wall.revision:
                        issues.append("invalid_capture_receipt")
                if document is None and captures:
                    issues.append("missing_document_with_capture_receipts")

                if document is not None and document.cloud_workspace is not None:
                    workspace = document.cloud_workspace
                elif prefs is not None:
                    linked = document if document is not None else WallDocument(wall=wall)
                    linked.wall = wall
                    workspace = initial_workspace(linked)
                if prefs is None:
                    issues.append("missing_preferences")

            claims = [{"sourceId": source, "boardId": sources[source]} for source in sorted(sources)]
            archive("source-claims", json_bytes(claims))
            archive("link-intents", json_bytes(intents))
            archive("capture-receipts", json_bytes(captures))
            archive("source-inventory", json_bytes({
                "wallId": str(wall.id) if wall else None,
                "linkedSourceId": str(document.source_id) if document is not None else None,
                "schemaVersion": document.schema_version if document is not None else None,
                "importedSources": imported_sources if wall else [],
            }))
            boards = []
            revision = str(wall.revision) if wall else None
            try:
                validate_workspace(workspace)
            except (InvalidDocument, TypeError, ValueError, OverflowError, RecursionError):
                issues.append("invalid_or_missing_workspace")
            else:
                raw = json_bytes({"revision": revision, "workspace": workspace, "claimedSources": sorted(sources)})
                archive("workspace", raw)
                boards = board_inventory(workspace)
                if len(raw) > 6500000:
                    issues.append("workspace_exceeds_import_limit")

            disposition = "disabled" if not owner.is_active else (
                "quarantined" if issues else "empty" if origin == "uninitialized" else "ready"
            )
            accounts.append({
                "legacyUserId": owner_id, "googleSubject": owner.google_sub, "active": owner.is_active,
                "identityState": identity_state, "workspaceOrigin": origin, "legacyRevision": revision,
                "disposition": disposition, "issues": sorted(set(issues)), "boards": boards,
                "observedCloudIds": observed_ids(workspace.get("boards")) if isinstance(workspace, dict) else {},
                "observedLinkedIds": linked_ids,
                "sourceClaimCount": len(claims), "intentCount": len(intents), "captureReceiptCount": len(captures),
                "artifacts": artifacts,
            })
    board_counts = Counter(board["id"] for account in accounts for board in account["boards"])
    for account in accounts:
        if any(board_counts[board["id"]] > 1 for board in account["boards"]):
            account["issues"] = sorted(account["issues"] + ["board_uuid_shared_by_multiple_accounts"])
            if account["active"]:
                account["disposition"] = "quarantined"
    return {"format": FORMAT, "snapshotAt": started.isoformat(), "accounts": accounts}


def run_export(root):
    root = root.resolve()
    root.mkdir(mode=0o700)
    manifest = export_accounts(root)
    manifest_raw = json_bytes(manifest)
    file_record(root, Path("manifest.json"), manifest_raw)
    report = verify_files(root, manifest, manifest_raw)
    file_record(root, Path("verification.json"), json_bytes(report))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["export", "verify"])
    parser.add_argument("directory", type=Path, help="A new private directory for export, or an existing bundle to verify")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.stage == "export":
            dsn = os.environ.get("WALLFLOW_EXPORT_DJANGO_DSN")
            if not dsn:
                parser.error("Set WALLFLOW_EXPORT_DJANGO_DSN to the authorized read-only source connection.")
            configure_source(dsn)
            report = run_export(args.directory)
        else:
            report = verify_bundle(args.directory.resolve())
    except Exception as error:
        # A database or filesystem error can include credentials or source data.
        parser.exit(1, f"Export {args.stage} failed ({type(error).__name__}).\n")
    print(json.dumps({"verified": report["verified"], "totals": report["totals"], "dispositions": report["dispositions"]},
                     sort_keys=True))


if __name__ == "__main__":
    main()
