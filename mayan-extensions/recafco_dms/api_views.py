"""
REST endpoints used by the RECAFCO employee portal.

Mayan's REST framework configuration has no default permission class, so
every view here sets IsAuthenticated explicitly (admin views add
IsPortalAdmin). Document visibility is always resolved through Mayan's ACLs
for the requesting user. A document the user cannot see gets the same 404
as a document that does not exist.
"""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import get_controller_department_ids, is_portal_admin
from .literals import (
    DEPARTMENT_DOCUMENTS_MAXIMUM_PAGE_SIZE, DEPARTMENT_DOCUMENTS_PAGE_SIZE,
    MY_UPLOADS_DEFAULT_LIMIT, MY_UPLOADS_MAXIMUM_LIMIT,
    RECENT_DOCUMENTS_MAXIMUM_PAGE_SIZE, RECENT_DOCUMENTS_PAGE_SIZE, SUMMARY_BATCH_LIMIT,
    UPLOAD_ALLOWED_FIELDS
)
from .models import (
    Category, ConfidentialAccessGroup, Department, DepartmentAssignment,
    UploadOperation
)
from .services import (
    InputRejected, confidential_group_display, get_accessible_document,
    get_department_documents, get_departments_for_user,
    get_document_summaries, get_editable_department_ids, get_favorite_ids,
    get_favorites, get_my_uploads, get_recent_documents, get_upload_options,
    serialize_category,
    serialize_department, serialize_document, set_favorite,
    update_document_details, user_can_upload
)
from .uploads import (
    OperationConflict, OperationFailed, OperationInProgress, get_operation,
    run_upload
)


class PortalAPIView(APIView):
    permission_classes = (IsAuthenticated,)


def query_int(request, name, default, minimum=1, maximum=None):
    raw = request.query_params.get(name)
    if raw in (None, ''):
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValidationError({name: 'Must be a number.'})
    value = max(minimum, value)
    if maximum is not None:
        value = min(value, maximum)
    return value


def body_value(data, name, kind):
    """Optional typed field from a JSON body: None if absent."""
    if name not in data or data[name] is None:
        return None
    value = data[name]
    if kind is bool and not isinstance(value, bool):
        raise ValidationError({name: 'Must be true or false.'})
    if kind is int and (isinstance(value, bool) or not isinstance(value, int)):
        raise ValidationError({name: 'Must be a number.'})
    if kind is str and not isinstance(value, str):
        raise ValidationError({name: 'Must be text.'})
    if kind is list:
        if not isinstance(value, list) or not all(
            isinstance(item, int) and not isinstance(item, bool) for item in value
        ):
            raise ValidationError({name: 'Must be a list of numbers.'})
    return value


def reject(exception):
    raise ValidationError({exception.field: exception.message})


def operation_result(operation, user, replayed):
    """
    The saved document as the uploader may see it now. If the uploader
    cannot open it (an administrator uploading to a confidential group they
    are not in), only a receipt is returned: no content, no page IDs.
    """
    document = operation.document
    accessible = document is not None and get_accessible_document(
        user=user, document_id=document.pk
    )
    if accessible:
        data = serialize_document(document=accessible, user=user)
        data['accessible'] = True
    elif document is not None:
        data = {
            'access': 'confidential',
            'accessible': False,
            'confidential_group': confidential_group_display(document=document),
            'datetime_created': document.datetime_created.isoformat(),
            'id': document.pk,
            'label': document.label
        }
    else:
        data = {'accessible': False, 'id': None}
    data['operation_id'] = operation.operation_id
    data['replayed'] = replayed
    return data


def operation_error_body(operation):
    field, separator, message = (operation.error or '').partition(': ')
    if separator and field in UPLOAD_ALLOWED_FIELDS | {'operation_id'}:
        return {field: message, 'code': 'operation_failed'}
    return {
        'code': 'operation_failed',
        'detail': 'This upload was not saved. Start a new upload.'
    }


def get_document_or_404(request, document_id):
    document = get_accessible_document(user=request.user, document_id=document_id)
    if document is None:
        raise Http404
    return document


def serialize_document_detail(document, user):
    data = serialize_document(document=document, user=user)
    editable = get_editable_department_ids(document=document, user=user)
    data['is_favorite'] = bool(get_favorite_ids(user=user, document_ids=[document.pk]))
    data['can_edit_details'] = bool(editable)
    data['editable_department_ids'] = sorted(editable)
    # Reclassifying needs administrator authority AND current access; the
    # caller already established access by loading the document.
    data['can_reclassify'] = is_portal_admin(user=user)
    return data


@extend_schema(exclude=True)
class APIPortalMeView(PortalAPIView):
    def get(self, request):
        user = request.user
        return Response(
            {
                'can_upload': user_can_upload(user=user),
                'controller_department_ids': sorted(
                    get_controller_department_ids(user=user)
                ),
                'department_ids': sorted(
                    DepartmentAssignment.objects.filter(user=user).values_list(
                        'department_id', flat=True
                    )
                ),
                'full_name': user.get_full_name().strip() or user.username,
                'is_admin': is_portal_admin(user=user),
                'username': user.username
            }
        )


@extend_schema(exclude=True)
class APIPortalOptionsView(PortalAPIView):
    def get(self, request):
        options = get_upload_options()
        # Only administrators may upload confidential documents; they choose
        # the group explicitly. Others get no group list at all.
        options['confidential_groups'] = [
            {'id': group.pk, 'name': group.name}
            for group in ConfidentialAccessGroup.objects.all()
        ] if is_portal_admin(user=request.user) else []
        return Response(options)


@extend_schema(exclude=True)
class APIPortalUploadView(PortalAPIView):
    parser_classes = (MultiPartParser,)

    def post(self, request):
        submitted = set(request.data.keys()) | set(request.FILES.keys())
        unexpected = sorted(submitted - UPLOAD_ALLOWED_FIELDS)
        if unexpected:
            raise ValidationError(
                {
                    'detail': 'Unexpected fields: {}.'.format(
                        ', '.join(unexpected)
                    )
                }
            )

        if len(request.FILES.getlist('file')) > 1:
            raise ValidationError({'file': 'Upload one file at a time.'})

        try:
            operation, created = run_upload(
                confidential_group_id=request.data.get('confidential_group') or None,
                fields={
                    'category': request.data.get('category'),
                    'department': request.data.get('department'),
                    'label': request.data.get('label')
                },
                operation_id=request.data.get('operation_id'),
                uploaded_file=request.FILES.get('file'), user=request.user
            )
        except InputRejected as exception:
            reject(exception)
        except DjangoPermissionDenied:
            raise PermissionDenied(
                'You do not have permission to upload documents here.'
            )
        except OperationConflict:
            return Response(
                {
                    'code': 'operation_conflict',
                    'operation_id': 'This upload ID was already used for a different file '
                    'or different details. Start a new upload.'
                }, status=status.HTTP_409_CONFLICT
            )
        except OperationInProgress:
            return Response(
                {'code': 'operation_pending', 'state': 'pending'},
                status=status.HTTP_202_ACCEPTED
            )
        except OperationFailed as exception:
            return Response(
                operation_error_body(exception.operation),
                status=status.HTTP_400_BAD_REQUEST
            )

        return Response(
            operation_result(operation=operation, user=request.user, replayed=not created),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )


@extend_schema(exclude=True)
class APIPortalUploadOperationView(PortalAPIView):
    """
    Recovery: what happened to an upload whose reply was lost? Only the
    user who started the operation can see it (404 for anyone else).
    """
    def get(self, request, operation_id):
        operation = get_operation(operation_id=operation_id, user=request.user)
        if operation is None:
            # Never received: nothing was saved. Uploading again is safe.
            return Response(
                {'operation_id': operation_id, 'state': 'not_found'},
                status=status.HTTP_404_NOT_FOUND
            )
        body = {
            'filename': operation.original_filename,
            'operation_id': operation.operation_id,
            'state': operation.state
        }
        if operation.state == UploadOperation.STATE_COMPLETED:
            body['document'] = operation_result(operation=operation, user=request.user, replayed=True)
        elif operation.state == UploadOperation.STATE_FAILED:
            body['errors'] = operation_error_body(operation)
        return Response(body)


@extend_schema(exclude=True)
class APIPortalMyUploadsView(PortalAPIView):
    def get(self, request):
        limit = query_int(
            request=request, name='limit', default=MY_UPLOADS_DEFAULT_LIMIT,
            maximum=MY_UPLOADS_MAXIMUM_LIMIT
        )
        return Response(
            {'results': get_my_uploads(limit=limit, user=request.user)}
        )


@extend_schema(exclude=True)
class APIPortalDocumentDetailView(PortalAPIView):
    def get(self, request, document_id):
        document = get_document_or_404(request=request, document_id=document_id)
        return Response(
            serialize_document_detail(document=document, user=request.user)
        )


@extend_schema(exclude=True)
class APIPortalDocumentDetailsView(PortalAPIView):
    """
    Correct a document's title, department or category. Allowed for
    administrators (any active department) and for Department controllers
    (documents in their departments, moved only between them).
    """
    parser_classes = (JSONParser,)

    def patch(self, request, document_id):
        document = get_document_or_404(request=request, document_id=document_id)
        allowed = get_editable_department_ids(document=document, user=request.user)
        if not allowed:
            raise PermissionDenied('You cannot change this document.')
        unexpected = set(request.data) - {'category_id', 'department_id', 'label'}
        if unexpected:
            raise ValidationError(
                {'detail': 'Unexpected fields: {}.'.format(', '.join(sorted(unexpected)))}
            )
        try:
            changes = update_document_details(
                actor=request.user, allowed_department_ids=allowed,
                category_id=body_value(request.data, 'category_id', int),
                department_id=body_value(request.data, 'department_id', int),
                document=document,
                label=body_value(request.data, 'label', str)
            )
        except InputRejected as exception:
            reject(exception)
        document.refresh_from_db()
        data = serialize_document_detail(document=document, user=request.user)
        data['changes'] = changes
        return Response(data)


@extend_schema(exclude=True)
class APIPortalDocumentFavoriteView(PortalAPIView):
    def post(self, request, document_id):
        document = get_document_or_404(request=request, document_id=document_id)
        set_favorite(document=document, user=request.user, value=True)
        return Response({'is_favorite': True})

    def delete(self, request, document_id):
        document = get_document_or_404(request=request, document_id=document_id)
        set_favorite(document=document, user=request.user, value=False)
        return Response({'is_favorite': False})


@extend_schema(exclude=True)
class APIPortalFavoritesView(PortalAPIView):
    def get(self, request):
        return Response({'results': get_favorites(user=request.user)})


@extend_schema(exclude=True)
class APIPortalDocumentSummaryListView(PortalAPIView):
    def get(self, request):
        try:
            document_ids = [
                int(value) for value in request.query_params.getlist('id')
            ]
        except ValueError:
            raise ValidationError({'id': 'Document IDs must be numbers.'})

        if len(document_ids) > SUMMARY_BATCH_LIMIT:
            raise ValidationError(
                {'id': 'At most {} IDs per request.'.format(SUMMARY_BATCH_LIMIT)}
            )

        return Response(
            {
                'results': get_document_summaries(
                    document_ids=document_ids, user=request.user
                )
            }
        )


@extend_schema(exclude=True)
class APIPortalDepartmentListView(PortalAPIView):
    """Department cards: counts include only documents the caller can view."""
    def get(self, request):
        return Response(get_departments_for_user(user=request.user))


def get_department_or_404(department_id):
    try:
        return Department.objects.get(pk=department_id)
    except Department.DoesNotExist:
        raise Http404


@extend_schema(exclude=True)
class APIPortalDepartmentDetailView(PortalAPIView):
    def get(self, request, department_id):
        department = get_department_or_404(department_id=department_id)
        return Response(
            dict(
                serialize_department(department=department),
                can_upload=department.is_active and user_can_upload(user=request.user),
                categories=[
                    serialize_category(category)
                    for category in Category.objects.all()
                ]
            )
        )


@extend_schema(exclude=True)
class APIPortalDepartmentDocumentsView(PortalAPIView):
    """
    Documents in one department that the caller may view, newest first.
    `q` runs Mayan's document search limited to this department.
    """
    def get(self, request, department_id):
        department = get_department_or_404(department_id=department_id)
        return Response(
            get_department_documents(
                category_id=query_int(request=request, name='category', default=None),
                department=department,
                page=query_int(request=request, name='page', default=1, maximum=10000),
                page_size=query_int(
                    request=request, name='page_size',
                    default=DEPARTMENT_DOCUMENTS_PAGE_SIZE,
                    maximum=DEPARTMENT_DOCUMENTS_MAXIMUM_PAGE_SIZE
                ),
                query=request.query_params.get('q'), user=request.user
            )
        )


@extend_schema(exclude=True)
class APIPortalTokenRevokeView(PortalAPIView):
    """
    Delete the caller's Mayan API token. Mayan keeps one token per user, so
    this ends every portal session of that user, on every device.
    """
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(exclude=True)
class APIPortalRecentDocumentsView(PortalAPIView):
    """
    GET ?page=&page_size= -> newest documents the caller may view, across
    all departments. Small pages only (RECENT_DOCUMENTS_MAXIMUM_PAGE_SIZE).
    """
    def get(self, request):
        return Response(
            get_recent_documents(
                page=query_int(request=request, name='page', default=1, maximum=100),
                page_size=query_int(
                    request=request, name='page_size',
                    default=RECENT_DOCUMENTS_PAGE_SIZE,
                    maximum=RECENT_DOCUMENTS_MAXIMUM_PAGE_SIZE
                ),
                user=request.user
            )
        )
