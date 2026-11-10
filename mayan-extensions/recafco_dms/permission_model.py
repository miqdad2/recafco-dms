"""
The tested RECAFCO permission mapping (see docs/permission-model.md).

Employees get NO global permissions. All access is granted through ACLs on
document types, which Mayan propagates to documents, files, versions and
pages. Employees get no metadata, edit, ACL or document-type permissions.
They see Department and Category through the portal extension, which reads
them only after checking the employee may view the document.
"""
from mayan.apps.document_downloads.permissions import (
    permission_document_file_download
)
from mayan.apps.documents.permissions import (
    permission_document_file_view, permission_document_version_view,
    permission_document_view
)

from .literals import (
    DOCUMENT_TYPE_CONFIDENTIAL_LABEL, DOCUMENT_TYPE_GENERAL_LABEL,
    ROLE_CONTROLLERS_LABEL, ROLE_EMPLOYEES_LABEL
)
from .permissions import permission_portal_document_upload

READ_PERMISSIONS = (
    permission_document_file_download, permission_document_file_view,
    permission_document_version_view, permission_document_view
)

# {role label: {document type label: permissions}}
# Any document type not listed for a role gets no ACL for that role.
ACL_MAP = {
    ROLE_EMPLOYEES_LABEL: {
        DOCUMENT_TYPE_GENERAL_LABEL: READ_PERMISSIONS + (
            permission_portal_document_upload,
        )
    },
    ROLE_CONTROLLERS_LABEL: {
        DOCUMENT_TYPE_GENERAL_LABEL: READ_PERMISSIONS + (
            permission_portal_document_upload,
        ),
        # Confidential uploads are not part of Unit 1, so controllers get
        # read access only.
        DOCUMENT_TYPE_CONFIDENTIAL_LABEL: READ_PERMISSIONS
    }
}
