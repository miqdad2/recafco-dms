from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('recafco_dms', '0005_password_state'),
    ]

    operations = [
        migrations.CreateModel(
            name='LoginRateWindow',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.CharField(max_length=64)),
                ('window_start', models.DateTimeField(db_index=True)),
                ('count', models.PositiveIntegerField(default=0)),
            ],
            options={
                'unique_together': {('key', 'window_start')},
            },
        ),
    ]
