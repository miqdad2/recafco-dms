from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from .literals import DEPARTMENT_ICON_DEFAULT, DEPARTMENT_ICONS, NAME_MAX_LENGTH


class PortalUpload(models.Model):
    """
    Records who uploaded a document through the portal. The uploader is
    always the authenticated request user; it is never read from client
    input. An administrator may later correct the owner (audited).
    """
    document = models.OneToOneField(
        on_delete=models.CASCADE, related_name='recafco_portal_upload',
        to='documents.Document', verbose_name=_(message='Document')
    )
    # The uploader is an audit record. If an administrator deletes the
    # account (Unit 5), the link becomes empty and the name snapshot below
    # keeps the attribution.
    uploader = models.ForeignKey(
        null=True, on_delete=models.SET_NULL,
        related_name='recafco_portal_uploads',
        to=settings.AUTH_USER_MODEL, verbose_name=_(message='Uploader')
    )
    uploader_username = models.CharField(blank=True, max_length=150)
    uploader_full_name = models.CharField(blank=True, max_length=300)
    datetime_created = models.DateTimeField(
        auto_now_add=True, db_index=True,
        verbose_name=_(message='Date and time created')
    )
    original_filename = models.CharField(
        max_length=255, verbose_name=_(message='Original filename')
    )
    size = models.BigIntegerField(verbose_name=_(message='Size in bytes'))

    class Meta:
        ordering = ('-datetime_created', '-id')
        verbose_name = _(message='Portal upload')
        verbose_name_plural = _(message='Portal uploads')

    def __str__(self):
        return '{} ({})'.format(self.original_filename, self.uploader)

    def save(self, *args, **kwargs):
        # The original uploader is evidence and never changes. Transfers of
        # responsibility use DocumentResponsibility instead.
        if self.pk:
            stored = PortalUpload.objects.filter(pk=self.pk).values_list(
                'uploader_id', 'document_id'
            ).first()
            if stored and stored != (self.uploader_id, self.document_id):
                raise ValueError('The original uploader of a document cannot change.')
        if self.uploader_id and not self.uploader_username:
            self.uploader_username = self.uploader.username
            self.uploader_full_name = self.uploader.get_full_name().strip()
        super().save(*args, **kwargs)


class DocumentResponsibility(models.Model):
    """
    The person currently responsible for a document, when an administrator
    has assigned one. Without a row, the original uploader is responsible.
    """
    document = models.OneToOneField(
        on_delete=models.CASCADE, related_name='recafco_responsibility',
        to='documents.Document'
    )
    person = models.ForeignKey(
        on_delete=models.CASCADE, related_name='recafco_responsible_for',
        to=settings.AUTH_USER_MODEL
    )
    assigned_by = models.ForeignKey(
        null=True, on_delete=models.SET_NULL,
        related_name='recafco_responsibilities_assigned',
        to=settings.AUTH_USER_MODEL
    )
    datetime_assigned = models.DateTimeField(auto_now=True)


class UploadOperation(models.Model):
    """
    One upload attempt identified by the client (`operation_id`), scoped to
    the user. Makes uploads idempotent: a retry of the same operation returns
    the document saved the first time instead of creating a copy.

    State is committed in two steps: `pending` is recorded before any work,
    and `completed` is set in the same transaction that creates the document,
    so `completed` is true exactly when the document exists.
    """
    STATE_PENDING = 'pending'
    STATE_COMPLETED = 'completed'
    STATE_FAILED = 'failed'

    user = models.ForeignKey(
        on_delete=models.CASCADE, related_name='recafco_upload_operations',
        to=settings.AUTH_USER_MODEL
    )
    operation_id = models.CharField(max_length=64)
    # SHA-256 of the file bytes and every submitted field.
    fingerprint = models.CharField(max_length=64)
    state = models.CharField(db_index=True, max_length=16)
    # Random token of the request currently doing the work.
    attempt = models.CharField(max_length=32)
    document = models.ForeignKey(
        null=True, on_delete=models.SET_NULL,
        related_name='recafco_upload_operations', to='documents.Document'
    )
    original_filename = models.CharField(blank=True, max_length=255)
    error = models.TextField(blank=True)
    datetime_created = models.DateTimeField(auto_now_add=True)
    datetime_updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'operation_id')


class Department(models.Model):
    """
    A department organizes documents. It never restricts who may view a
    general document. Departments are deactivated, never deleted, so the
    documents and history that refer to them stay intact.
    """
    name = models.CharField(
        max_length=NAME_MAX_LENGTH, unique=True,
        verbose_name=_(message='Name')
    )
    icon = models.CharField(
        choices=[(icon, icon) for icon in DEPARTMENT_ICONS],
        default=DEPARTMENT_ICON_DEFAULT, max_length=32,
        verbose_name=_(message='Icon')
    )
    sort_order = models.PositiveIntegerField(
        db_index=True, default=0, verbose_name=_(message='Sort order')
    )
    is_active = models.BooleanField(
        db_index=True, default=True, verbose_name=_(message='Active')
    )
    # Placeholder until RECAFCO supplies the real department list.
    is_sample = models.BooleanField(
        default=False, verbose_name=_(message='Sample')
    )
    datetime_created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('sort_order', 'name')
        verbose_name = _(message='Department')
        verbose_name_plural = _(message='Departments')

    def __str__(self):
        return self.name


class Category(models.Model):
    """A kind of document (purchase order, bill, ...). Not an access level."""
    name = models.CharField(
        max_length=NAME_MAX_LENGTH, unique=True,
        verbose_name=_(message='Name')
    )
    is_active = models.BooleanField(
        db_index=True, default=True, verbose_name=_(message='Active')
    )
    datetime_created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('name',)
        verbose_name = _(message='Category')
        verbose_name_plural = _(message='Categories')

    def __str__(self):
        return self.name


class DocumentClassification(models.Model):
    """
    The department and category of a document, by record (stable across
    renames). The same names are mirrored into the Mayan metadata values
    `recafco_department` / `recafco_category` for Mayan's own screens and
    search.
    """
    document = models.OneToOneField(
        on_delete=models.CASCADE, related_name='recafco_classification',
        to='documents.Document'
    )
    # PROTECT: deleting a department or category never removes documents.
    # The value is empty only for documents in the recycle bin whose
    # department or category an administrator deleted (Unit 5); the Mayan
    # metadata value keeps the old name.
    department = models.ForeignKey(
        null=True, on_delete=models.PROTECT, related_name='classifications',
        to=Department
    )
    category = models.ForeignKey(
        null=True, on_delete=models.PROTECT, related_name='classifications',
        to=Category
    )
    datetime_modified = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _(message='Document classification')


class DepartmentAssignment(models.Model):
    """
    The department(s) a user belongs to. Organizational only: it does not
    limit what the user may view or where the user may upload.
    """
    user = models.ForeignKey(
        on_delete=models.CASCADE, related_name='recafco_departments',
        to=settings.AUTH_USER_MODEL
    )
    department = models.ForeignKey(
        on_delete=models.PROTECT, related_name='members', to=Department
    )

    class Meta:
        unique_together = ('user', 'department')


class ControllerAssignment(models.Model):
    """
    A Department controller may correct the title, category and department
    of documents in these departments (moving them only between their own
    departments). Controllers have no access to the administration area.
    """
    user = models.ForeignKey(
        on_delete=models.CASCADE, related_name='recafco_controller_of',
        to=settings.AUTH_USER_MODEL
    )
    department = models.ForeignKey(
        on_delete=models.PROTECT, related_name='controllers', to=Department
    )

    class Meta:
        unique_together = ('user', 'department')


class ConfidentialAccessGroup(models.Model):
    """
    A confidential access group = one Mayan document type that only this
    group's role can read. Members are the Mayan group's users.
    """
    name = models.CharField(
        max_length=NAME_MAX_LENGTH, unique=True,
        verbose_name=_(message='Name')
    )
    document_type = models.OneToOneField(
        on_delete=models.PROTECT, related_name='recafco_confidential_group',
        to='documents.DocumentType'
    )
    role = models.OneToOneField(
        on_delete=models.PROTECT, related_name='recafco_confidential_group',
        to='permissions.Role'
    )
    group = models.OneToOneField(
        on_delete=models.PROTECT, related_name='recafco_confidential_group',
        to='auth.Group'
    )
    # Deactivated groups take no new documents; existing access is unchanged.
    is_active = models.BooleanField(default=True)
    datetime_created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('name',)

    def __str__(self):
        return self.name


class AuditEntry(models.Model):
    """
    Who changed what in the RECAFCO administration area. Append-only: an
    entry is never edited or deleted through the application (save() of an
    existing entry and delete() raise). The actor's name is copied in, so
    the history stays readable after the account or the target is deleted.
    """
    OUTCOME_SUCCESS = 'success'
    OUTCOME_FAILED = 'failed'

    actor = models.ForeignKey(
        null=True, on_delete=models.SET_NULL,
        related_name='recafco_audit_entries', to=settings.AUTH_USER_MODEL
    )
    actor_username = models.CharField(blank=True, max_length=150)
    actor_full_name = models.CharField(blank=True, max_length=300)
    action = models.CharField(db_index=True, max_length=64)
    target_type = models.CharField(db_index=True, max_length=32)
    target_id = models.PositiveIntegerField(db_index=True)
    target_label = models.CharField(blank=True, max_length=255)
    details = models.JSONField(default=dict)
    reason = models.TextField(blank=True)
    outcome = models.CharField(db_index=True, default=OUTCOME_SUCCESS, max_length=16)
    datetime_created = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ('-datetime_created', '-id')

    def save(self, *args, **kwargs):
        if self.pk is not None and AuditEntry.objects.filter(pk=self.pk).exists():
            raise ValueError('Activity log entries cannot be changed.')
        if self.actor_id and not self.actor_username:
            self.actor_username = self.actor.username
            self.actor_full_name = self.actor.get_full_name().strip()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Activity log entries cannot be deleted.')


class PasswordState(models.Model):
    """
    Whether the account must replace its password before doing anything
    else. Set when an administrator creates the account or resets its
    password (temporary password); cleared when the person chooses their
    own password. No row means no pending change (accounts created before
    this existed, Mayan system accounts).

    The password itself lives only in Django's user table, hashed by
    Django's password hasher. Nothing here stores or copies it.
    """
    user = models.OneToOneField(
        on_delete=models.CASCADE, primary_key=True,
        related_name='recafco_password_state', to=settings.AUTH_USER_MODEL
    )
    must_change = models.BooleanField(default=False)
    # Why a change is (or was last) required: "created" or "admin_reset".
    reason = models.CharField(blank=True, max_length=16)
    set_by = models.ForeignKey(
        null=True, on_delete=models.SET_NULL,
        related_name='recafco_password_states_set', to=settings.AUTH_USER_MODEL
    )
    datetime_temporary_set = models.DateTimeField(null=True)
    datetime_changed = models.DateTimeField(null=True)


class LoginRateWindow(models.Model):
    """
    Sign-in requests per username per minute (passwords.LoginUsernameRateThrottle).
    Kept in the database so every Gunicorn worker and server shares one
    count; Mayan's own throttle cache is per-process memory. The key is a
    SHA-256 of the lower-cased username, never the name or password.
    """
    key = models.CharField(max_length=64)
    window_start = models.DateTimeField(db_index=True)
    count = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ('key', 'window_start')


class AppRole(models.Model):
    """
    An application role: a named set of RECAFCO application permissions
    (see app_permissions.py). The built-in "System Administrator" role
    (system_key = "system_administrator") is protected: it has every
    permission, cannot be edited or deleted, and its members are the
    "RECAFCO Administrators" group (which also gives document access through
    Mayan ACLs). Other roles are created by System Administrators and are
    assigned to users here.
    """
    name = models.CharField(max_length=60, unique=True)
    description = models.CharField(blank=True, max_length=255)
    permissions = models.JSONField(default=list)
    system_key = models.CharField(blank=True, max_length=32, null=True, unique=True)
    users = models.ManyToManyField(
        blank=True, related_name='recafco_app_roles', to=settings.AUTH_USER_MODEL
    )
    datetime_created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('name',)

    def __str__(self):
        return self.name


class DeletedObject(models.Model):
    """
    Tombstone of a permanently deleted document or one of its parts (file,
    file page, version, version page, metadata entry). Written in the same
    transaction as the deletion; read by search_cleanup to end Mayan's
    search-index retries for objects that are gone for good. Kept for a day.
    """
    app_label = models.CharField(max_length=100)
    model_name = models.CharField(max_length=100)
    object_id = models.BigIntegerField()
    datetime_deleted = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=('app_label', 'model_name', 'object_id'),
                name='recafco_deleted_object_unique'
            )
        ]
