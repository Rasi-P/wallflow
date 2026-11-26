import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class Wall(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wall")
    name = models.CharField(max_length=48, default="My everyday wall")
    tilt_deg = models.FloatField(default=0)
    turn_deg = models.FloatField(default=0)
    revision = models.PositiveBigIntegerField(default=0)
    next_note_order = models.PositiveBigIntegerField(default=1)
    next_section_order = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=~Q(name=""), name="wall_name_present"),
            models.CheckConstraint(condition=Q(tilt_deg__range=(-25, 25)), name="wall_tilt_in_bounds"),
            models.CheckConstraint(condition=Q(turn_deg__range=(-30, 30)), name="wall_turn_in_bounds"),
            models.CheckConstraint(
                condition=Q(next_note_order__gt=0, next_section_order__gt=0), name="wall_orders_positive"
            ),
        ]


CHOICES = {
    "theme": ("minimal", "study", "studio", "lab"),
    "wall_shade": ("theme", "chalk", "ivory", "mist"),
    "ambience": ("theme", "quiet", "airy"),
    "lighting": ("daylight", "warm"),
    "default_note_color": ("yellow", "pink", "green", "blue", "violet"),
    "default_note_typography": ("handwritten", "sans"),
    "default_note_size": ("compact", "standard", "large"),
    "default_note_rotation": ("varied", "straight"),
}


class WallPreference(models.Model):
    wall = models.OneToOneField(Wall, primary_key=True, on_delete=models.CASCADE, related_name="preferences")
    theme = models.CharField(max_length=8, default="minimal")
    wall_shade = models.CharField(max_length=8, default="theme")
    light_intensity = models.PositiveSmallIntegerField(default=100)
    ambience = models.CharField(max_length=8, default="theme")
    lighting = models.CharField(max_length=8, default="daylight")
    default_note_color = models.CharField(max_length=8, default="yellow")
    default_note_typography = models.CharField(max_length=12, default="handwritten")
    default_note_size = models.CharField(max_length=8, default="standard")
    default_note_rotation = models.CharField(max_length=8, default="varied")
    show_hints = models.BooleanField(default=True)
    onboarding_complete = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(light_intensity__range=(85, 115)), name="wp_intensity_in_bounds"),
            *[
                models.CheckConstraint(condition=Q(**{f"{field}__in": values}), name=f"wp_{field}_valid")
                for field, values in CHOICES.items()
            ],
        ]
