from django.db import migrations


def _set_delete_action(apps, schema_editor, *, cascade, models=("WallDocument", "WallLinkIntent", "CaptureReceipt")):
    if schema_editor.connection.vendor != "postgresql":
        return

    quote = schema_editor.quote_name
    action = "CASCADE" if cascade else "NO ACTION"
    with schema_editor.connection.cursor() as cursor:
        for name in models:
            field = apps.get_model("walls", name)._meta.get_field("wall")
            table = field.model._meta.db_table
            target = field.target_field.model._meta.db_table
            target_column = field.target_field.column
            constraints = schema_editor.connection.introspection.get_constraints(cursor, table)
            constraint, = (
                key for key, attributes in constraints.items()
                if attributes["foreign_key"] == (target, target_column)
                and attributes["columns"] == [field.column]
            )
            cursor.execute(
                f"ALTER TABLE {quote(table)} DROP CONSTRAINT {quote(constraint)}, "
                f"ADD CONSTRAINT {quote(constraint)} FOREIGN KEY ({quote(field.column)}) "
                f"REFERENCES {quote(target)} ({quote(target_column)}) "
                f"ON DELETE {action} DEFERRABLE INITIALLY DEFERRED"
            )


def add_cascades(apps, schema_editor):
    _set_delete_action(apps, schema_editor, cascade=True)


def remove_cascades(apps, schema_editor):
    _set_delete_action(apps, schema_editor, cascade=False)


class Migration(migrations.Migration):
    dependencies = [("walls", "0003_capturereceipt_walldocument_walllinkintent_and_more")]
    operations = [migrations.RunPython(add_cascades, remove_cascades)]
