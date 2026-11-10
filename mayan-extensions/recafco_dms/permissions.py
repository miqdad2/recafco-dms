from django.utils.translation import gettext_lazy as _

from mayan.apps.permissions.classes import PermissionNamespace

namespace = PermissionNamespace(
    label=_(message='RECAFCO portal'), name='recafco_dms'
)

# Granted per document type through an ACL. Replaces Mayan's own
# "Create documents" permission for employees so that the only way an
# employee can add a document is the portal upload endpoint, which sets the
# required metadata, the uploader and the access level atomically.
permission_portal_document_upload = namespace.add_permission(
    label=_(message='Upload documents through the RECAFCO portal'),
    name='portal_document_upload'
)
