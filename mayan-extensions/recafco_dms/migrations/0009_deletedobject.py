from django.db import migrations, models


class Migration(migrations.Migration):
    """Tombstones of permanently deleted objects (search_cleanup.py)."""

    dependencies = [
        ('recafco_dms', '0008_backfill_attribution_system_role'),
    ]

    operations = [
        migrations.CreateModel(
            name='DeletedObject',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('app_label', models.CharField(max_length=100)),
                ('model_name', models.CharField(max_length=100)),
                ('object_id', models.BigIntegerField()),
                ('datetime_deleted', models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={
                'constraints': [
                    models.UniqueConstraint(
                        fields=('app_label', 'model_name', 'object_id'),
                        name='recafco_deleted_object_unique'
                    )
                ],
            },
        ),
    ]
