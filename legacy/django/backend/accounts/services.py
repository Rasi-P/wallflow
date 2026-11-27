from django.contrib.auth.hashers import make_password
from django.db import transaction

from walls.models import Wall, WallPreference

from .models import User


class AccountInactive(Exception):
    pass


@transaction.atomic
def provision_account(identity):
    user, created = User.objects.select_for_update().get_or_create(
        google_sub=identity.sub,
        defaults={
            "email": identity.email,
            "display_name": identity.display_name,
            "password": lambda: make_password(None),
        },
    )
    if not user.is_active:
        raise AccountInactive

    if not created and (user.email, user.display_name) != (identity.email, identity.display_name):
        user.email = identity.email
        user.display_name = identity.display_name
        user.save(update_fields=("email", "display_name", "updated_at"))

    wall, _ = Wall.objects.get_or_create(owner=user)
    WallPreference.objects.get_or_create(wall=wall)
    return user
