import copy
import hashlib
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch as mock

from django.db import OperationalError, close_old_connections, connection, transaction
from django.test import Client, TestCase, TransactionTestCase
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from .models import CaptureReceipt, ImportedBoardSource, Wall, WallDocument, WallLinkIntent, WallPreference


def owner(subject):
    user = User.objects.create_user(subject)
    wall = Wall.objects.create(owner=user)
    WallPreference.objects.create(wall=wall)
    return user, wall


def browser(user, csrf=False):
    client = Client(enforce_csrf_checks=csrf)
    client.force_login(user, backend="accounts.backends.GoogleSessionBackend")
    return client


def board():
    return {
        "id": "first-board", "name": "Ideas",
        "document": {
            "notes": [
                {"id": "research", "title": "Research 🔬", "body": "Across devices", "color": "mint",
                 "position": [1.25, 3.1], "rotation": .1, "size": [3, 3.2], "sectionId": "lab",
                 "dueDate": "2026-12-01", "plannedOn": "2026-11-29", "priority": "high", "doodle": "flask",
                 "inlineSketches": True, "reminder": {"id": "alarm", "at": 1800000000000},
                 "checklist": [{"id": "item", "text": "Bring notes", "done": True, "plannedOn": "2026-11-29"}]},
                {"id": "past", "title": "Archive", "body": "", "color": "cream",
                 "position": [-1, 0], "rotation": -.25, "archived": True},
            ],
            "sections": [{"id": "lab", "name": "Lab", "position": [1, 3]}],
            "wallRotation": [-4, 3],
        },
        "preferences": {"noteDefaults": {"color": "grey", "typography": "sans", "size": "large", "rotation": "straight"},
                        "showHints": False, "onboardingComplete": True},
        "presentation": {"lighting": "warm", "appearance": {
            "theme": "office", "shade": "mist", "intensity": 95, "ambience": "quiet", "photoWorkspace": "scientist"}},
        "notifiedReminders": ["alarm"],
    }


def post(client, name, data, **headers):
    return client.post(reverse(name), data, content_type="application/json", **headers)


def prepare(client, user, source, snapshot):
    return post(client, "wall-link-prepare", {
        "sourceId": str(source), "expectedAccountId": str(user.pk), "schemaVersion": 1,
        "snapshotDigest": hashlib.sha256(snapshot.encode()).hexdigest(),
    })


def confirm(client, user, intent, snapshot):
    return post(client, "wall-link-confirm", {
        "intentId": str(intent), "expectedAccountId": str(user.pk), "snapshot": snapshot,
    })


def create_link(client, user, source=None, snapshot=None):
    snapshot = json.dumps(board()) if snapshot is None else snapshot
    intent = prepare(client, user, source or uuid.uuid4(), snapshot).json()["intentId"]
    return confirm(client, user, intent, snapshot)


def recover(client, user, source):
    return post(client, "wall-link-recover", {
        "sourceId": str(source), "expectedAccountId": str(user.pk),
    })


def read(client, user, **headers):
    return client.get(reverse("wall-document"), HTTP_X_WALLFLOW_ACCOUNT=str(user.pk), **headers)


def patch(client, user, current, revision, removed=None):
    return client.patch(reverse("wall-document"), {
        "board": current, "expectedAccountId": str(user.pk), "removed": removed or {"notes": [], "sections": []},
    }, content_type="application/json", HTTP_IF_MATCH=revision)


def capture(client, user, key, content="Capture 🔬"):
    return post(client, "mobile-quick-capture", {"content": content},
                HTTP_X_WALLFLOW_ACCOUNT=str(user.pk), HTTP_IDEMPOTENCY_KEY=str(key))


class LinkedWallTests(TestCase):
    def setUp(self):
        self.a, self.wall = owner("google-a")
        self.b, self.other = owner("google-b")
        self.client_a = browser(self.a)
        self.client_b = browser(self.b)

    def test_authentication_csrf_and_no_link_on_sign_in(self):
        self.assertEqual(read(Client(), self.a).status_code, 403)
        self.assertEqual(capture(Client(), self.a, uuid.uuid4()).status_code, 403)
        csrf_browser = browser(self.a, csrf=True)
        self.assertEqual(prepare(csrf_browser, self.a, uuid.uuid4(), json.dumps(board())).json()["error"]["code"], "csrf_failed")
        self.assertFalse(WallDocument.objects.exists())
        self.assertEqual(read(self.client_a, self.a).status_code, 404)

    def test_link_preserves_document_and_is_idempotent(self):
        before = board()
        snapshot = json.dumps(before, ensure_ascii=False)
        source = uuid.uuid4()
        draft = prepare(self.client_a, self.a, source, snapshot)
        self.assertEqual(draft.status_code, 200)
        self.assertFalse(WallDocument.objects.exists())
        intent = draft.json()["intentId"]
        accepted = confirm(self.client_a, self.a, intent, snapshot)
        self.assertEqual(accepted.status_code, 201, accepted.content)
        replay = confirm(self.client_a, self.a, intent, snapshot)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(accepted.json(), replay.json())
        response = read(self.client_a, self.a)
        before["id"] = str(self.wall.pk)
        self.assertEqual(response.json()["board"], before)
        self.assertEqual(response.json()["sourceId"], str(source))
        self.assertEqual(read(self.client_a, self.a, HTTP_IF_NONE_MATCH=response["ETag"]).status_code, 304)
        self.assertEqual(prepare(self.client_b, self.b, source, snapshot).status_code, 409)
        self.assertEqual(prepare(self.client_a, self.a, uuid.uuid4(), snapshot).status_code, 409)
        self.assertEqual(WallDocument.objects.count(), 1)

    def test_account_switch_and_different_browser_session_cannot_confirm(self):
        snapshot = json.dumps(board())
        intent = prepare(self.client_a, self.a, uuid.uuid4(), snapshot).json()["intentId"]
        self.assertEqual(confirm(self.client_b, self.a, intent, snapshot).json()["error"]["code"], "account_changed")
        self.assertEqual(confirm(self.client_b, self.b, intent, snapshot).status_code, 409)
        self.assertEqual(confirm(browser(self.a), self.a, intent, snapshot).status_code, 409)
        self.assertFalse(WallDocument.objects.exists())

    def test_changed_expired_and_invalid_snapshots_leave_both_walls_intact(self):
        raw = json.dumps(board())
        source = uuid.uuid4()
        intent = prepare(self.client_a, self.a, source, raw).json()["intentId"]
        self.assertEqual(confirm(self.client_a, self.a, intent, raw + " ").json()["error"]["code"], "board_changed")
        WallLinkIntent.objects.filter(pk=intent).update(expires_at=timezone.now())
        self.assertEqual(confirm(self.client_a, self.a, intent, raw).json()["error"]["code"], "review_expired")
        value = board()
        value["document"]["notes"][0]["position"] = [100, 0]
        invalid = json.dumps(value)
        intent = prepare(self.client_a, self.a, source, invalid).json()["intentId"]
        self.assertEqual(confirm(self.client_a, self.a, intent, invalid).status_code, 400)
        self.wall.refresh_from_db()
        self.assertEqual(self.wall.revision, 0)
        self.assertFalse(WallDocument.objects.exists())

    def test_database_error_rolls_back_the_entire_confirmation(self):
        from .documents import write_board

        raw = json.dumps(board())
        source = uuid.uuid4()
        intent = prepare(self.client_a, self.a, source, raw).json()["intentId"]

        def interrupted(document, value):
            write_board(document, value)
            raise OperationalError("simulated write failure")

        with mock("walls.views.write_board", side_effect=interrupted):
            self.assertEqual(confirm(self.client_a, self.a, intent, raw).status_code, 503)
        self.wall.refresh_from_db()
        self.assertEqual((self.wall.name, self.wall.revision), ("My everyday wall", 0))
        self.assertFalse(WallDocument.objects.exists())
        self.assertIsNone(WallLinkIntent.objects.get(pk=intent).confirmed_revision)
        self.assertEqual(confirm(self.client_a, self.a, intent, raw).status_code, 201)

    def test_remote_reads_and_writes_cannot_cross_accounts(self):
        self.assertEqual(create_link(self.client_a, self.a).status_code, 201)
        self.assertEqual(create_link(self.client_b, self.b).status_code, 201)
        first = read(self.client_a, self.a)
        self.assertEqual(read(self.client_b, self.a).json()["error"]["code"], "account_changed")
        self.assertEqual(patch(self.client_b, self.b, first.json()["board"], first["ETag"]).status_code, 404)
        self.assertEqual(read(self.client_a, self.a).json()["revision"], "1")
        self.assertEqual(read(self.client_b, self.b).json()["revision"], "1")

    def test_linked_workspace_is_authoritative_across_independent_browser_sessions(self):
        self.assertEqual(create_link(self.client_a, self.a).status_code, 201)
        second_device = browser(self.a)
        self.assertNotEqual(second_device.session.session_key, self.client_a.session.session_key)

        first = read(self.client_a, self.a)
        second = read(second_device, self.a)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(first["ETag"], second["ETag"])
        self.assertEqual(second.json()["board"]["document"], board()["document"])
        self.assertEqual(second.json()["board"]["presentation"], board()["presentation"])
        self.assertEqual(second.json()["board"]["preferences"], board()["preferences"])
        self.assertEqual(second.json()["board"]["notifiedReminders"], board()["notifiedReminders"])

        current = second.json()["board"]
        added = {"id": "from-second-device", "title": "New note", "body": "", "position": [0, 0], "rotation": 0, "color": "pink"}
        current["document"]["notes"].append(added)
        saved = patch(second_device, self.a, current, second["ETag"])
        self.assertEqual(saved.status_code, 200, saved.content)
        stale = patch(self.client_a, self.a, first.json()["board"], first["ETag"])
        self.assertEqual(stale.status_code, 412)
        refreshed = read(self.client_a, self.a)
        self.assertEqual(refreshed.json()["board"]["document"]["notes"][-1], added)

        desktop_edit = refreshed.json()["board"]
        desktop_edit["document"]["notes"][-1].update({"title": "Edited from desktop", "archived": True})
        self.assertEqual(patch(self.client_a, self.a, desktop_edit, refreshed["ETag"]).status_code, 200)
        latest = read(second_device, self.a)
        self.assertEqual(latest.json()["board"], desktop_edit)
        desktop_edit["document"]["notes"].pop()
        self.assertEqual(patch(second_device, self.a, desktop_edit, latest["ETag"], {"notes": [added["id"]], "sections": []}).status_code, 200)
        self.assertEqual(read(self.client_b, self.b).status_code, 404)
        second_device.logout()
        self.assertEqual(read(second_device, self.a).status_code, 403)
        self.assertEqual(read(browser(self.a), self.a).json()["board"], desktop_edit)

    def test_recovery_keeps_committed_source_private_after_a_lost_response(self):
        source = uuid.uuid4()
        raw = json.dumps(board())
        intent = prepare(self.client_a, self.a, source, raw).json()["intentId"]
        self.assertEqual(recover(self.client_b, self.b, source).json(), {"status": "pending"})
        self.assertEqual(recover(self.client_b, self.a, source).json()["error"]["code"], "account_changed")
        self.assertEqual(recover(Client(), self.a, source).status_code, 403)
        self.assertEqual(recover(browser(self.a, csrf=True), self.a, source).json()["error"]["code"], "csrf_failed")
        self.assertEqual(confirm(self.client_a, self.a, intent, raw).status_code, 201)
        self.assertEqual(recover(self.client_b, self.b, source).json(), {"status": "claimed"})
        self.assertEqual(read(self.client_b, self.b).status_code, 404)
        self.assertEqual(recover(browser(self.a), self.a, source).json(), {"status": "claimed"})
        self.assertEqual(read(browser(self.a), self.a).json()["board"]["document"], board()["document"])
        self.assertEqual(confirm(self.client_a, self.a, intent, raw).status_code, 200)

    def test_recovery_fences_an_unconfirmed_request_after_a_crash(self):
        source = uuid.uuid4()
        raw = json.dumps(board())
        intent = prepare(self.client_a, self.a, source, raw).json()["intentId"]
        self.assertEqual(recover(browser(self.a), self.a, source).json(), {"status": "available"})
        self.assertEqual(confirm(self.client_a, self.a, intent, raw).json()["error"]["code"], "review_expired")
        self.assertFalse(WallDocument.objects.exists())
        self.assertEqual(recover(self.client_a, self.a, source).json(), {"status": "available"})
        self.assertEqual(create_link(self.client_a, self.a, source, raw).status_code, 201)

    def test_revision_conflict_and_explicit_removals(self):
        self.assertEqual(create_link(self.client_a, self.a).status_code, 201)
        response = read(self.client_a, self.a)
        changed = copy.deepcopy(response.json()["board"])
        changed["document"]["notes"].pop()
        self.assertEqual(patch(self.client_a, self.a, changed, response["ETag"]).status_code, 400)
        saved = patch(self.client_a, self.a, changed, response["ETag"], {"notes": ["past"], "sections": []})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()["board"], changed)
        self.assertEqual(patch(self.client_a, self.a, changed, response["ETag"]).status_code, 412)

    def test_capture_reuses_wall_defaults_and_retries_without_duplicates(self):
        self.assertEqual(create_link(self.client_a, self.a).status_code, 201)
        key = uuid.uuid4()
        self.assertEqual(capture(self.client_a, self.a, key, "  ").status_code, 400)
        self.assertEqual(capture(self.client_a, self.a, key, "🔬" * 121).status_code, 400)
        self.assertEqual(capture(self.client_b, self.b, key).status_code, 404)
        first = capture(self.client_a, self.a, key)
        self.assertEqual(first.status_code, 201, first.content)
        note = first.json()["note"]
        self.assertEqual((note["color"], note["typography"], note["rotation"]), ("grey", "sans", 0))
        self.assertEqual(capture(self.client_a, self.a, key).json(), first.json())
        self.assertEqual(capture(self.client_a, self.a, key, "different").status_code, 409)
        self.assertEqual(CaptureReceipt.objects.count(), 1)
        current = read(self.client_a, self.a)
        self.assertEqual(current.json()["board"]["document"]["notes"][2], note)
        self.assertEqual(current.json()["revision"], "2")


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row locks and constraints are required")
class LinkedWallPostgresTests(TransactionTestCase):
    def concurrently(self, first, second):
        barrier = Barrier(2)

        def run(operation):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return operation().status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(run, fn) for fn in (first, second)]
            return sorted(job.result(timeout=20) for job in jobs)

    def test_two_accounts_racing_to_claim_one_source_choose_one_owner(self):
        a, first_wall = owner("postgres-a")
        b, second_wall = owner("postgres-b")
        first, second = browser(a), browser(b)
        source, raw = uuid.uuid4(), json.dumps(board())
        first_intent = prepare(first, a, source, raw).json()["intentId"]
        second_intent = prepare(second, b, source, raw).json()["intentId"]
        results = self.concurrently(
            lambda: confirm(first, a, first_intent, raw), lambda: confirm(second, b, second_intent, raw),
        )
        self.assertEqual(results, [201, 409])
        document = WallDocument.objects.get(source_id=source)
        winner, loser = (a, b) if document.wall_id == first_wall.pk else (b, a)
        self.assertEqual(read(browser(winner), winner).status_code, 200)
        self.assertEqual(read(browser(loser), loser).status_code, 404)
        first_wall.refresh_from_db()
        second_wall.refresh_from_db()
        self.assertEqual(sorted([first_wall.revision, second_wall.revision]), [0, 1])

    def test_duplicate_capture_requests_and_a_stale_edit_serialize_safely(self):
        user, wall = owner("postgres-capture")
        first, second = browser(user), browser(user)
        self.assertEqual(create_link(first, user).status_code, 201)
        stale = read(first, user)
        key = uuid.uuid4()
        self.assertEqual(self.concurrently(lambda: capture(first, user, key), lambda: capture(second, user, key)), [200, 201])
        self.assertEqual(patch(first, user, stale.json()["board"], stale["ETag"]).status_code, 412)
        wall.refresh_from_db()
        self.assertEqual(wall.revision, 2)
        self.assertEqual(len(wall.document.notes), 3)

    def test_simultaneous_desktop_edit_and_capture_preserve_the_winning_changes(self):
        user, wall = owner("postgres-desktop-and-mobile")
        desktop, mobile = browser(user), browser(user)
        self.assertEqual(create_link(desktop, user).status_code, 201)
        initial = read(desktop, user)
        edited = initial.json()["board"]
        edited["document"]["notes"][0]["body"] = "Desktop edit"
        statuses = self.concurrently(
            lambda: patch(desktop, user, edited, initial["ETag"]),
            lambda: capture(mobile, user, uuid.uuid4(), "Mobile capture"),
        )
        self.assertIn(statuses, ([200, 201], [201, 412]))
        wall.refresh_from_db()
        self.assertEqual(wall.revision, 3 if statuses == [200, 201] else 2)
        notes = wall.document.notes
        self.assertEqual(notes[-1]["body"], "Mobile capture")
        self.assertEqual(notes[0]["body"], "Desktop edit" if statuses == [200, 201] else "Across devices")
        if statuses == [201, 412]:
            latest = read(desktop, user)
            reapplied = latest.json()["board"]
            reapplied["document"]["notes"][0]["body"] = "Desktop edit"
            self.assertEqual(patch(desktop, user, reapplied, latest["ETag"]).status_code, 200)
            self.assertEqual(read(desktop, user).json()["board"]["document"]["notes"][-1]["body"], "Mobile capture")

    def test_simultaneous_recovery_and_confirmation_cannot_release_a_claimed_source(self):
        user, wall = owner("postgres-recover")
        first, second = browser(user), browser(user)
        source, raw = uuid.uuid4(), json.dumps(board())
        intent = prepare(first, user, source, raw).json()["intentId"]
        outcome = {}

        def resolve():
            response = recover(second, user, source)
            outcome.update(response.json())
            return response

        statuses = self.concurrently(lambda: confirm(first, user, intent, raw), resolve)
        self.assertIn(statuses, ([200, 201], [200, 409]))
        self.assertEqual(outcome.get("status"), "claimed" if statuses == [200, 201] else "available")
        self.assertEqual(WallDocument.objects.filter(wall=wall).exists(), statuses == [200, 201])

    def test_raw_sql_account_delete_cascades_cloud_sources_and_receipts(self):
        first, first_wall = owner("erase-linked")
        second, second_wall = owner("keep-linked")
        for user in (first, second):
            client = browser(user)
            self.assertEqual(create_link(client, user).status_code, 201)
            self.assertEqual(capture(client, user, uuid.uuid4()).status_code, 201)

        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("DELETE FROM accounts_user WHERE id = %s", [first.pk])

        self.assertFalse(User.objects.filter(pk=first.pk).exists())
        for model in (WallPreference, WallDocument, WallLinkIntent, CaptureReceipt, ImportedBoardSource):
            self.assertFalse(model.objects.filter(wall_id=first_wall.pk).exists())
            self.assertTrue(model.objects.filter(wall_id=second_wall.pk).exists())

    def test_competing_cloud_imports_cannot_duplicate_one_source(self):
        from .test_workspace import confirm as confirm_import, review

        a, _ = owner("workspace-import-a")
        b, _ = owner("workspace-import-b")
        first, second = browser(a), browser(b)
        snapshots, sources = [json.dumps(board())], [uuid.uuid4()]
        first_intents = review(first, a, snapshots, sources).json()["intentIds"]
        second_intents = review(second, b, snapshots, sources).json()["intentIds"]
        result = self.concurrently(
            lambda: confirm_import(first, a, snapshots, first_intents),
            lambda: confirm_import(second, b, snapshots, second_intents),
        )
        self.assertEqual(result, [200, 409])
        self.assertEqual(ImportedBoardSource.objects.count(), 1)
