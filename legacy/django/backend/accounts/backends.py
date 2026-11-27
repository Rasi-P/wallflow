from django.contrib.auth.backends import BaseBackend

from .models import User


class GoogleSessionBackend(BaseBackend):
    def get_user(self, user_id):
        return User.objects.filter(pk=user_id, is_active=True).first()
