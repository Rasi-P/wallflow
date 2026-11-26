from unittest import skipUnless
from unittest.mock import patch

from django.db import IntegrityError, OperationalError, connection, transaction
from django.test import TestCase
from django.urls import reverse

from accounts.models import User

from .models import Wall, WallPreference


class FoundationTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("provider-subject")
        self.wall = Wall.objects.create(owner=self.owner)
        self.preferences = WallPreference.objects.create(wall=self.wall)

    def test_duplicate_subject_fails_even_if_email_differs(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user(self.owner.google_sub, email="different@example.test")

    def test_passwords_cannot_be_enabled(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.filter(pk=self.owner.pk).update(password="usable")

    def test_second_wall_and_preferences_are_rejected(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Wall.objects.create(owner=self.owner)
        with self.assertRaises(IntegrityError), transaction.atomic():
            WallPreference.objects.create(wall=self.wall)

    def test_database_rejects_bad_bounds_enums_and_counters(self):
        cases = [
            (Wall, {"tilt_deg": 26}), (Wall, {"turn_deg": float("inf")}),
            (Wall, {"revision": -1}), (Wall, {"next_note_order": 0}),
            (WallPreference, {"theme": "other"}), (WallPreference, {"light_intensity": 116}),
        ]
        for model, fields in cases:
            with self.subTest(fields=fields), self.assertRaises(IntegrityError), transaction.atomic():
                model.objects.update(**fields)

    def test_orm_delete_cascades_without_affecting_other_owner(self):
        other = User.objects.create_user("other-subject")
        other_wall = Wall.objects.create(owner=other)
        self.owner.delete()
        self.assertFalse(Wall.objects.filter(pk=self.wall.pk).exists())
        self.assertFalse(WallPreference.objects.filter(pk=self.wall.pk).exists())
        self.assertTrue(Wall.objects.filter(pk=other_wall.pk).exists())

    @skipUnless(connection.vendor == "postgresql", "PostgreSQL database FK actions are required")
    def test_sql_delete_cascades_without_django_orm(self):
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM accounts_user WHERE id = %s", [self.owner.pk])
        self.assertFalse(Wall.objects.filter(pk=self.wall.pk).exists())
        self.assertFalse(WallPreference.objects.filter(pk=self.wall.pk).exists())

    def test_health_discloses_only_availability(self):
        result = self.client.get(reverse("health"))
        self.assertEqual(result.json(), {"status": "ok"})
        with patch("config.api.connection.cursor", side_effect=OperationalError("private connection detail")):
            result = self.client.get(reverse("health"))
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.json()["error"]["code"], "unavailable")
        self.assertNotContains(result, "private connection detail", status_code=503)
