"""Rehearse the legacy exporter and receipt importer on the disposable M5 stack."""
import argparse
from datetime import timedelta
import json
import os
from pathlib import Path
import shutil
import sys
from urllib.parse import unquote, urlsplit

import psycopg
from psycopg.types.json import Jsonb

from django_round_trip import configure_django, fail_sql, identifier, seed_django_fixtures, test_django

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from export_django import board_inventory, digest, json_bytes, run_export, verify_bundle

SOURCE = "wallflow_m5_django_source"
SOURCE_GUARD = "public.wallflow_m5_rehearsal_guard"
TARGET_GUARD = "WALLFLOW M5 disposable synthetic rehearsal"
IMPORT = "select wallflow_private.import_django_workspace_with_captures(%s,%s,%s,%s,%s,%s,%s)"
RECONCILE = "select wallflow_private.reconcile_google_account(%s,%s)"
REGISTER = """insert into wallflow_private.legacy_account_map(legacy_user_id,google_sub,legacy_is_active)
              values (%s,%s,%s)"""
ALIVE_CAPTURE_BODY = "Still on the board ☕"
DELETED_CAPTURE_BODY = "Historical, now deleted"


def add_parity_fixtures():
    from django.db import transaction
    from django.utils import timezone
    from accounts.models import User
    from walls.cloud_documents import initial_workspace
    from walls.models import CaptureReceipt, ImportedBoardSource, Wall, WallDocument, WallLinkIntent, WallPreference

    pending = seed_django_fixtures()
    with transaction.atomic():
        document = WallDocument.objects.get(wall_id=identifier(11))
        board = document.cloud_workspace["boards"][str(document.wall_id)]
        board["document"]["notes"].append({
            "id": identifier(33), "title": "", "body": ALIVE_CAPTURE_BODY, "color": "yellow",
            "position": [4, 4], "rotation": 0,
        })
        document.save(update_fields=["cloud_workspace"])
        CaptureReceipt.objects.filter(request_id=identifier(31)).update(content_digest=digest(DELETED_CAPTURE_BODY.encode()))
        CaptureReceipt.objects.create(wall_id=document.wall_id, request_id=identifier(34),
                                      note_id=identifier(33), revision=30, content_digest=digest(ALIVE_CAPTURE_BODY.encode()))
        for number, source, expiry, confirmed in (
            (35, 26, timedelta(minutes=10), 30),
            (36, 29, -timedelta(minutes=10), None),
        ):
            WallLinkIntent.objects.create(id=identifier(number), wall_id=document.wall_id, source_id=identifier(source),
                                          expires_at=timezone.now() + expiry, confirmed_revision=confirmed,
                                          snapshot_digest="a" * 64, session_digest="b" * 64)
        for number, subject in ((5, "m5-empty"), (6, "invalid subject"), (7, "m5-missing-wall"), (8, "m5-conflicted-source")):
            user = User(id=identifier(number), google_sub=subject, email="same-synthetic-address@example.invalid")
            user.set_unusable_password()
            user.save(force_insert=True)
            if number != 7:
                wall = Wall.objects.create(id=identifier(55 if number == 5 else 10 + number), owner=user)
                WallPreference.objects.create(wall=wall)
                if number in (6, 8):
                    source_doc = WallDocument(wall=wall, source_id=identifier(80 + number))
                    original = initial_workspace(source_doc)
                    board = original["boards"][str(wall.id)]
                    board_id = identifier(56)
                    board["id"] = board_id
                    source_doc.cloud_workspace = {
                        "version": 2, "boards": {board_id: board}, "activeBoardId": board_id, "boardOrder": [board_id],
                    }
                    source_doc.save(force_insert=True)
                if number == 8:
                    # These two tables can hold inconsistent claims without violating a single-table key.
                    ImportedBoardSource.objects.create(source_id=identifier(88), wall_id=identifier(13),
                                                       board_id=identifier(13))
    return pending.id


def artifact(directory, entry, kind):
    info = entry["artifacts"][kind]
    raw = (directory / info["file"]).read_bytes()
    assert digest(raw) == info["sha256"]
    return raw


def seed_and_export(database, directory):
    configure_django(database, source=SOURCE)
    pending = add_parity_fixtures()
    report = run_export(directory)
    assert verify_bundle(directory) == report
    assert report["dispositions"] == {"ready": 2, "quarantined": 4, "disabled": 1, "empty": 1}
    accounts = {item["legacyUserId"]: item for item in json.loads((directory / "manifest.json").read_bytes())["accounts"]}
    multi = accounts[identifier(1)]
    assert accounts[identifier(2)]["workspaceOrigin"] == "linked"
    assert "stored-cloud" not in accounts[identifier(2)]["artifacts"]
    assert "stored-cloud" in accounts[identifier(3)]["artifacts"]
    assert accounts[identifier(5)]["workspaceOrigin"] == "uninitialized"
    assert accounts[identifier(6)]["identityState"] == "invalid_subject"
    assert "missing_wall" in accounts[identifier(7)]["issues"]
    assert "source_claimed_by_multiple_accounts" in accounts[identifier(8)]["issues"]
    assert "board_uuid_shared_by_multiple_accounts" in accounts[identifier(8)]["issues"]
    intents = json.loads(artifact(directory, multi, "link-intents"))
    assert {item["state"] for item in intents} == {"pending", "confirmed", "expired"}
    assert len(json.loads(artifact(directory, multi, "capture-receipts"))) == 2

    from django.db import connection
    from walls.models import WallDocument, WallLinkIntent
    assert WallDocument.objects.get(wall_id=identifier(12)).cloud_workspace is None
    assert not WallDocument.objects.filter(wall_id=identifier(55)).exists()
    assert WallLinkIntent.objects.get(pk=pending).confirmed_revision is None
    with connection.cursor() as cursor:
        cursor.execute("select cloud_workspace::text from walls_walldocument where wall_id=%s", (identifier(11),))
        assert artifact(directory, multi, "stored-cloud") == cursor.fetchone()[0].encode("utf-8")

    damaged = directory.with_name(directory.name + "-tamper-test")
    shutil.copytree(directory, damaged)
    damaged_file = damaged / multi["artifacts"]["stored-cloud"]["file"]
    damaged_file.write_bytes(damaged_file.read_bytes() + b" ")
    try:
        verify_bundle(damaged)
    except ValueError:
        pass
    else:
        raise AssertionError("Corrupted export was accepted.")
    print("PASS source export: 8 accounts, exact raw JSON, intent states, 2 receipts, quarantine and checksum tamper rejection")


def make_auth(conn, owner, subject):
    conn.execute("insert into auth.users(id,email) values (%s,%s)", (owner, f"{owner}@example.invalid"))
    conn.execute("""insert into auth.identities(id,user_id,provider,provider_id,identity_data)
                    values (gen_random_uuid(),%s,'google',%s,%s)""", (owner, subject, Jsonb({"sub": subject})))
    session = conn.execute("insert into auth.sessions (id,user_id,created_at) values (gen_random_uuid(),%s,now()) returning id",
                           (owner,)).fetchone()[0]
    return str(session)


def act_as(conn, owner, session):
    conn.execute("set local role authenticated")
    conn.execute("select set_config('request.jwt.claims',%s,true)",
                 (json.dumps({"sub": owner, "session_id": session, "role": "authenticated"}),))


def import_parameters(directory, entry, owner):
    workspace = artifact(directory, entry, "workspace")
    captures = artifact(directory, entry, "capture-receipts")
    claims = json.loads(artifact(directory, entry, "source-claims"))
    return (entry["legacyUserId"], owner, workspace.decode(), digest(workspace), Jsonb(claims),
            captures.decode(), digest(captures))


def verify_import(conn, directory, entry, owner, saved):
    raw = artifact(directory, entry, "workspace")
    captures_raw = artifact(directory, entry, "capture-receipts")
    workspace = json.loads(raw)
    assert dict(saved, claimedSources=sorted(saved["claimedSources"])) == {
        **workspace, "revision": str(max(1, int(workspace["revision"]))),
    }
    assert board_inventory(saved["workspace"]) == entry["boards"]
    assert conn.execute("""select original,legacy_capture_manifest from wallflow_private.workspace_import_backups
                           where owner_id=%s and operation_id=%s""", (owner, entry["legacyUserId"])).fetchone() == (
        raw.decode(), captures_raw.decode(),
    )
    captures = json.loads(captures_raw)
    sql_receipts = conn.execute("""
        select operation_id::text,request_digest,revision::text,result ->> 'noteId'
        from wallflow_private.operation_receipts where owner_id=%s and operation_kind='quick_capture'
        order by operation_id
    """, (owner,)).fetchall()
    assert sql_receipts == [(r["requestId"], r["contentDigest"], r["revision"], r["noteId"]) for r in captures]
    claims = json.loads(artifact(directory, entry, "source-claims"))
    assert conn.execute("""
        select source_id::text, claimed_board_id::text, board_id::text
        from wallflow_private.import_sources where owner_id=%s order by source_id
    """, (owner,)).fetchall() == [
        (row["sourceId"], row["boardId"], row["boardId"] if row["boardId"] in workspace["workspace"]["boards"] else None)
        for row in claims
    ]
    assert conn.execute("select count(*) from wallflow_private.import_intents where owner_id=%s", (owner,)).fetchone() == (0,)


def rehearsal(conn, directory):
    verify_bundle(directory)
    accounts = json.loads((directory / "manifest.json").read_bytes())["accounts"]
    owners = {}
    for number, entry in enumerate(accounts, 1):
        legacy, subject = entry["legacyUserId"], entry["googleSubject"]
        owner = identifier(60 + number)
        if entry["identityState"] != "candidate":
            assert entry["disposition"] == "quarantined"
            continue
        with conn.transaction():
            if entry["disposition"] == "quarantined":
                # The importer is never invoked for invalid or unresolved source records.
                continue
            session = make_auth(conn, owner, subject)
            conn.execute(REGISTER, (legacy, subject, entry["active"]))
            if entry["disposition"] == "disabled":
                fail_sql(conn, "42501", RECONCILE, (owner, subject))
                assert conn.execute("select count(*) from public.profiles where owner_id=%s", (owner,)).fetchone() == (0,)
                continue
            owners[legacy] = (entry, owner, session)
            if legacy == identifier(1):
                fail_sql(conn, "23505", REGISTER, (identifier(99), subject, True))
                fail_sql(conn, "23505", """insert into auth.identities(id,user_id,provider,provider_id,identity_data)
                  values (gen_random_uuid(),%s,'google',%s,%s)""", (owner, subject, Jsonb({"sub": subject})))
                fail_sql(conn, "42501", RECONCILE, (owner, "wrong-verified-subject"))
                conn.execute("""insert into auth.identities(id,user_id,provider,provider_id,identity_data)
                  values (gen_random_uuid(),%s,'email','m5-ambiguous','{}')""", (owner,))
                fail_sql(conn, "42501", RECONCILE, (owner, subject))
                # Remove only the ambiguous provider fixture inside this disposable transaction.
                conn.execute("delete from auth.identities where user_id=%s and provider='email'", (owner,))
            assert str(conn.execute(RECONCILE, (owner, subject)).fetchone()[0]) == legacy

    for legacy, (entry, owner, session) in owners.items():
        params = import_parameters(directory, entry, owner)
        with conn.transaction(force_rollback=True):
            conn.execute(IMPORT, params).fetchone()
        assert conn.execute("select count(*) from public.workspaces where owner_id=%s", (owner,)).fetchone() == (0,)
        assert conn.execute("select count(*) from wallflow_private.operation_receipts where owner_id=%s", (owner,)).fetchone() == (0,)
        assert conn.execute("select count(*) from wallflow_private.workspace_import_backups where owner_id=%s", (owner,)).fetchone() == (0,)
        assert conn.execute("select is_active from public.profiles where owner_id=%s", (owner,)).fetchone() == (False,)
        if legacy == identifier(1):
            with conn.transaction(force_rollback=True):
                conn.execute("update public.profiles set is_active=true where owner_id=%s", (owner,))
                conn.execute("update wallflow_private.legacy_account_map set workspace_reconciled_at=now() where legacy_user_id=%s",
                             (legacy,))
                act_as(conn, owner, session)
                existing = conn.execute("select public.initialize_wallflow_workspace(%s)", (owner,)).fetchone()
                conn.execute("reset role")
                fail_sql(conn, "23505", IMPORT, params)
                assert conn.execute("select id from public.workspaces where owner_id=%s", (owner,)).fetchone() == existing
            fail_sql(conn, "22023", IMPORT, (*params[:-1], "0" * 64))
            invalid_captures = json.loads(params[-2])
            invalid_captures.append({**invalid_captures[0], "requestId": identifier(96), "revision": "999"})
            invalid_raw = json_bytes(invalid_captures)
            fail_sql(conn, "22023", IMPORT, (*params[:-2], invalid_raw.decode(), digest(invalid_raw)))
            assert conn.execute("select count(*) from public.workspaces where owner_id=%s", (owner,)).fetchone() == (0,)
            assert conn.execute("select is_active from public.profiles where owner_id=%s", (owner,)).fetchone() == (False,)

        saved = conn.execute(IMPORT, params).fetchone()[0]
        assert conn.execute(IMPORT, params).fetchone()[0] == saved
        fail_sql(conn, "23505", IMPORT, (*params[:-2], params[-2] + "\n", digest((params[-2] + "\n").encode())))
        verify_import(conn, directory, entry, owner, saved)
        with conn.transaction():
            act_as(conn, owner, session)
            assert conn.execute("select public.read_wallflow_workspace(%s)", (owner,)).fetchone()[0] == saved
            if legacy == identifier(1):
                for request, note, body, deleted in (
                    (31, 32, DELETED_CAPTURE_BODY, True), (34, 33, ALIVE_CAPTURE_BODY, False),
                ):
                    response = conn.execute("select public.quick_capture_wallflow_note(%s,%s,%s)",
                                            (owner, identifier(request), "  " + body + "\n")).fetchone()[0]
                    assert response["noteId"] == identifier(note) and (response["note"] is None) == deleted
                    assert response["revision"] == saved["revision"]
                    fail_sql(conn, "PT409", "select public.quick_capture_wallflow_note(%s,%s,%s)",
                             (owner, identifier(request), "different text"))
                assert conn.execute("select public.recover_wallflow_browser_import(%s,%s)",
                                    (owner, identifier(26))).fetchone() == ("claimed",)
                fail_sql(conn, "23505", "select public.prepare_wallflow_browser_import(%s,%s)",
                         (owner, Jsonb([{"sourceId": identifier(26), "snapshotDigest": "a" * 64}])))
                assert conn.execute("select public.read_wallflow_workspace(%s)", (owner,)).fetchone()[0] == saved

    assert conn.execute("select count(*) from public.workspaces where owner_id::text like '84100000-0000-4000-8000-000000000%'").fetchone() == (3,)
    print("PASS local import: cloud, linked and empty workspaces; existing destination, duplicate, ambiguous and disabled denial")
    print("PASS local import: rollback, identical retry, changed manifest rejection, original bytes, source claims and capture replay")


def local_database(url):
    parsed = urlsplit(url)
    if (parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"127.0.0.1", "localhost"}
        or parsed.port != 55322 or parsed.path != "/postgres"):
        raise ValueError("Only the disposable WALLFLOW local database on port 55322 is supported.")
    return {"host": parsed.hostname, "port": parsed.port, "user": unquote(parsed.username or ""),
            "password": unquote(parsed.password or ""), "sslmode": "disable", "connect_timeout": 5}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["export", "import", "django-tests"])
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    os.umask(0o077)
    database = local_database(os.environ["WALLFLOW_REHEARSAL_LOCAL_DB_URL"])
    with psycopg.connect(**database, dbname=SOURCE) as source:
        if source.execute("select to_regclass(%s) is not null", (SOURCE_GUARD,)).fetchone() != (True,):
            parser.error("The disposable source guard is missing.")
    if args.stage == "export":
        seed_and_export(database, directory)
    elif args.stage == "django-tests":
        test_django(database, source=SOURCE, test_database="test_wallflow_m5_django")
    else:
        with psycopg.connect(**database, dbname="postgres", autocommit=True) as conn:
            if conn.execute("select shobj_description(oid,'pg_database') from pg_database where datname=current_database()").fetchone() != (TARGET_GUARD,):
                parser.error("The disposable destination guard is missing.")
            rehearsal(conn, directory)


if __name__ == "__main__":
    main()
