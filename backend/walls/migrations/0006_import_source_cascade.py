from importlib import import_module

from django.db import migrations

from_previous_migration = import_module("walls.migrations.0004_linked_board_cascades")._set_delete_action


def add_cascade(apps, editor):
    from_previous_migration(apps, editor, cascade=True, models=("ImportedBoardSource",))


def remove_cascade(apps, editor):
    from_previous_migration(apps, editor, cascade=False, models=("ImportedBoardSource",))


class Migration(migrations.Migration):
    dependencies = [("walls", "0005_account_workspace")]
    operations = [migrations.RunPython(add_cascade, remove_cascade)]
