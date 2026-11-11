"""
Unit 5 data migration:
- Copy the uploader's and audit actor's names into the new snapshot fields,
  so attribution survives if an administrator later deletes the account.
- Create the protected built-in "System Administrator" application role.
  Its members are the "RECAFCO Administrators" group (unchanged); the row
  exists so the role appears in role management.
Reversible: the reverse step removes the built-in role row only.
"""
from django.db import migrations

SYSTEM_KEY = 'system_administrator'


def full_name(user):
    return '{} {}'.format(user.first_name, user.last_name).strip()


def forward(apps, schema_editor):
    PortalUpload = apps.get_model('recafco_dms', 'PortalUpload')
    AuditEntry = apps.get_model('recafco_dms', 'AuditEntry')
    AppRole = apps.get_model('recafco_dms', 'AppRole')

    for upload in PortalUpload.objects.filter(uploader__isnull=False, uploader_username='').select_related('uploader'):
        PortalUpload.objects.filter(pk=upload.pk).update(
            uploader_full_name=full_name(upload.uploader),
            uploader_username=upload.uploader.username
        )
    for entry in AuditEntry.objects.filter(actor__isnull=False, actor_username='').select_related('actor'):
        # queryset.update(): historical entries are not "edited", only the
        # actor's name is copied next to the existing link.
        AuditEntry.objects.filter(pk=entry.pk).update(
            actor_full_name=full_name(entry.actor), actor_username=entry.actor.username
        )
    AppRole.objects.get_or_create(
        system_key=SYSTEM_KEY, defaults={
            'description': 'Full application access, including every confidential document and role management. Protected.',
            'name': 'System Administrator', 'permissions': []
        }
    )


def backward(apps, schema_editor):
    AppRole = apps.get_model('recafco_dms', 'AppRole')
    AppRole.objects.filter(system_key=SYSTEM_KEY).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('recafco_dms', '0007_admin_control'),
    ]

    operations = [
        migrations.RunPython(code=forward, reverse_code=backward),
    ]
