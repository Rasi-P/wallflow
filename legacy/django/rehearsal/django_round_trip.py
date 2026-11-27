"""Exercise the WALLFLOW operator import using separate, synthetic local databases."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
from datetime import timedelta
from urllib.parse import unquote, urlsplit

import psycopg
from psycopg.types.json import Jsonb

SOURCE = "wallflow_m4_django_source"
RESTORE = "wallflow_m4_restore"
FIXTURE = "84100000-0000-4000-8000-000000000"
ROOT = Path(__file__).resolve().parents[1]


def identifier(number):
    return f"{FIXTURE}{number:03d}"


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def checksum(raw):
    return hashlib.sha256(raw).hexdigest()


def configure_django(database, *, source=SOURCE, test_database="test_wallflow_m4_django"):
    sys.path.insert(0, str(ROOT / "backend"))
    from config.settings import base
    from django.conf import settings
    import django

    values = {key: getattr(base, key) for key in dir(base) if key.isupper()}
    settings.configure(**(values | {
        "DATABASES": {"default": {
            "ENGINE": "django.db.backends.postgresql",
            "HOST": database["host"], "PORT": database["port"], "USER": database["user"],
            "PASSWORD": database["password"], "NAME": source,
            "OPTIONS": {"sslmode": "disable", "connect_timeout": 5},
            "TEST": {"NAME": test_database},
        }},
        "SECRET_KEY": "synthetic-local-django-rehearsal-only",
        "WALLFLOW_ORIGIN": "http://localhost:8000",
    }))
    django.setup()


def test_django(database, **database_options):
    configure_django(database, **database_options)
    from django.conf import settings
    from django.core.management import call_command
    from django.test.utils import override_settings

    with override_settings(
        ALLOWED_HOSTS=["localhost", "testserver"], CSRF_TRUSTED_ORIGINS=[settings.WALLFLOW_ORIGIN],
        SESSION_COOKIE_NAME="wallflow-session", CSRF_COOKIE_NAME="wallflow-csrf",
        WALLFLOW_AUTH_PREVIEW=True, GOOGLE_CLIENT_ID="", GOOGLE_CLIENT_SECRET="",
    ):
        call_command("test", "accounts", "walls", "config", interactive=False, verbosity=1)


def seed_django_fixtures():
    from django.core.management import call_command
    from django.db import transaction
    from django.utils import timezone
    from accounts.models import User
    from walls.cloud_documents import initial_workspace, validate_workspace
    from walls.models import CaptureReceipt, ImportedBoardSource, Wall, WallDocument, WallLinkIntent, WallPreference

    call_command("migrate", interactive=False, verbosity=0)
    with transaction.atomic():
        for number, label in enumerate(("multi", "linked", "incomplete", "disabled"), 1):
            owner = User(id=identifier(number), google_sub=f"m4-synthetic-{label}",
                         email=f"{label}@example.invalid", is_active=label != "disabled")
            owner.set_unusable_password()
            owner.save(force_insert=True)
            wall = Wall.objects.create(id=identifier(10 + number), owner=owner, name=f"{label.title()} board",
                                       revision=31 if number == 1 else 0, tilt_deg=-7, turn_deg=4)
            WallPreference.objects.create(
                wall=wall, theme="study", photo_workspace="scientist", lighting="warm", light_intensity=110,
                wall_shade="mist", ambience="airy", default_note_color="mint", show_hints=False,
                onboarding_complete=True,
            )
            note = {"id": "original-note", "title": "Synthetic café ☕", "body": "First\nSecond β",
                    "position": [1.25, -2], "rotation": 0.16, "size": [3.2, 3.5], "color": "pink",
                    "typography": "sans", "sectionId": "original-section", "priority": "high",
                    "reminder": {"id": "rem-1", "at": 1795773600123}, "plannedOn": "2026-11-27",
                    "dueDate": "2026-12-03", "checklist": [
                        {"id": "check-1", "text": "Completed", "done": True, "plannedOn": "2026-11-27"},
                        {"id": "check-2", "text": "Open", "done": False},
                    ]}
            archived = {"id": "archive-id", "title": "Archive", "body": "Keep this", "position": [2, 2],
                        "rotation": 0, "color": "yellow", "archived": True}
            doc = WallDocument.objects.create(
                wall=wall, source_id=identifier(20 + number), notes=[note, archived],
                sections=[{"id": "original-section", "name": "Planning", "position": [0, 0], "size": [8, 6]}],
                reminder_receipts=["rem-1", "removed-reminder"],
            )
            if label == "multi":
                saved = initial_workspace(doc)
                second_id = identifier(15)
                second = copy.deepcopy(saved["boards"][str(wall.id)])
                second.update(id=second_id, name="Second board")
                second["document"]["notes"].reverse()
                saved["boards"][second_id] = second
                saved["boardOrder"].insert(0, second_id)
                doc.cloud_workspace = validate_workspace(saved)
                doc.save(update_fields=["cloud_workspace"])
                ImportedBoardSource.objects.create(source_id=identifier(26), wall=wall, board_id=second_id)
                ImportedBoardSource.objects.create(source_id=identifier(27), wall=wall, board_id=identifier(17))
                pending = WallLinkIntent.objects.create(
                    id=identifier(30), wall=wall, source_id=identifier(28), snapshot_digest="a" * 64,
                    session_digest="b" * 64, expires_at=timezone.now() + timedelta(days=1),
                )
                CaptureReceipt.objects.create(wall=wall, request_id=identifier(31), content_digest="c" * 64,
                                              note_id=identifier(32), revision=29)
            elif label == "incomplete":
                doc.cloud_workspace = {
                    "version": 2, "boardOrder": [str(wall.id)], "activeBoardId": str(wall.id), "boards": {},
                }
                doc.save(update_fields=["cloud_workspace"])

    return pending


def export_django(database, directory):
    configure_django(database)
    from django.db import connection, transaction
    from walls.cloud_documents import initial_workspace, validate_workspace
    from walls.documents import InvalidDocument
    from walls.models import CaptureReceipt, WallDocument, WallLinkIntent
    from walls.workspace_views import workspace_response

    pending = seed_django_fixtures()
    entries = []
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        for doc in WallDocument.objects.select_related("wall__owner", "wall__preferences").order_by("wall__owner_id"):
            owner = doc.wall.owner
            label = owner.google_sub.removeprefix("m4-synthetic-")
            raw_legacy = {"schemaVersion": doc.schema_version, "sourceId": str(doc.source_id),
                          "notes": doc.notes, "sections": doc.sections, "reminderReceipts": doc.reminder_receipts}
            if doc.cloud_workspace is None:
                doc.cloud_workspace = initial_workspace(doc)
            envelope = workspace_response(doc).data
            raw = json_bytes(envelope)
            (directory / f"{label}.json").write_bytes(raw)
            (directory / f"{label}.legacy.json").write_bytes(json_bytes(raw_legacy))
            claims = {str(doc.source_id): str(doc.wall_id)}
            claims.update({str(row.source_id): str(row.board_id) for row in doc.wall.imported_sources.all()})
            assert set(claims) == set(envelope["claimedSources"])
            entry = {"label": label, "legacyId": str(owner.id), "subject": owner.google_sub,
                     "enabled": owner.is_active, "ownerId": identifier(40 + len(entries)),
                     "sha256": checksum(raw), "legacySha256": checksum(json_bytes(raw_legacy)),
                     "claims": [{"sourceId": key, "boardId": claims[key]} for key in sorted(claims)]}
            try:
                validate_workspace(envelope["workspace"])
            except InvalidDocument:
                entry["disposition"] = "quarantined"
            else:
                entry["disposition"] = "ready" if owner.is_active else "disabled"
            entries.append(entry)
        assert [e["disposition"] for e in entries] == ["ready", "ready", "quarantined", "disabled"]
        assert not WallDocument.objects.get(wall_id=identifier(12)).cloud_workspace
        assert WallLinkIntent.objects.filter(pk=pending.pk, confirmed_revision__isnull=True).count() == 1
        assert CaptureReceipt.objects.filter(request_id=identifier(31)).count() == 1
    (directory / "manifest.json").write_bytes(json_bytes({
        "accounts": entries,
        "unresolvedLegacy": {"pendingIntent": str(pending.id), "pendingSource": str(pending.source_id),
                             "captureReceipt": identifier(31)},
    }))
    print("PASS Django: read-only export from four synthetic PostgreSQL records; incomplete and disabled classified")


def fail_sql(conn, code, statement, parameters):
    try:
        with conn.transaction():
            conn.execute(statement, parameters)
    except psycopg.Error as error:
        assert error.sqlstate == code, error.sqlstate
    else:
        raise AssertionError(f"Expected SQLSTATE {code}")


IMPORT = "select wallflow_private.import_django_workspace(%s, %s, %s, %s, %s)"
RECONCILE = "select wallflow_private.reconcile_google_account(%s, %s)"


def payload(directory, entry):
    raw = (directory / f"{entry['label']}.json").read_bytes()
    legacy = (directory / f"{entry['label']}.legacy.json").read_bytes()
    assert checksum(raw) == entry["sha256"] and checksum(legacy) == entry["legacySha256"]
    return raw.decode(), json.loads(raw)


def import_all(conn, directory, manifest):
    imported_count = 0
    replayed_count = 0
    for entry in manifest["accounts"]:
        owner, legacy, subject = entry["ownerId"], entry["legacyId"], entry["subject"]
        email = f"target-{entry['label']}@example.invalid"
        conn.execute("insert into auth.users(id,email) values (%s,%s) on conflict (id) do nothing", (owner, email))
        assert conn.execute("select email from auth.users where id=%s", (owner,)).fetchone() == (email,)
        conn.execute(
            """insert into auth.identities(id,user_id,provider,provider_id,identity_data)
               values (gen_random_uuid(),%s,'google',%s,%s) on conflict (provider_id, provider) do nothing""",
            (owner, subject, Jsonb({"sub": subject})),
        )
        conn.execute("""insert into wallflow_private.legacy_account_map(legacy_user_id,google_sub,legacy_is_active)
                        values (%s,%s,%s) on conflict (legacy_user_id) do nothing""", (legacy, subject, entry["enabled"]))
        if entry["disposition"] == "disabled":
            fail_sql(conn, "42501", RECONCILE, (owner, subject))
            continue
        fail_sql(conn, "42501", RECONCILE, (owner, "unverified-subject"))
        assert str(conn.execute(RECONCILE, (owner, subject)).fetchone()[0]) == legacy
        raw, snapshot = payload(directory, entry)
        params = (legacy, owner, raw, entry["sha256"], Jsonb(entry["claims"]))
        if entry["disposition"] == "quarantined":
            fail_sql(conn, "22023", IMPORT, params)
            continue
        revision = str(max(1, int(snapshot["revision"])))
        expected = dict(snapshot, revision=revision, claimedSources=sorted(snapshot["claimedSources"]))
        if conn.execute("select workspace_reconciled_at is not null from wallflow_private.legacy_account_map where legacy_user_id=%s",
                        (legacy,)).fetchone()[0]:
            replayed = conn.execute(IMPORT, params).fetchone()[0]
            assert dict(replayed, claimedSources=sorted(replayed["claimedSources"])) == expected
            replayed_count += 1
            continue
        fail_sql(conn, "22023", IMPORT, (legacy, owner, raw, "0" * 64, Jsonb(entry["claims"])))
        fail_sql(conn, "22023", IMPORT, (legacy, owner, raw, entry["sha256"], Jsonb([])))
        wrong_owner = identifier(99)
        fail_sql(conn, "42501", IMPORT, (legacy, wrong_owner, raw, entry["sha256"], Jsonb(entry["claims"])))
        conn.commit()
        conn.execute(IMPORT, params)
        # Interrupt after all transactional writes but before COMMIT.
        conn.rollback()
        assert conn.execute("select count(*) from public.workspaces where owner_id=%s", (owner,)).fetchone()[0] == 0
        assert conn.execute("select count(*) from wallflow_private.workspace_import_backups where owner_id=%s",
                            (owner,)).fetchone()[0] == 0
        assert not conn.execute("select is_active from public.profiles where owner_id=%s", (owner,)).fetchone()[0]
        observed = conn.execute(IMPORT, params).fetchone()[0]
        assert dict(observed, claimedSources=sorted(observed["claimedSources"])) == expected
        conn.commit()
        assert conn.execute(IMPORT, params).fetchone()[0] == observed
        conn.execute(RECONCILE, (owner, subject))
        fail_sql(conn, "23505", IMPORT, (legacy, owner, raw + "\n", checksum((raw + "\n").encode()), Jsonb(entry["claims"])))
        conn.commit()
        imported_count += 1
    conn.commit()
    print("PASS operator: rejected unverified, disabled and incomplete candidates")
    print(f"PASS operator: {imported_count} interrupted imports retried and verified, {replayed_count} resumed replays")


def verify(conn, directory, manifest):
    for entry in manifest["accounts"]:
        owner, legacy = entry["ownerId"], entry["legacyId"]
        raw, exported = payload(directory, entry)
        row = conn.execute("""select wallflow_private.workspace_response(w), p.is_active
                              from public.workspaces w join public.profiles p using (owner_id)
                              where w.owner_id=%s""", (owner,)).fetchone()
        if entry["disposition"] != "ready":
            assert row is None
            assert conn.execute("select workspace_reconciled_at from wallflow_private.legacy_account_map where legacy_user_id=%s",
                                (legacy,)).fetchone()[0] is None
            continue
        snapshot, active = row
        assert active and snapshot["workspace"] == exported["workspace"]
        assert snapshot["revision"] == str(max(1, int(exported["revision"])))
        assert sorted(snapshot["claimedSources"]) == sorted(exported["claimedSources"])
        backup = conn.execute("""
            select original, digest=encode(sha256(convert_to(jsonb_build_array(original,%s)::text,'UTF8')),'hex')
            from wallflow_private.workspace_import_backups where owner_id=%s and operation_id=%s and source_kind='django'
        """, (Jsonb(entry["claims"]), owner, legacy)).fetchall()
        assert backup == [(raw, True)]
        assert conn.execute("""
            select source_id::text,claimed_board_id::text,board_id::text from wallflow_private.import_sources
            where owner_id=%s order by source_id
        """, (owner,)).fetchall() == [
            (claim["sourceId"], claim["boardId"],
             claim["boardId"] if claim["boardId"] in exported["workspace"]["boards"] else None)
            for claim in entry["claims"]
        ]
        assert conn.execute("""
            select id::text from public.boards where owner_id=%s order by sort_index
        """, (owner,)).fetchall() == [(key,) for key in exported["workspace"]["boardOrder"]]
        for key in exported["workspace"]["boardOrder"]:
            board = exported["workspace"]["boards"][key]
            assert conn.execute("""
                select id,title,body,x,y,archived from public.notes
                where owner_id=%s and board_id=%s order by sort_index
            """, (owner, key)).fetchall() == [
                (n["id"], n["title"], n["body"], *n["position"], n.get("archived"))
                for n in board["document"]["notes"]
            ]
            assert conn.execute("""
                select id,note_id,text,done from public.checklist_items
                where owner_id=%s and board_id=%s order by note_id,sort_index
            """, (owner, key)).fetchall() == [
                (item["id"], note["id"], item["text"], item["done"])
                for note in sorted(board["document"]["notes"], key=lambda note: note["id"])
                for item in note.get("checklist", [])
            ]
            assert conn.execute("""
                select id,name,x,y from public.sections where owner_id=%s and board_id=%s order by sort_index
            """, (owner, key)).fetchall() == [
                (section["id"], section["name"], *section["position"]) for section in board["document"]["sections"]
            ]
            assert conn.execute("""
                select theme,lighting,show_hints from public.board_preferences where owner_id=%s and board_id=%s
            """, (owner, key)).fetchone() == (
                board["presentation"]["appearance"]["theme"], board["presentation"]["lighting"], board["preferences"]["showHints"],
            )
            assert conn.execute("""
                select reminder_id, occurrence_id from public.reminder_receipts
                where owner_id=%s and board_id=%s order by reminder_id
            """, (owner, key)).fetchall() == [("rem-1", "rem-1"), ("removed-reminder", None)]
            assert conn.execute("""
                select (extract(epoch from scheduled_at)*1000)::bigint from public.reminder_occurrences
                where owner_id=%s and board_id=%s and id='rem-1'
            """, (owner, key)).fetchone() == (1795773600123,)
        assert conn.execute("select count(*) from wallflow_private.workspace_import_backups where owner_id=%s",
                            (owner,)).fetchone()[0] == 1
    assert conn.execute("select count(*) from public.workspaces where owner_id::text like %s",
                        (FIXTURE + "%",)).fetchone()[0] == 2
    assert conn.execute("select not has_table_privilege('authenticated','wallflow_private.workspace_import_backups','SELECT')").fetchone()[0]
    print("PASS database: IDs, ordering, features, ownership, historical claims, timestamps, originals and checksums")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["export", "import", "verify", "restore-compare", "django-tests"])
    parser.add_argument("directory", type=Path, help="Private scratch directory for synthetic exports")
    args = parser.parse_args()
    os.umask(0o077)
    url = urlsplit(os.environ["WALLFLOW_REHEARSAL_LOCAL_DB_URL"])
    if url.scheme not in {"postgresql", "postgres"} or url.hostname not in {"127.0.0.1", "localhost"} or url.port != 55322 or url.path != "/postgres":
        parser.error("The isolated WALLFLOW loopback database on port 55322 is required.")
    database = {"host": url.hostname, "port": url.port, "user": unquote(url.username or ""),
                "password": unquote(url.password or ""), "sslmode": "disable", "connect_timeout": 5}
    # A project-specific guard also protects a different local stack on the same port.
    with psycopg.connect(**database, dbname=SOURCE) as conn:
        if conn.execute("select to_regclass('public.wallflow_m4_rehearsal_guard') is not null").fetchone() != (True,):
            parser.error("The disposable rehearsal database guard is missing.")
    if args.stage == "export":
        args.directory.mkdir(mode=0o700)
        export_django(database, args.directory)
    elif args.stage == "django-tests":
        test_django(database)
    else:
        manifest = json.loads((args.directory / "manifest.json").read_bytes())
        with psycopg.connect(**database, dbname=RESTORE if args.stage == "restore-compare" else "postgres") as conn:
            if args.stage == "import":
                import_all(conn, args.directory, manifest)
            verify(conn, args.directory, manifest)


if __name__ == "__main__":
    main()
