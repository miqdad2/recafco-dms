"""
RECAFCO administration endpoints. Every view requires an authenticated
RECAFCO administrator (IsPortalAdmin) — checked on each request, so a
direct request from anyone else gets 403.

Documents are still resolved through Mayan's ACLs for the administrator:
being a RECAFCO administrator does not reveal confidential documents.
"""
from django.http import Http404
from django.db.models import Q

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import IsPortalAdmin
from .admin_services import (
    create_category, create_confidential_group, create_department,
    create_user, get_audit_entries, get_manageable_user, list_categories,
    list_departments, list_users, manageable_users, paginate,
    rename_confidential_group, reorder_departments,
    serialize_confidential_group, serialize_user,
    reclassify_document, set_confidential_membership, set_responsible_person,
    update_category, update_department, update_user
)
from .api_views import (
    body_value, get_document_or_404, query_int, reject,
    serialize_document_detail
)
from .literals import (
    ADMIN_PAGE_SIZE, DEPARTMENT_ICONS, GROUP_ADMINISTRATORS_NAME,
    GROUP_EMPLOYEES_NAME, QUERY_MAX_LENGTH
)
from .passwords import reset_password_by_admin
from .models import (
    AuditEntry, Category, ConfidentialAccessGroup, ControllerAssignment,
    Department
)
from .services import (
    DOCUMENT_RELATED, InputRejected, get_accessible_document,
    get_accessible_documents, get_confidential_group,
    serialize_audit_entry, serialize_category, serialize_department,
    serialize_document, user_display
)


class AdminAPIView(APIView):
    parser_classes = (JSONParser,)
    permission_classes = (IsAuthenticated, IsPortalAdmin)

    allowed_fields = frozenset()

    def check_fields(self, request):
        unexpected = set(request.data) - self.allowed_fields
        if unexpected:
            raise ValidationError(
                {'detail': 'Unexpected fields: {}.'.format(', '.join(sorted(unexpected)))}
            )


def get_or_404(model, pk):
    try:
        return model.objects.get(pk=pk)
    except model.DoesNotExist:
        raise Http404


@extend_schema(exclude=True)
class APIAdminOverviewView(AdminAPIView):
    def get(self, request):
        users = manageable_users()
        return Response(
            {
                'counts': {
                    'active_users': users.filter(is_active=True).count(),
                    'administrators': users.filter(
                        groups__name=GROUP_ADMINISTRATORS_NAME
                    ).count(),
                    'categories': Category.objects.filter(is_active=True).count(),
                    'confidential_groups': ConfidentialAccessGroup.objects.count(),
                    'controllers': ControllerAssignment.objects.values(
                        'user'
                    ).distinct().count(),
                    'departments': Department.objects.filter(is_active=True).count(),
                    'employees': users.filter(groups__name=GROUP_EMPLOYEES_NAME).count(),
                    'inactive_users': users.filter(is_active=False).count()
                },
                'recent_activity': [
                    serialize_audit_entry(entry) for entry in
                    AuditEntry.objects.select_related('actor')[:10]
                ]
            }
        )


# ------------------------------------------------------------ departments

@extend_schema(exclude=True)
class APIAdminDepartmentListView(AdminAPIView):
    allowed_fields = frozenset(('icon', 'is_sample', 'name'))

    def get(self, request):
        return Response({'icons': DEPARTMENT_ICONS, 'results': list_departments()})

    def post(self, request):
        self.check_fields(request)
        try:
            department = create_department(
                actor=request.user, icon=body_value(request.data, 'icon', str) or 'folder',
                is_sample=body_value(request.data, 'is_sample', bool) or False,
                name=body_value(request.data, 'name', str)
            )
        except InputRejected as exception:
            reject(exception)
        return Response(
            serialize_department(department), status=status.HTTP_201_CREATED
        )


@extend_schema(exclude=True)
class APIAdminDepartmentDetailView(AdminAPIView):
    allowed_fields = frozenset(('icon', 'is_active', 'is_sample', 'name'))

    def patch(self, request, department_id):
        self.check_fields(request)
        department = get_or_404(Department, department_id)
        try:
            department, changes = update_department(
                actor=request.user, department=department,
                icon=body_value(request.data, 'icon', str),
                is_active=body_value(request.data, 'is_active', bool),
                is_sample=body_value(request.data, 'is_sample', bool),
                name=body_value(request.data, 'name', str)
            )
        except InputRejected as exception:
            reject(exception)
        return Response(dict(serialize_department(department), changes=changes))


@extend_schema(exclude=True)
class APIAdminDepartmentOrderView(AdminAPIView):
    allowed_fields = frozenset(('ids',))

    def post(self, request):
        self.check_fields(request)
        try:
            reorder_departments(
                actor=request.user, ids=body_value(request.data, 'ids', list) or []
            )
        except InputRejected as exception:
            reject(exception)
        return Response({'results': list_departments()})


# ------------------------------------------------------------- categories

@extend_schema(exclude=True)
class APIAdminCategoryListView(AdminAPIView):
    allowed_fields = frozenset(('name',))

    def get(self, request):
        return Response({'results': list_categories()})

    def post(self, request):
        self.check_fields(request)
        try:
            category = create_category(
                actor=request.user, name=body_value(request.data, 'name', str)
            )
        except InputRejected as exception:
            reject(exception)
        return Response(serialize_category(category), status=status.HTTP_201_CREATED)


@extend_schema(exclude=True)
class APIAdminCategoryDetailView(AdminAPIView):
    allowed_fields = frozenset(('is_active', 'name'))

    def patch(self, request, category_id):
        self.check_fields(request)
        category = get_or_404(Category, category_id)
        try:
            category, changes = update_category(
                actor=request.user, category=category,
                is_active=body_value(request.data, 'is_active', bool),
                name=body_value(request.data, 'name', str)
            )
        except InputRejected as exception:
            reject(exception)
        return Response(dict(serialize_category(category), changes=changes))


# ------------------------------------------------------------------ users

USER_FIELDS = frozenset((
    'controller_department_ids', 'department_ids', 'email', 'first_name',
    'is_active', 'is_administrator', 'is_employee', 'last_name'
))


@extend_schema(exclude=True)
class APIAdminUserListView(AdminAPIView):
    allowed_fields = USER_FIELDS - {'is_active'} | {'password', 'username'}

    def get(self, request):
        return Response(
            list_users(
                page=query_int(request=request, name='page', default=1, maximum=10000),
                query=request.query_params.get('q')
            )
        )

    def post(self, request):
        self.check_fields(request)
        data = request.data
        try:
            user = create_user(
                actor=request.user,
                controller_department_ids=body_value(data, 'controller_department_ids', list) or [],
                department_ids=body_value(data, 'department_ids', list) or [],
                email=body_value(data, 'email', str) or '',
                first_name=body_value(data, 'first_name', str) or '',
                is_administrator=bool(body_value(data, 'is_administrator', bool)),
                is_employee=body_value(data, 'is_employee', bool) is not False,
                last_name=body_value(data, 'last_name', str) or '',
                password=body_value(data, 'password', str),
                username=body_value(data, 'username', str)
            )
        except InputRejected as exception:
            reject(exception)
        return Response(serialize_user(user), status=status.HTTP_201_CREATED)


def get_user_or_404(user_id):
    user = get_manageable_user(user_id=user_id)
    if user is None:
        raise Http404
    return user


@extend_schema(exclude=True)
class APIAdminUserDetailView(AdminAPIView):
    allowed_fields = USER_FIELDS

    def get(self, request, user_id):
        return Response(serialize_user(get_user_or_404(user_id)))

    def patch(self, request, user_id):
        self.check_fields(request)
        user = get_user_or_404(user_id)
        data = request.data
        try:
            user, changes = update_user(
                actor=request.user, user=user,
                controller_department_ids=body_value(data, 'controller_department_ids', list),
                department_ids=body_value(data, 'department_ids', list),
                email=body_value(data, 'email', str),
                first_name=body_value(data, 'first_name', str),
                is_active=body_value(data, 'is_active', bool),
                is_administrator=body_value(data, 'is_administrator', bool),
                is_employee=body_value(data, 'is_employee', bool),
                last_name=body_value(data, 'last_name', str)
            )
        except InputRejected as exception:
            reject(exception)
        return Response(dict(serialize_user(user), changes=changes))


@extend_schema(exclude=True)
class APIAdminUserPasswordView(AdminAPIView):
    allowed_fields = frozenset(('password',))

    def post(self, request, user_id):
        self.check_fields(request)
        user = get_user_or_404(user_id)
        try:
            if user.pk == request.user.pk:
                raise InputRejected(
                    field='password',
                    message='Use “Change password” in your account menu to change your own password.'
                )
            reset_password_by_admin(
                actor=request.user, password=body_value(request.data, 'password', str),
                user=user
            )
        except InputRejected as exception:
            reject(exception)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------- confidential groups

@extend_schema(exclude=True)
class APIAdminConfidentialGroupListView(AdminAPIView):
    allowed_fields = frozenset(('name',))

    def get(self, request):
        return Response(
            {
                'results': [
                    serialize_confidential_group(group)
                    for group in ConfidentialAccessGroup.objects.select_related(
                        'document_type', 'group'
                    )
                ]
            }
        )

    def post(self, request):
        self.check_fields(request)
        try:
            group = create_confidential_group(
                actor=request.user, name=body_value(request.data, 'name', str)
            )
        except InputRejected as exception:
            reject(exception)
        return Response(
            serialize_confidential_group(group, include_members=True),
            status=status.HTTP_201_CREATED
        )


@extend_schema(exclude=True)
class APIAdminConfidentialGroupDetailView(AdminAPIView):
    allowed_fields = frozenset(('name',))

    def get(self, request, group_id):
        group = get_or_404(ConfidentialAccessGroup, group_id)
        return Response(serialize_confidential_group(group, include_members=True))

    def patch(self, request, group_id):
        self.check_fields(request)
        group = get_or_404(ConfidentialAccessGroup, group_id)
        try:
            group = rename_confidential_group(
                access_group=group, actor=request.user,
                name=body_value(request.data, 'name', str)
            )
        except InputRejected as exception:
            reject(exception)
        return Response(serialize_confidential_group(group, include_members=True))


@extend_schema(exclude=True)
class APIAdminConfidentialGroupMembersView(AdminAPIView):
    allowed_fields = frozenset(('is_member', 'user_id'))

    def post(self, request, group_id):
        self.check_fields(request)
        group = get_or_404(ConfidentialAccessGroup, group_id)
        user_id = body_value(request.data, 'user_id', int)
        is_member = body_value(request.data, 'is_member', bool)
        if user_id is None or is_member is None:
            raise ValidationError({'user_id': 'Send user_id and is_member.'})
        user = get_manageable_user(user_id=user_id)
        if user is None:
            raise ValidationError({'user_id': 'Choose a user from the list.'})
        try:
            set_confidential_membership(
                access_group=group, actor=request.user, user=user, value=is_member
            )
        except InputRejected as exception:
            reject(exception)
        return Response(serialize_confidential_group(group, include_members=True))


# -------------------------------------------------------------- documents

@extend_schema(exclude=True)
class APIAdminDocumentListView(AdminAPIView):
    """Documents the administrator may view (Mayan ACLs), by title or ID."""
    def get(self, request):
        queryset = get_accessible_documents(user=request.user)
        query = (request.query_params.get('q') or '').strip()[:QUERY_MAX_LENGTH]
        if query:
            condition = Q(label__icontains=query)
            if query.isdigit():
                condition |= Q(pk=int(query))
            queryset = queryset.filter(condition)
        page = query_int(request=request, name='page', default=1, maximum=10000)
        count, documents = paginate(
            queryset=queryset.select_related(*DOCUMENT_RELATED).order_by(
                '-datetime_created', '-pk'
            ), page=page
        )
        return Response(
            {
                'count': count, 'page': page, 'page_size': ADMIN_PAGE_SIZE,
                'results': [
                    serialize_document(document=document, user=request.user)
                    for document in documents
                ]
            }
        )


@extend_schema(exclude=True)
class APIAdminDocumentDetailView(AdminAPIView):
    def get(self, request, document_id):
        document = get_document_or_404(request=request, document_id=document_id)
        count, entries = get_audit_entries(
            page=1, target_id=document.pk, target_type='document'
        )
        data = serialize_document_detail(document=document, user=request.user)
        data['history'] = [serialize_audit_entry(entry) for entry in entries]
        return Response(data)


@extend_schema(exclude=True)
class APIAdminDocumentResponsibleView(AdminAPIView):
    """Transfer responsibility. The original uploader never changes."""
    allowed_fields = frozenset(('user_id',))

    def post(self, request, document_id):
        self.check_fields(request)
        document = get_document_or_404(request=request, document_id=document_id)
        user = get_manageable_user(user_id=body_value(request.data, 'user_id', int))
        if user is None:
            raise ValidationError({'user_id': 'Choose a user from the list.'})
        try:
            set_responsible_person(actor=request.user, document=document, user=user)
        except InputRejected as exception:
            reject(exception)
        document.refresh_from_db()
        return Response(serialize_document_detail(document=document, user=request.user))


@extend_schema(exclude=True)
class APIAdminDocumentReclassifyView(AdminAPIView):
    """
    Make a document confidential (or move it to another confidential group).
    Requires administrator authority (IsPortalAdmin) AND current access to the
    document (404 otherwise). Confidential-to-general is not offered.
    """
    allowed_fields = frozenset(('confidential_group',))

    def post(self, request, document_id):
        self.check_fields(request)
        document = get_document_or_404(request=request, document_id=document_id)
        group_id = body_value(request.data, 'confidential_group', int)
        if group_id is None:
            raise ValidationError({'confidential_group': 'Choose a confidential group.'})
        try:
            group = get_confidential_group(group_id)
            changed = reclassify_document(
                access_group=group, actor=request.user, document=document
            )
        except InputRejected as exception:
            reject(exception)
        accessible = get_accessible_document(user=request.user, document_id=document.pk)
        return Response(
            {
                'accessible': bool(accessible),
                'changed': changed,
                'confidential_group': {'id': group.pk, 'name': group.name},
                'id': document.pk
            }
        )


# ------------------------------------------------------------------ audit

@extend_schema(exclude=True)
class APIAdminAuditView(AdminAPIView):
    def get(self, request):
        page = query_int(request=request, name='page', default=1, maximum=10000)
        count, entries = get_audit_entries(page=page)
        return Response(
            {
                'count': count, 'page': page, 'page_size': ADMIN_PAGE_SIZE,
                'results': [serialize_audit_entry(entry) for entry in entries]
            }
        )


@extend_schema(exclude=True)
class APIAdminUserChoicesView(AdminAPIView):
    """Compact list of manageable users for pickers (owner, members)."""
    def get(self, request):
        return Response(
            {
                'results': [
                    dict(user_display(user), is_active=user.is_active)
                    for user in manageable_users().order_by('username')[:1000]
                ]
            }
        )


