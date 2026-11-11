"""
Names of the Mayan objects that make up the RECAFCO permission model.

These labels are looked up at runtime. They are created and kept in sync by
the `recafco_setup` management command. See docs/permission-model.md.
"""

# Confidentiality is decided by the document type. Mayan permissions are
# additive and per-document ACLs can only add access, never remove access
# inherited from the document type. Confidential documents therefore must
# live in a document type that ordinary employees have no ACL on.
DOCUMENT_TYPE_GENERAL_LABEL = 'RECAFCO General'
DOCUMENT_TYPE_CONFIDENTIAL_LABEL = 'RECAFCO Confidential'

METADATA_TYPE_DEPARTMENT_NAME = 'recafco_department'
METADATA_TYPE_DEPARTMENT_LABEL = 'Department'
METADATA_TYPE_CATEGORY_NAME = 'recafco_category'
METADATA_TYPE_CATEGORY_LABEL = 'Category'

ROLE_EMPLOYEES_LABEL = 'RECAFCO Employees'
ROLE_CONTROLLERS_LABEL = 'RECAFCO Controllers'
GROUP_EMPLOYEES_NAME = 'RECAFCO Employees'
# Historical name (Unit 1). This group reads "RECAFCO Confidential": it is
# the first confidential access group. It is NOT the Department controller
# role, which is models.ControllerAssignment.
GROUP_CONTROLLERS_NAME = 'RECAFCO Controllers'
CONFIDENTIAL_GROUP_ORIGINAL_NAME = 'Confidential (original group)'

# Members may use the RECAFCO administration area. The group carries no
# Mayan permissions: the extension authorizes admin requests itself.
GROUP_ADMINISTRATORS_NAME = 'RECAFCO Administrators'

# Prefix of the Mayan document type, role and group created for each
# additional confidential access group.
CONFIDENTIAL_GROUP_PREFIX = 'RECAFCO Confidential - '
# Keeps prefix + name well inside Mayan's label limits (document type, role, group).
CONFIDENTIAL_GROUP_NAME_MAX_LENGTH = 60

# Form fields accepted by the portal upload endpoint. Anything else is
# rejected so that a client cannot smuggle in a document type, a user, or
# any other attribute.
UPLOAD_ALLOWED_FIELDS = frozenset((
    'category', 'confidential_group', 'department', 'file', 'label',
    'operation_id'
))

LABEL_MAX_LENGTH = 255

# A document whose preview is not ready after this many seconds is reported
# as "delayed" instead of "processing".
PROCESSING_DELAYED_AFTER_SECONDS = 600

SUMMARY_PAGE_LIMIT = 50
SUMMARY_BATCH_LIMIT = 50
MY_UPLOADS_DEFAULT_LIMIT = 50
MY_UPLOADS_MAXIMUM_LIMIT = 100

STATE_PROCESSING = 'processing'
STATE_READY = 'ready'
STATE_DELAYED = 'delayed'
STATE_NO_PREVIEW = 'no_preview'

ACCESS_GENERAL = 'general'
ACCESS_CONFIDENTIAL = 'confidential'

# Department and category names are also Mayan metadata lookup values.
# Mayan renders the lookup as a template and splits it with shlex, so these
# characters cannot appear in a name.
NAME_FORBIDDEN_CHARACTERS = ',\'"\\{}%'
NAME_MAX_LENGTH = 100

DEPARTMENT_ICONS = (
    'folder', 'finance', 'purchasing', 'projects', 'factory', 'people',
    'truck', 'quality', 'tools', 'computer', 'legal', 'sales', 'safety',
    'warehouse'
)
DEPARTMENT_ICON_DEFAULT = 'folder'

DEPARTMENT_DOCUMENTS_PAGE_SIZE = 20
DEPARTMENT_DOCUMENTS_MAXIMUM_PAGE_SIZE = 50
ADMIN_PAGE_SIZE = 25
FAVORITES_LIMIT = 100
QUERY_MAX_LENGTH = 200

# Accounts and passwords (see passwords.py).
# A temporary password is set by an administrator and is good only until
# the person signs in: they must then choose their own. It may be as simple
# as "123". A personal password needs at least 6 characters; no character
# types are required.
TEMPORARY_PASSWORD_MIN_LENGTH = 1
PASSWORD_MIN_LENGTH = 6
# Upper bound so a huge "password" cannot tie up the password hasher.
PASSWORD_MAX_LENGTH = 128
USERNAME_MAX_LENGTH = 150
# Sign-in rate limit per username (not per IP address: the whole office
# reaches the portal from shared addresses). Repeated failures additionally
# lock the username through Mayan's lockout (django-axes), which must be
# configured with AUTHENTICATION_LOCKOUT_PARAMETERS = ['username'].
LOGIN_RATE_PER_USERNAME_PER_MINUTE = 10
PASSWORD_REASON_CREATED = 'created'
PASSWORD_REASON_ADMIN_RESET = 'admin_reset'

# Upload operations (see uploads.py). A pending operation older than this
# is a dead attempt (Gunicorn kills a request after 120 s), so a retry may
# take it over.
UPLOAD_OPERATION_STALE_SECONDS = 600
# How long a repeated request waits for a concurrent attempt to finish.
UPLOAD_OPERATION_WAIT_SECONDS = 45

ROLE_EMPLOYEE = 'employee'
ROLE_ADMINISTRATOR = 'administrator'
