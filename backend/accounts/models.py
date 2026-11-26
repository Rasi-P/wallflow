import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.db.models import Q


class UserManager(BaseUserManager):
    def create_user(self, google_sub, *, email=None, display_name=None):
        if not google_sub:
            raise ValueError("A Google subject is required.")
        user = self.model(google_sub=google_sub, email=email, display_name=display_name)
        user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    google_sub = models.CharField(max_length=255, unique=True)
    email = models.EmailField(max_length=254, null=True, blank=True)
    display_name = models.CharField(max_length=150, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "google_sub"
    EMAIL_FIELD = "email"

    objects = UserManager()

    class Meta:
        constraints = [
            models.CheckConstraint(condition=~Q(google_sub=""), name="user_google_sub_present"),
            models.CheckConstraint(condition=Q(password__startswith="!"), name="user_password_unusable"),
        ]
