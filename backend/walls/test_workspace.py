import hashlib
import json
import uuid

from django.test import Client, TestCase
from django.urls import reverse

from .models import ImportedBoardSource
from .test_linked import board, browser, capture, create_link, owner, post


def get(client, account):
    return client.get(reverse("account-workspace"), HTTP_X_WALLFLOW_ACCOUNT=str(account.pk))


def save(client, account, previous, workspace, removed=()):
    return client.patch(reverse("account-workspace"), {
        "expectedAccountId": str(account.pk), "workspace": workspace, "removedBoards": list(removed),
    }, content_type="application/json", HTTP_IF_MATCH=previous["ETag"])


def review(client, account, snapshots, sources):
    return post(client, "workspace-import-prepare", {
        "expectedAccountId": str(account.pk),
        "sources": [{"sourceId": str(source), "snapshotDigest": hashlib.sha256(snapshot.encode()).hexdigest()}
                    for source, snapshot in zip(sources, snapshots)],
    })


def confirm(client, account, snapshots, intents):
    return post(client, "workspace-import-confirm", {
        "expectedAccountId": str(account.pk),
        "boards": [{"intentId": intent, "snapshot": snapshot} for intent, snapshot in zip(intents, snapshots)],
    })


class WorkspaceTests(TestCase):
    def setUp(self):
        self.a, self.wall = owner("cloud-a")
        self.b, _ = owner("cloud-b")
        self.desktop = browser(self.a)
        self.mobile = browser(self.a)

    def test_every_account_opens_its_cloud_workspace_and_persists_multiple_boards(self):
        self.assertEqual(get(Client(), self.a).status_code, 403)
        initial = get(self.desktop, self.a)
        self.assertEqual(initial.json(), get(self.mobile, self.a).json())
        value = initial.json()["workspace"]
        self.assertEqual(value["boards"][str(self.wall.pk)]["document"]["notes"], [])
        extra = board()
        extra["id"] = str(uuid.uuid4())
        value["boardOrder"].append(extra["id"])
        value["boards"][extra["id"]] = extra
        value["activeBoardId"] = extra["id"]
        saved = save(self.desktop, self.a, initial, value)
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(get(self.mobile, self.a).json()["workspace"], value)
        self.assertEqual(save(self.mobile, self.a, initial, value).status_code, 412)

        captured = capture(self.mobile, self.a, uuid.uuid4())
        self.assertEqual(captured.status_code, 201)
        latest = get(self.desktop, self.a).json()["workspace"]
        self.assertEqual(latest["boards"][extra["id"]]["document"]["notes"][-1], captured.json()["note"])
        self.assertEqual(latest["boards"][str(self.wall.pk)]["document"]["notes"], [])
        other = get(browser(self.b), self.b).json()["workspace"]
        self.assertNotIn(extra["id"], other["boards"])

    def test_import_preserves_all_snapshots_and_only_removes_the_untouched_placeholder(self):
        first, second = board(), board()
        second["id"], second["name"] = "another", "Second browser board"
        snapshots = [json.dumps(first), json.dumps(second)]
        sources = [uuid.uuid4(), uuid.uuid4()]
        self.assertEqual(get(self.desktop, self.a)["ETag"], '"0"')
        prepared = review(self.desktop, self.a, snapshots, sources)
        self.assertEqual(prepared.status_code, 200, prepared.content)
        intents = prepared.json()["intentIds"]
        bad = confirm(self.desktop, self.a, [snapshots[0], snapshots[1] + " "], intents)
        self.assertEqual(bad.status_code, 409)
        self.assertFalse(ImportedBoardSource.objects.exists())
        self.assertEqual(confirm(browser(self.b), self.b, snapshots, intents).status_code, 409)
        self.assertEqual(confirm(self.mobile, self.a, snapshots, intents).status_code, 409)

        completed = confirm(self.desktop, self.a, snapshots, intents)
        self.assertEqual(completed.status_code, 200, completed.content)
        value = completed.json()["workspace"]
        self.assertEqual(len(value["boardOrder"]), 2)
        for original, cloud_id in zip((first, second), value["boardOrder"]):
            self.assertEqual(value["boards"][cloud_id], {**original, "id": cloud_id})
        self.assertEqual(confirm(self.desktop, self.a, snapshots, intents).json(), completed.json())
        self.assertEqual(get(self.mobile, self.a).json(), completed.json())
        self.assertEqual(review(browser(self.b), self.b, snapshots, sources).status_code, 409)

    def test_import_appends_to_existing_linked_cloud_data(self):
        self.assertEqual(create_link(self.desktop, self.a).status_code, 201)
        initial = get(self.desktop, self.a).json()["workspace"]
        snapshots = [json.dumps(board())]
        intents = review(self.desktop, self.a, snapshots, [uuid.uuid4()]).json()["intentIds"]
        response = confirm(self.desktop, self.a, snapshots, intents)
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()["workspace"]
        self.assertEqual(len(result["boardOrder"]), 2)
        self.assertEqual(result["boards"][str(self.wall.pk)], initial["boards"][str(self.wall.pk)])
