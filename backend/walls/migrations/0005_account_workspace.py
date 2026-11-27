import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("walls", "0004_linked_board_cascades")]
    operations = [
        migrations.AddField(
            model_name="walldocument",
            name="cloud_workspace",
            field=models.JSONField(default=None, null=True),
        ),
        migrations.CreateModel(
            name="ImportedBoardSource",
            fields=[
                ("source_id", models.UUIDField(editable=False, primary_key=True, serialize=False)),
                ("board_id", models.UUIDField()),
                ("wall", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="imported_sources",
                    to="walls.wall",
                )),
            ],
        ),
    ]
