import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('recafco_dms', '0004_restore_original_uploaders'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PasswordState',
            fields=[
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name='recafco_password_state', serialize=False, to=settings.AUTH_USER_MODEL)),
                ('must_change', models.BooleanField(default=False)),
                ('reason', models.CharField(blank=True, max_length=16)),
                ('datetime_temporary_set', models.DateTimeField(null=True)),
                ('datetime_changed', models.DateTimeField(null=True)),
                ('set_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='recafco_password_states_set', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
