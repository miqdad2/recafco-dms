"""
Unit 2's "change uploader" overwrote PortalUpload.uploader, which is the
original uploader. This migration restores the original from the evidence
in the append-only audit log and moves the transferred person to
DocumentResponsibility.

Evidence: AuditEntry rows with action "document.owner_changed", whose
details are {"owner": [previous username or null, new username]}.

- The first entry's previous username is the original uploader.
- If that previous value is null, the document had no portal upload record
  and Unit 2 created one naming the new person as uploader. That record is
  not evidence of who uploaded the file, so it is removed: the original
  uploader is shown as "not recorded" rather than invented.
- The last entry's new username becomes the responsible person.

Audit entries are not changed.
"""
from django.db import migrations


def restore(apps, schema_editor):
    AuditEntry = apps.get_model('recafco_dms', 'AuditEntry')
    PortalUpload = apps.get_model('recafco_dms', 'PortalUpload')
    DocumentResponsibility = apps.get_model('recafco_dms', 'DocumentResponsibility')
    User = apps.get_model('auth', 'User')

    by_document = {}
    for entry in AuditEntry.objects.filter(
        action='document.owner_changed', target_type='document'
    ).order_by('datetime_created', 'id'):
        owner = (entry.details or {}).get('owner')
        if isinstance(owner, list) and len(owner) == 2:
            by_document.setdefault(entry.target_id, []).append((entry, owner))

    for document_id, entries in by_document.items():
        first_previous = entries[0][1][0]
        last_entry, last_owner = entries[-1]
        current = User.objects.filter(username=last_owner[1]).first()

        if first_previous is None:
            PortalUpload.objects.filter(document_id=document_id).delete()
            original = None
        else:
            original = User.objects.filter(username=first_previous).first()
            if original is not None:
                PortalUpload.objects.filter(document_id=document_id).update(
                    uploader=original
                )

        if current is not None and current != original:
            DocumentResponsibility.objects.update_or_create(
                document_id=document_id,
                defaults={'assigned_by_id': last_entry.actor_id, 'person': current}
            )


class Migration(migrations.Migration):

    dependencies = [
        ('recafco_dms', '0003_upload_operations_responsibility'),
    ]

    operations = [
        migrations.RunPython(code=restore, reverse_code=migrations.RunPython.noop),
    ]
