"""
RECAFCO portal business logic. Every function that returns document data
takes the requesting user and applies Mayan's own ACL checks; nothing here
uses elevated access on behalf of an employee.
"""
import logging
from pathlib import PurePath

from django.core.exceptions import (
    ImproperlyConfigured, PermissionDenied, ValidationError
)
from django.core.files import File
from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from mayan.apps.acls.models import AccessControlList
from mayan.apps.document_favorites.models import FavoriteDocument
from mayan.apps.documents.literals import DEFAULT_DOCUMENT_FILE_ACTION_NAME
from mayan.apps.documents.models.document_file_models import DocumentFile
from mayan.apps.documents.models.document_models import Document
from mayan.apps.documents.models.document_type_models import DocumentType
from mayan.apps.documents.permissions import permission_document_view
from mayan.apps.documents.tasks import task_document_file_size_update
from mayan.apps.dynamic_search.search_backends import SearchBackend
from mayan.apps.dynamic_search.search_interpreters import SearchInterpreter
from mayan.apps.dynamic_search.search_models import SearchModel
from mayan.apps.metadata.models import DocumentMetadata, MetadataType

from .access import get_controller_department_ids, is_portal_admin
from .literals import (
    ACCESS_CONFIDENTIAL, ACCESS_GENERAL, DOCUMENT_TYPE_GENERAL_LABEL,
    FAVORITES_LIMIT, LABEL_MAX_LENGTH, METADATA_TYPE_CATEGORY_NAME,
    METADATA_TYPE_DEPARTMENT_NAME, NAME_FORBIDDEN_CHARACTERS,
    NAME_MAX_LENGTH, PROCESSING_DELAYED_AFTER_SECONDS, QUERY_MAX_LENGTH,
    STATE_DELAYED, STATE_NO_PREVIEW, STATE_PROCESSING, STATE_READY,
    SUMMARY_PAGE_LIMIT
)
from .models import (
    AuditEntry, Category, Department, DocumentClassification, PortalUpload
)
from .permissions import permission_portal_document_upload

logger = logging.getLogger(name=__name__)


class InputRejected(Exception):
    """A user-correctable problem with a request. Shown next to `field`."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field = field
        self.message = message


# Unit 1 name, kept for the upload view.
UploadRejected = InputRejected


# ------------------------------------------------------------ reference data

def get_document_type_general():
    try:
        return DocumentType.objects.get(label=DOCUMENT_TYPE_GENERAL_LABEL)
    except DocumentType.DoesNotExist:
        raise ImproperlyConfigured(
            'Document type "{}" is missing. Run "recafco_setup".'.format(
                DOCUMENT_TYPE_GENERAL_LABEL
            )
        )


def get_metadata_type(name):
    try:
        return MetadataType.objects.get(name=name)
    except MetadataType.DoesNotExist:
        raise ImproperlyConfigured(
            'Metadata type "{}" is missing. Run "recafco_setup".'.format(name)
        )


def clean_name(value, field='name'):
    value = ' '.join(str(value or '').split())
    if not value:
        raise InputRejected(field=field, message='Enter a name.')
    if len(value) > NAME_MAX_LENGTH:
        raise InputRejected(
            field=field, message='Use at most {} characters.'.format(
                NAME_MAX_LENGTH
            )
        )
    bad = sorted({c for c in value if c in NAME_FORBIDDEN_CHARACTERS})
    if bad:
        raise InputRejected(
            field=field, message='A name cannot contain: {}'.format(
                ' '.join(bad)
            )
        )
    return value


def sync_metadata_lookups():
    """
    Mirror every department and category name (active or not, so that
    existing documents stay valid) into the Mayan metadata lookup lists.
    """
    for name, model in (
        (METADATA_TYPE_DEPARTMENT_NAME, Department),
        (METADATA_TYPE_CATEGORY_NAME, Category)
    ):
        metadata_type = get_metadata_type(name=name)
        lookup = ','.join(
            model.objects.order_by('pk').values_list('name', flat=True)
        )
        if metadata_type.lookup != lookup:
            metadata_type.lookup = lookup
            metadata_type.save()


def serialize_department(department, document_count=None):
    data = {
        'icon': department.icon,
        'id': department.pk,
        'is_active': department.is_active,
        'is_sample': department.is_sample,
        'name': department.name,
        'sort_order': department.sort_order
    }
    if document_count is not None:
        data['document_count'] = document_count
    return data


def serialize_category(category):
    return {
        'id': category.pk, 'is_active': category.is_active,
        'name': category.name
    }


def get_upload_options():
    return {
        'categories': [
            serialize_category(category=category)
            for category in Category.objects.filter(is_active=True)
        ],
        'departments': [
            serialize_department(department=department)
            for department in Department.objects.filter(is_active=True)
        ]
    }


# ------------------------------------------------------------------ access

def user_can_upload(user):
    try:
        AccessControlList.objects.check_access(
            obj=get_document_type_general(),
            permission=permission_portal_document_upload, user=user
        )
    except PermissionDenied:
        return False
    return True


def get_accessible_documents(user):
    """Documents the user may view, according to Mayan's ACLs."""
    return AccessControlList.objects.restrict_queryset(
        permission=permission_document_view, queryset=Document.valid.all(),
        user=user
    )


def get_accessible_document(user, document_id):
    """The document, or None if it does not exist or the user may not view it."""
    try:
        return get_accessible_documents(user=user).get(pk=document_id)
    except (Document.DoesNotExist, ValueError, TypeError):
        return None


def get_editable_department_ids(document, user):
    """
    Departments this user may assign to this document when correcting its
    details. Empty if the user may not correct it at all. The caller must
    already have established that the user may view the document.
    """
    active_ids = set(
        Department.objects.filter(is_active=True).values_list('pk', flat=True)
    )
    if is_portal_admin(user=user):
        return active_ids
    controlled = get_controller_department_ids(user=user)
    classification = get_classification(document=document)
    if classification is None or classification.department_id not in controlled:
        return set()
    return controlled & active_ids


# ---------------------------------------------------------------- upload

def resolve_active(model, value, field):
    label = model._meta.verbose_name.lower()
    value = (str(value) if value is not None else '').strip()
    if not value:
        raise InputRejected(
            field=field, message='Choose a {}.'.format(label)
        )
    record = model.objects.filter(name=value).first()
    if record is None or not record.is_active:
        raise InputRejected(
            field=field, message='Choose a {} from the list.'.format(label)
        )
    return record


def _metadata_value(document_type, metadata_type, value):
    try:
        return metadata_type.validate_value(
            document_type=document_type, value=value
        )
    except ValidationError:
        # Department/category records and the Mayan lookup list disagree.
        raise ImproperlyConfigured(
            'Metadata lookup for "{}" is out of date. Run '
            '"recafco_setup".'.format(metadata_type.name)
        )


def create_document(
    category, department, document_type, uploaded_file, user, label=None
):
    """
    Create a document, its required metadata, its classification, the
    uploader record and its first file in one database transaction.

    Visibility comes from the document type ACL, so the document is never
    visible with the wrong access level. Because everything commits together,
    the document is never visible without its required metadata or its file.
    If anything fails, nothing is committed. The file may then remain in
    storage as an unreferenced object, but it is not reachable through Mayan.

    Page detection, preview and search indexing run afterwards in Mayan's
    own background tasks, started only after the commit.
    """
    if uploaded_file is None:
        raise InputRejected(field='file', message='Choose a file to upload.')

    if not uploaded_file.size:
        raise InputRejected(field='file', message='The file is empty.')

    department_record = resolve_active(
        model=Department, value=department, field='department'
    )
    category_record = resolve_active(
        model=Category, value=category, field='category'
    )

    department_type = get_metadata_type(name=METADATA_TYPE_DEPARTMENT_NAME)
    category_type = get_metadata_type(name=METADATA_TYPE_CATEGORY_NAME)

    values = {
        department_type: _metadata_value(
            document_type=document_type, metadata_type=department_type,
            value=department_record.name
        ),
        category_type: _metadata_value(
            document_type=document_type, metadata_type=category_type,
            value=category_record.name
        )
    }

    required_ids = set(
        document_type.metadata.filter(required=True).values_list(
            'metadata_type_id', flat=True
        )
    )
    missing = required_ids - {metadata_type.pk for metadata_type in values}
    if missing:
        raise ImproperlyConfigured(
            'Document type "{}" requires metadata the portal does not '
            'collect: {}.'.format(document_type, sorted(missing))
        )

    filename = PurePath(uploaded_file.name or 'upload').name
    filename = filename[:255] or 'upload'
    label = (label or '').strip()[:LABEL_MAX_LENGTH] or filename

    with transaction.atomic():
        document = Document(document_type=document_type, label=label)
        document._event_actor = user
        document.save()

        for metadata_type, value in values.items():
            document_metadata = DocumentMetadata(
                document=document, metadata_type=metadata_type, value=value
            )
            document_metadata._event_actor = user
            document_metadata.save()

        DocumentClassification.objects.create(
            category=category_record, department=department_record,
            document=document
        )

        upload = PortalUpload.objects.create(
            document=document, original_filename=filename,
            size=uploaded_file.size, uploader=user
        )

        document_file = DocumentFile(
            document=document, file=File(file=uploaded_file),
            filename=filename
        )
        document_file._event_actor = user
        # Same call Mayan's own upload task makes. Introspection (MIME type,
        # page count) is done by the task chain started below.
        document_file.save(skip_introspection=True)

        document_file_id = document_file.pk
        user_id = user.pk

        def start_processing():
            task_document_file_size_update.apply_async(
                kwargs={
                    'action_name': DEFAULT_DOCUMENT_FILE_ACTION_NAME,
                    'document_file_id': document_file_id,
                    'is_document_upload_sequence': True,
                    'user_id': user_id
                }
            )

        transaction.on_commit(func=start_processing)

    logger.info(
        'Portal upload: document %s created by user %s.', document.pk,
        user.pk
    )
    return upload


def create_portal_upload(category, department, uploaded_file, user, label=None):
    """The only upload path exposed over HTTP: always the General type."""
    document_type = get_document_type_general()

    AccessControlList.objects.check_access(
        obj=document_type, permission=permission_portal_document_upload,
        user=user
    )

    return create_document(
        category=category, department=department,
        document_type=document_type, label=label,
        uploaded_file=uploaded_file, user=user
    )


# ------------------------------------------------------------ serializing

def get_processing_state(document):
    version = document.version_active
    if version is not None:
        if version.version_pages.exists():
            return STATE_READY
        # Mayan creates the version only after page detection has finished.
        # A version with no pages from a file with no pages means Mayan could
        # not read the file; the original is still downloadable.
        file_latest = document.file_latest
        if file_latest is not None and not file_latest.file_pages.exists():
            return STATE_NO_PREVIEW

    age = (timezone.now() - document.datetime_created).total_seconds()
    if age > PROCESSING_DELAYED_AFTER_SECONDS:
        return STATE_DELAYED
    return STATE_PROCESSING


def user_display(user):
    if user is None:
        return None
    full_name = user.get_full_name().strip()
    return {
        'full_name': full_name or user.username, 'id': user.pk,
        'username': user.username
    }


def get_classification(document):
    try:
        return document.recafco_classification
    except DocumentClassification.DoesNotExist:
        return None


def is_confidential(document):
    # Every RECAFCO document type except General is a confidential type
    # (see ConfidentialAccessGroup). Other Mayan types count as confidential
    # too, which errs on the side of labelling.
    return document.document_type.label != DOCUMENT_TYPE_GENERAL_LABEL


def serialize_document(document, user):
    """
    Portal view of a document. The caller must already have established
    that `user` may view `document`.
    """
    classification = get_classification(document=document)
    if classification is not None:
        department = classification.department
        category = classification.category
        department_data = {'id': department.pk, 'name': department.name}
        category_data = {'id': category.pk, 'name': category.name}
    else:
        # Documents created outside the portal before `recafco_setup`
        # linked them: fall back to the Mayan metadata values.
        metadata = {
            entry.metadata_type.name: entry.value
            for entry in document.metadata.select_related('metadata_type')
        }
        department_data = None
        category_data = None
        department = metadata.get(METADATA_TYPE_DEPARTMENT_NAME)
        category = metadata.get(METADATA_TYPE_CATEGORY_NAME)

    try:
        upload = document.recafco_portal_upload
    except PortalUpload.DoesNotExist:
        upload = None

    file_latest = document.file_latest
    version = document.version_active

    if version is not None:
        page_queryset = version.version_pages.order_by('page_number')
        page_count = page_queryset.count()
        page_ids = list(
            page_queryset.values_list('pk', flat=True)[:SUMMARY_PAGE_LIMIT]
        )
    else:
        page_count = 0
        page_ids = []

    return {
        'access': (
            ACCESS_CONFIDENTIAL if is_confidential(document=document)
            else ACCESS_GENERAL
        ),
        'category': str(category) if category else None,
        'category_ref': category_data,
        'datetime_created': document.datetime_created.isoformat(),
        'department': str(department) if department else None,
        'department_ref': department_data,
        'file': {
            'filename': file_latest.filename,
            'id': file_latest.pk,
            'mimetype': file_latest.mimetype or None,
            # Mayan computes the size in a background task; until then use
            # the size recorded at upload time.
            'size': file_latest.size or (upload.size if upload else None)
        } if file_latest else None,
        'id': document.pk,
        'is_mine': bool(upload and upload.uploader_id == user.pk),
        'label': document.label,
        'state': get_processing_state(document=document),
        'uploaded_by': user_display(user=upload.uploader) if upload else None,
        'version': {
            'id': version.pk,
            'page_count': page_count,
            'page_ids': page_ids
        } if version else None
    }


DOCUMENT_RELATED = (
    'document_type', 'file_latest', 'recafco_portal_upload__uploader',
    'recafco_classification__department',
    'recafco_classification__category', 'version_active'
)


def get_document_summaries(document_ids, user):
    queryset = get_accessible_documents(user=user).filter(
        pk__in=document_ids
    ).select_related(*DOCUMENT_RELATED)
    by_id = {document.pk: document for document in queryset}
    # Keep the caller's order; silently drop documents the user cannot see.
    return [
        serialize_document(document=by_id[document_id], user=user)
        for document_id in document_ids if document_id in by_id
    ]


def get_my_uploads(limit, user):
    accessible = get_accessible_documents(user=user)
    uploads = PortalUpload.objects.filter(
        document__in=accessible, uploader=user
    ).select_related(
        'document', 'document__document_type', 'document__file_latest',
        'document__version_active', 'document__recafco_classification__department',
        'document__recafco_classification__category', 'uploader'
    )[:limit]
    return [
        serialize_document(document=upload.document, user=user)
        for upload in uploads
    ]


# ------------------------------------------------------------ departments

def get_department_counts(user):
    """{department id: number of documents this user may view in it}."""
    rows = get_accessible_documents(user=user).filter(
        recafco_classification__isnull=False
    ).order_by().values('recafco_classification__department_id').annotate(
        count=Count('pk')
    )
    return {
        row['recafco_classification__department_id']: row['count']
        for row in rows
    }


def get_departments_for_user(user):
    """
    Active departments (all of them, in admin order), plus inactive ones
    that still hold documents this user may view. Counts respect access.
    """
    counts = get_department_counts(user=user)
    active = []
    inactive = []
    for department in Department.objects.all():
        count = counts.get(department.pk, 0)
        if department.is_active:
            active.append(serialize_department(department, count))
        elif count:
            inactive.append(serialize_department(department, count))
    return {'departments': active, 'inactive_departments': inactive}


def search_document_queryset(query, queryset, user):
    """
    Mayan's own document search (label, file name, content, OCR, metadata,
    ...) limited to `queryset`, run as `user`. Returns None for an empty
    query.
    """
    search_model = SearchModel.get(name='documents.documentsearchresult')
    interpreter = SearchInterpreter.init(
        query={'q': query}, search_model=search_model
    )
    query_clean = interpreter.do_query_cleanup()
    if not query_clean or interpreter.is_empty:
        return None
    saved_resultset, result = SearchBackend.get_instance().search(
        query=query_clean, queryset=search_model.get_queryset().filter(
            pk__in=queryset.values('pk')
        ), search_model=search_model, user=user
    )
    return result


def get_department_documents(
    department, user, page, page_size, category_id=None, query=None
):
    queryset = get_accessible_documents(user=user).filter(
        recafco_classification__department=department
    )
    if category_id:
        queryset = queryset.filter(
            recafco_classification__category_id=category_id
        )
    query = (query or '').strip()[:QUERY_MAX_LENGTH]
    if query:
        matches = search_document_queryset(
            query=query, queryset=queryset, user=user
        )
        if matches is not None:
            queryset = queryset.filter(pk__in=matches.values('pk'))

    count = queryset.count()
    start = (page - 1) * page_size
    documents = queryset.select_related(*DOCUMENT_RELATED).order_by(
        '-datetime_created', '-pk'
    )[start:start + page_size]
    return {
        'count': count,
        'page': page,
        'page_size': page_size,
        'results': [
            serialize_document(document=document, user=user)
            for document in documents
        ]
    }


# ------------------------------------------------------------- favorites

def get_favorite_ids(user, document_ids=None):
    queryset = FavoriteDocument.valid.filter(user=user)
    if document_ids is not None:
        queryset = queryset.filter(document_id__in=document_ids)
    return set(queryset.values_list('document_id', flat=True))


def get_favorites(user):
    accessible = get_accessible_documents(user=user)
    favorites = FavoriteDocument.valid.filter(
        document__in=accessible, user=user
    ).select_related(
        *('document__{}'.format(path) for path in DOCUMENT_RELATED)
    ).order_by('-datetime_added')[:FAVORITES_LIMIT]
    return [
        serialize_document(document=favorite.document, user=user)
        for favorite in favorites
    ]


def set_favorite(document, user, value):
    """The caller must already have established that `user` may view it."""
    if value:
        FavoriteDocument.valid.add_for_user(document=document, user=user)
    else:
        FavoriteDocument.objects.filter(document=document, user=user).delete()


# ---------------------------------------------------------------- audit

def audit(actor, action, target, details=None, target_type=None):
    AuditEntry.objects.create(
        action=action, actor=actor, details=details or {},
        target_id=target.pk, target_label=str(target)[:255],
        target_type=target_type or target._meta.model_name
    )


def serialize_audit_entry(entry):
    return {
        'action': entry.action,
        'actor': user_display(user=entry.actor),
        'datetime': entry.datetime_created.isoformat(),
        'details': entry.details,
        'id': entry.pk,
        'target_id': entry.target_id,
        'target_label': entry.target_label,
        'target_type': entry.target_type
    }


# ------------------------------------------------------ document details

def _set_metadata_value(actor, document, metadata_name, value):
    metadata_type = get_metadata_type(name=metadata_name)
    entry = DocumentMetadata.objects.filter(
        document=document, metadata_type=metadata_type
    ).first()
    if entry is None:
        entry = DocumentMetadata(
            document=document, metadata_type=metadata_type
        )
    if entry.value != value:
        entry.value = value
        entry._event_actor = actor
        entry.save()


def update_document_details(
    actor, document, allowed_department_ids, label=None, department_id=None,
    category_id=None
):
    """
    Correct the title, department and/or category of a document. The
    caller has checked that `actor` may view the document and passes the
    departments `actor` may move it to. Mayan metadata, the classification
    record and the title change together, and the change is audited.
    """
    if not allowed_department_ids:
        raise PermissionDenied
    classification = get_classification(document=document)
    changes = {}

    if label is not None:
        label = ' '.join(str(label).split())[:LABEL_MAX_LENGTH]
        if not label:
            raise InputRejected(field='label', message='Enter a title.')
        if label != document.label:
            changes['label'] = [document.label, label]

    department = classification.department if classification else None
    if department_id is not None:
        new_department = Department.objects.filter(
            pk=department_id, is_active=True
        ).first()
        if new_department is None:
            raise InputRejected(
                field='department_id', message='Choose a department from the list.'
            )
        if new_department.pk not in allowed_department_ids:
            raise InputRejected(
                field='department_id',
                message='You can only move documents between your own departments.'
            )
        if new_department != department:
            changes['department'] = [
                department.name if department else None, new_department.name
            ]
            department = new_department

    category = classification.category if classification else None
    if category_id is not None:
        new_category = Category.objects.filter(
            pk=category_id, is_active=True
        ).first()
        if new_category is None:
            raise InputRejected(
                field='category_id', message='Choose a category from the list.'
            )
        if new_category != category:
            changes['category'] = [
                category.name if category else None, new_category.name
            ]
            category = new_category

    if not changes:
        return changes
    if department is None or category is None:
        raise InputRejected(
            field='department_id',
            message='Choose both a department and a category.'
        )

    with transaction.atomic():
        if 'label' in changes:
            document.label = label
            document._event_actor = actor
            document.save()
        _set_metadata_value(
            actor=actor, document=document,
            metadata_name=METADATA_TYPE_DEPARTMENT_NAME, value=department.name
        )
        _set_metadata_value(
            actor=actor, document=document,
            metadata_name=METADATA_TYPE_CATEGORY_NAME, value=category.name
        )
        DocumentClassification.objects.update_or_create(
            document=document,
            defaults={'category': category, 'department': department}
        )
        audit(
            action='document.details_changed', actor=actor, details=changes,
            target=document
        )
    return changes
