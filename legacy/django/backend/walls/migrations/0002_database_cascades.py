from django.db import migrations


def _change_delete_rule(apps, schema_editor, *, cascade):
    if schema_editor.connection.vendor != "postgresql":
        return
    quote = schema_editor.quote_name
    fields = (("Wall", "owner"), ("WallPreference", "wall"))
    with schema_editor.connection.cursor() as cursor:
        for model, relation in fields:
            field = apps.get_model("walls", model)._meta.get_field(relation)
            table = field.model._meta.db_table
            target = field.target_field.model._meta.db_table
            target_column = field.target_field.column
            constraints = schema_editor.connection.introspection.get_constraints(cursor, table)
            name, = (
                name for name, attributes in constraints.items()
                if attributes["foreign_key"] == (target, target_column) and attributes["columns"] == [field.column]
            )
            statement = (
                f"ALTER TABLE {quote(table)} DROP CONSTRAINT {quote(name)}, "
                f"ADD CONSTRAINT {quote(name)} FOREIGN KEY ({quote(field.column)}) "
                f"REFERENCES {quote(target)} ({quote(target_column)}) "
                f"ON DELETE {'CASCADE' if cascade else 'NO ACTION'} DEFERRABLE INITIALLY DEFERRED"
            )
            cursor.execute(statement)


def add_cascades(apps, schema_editor):
    _change_delete_rule(apps, schema_editor, cascade=True)


def remove_cascades(apps, schema_editor):
    _change_delete_rule(apps, schema_editor, cascade=False)


class Migration(migrations.Migration):
    dependencies = [("walls", "0001_initial")]
    operations = [migrations.RunPython(add_cascades, remove_cascades)]
