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
    # PROTECT: ownership is an audit record. Users who leave are disabled,
    # not deleted.
    uploader = models.ForeignKey(
        on_delete=models.PROTECT, related_name='recafco_portal_uploads',
        to=settings.AUTH_USER_MODEL, verbose_name=_(message='Uploader')
    )
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
    department = models.ForeignKey(
        on_delete=models.PROTECT, related_name='classifications',
        to=Department
    )
    category = models.ForeignKey(
        on_delete=models.PROTECT, related_name='classifications',
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
    datetime_created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('name',)

    def __str__(self):
        return self.name


class AuditEntry(models.Model):
    """Who changed what in the RECAFCO administration area. Append-only."""
    actor = models.ForeignKey(
        on_delete=models.PROTECT, related_name='recafco_audit_entries',
        to=settings.AUTH_USER_MODEL
    )
    action = models.CharField(max_length=64)
    target_type = models.CharField(db_index=True, max_length=32)
    target_id = models.PositiveIntegerField(db_index=True)
    target_label = models.CharField(blank=True, max_length=255)
    details = models.JSONField(default=dict)
    datetime_created = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ('-datetime_created', '-id')
