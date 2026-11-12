"""
RECAFCO administration endpoints (Unit 5: full administrator control).

Authorization, checked on every request (direct requests included):
- each view requires one application permission (app_permissions.py);
  reading shared lists (departments, categories, user choices) only needs
  access to the administration area;
- roles and administrative authority: System Administrators only;
- document operations apply only to documents the actor can open through
  Mayan's ACLs. System Administrators can open every RECAFCO document;
  nobody else gains document access from these endpoints.
"""
import csv
import io
import json

from django.core.exceptions import PermissionDenied
from django.db.models import Q
from django.http import Http404, HttpResponse

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .admin_operations import (
    admin_documents, bulk_documents, confidential_group_usage,
    delete_category, delete_confidential_group, delete_department, delete_role,
    delete_user, department_usage, ensure_may_manage, filter_audit_entries,
    get_admin_document, is_builtin_group, save_role, serialize_role,
    set_confidential_group_active, set_document_access, set_responsible,
    set_user_roles, user_usage
)
from .admin_services import (
    create_category, create_confidential_group, create_department,
    create_user, get_audit_entries, get_manageable_user, list_categories,
    list_departments, list_users, manageable_users, paginate,
    rename_confidential_group, reorder_departments,
    serialize_confidential_group, serialize_user, set_confidential_membership,
    update_category, update_department, update_user
)
from .api_views import body_value, query_int, serialize_document_detail
from .app_permissions import (
    ALL_PERMISSIONS, GRANTABLE_PERMISSIONS, AppPermission, CanUseAdminArea,
    get_app_permissions, has_app_permission, is_system_admin
)
from .literals import (
    ADMIN_PAGE_SIZE, DEPARTMENT_ICONS, GROUP_ADMINISTRATORS_NAME,
    GROUP_EMPLOYEES_NAME, QUERY_MAX_LENGTH
)
from .models import (
    AppRole, AuditEntry, Category, ConfidentialAccessGroup,
    ControllerAssignment, Department
)
from .passwords import reset_password_by_admin
from .services import (
    DOCUMENT_RELATED, InputRejected, PageInfo, get_confidential_group,
    serialize_audit_entry, serialize_category, serialize_department,
    serialize_document, user_display
)

AUDIT_EXPORT_MAXIMUM = 50000


class AdminAPIView(APIView):
    """
    `read_permission`: needed for GET (None = any administration access).
    `write_permission`: needed for POST/PATCH/DELETE.
    """
    parser_classes = (JSONParser,)
    permission_classes = (IsAuthenticated, CanUseAdminArea)
    read_permission = None
    write_permission = None
    allowed_fields = frozenset()

    def get_permissions(self):
        wanted = self.read_permission if self.request.method in ('GET', 'HEAD', 'OPTIONS') else self.write_permission
        classes = [IsAuthenticated, CanUseAdminArea]
        if wanted:
            classes.append(AppPermission.require(wanted))
        return [cls() for cls in classes]

    def check_fields(self, request):
        unexpected = set(request.data) - self.allowed_fields
        if unexpected:
            raise ValidationError(
                {'detail': 'Unexpected fields: {}.'.format(', '.join(sorted(unexpected)))}
            )

    def handle_exception(self, exc):
        if isinstance(exc, InputRejected):
            exc = ValidationError({exc.field: exc.message})
        return super().handle_exception(exc)


def string_list(data, name):
    """Optional list of short strings (e.g. permission keys); None if absent."""
    if name not in data or data[name] is None:
        return None
    value = data[name]
    if not isinstance(value, list) or not all(isinstance(item, str) and len(item) <= 64 for item in value):
        raise ValidationError({name: 'Must be a list of names.'})
    return value


def get_or_404(model, pk):
    try:
        return model.objects.get(pk=pk)
    except (model.DoesNotExist, TypeError, ValueError):
        raise Http404


def optional(model, value, field):
    if value is None:
        return None
    try:
        return model.objects.get(pk=int(value))
    except (model.DoesNotExist, TypeError, ValueError):
        raise ValidationError({field: 'Choose from the list.'})


@extend_schema(exclude=True)
class APIAdminOverviewView(AdminAPIView):
    def get(self, request):
        users = manageable_users()
        data = {
            'permissions': sorted(get_app_permissions(user=request.user)),
            'is_system_admin': is_system_admin(request.user),
            'counts': {
                'active_users': users.filter(is_active=True).count(),
                'administrators': users.filter(groups__name=GROUP_ADMINISTRATORS_NAME).count(),
                'categories': Category.objects.filter(is_active=True).count(),
                'confidential_groups': ConfidentialAccessGroup.objects.count(),
                'controllers': ControllerAssignment.objects.values('user').distinct().count(),
                'departments': Department.objects.filter(is_active=True).count(),
                'employees': users.filter(groups__name=GROUP_EMPLOYEES_NAME).count(),
                'inactive_users': users.filter(is_active=False).count(),
                'roles': AppRole.objects.count(),
            },
            'recent_activity': []
        }
        if has_app_permission(request.user, 'activity.view'):
            data['recent_activity'] = [
                serialize_audit_entry(entry) for entry in AuditEntry.objects.select_related('actor')[:10]
            ]
        return Response(data)


# ------------------------------------------------------------ departments

@extend_schema(exclude=True)
class APIAdminDepartmentListView(AdminAPIView):
    write_permission = 'departments.manage'
    allowed_fields = frozenset(('icon', 'is_sample', 'name'))

    def get(self, request):
        return Response({'icons': DEPARTMENT_ICONS, 'results': list_departments()})

    def post(self, request):
        self.check_fields(request)
        department = create_department(
            actor=request.user, icon=body_value(request.data, 'icon', str) or 'folder',
            is_sample=body_value(request.data, 'is_sample', bool) or False,
            name=body_value(request.data, 'name', str)
        )
        return Response(serialize_department(department), status=status.HTTP_201_CREATED)


@extend_schema(exclude=True)
class APIAdminDepartmentDetailView(AdminAPIView):
    read_permission = 'departments.manage'
    write_permission = 'departments.manage'
    allowed_fields = frozenset(('icon', 'is_active', 'is_sample', 'name', 'mode', 'target_id', 'reason'))

    def get(self, request, department_id):
        department = get_or_404(Department, department_id)
        return Response(dict(serialize_department(department), usage=department_usage(department)))

    def patch(self, request, department_id):
        self.check_fields(request)
        department = get_or_404(Department, department_id)
        department, changes = update_department(
            actor=request.user, department=department,
            icon=body_value(request.data, 'icon', str),
            is_active=body_value(request.data, 'is_active', bool),
            is_sample=body_value(request.data, 'is_sample', bool),
            name=body_value(request.data, 'name', str)
        )
        return Response(dict(serialize_department(department), changes=changes))

    def delete(self, request, department_id):
        """Body: {mode: null|"move"|"trash", target_id, reason}. Merge = move."""
        self.check_fields(request)
        department = get_or_404(Department, department_id)
        target = optional(Department, body_value(request.data, 'target_id', int), 'target_id')
        usage = delete_department(
            actor=request.user, department=department, mode=body_value(request.data, 'mode', str),
            reason=body_value(request.data, 'reason', str) or '', target=target
        )
        return Response({'deleted': True, 'usage': usage})


@extend_schema(exclude=True)
class APIAdminDepartmentOrderView(AdminAPIView):
    write_permission = 'departments.manage'
    allowed_fields = frozenset(('ids',))

    def post(self, request):
        self.check_fields(request)
        reorder_departments(actor=request.user, ids=body_value(request.data, 'ids', list) or [])
        return Response({'results': list_departments()})


# ------------------------------------------------------------- categories

@extend_schema(exclude=True)
class APIAdminCategoryListView(AdminAPIView):
    write_permission = 'categories.manage'
    allowed_fields = frozenset(('name',))

    def get(self, request):
        return Response({'results': list_categories()})

    def post(self, request):
        self.check_fields(request)
        category = create_category(actor=request.user, name=body_value(request.data, 'name', str))
        return Response(serialize_category(category), status=status.HTTP_201_CREATED)


@extend_schema(exclude=True)
class APIAdminCategoryDetailView(AdminAPIView):
    read_permission = 'categories.manage'
    write_permission = 'categories.manage'
    allowed_fields = frozenset(('is_active', 'name', 'target_id', 'reason'))

    def get(self, request, category_id):
        from mayan.apps.documents.models.document_models import Document

        category = get_or_404(Category, category_id)
        documents = Document.objects.filter(recafco_classification__category=category)
        return Response(dict(serialize_category(category), usage={
            'documents': documents.filter(in_trash=False).count(),
            'documents_in_recycle_bin': documents.filter(in_trash=True).count()
        }))

    def patch(self, request, category_id):
        self.check_fields(request)
        category = get_or_404(Category, category_id)
        category, changes = update_category(
            actor=request.user, category=category,
            is_active=body_value(request.data, 'is_active', bool),
            name=body_value(request.data, 'name', str)
        )
        return Response(dict(serialize_category(category), changes=changes))

    def delete(self, request, category_id):
        """Body: {target_id, reason}. Documents move to target_id (merge)."""
        self.check_fields(request)
        category = get_or_404(Category, category_id)
        target = optional(Category, body_value(request.data, 'target_id', int), 'target_id')
        moved = delete_category(
            actor=request.user, category=category,
            reason=body_value(request.data, 'reason', str) or '', target=target
        )
        return Response({'deleted': True, 'moved_documents': moved})


# ------------------------------------------------------------------ users

USER_FIELDS = frozenset((
    'controller_department_ids', 'department_ids', 'email', 'first_name',
    'is_active', 'is_administrator', 'is_employee', 'last_name', 'username'
))


def get_user_or_404(user_id):
    user = get_manageable_user(user_id=user_id)
    if user is None:
        raise Http404
    return user


@extend_schema(exclude=True)
class APIAdminUserListView(AdminAPIView):
    read_permission = 'users.manage'
    write_permission = 'users.manage'
    allowed_fields = USER_FIELDS - {'is_active'} | {'password'}

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
        is_administrator = bool(body_value(data, 'is_administrator', bool))
        if is_administrator and not is_system_admin(request.user):
            raise PermissionDenied
        user = create_user(
            actor=request.user,
            controller_department_ids=body_value(data, 'controller_department_ids', list) or [],
            department_ids=body_value(data, 'department_ids', list) or [],
            email=body_value(data, 'email', str) or '',
            first_name=body_value(data, 'first_name', str) or '',
            is_administrator=is_administrator,
            is_employee=body_value(data, 'is_employee', bool) is not False,
            last_name=body_value(data, 'last_name', str) or '',
            password=body_value(data, 'password', str),
            username=body_value(data, 'username', str)
        )
        return Response(serialize_user(user), status=status.HTTP_201_CREATED)


@extend_schema(exclude=True)
class APIAdminUserDetailView(AdminAPIView):
    read_permission = 'users.manage'
    write_permission = 'users.manage'
    allowed_fields = USER_FIELDS | {'transfer_to', 'reason'}

    def get(self, request, user_id):
        user = get_user_or_404(user_id)
        return Response(dict(serialize_user(user), usage=user_usage(user)))

    def patch(self, request, user_id):
        self.check_fields(request)
        user = get_user_or_404(user_id)
        data = request.data
        user, changes = update_user(
            actor=request.user, user=user,
            controller_department_ids=body_value(data, 'controller_department_ids', list),
            department_ids=body_value(data, 'department_ids', list),
            email=body_value(data, 'email', str),
            first_name=body_value(data, 'first_name', str),
            is_active=body_value(data, 'is_active', bool),
            is_administrator=body_value(data, 'is_administrator', bool),
            is_employee=body_value(data, 'is_employee', bool),
            last_name=body_value(data, 'last_name', str),
            username=body_value(data, 'username', str)
        )
        return Response(dict(serialize_user(user), changes=changes))

    def delete(self, request, user_id):
        """Body: {transfer_to (user id, optional), reason}."""
        self.check_fields(request)
        user = get_user_or_404(user_id)
        transfer_id = body_value(request.data, 'transfer_to', int)
        transfer_to = get_manageable_user(user_id=transfer_id) if transfer_id else None
        if transfer_id and transfer_to is None:
            raise ValidationError({'transfer_to': 'Choose a person from the list.'})
        usage = delete_user(
            actor=request.user, reason=body_value(request.data, 'reason', str) or '',
            transfer_to=transfer_to, user=user
        )
        return Response({'deleted': True, 'usage': usage})


@extend_schema(exclude=True)
class APIAdminUserPasswordView(AdminAPIView):
    write_permission = 'users.manage'
    allowed_fields = frozenset(('password',))

    def post(self, request, user_id):
        self.check_fields(request)
        user = get_user_or_404(user_id)
        ensure_may_manage(request.user, user)
        if user.pk == request.user.pk:
            raise InputRejected(
                field='password',
                message='Use “Change password” in your account menu to change your own password.'
            )
        reset_password_by_admin(
            actor=request.user, password=body_value(request.data, 'password', str), user=user
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(exclude=True)
class APIAdminUserRolesView(AdminAPIView):
    """Assign roles / System Administrator. System Administrators only."""
    write_permission = 'roles.manage'
    allowed_fields = frozenset(('role_ids', 'system_administrator'))

    def post(self, request, user_id):
        self.check_fields(request)
        user = get_user_or_404(user_id)
        changes = set_user_roles(
            actor=request.user, role_ids=body_value(request.data, 'role_ids', list),
            system_administrator=body_value(request.data, 'system_administrator', bool), user=user
        )
        return Response(dict(serialize_user(user), changes=changes))


@extend_schema(exclude=True)
class APIAdminUserChoicesView(AdminAPIView):
    """Compact list of manageable users for pickers (responsibility, members)."""
    def get(self, request):
        return Response({
            'results': [
                dict(user_display(user), is_active=user.is_active)
                for user in manageable_users().order_by('username')[:1000]
            ]
        })


# ------------------------------------------------------------------ roles

@extend_schema(exclude=True)
class APIAdminRoleListView(AdminAPIView):
    read_permission = 'roles.manage'
    write_permission = 'roles.manage'
    allowed_fields = frozenset(('name', 'description', 'permissions'))

    def get(self, request):
        return Response({
            'permissions': [
                {'key': key, 'label': label, 'description': description, 'grantable': key in GRANTABLE_PERMISSIONS}
                for key, (label, description) in ALL_PERMISSIONS.items()
            ],
            'results': [serialize_role(role) for role in AppRole.objects.all()]
        })

    def post(self, request):
        self.check_fields(request)
        role, changes = save_role(
            actor=request.user, description=body_value(request.data, 'description', str) or '',
            name=body_value(request.data, 'name', str),
            permissions=string_list(request.data, 'permissions') or []
        )
        return Response(serialize_role(role), status=status.HTTP_201_CREATED)


@extend_schema(exclude=True)
class APIAdminRoleDetailView(AdminAPIView):
    read_permission = 'roles.manage'
    write_permission = 'roles.manage'
    allowed_fields = frozenset(('name', 'description', 'permissions', 'reason'))

    def get(self, request, role_id):
        return Response(serialize_role(get_or_404(AppRole, role_id)))

    def patch(self, request, role_id):
        self.check_fields(request)
        role, changes = save_role(
            actor=request.user, description=body_value(request.data, 'description', str),
            name=body_value(request.data, 'name', str),
            permissions=string_list(request.data, 'permissions'),
            role=get_or_404(AppRole, role_id)
        )
        return Response(dict(serialize_role(role), changes=changes))

    def delete(self, request, role_id):
        self.check_fields(request)
        removed = delete_role(
            actor=request.user, reason=body_value(request.data, 'reason', str) or '',
            role=get_or_404(AppRole, role_id)
        )
        return Response({'deleted': True, 'members_removed': removed})


# --------------------------------------------------- confidential groups

def serialize_group(group, include_members=False):
    data = serialize_confidential_group(group, include_members=include_members)
    data['is_active'] = group.is_active
    data['is_builtin'] = is_builtin_group(group)
    data['usage'] = confidential_group_usage(group)
    return data


@extend_schema(exclude=True)
class APIAdminConfidentialGroupListView(AdminAPIView):
    write_permission = 'confidential_groups.manage'
    allowed_fields = frozenset(('name',))

    def get(self, request):
        return Response({
            'results': [
                serialize_group(group)
                for group in ConfidentialAccessGroup.objects.select_related('document_type', 'group')
            ]
        })

    def post(self, request):
        self.check_fields(request)
        group = create_confidential_group(actor=request.user, name=body_value(request.data, 'name', str))
        return Response(serialize_group(group, include_members=True), status=status.HTTP_201_CREATED)


@extend_schema(exclude=True)
class APIAdminConfidentialGroupDetailView(AdminAPIView):
    read_permission = 'confidential_groups.manage'
    write_permission = 'confidential_groups.manage'
    allowed_fields = frozenset(('name', 'is_active', 'mode', 'target_id', 'reason'))

    def get(self, request, group_id):
        return Response(serialize_group(get_or_404(ConfidentialAccessGroup, group_id), include_members=True))

    def patch(self, request, group_id):
        self.check_fields(request)
        group = get_or_404(ConfidentialAccessGroup, group_id)
        name = body_value(request.data, 'name', str)
        if name is not None:
            group = rename_confidential_group(access_group=group, actor=request.user, name=name)
        is_active = body_value(request.data, 'is_active', bool)
        if is_active is not None:
            set_confidential_group_active(
                access_group=group, actor=request.user, reason=body_value(request.data, 'reason', str) or '',
                value=is_active
            )
            group.refresh_from_db()
        return Response(serialize_group(group, include_members=True))

    def delete(self, request, group_id):
        """Body: {mode: null|"move"|"purge", target_id, reason}."""
        self.check_fields(request)
        group = get_or_404(ConfidentialAccessGroup, group_id)
        target = optional(ConfidentialAccessGroup, body_value(request.data, 'target_id', int), 'target_id')
        usage = delete_confidential_group(
            access_group=group, actor=request.user, mode=body_value(request.data, 'mode', str),
            reason=body_value(request.data, 'reason', str) or '', target=target
        )
        return Response({'deleted': True, 'usage': usage})


@extend_schema(exclude=True)
class APIAdminConfidentialGroupMembersView(AdminAPIView):
    write_permission = 'confidential_groups.manage'
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
        set_confidential_membership(access_group=group, actor=request.user, user=user, value=is_member)
        return Response(serialize_group(group, include_members=True))


# -------------------------------------------------------------- documents

DOCUMENT_PERMISSIONS = frozenset(('documents.manage', 'documents.recycle', 'documents.purge'))


class DocumentReadPermission(CanUseAdminArea):
    """Any of the document permissions."""
    def has_permission(self, request, view):
        return bool(get_app_permissions(request.user) & DOCUMENT_PERMISSIONS)


class DocumentAdminView(AdminAPIView):
    def get_permissions(self):
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return [IsAuthenticated(), DocumentReadPermission()]
        return super().get_permissions()


def serialize_admin_document(document, user, detail=False, page_info=None):
    if detail:
        data = serialize_document_detail(document=document, user=user)
    else:
        data = serialize_document(document=document, user=user, page_info=page_info)
    data['in_trash'] = document.in_trash
    data['trashed_at'] = document.trashed_date_time.isoformat() if document.trashed_date_time else None
    return data


@extend_schema(exclude=True)
class APIAdminDocumentListView(DocumentAdminView):
    """
    Documents the administrator can open (Mayan ACLs), with filters:
    q (title or ID), department (id or "none"), category, access
    (general|confidential|group id), status (active|trash), page.
    """
    def get(self, request):
        params = request.query_params
        trashed = params.get('status') == 'trash'
        queryset = admin_documents(user=request.user, trashed=trashed)
        query = (params.get('q') or '').strip()[:QUERY_MAX_LENGTH]
        if query:
            condition = Q(label__icontains=query)
            if query.isdigit():
                condition |= Q(pk=int(query))
            queryset = queryset.filter(condition)
        department = params.get('department')
        if department == 'none':
            queryset = queryset.filter(
                Q(recafco_classification__isnull=True) | Q(recafco_classification__department__isnull=True)
            )
        elif department:
            queryset = queryset.filter(recafco_classification__department_id=query_int(request, 'department', None))
        if params.get('category'):
            queryset = queryset.filter(recafco_classification__category_id=query_int(request, 'category', None))
        access = params.get('access')
        if access == 'general':
            queryset = queryset.filter(document_type__recafco_confidential_group__isnull=True)
        elif access == 'confidential':
            queryset = queryset.filter(document_type__recafco_confidential_group__isnull=False)
        elif access:
            queryset = queryset.filter(document_type__recafco_confidential_group__pk=query_int(request, 'access', None))
        page = query_int(request=request, name='page', default=1, maximum=10000)
        order = '-trashed_date_time' if trashed else '-datetime_created'
        count, documents = paginate(
            queryset=queryset.select_related(*DOCUMENT_RELATED).order_by(order, '-pk'), page=page
        )
        documents = list(documents)
        page_info = PageInfo(documents=documents)
        return Response({
            'count': count, 'page': page, 'page_size': ADMIN_PAGE_SIZE,
            'results': [
                serialize_admin_document(document, request.user, page_info=page_info)
                for document in documents
            ]
        })


@extend_schema(exclude=True)
class APIAdminDocumentDetailView(DocumentAdminView):
    def get(self, request, document_id):
        document = get_admin_document(user=request.user, document_id=document_id)
        count, entries = get_audit_entries(page=1, target_id=document.pk, target_type='document')
        data = serialize_admin_document(document, request.user, detail=True)
        data['files'] = [
            {
                'id': document_file.pk, 'filename': document_file.filename,
                'size': document_file.size, 'mimetype': document_file.mimetype or None,
                'timestamp': document_file.timestamp.isoformat(),
                'is_latest': document_file.pk == document.file_latest_id
            }
            for document_file in document.files.order_by('-timestamp', '-pk')
        ]
        data['history'] = [serialize_audit_entry(entry) for entry in entries]
        return Response(data)


@extend_schema(exclude=True)
class APIAdminDocumentResponsibleView(DocumentAdminView):
    """Transfer responsibility. The original uploader never changes."""
    write_permission = 'documents.manage'
    allowed_fields = frozenset(('user_id', 'reason'))

    def post(self, request, document_id):
        self.check_fields(request)
        document = get_admin_document(user=request.user, document_id=document_id, trashed=False)
        user = get_manageable_user(user_id=body_value(request.data, 'user_id', int))
        if user is None:
            raise ValidationError({'user_id': 'Choose a user from the list.'})
        set_responsible(actor=request.user, document=document, person=user,
                        reason=body_value(request.data, 'reason', str) or '')
        document.refresh_from_db()
        return Response(serialize_admin_document(document, request.user, detail=True))


@extend_schema(exclude=True)
class APIAdminDocumentReclassifyView(DocumentAdminView):
    """
    Change access: {confidential_group: <id>} or {confidential_group: null}
    for general. Requires documents.manage AND current access (404).
    """
    write_permission = 'documents.manage'
    allowed_fields = frozenset(('confidential_group', 'reason'))

    def post(self, request, document_id):
        self.check_fields(request)
        if 'confidential_group' not in request.data:
            raise ValidationError({'confidential_group': 'Choose general access or a confidential group.'})
        document = get_admin_document(user=request.user, document_id=document_id, trashed=False)
        group_id = body_value(request.data, 'confidential_group', int)
        group = get_confidential_group(group_id) if group_id is not None else None
        changed = set_document_access(
            access_group=group, actor=request.user, document=document,
            reason=body_value(request.data, 'reason', str) or ''
        )
        accessible = admin_documents(user=request.user).filter(pk=document.pk).exists()
        return Response({
            'accessible': accessible, 'changed': changed, 'id': document.pk,
            'confidential_group': {'id': group.pk, 'name': group.name} if group else None
        })


@extend_schema(exclude=True)
class APIAdminDocumentBulkView(DocumentAdminView):
    """
    POST {action, ids, department_id, category_id, user_id,
    confidential_group (id or "general"), reason}. Per-document results.
    The action's own permission is checked in bulk_documents().
    """
    allowed_fields = frozenset((
        'action', 'ids', 'department_id', 'category_id', 'user_id', 'confidential_group', 'reason'
    ))

    def get_permissions(self):
        return [IsAuthenticated(), DocumentReadPermission()]

    def post(self, request):
        self.check_fields(request)
        data = request.data
        group_value = data.get('confidential_group')
        make_general = group_value == 'general'
        group = None
        if group_value not in (None, 'general'):
            group = get_confidential_group(group_value)
        person = None
        if data.get('user_id') is not None:
            person = get_manageable_user(user_id=body_value(data, 'user_id', int))
            if person is None:
                raise ValidationError({'user_id': 'Choose a person from the list.'})
        result = bulk_documents(
            action=body_value(data, 'action', str), access_group=group, actor=request.user,
            category=optional(Category, body_value(data, 'category_id', int), 'category_id'),
            department=optional(Department, body_value(data, 'department_id', int), 'department_id'),
            ids=body_value(data, 'ids', list) or [], make_general=make_general, person=person,
            reason=body_value(data, 'reason', str) or ''
        )
        return Response(result)


# ------------------------------------------------------------------ audit

@extend_schema(exclude=True)
class APIAdminAuditView(AdminAPIView):
    read_permission = 'activity.view'

    def get(self, request):
        page = query_int(request=request, name='page', default=1, maximum=10000)
        queryset = filter_audit_entries(request.query_params).select_related('actor')
        count, entries = paginate(queryset=queryset, page=page)
        return Response({
            'count': count, 'page': page, 'page_size': ADMIN_PAGE_SIZE,
            'actions': sorted(set(AuditEntry.objects.values_list('action', flat=True))),
            'target_types': sorted(set(AuditEntry.objects.values_list('target_type', flat=True))),
            'results': [serialize_audit_entry(entry) for entry in entries]
        })


@extend_schema(exclude=True)
class APIAdminAuditExportView(AdminAPIView):
    """CSV export of the filtered activity log (read-only)."""
    read_permission = 'activity.view'

    def perform_content_negotiation(self, request, force=False):
        # The response is CSV built by hand, not a DRF renderer. Without
        # force, DRF answers 406 to 'Accept: text/csv' before the view runs.
        # Errors (403, 400) still use the first renderer (JSON).
        return super().perform_content_negotiation(request=request, force=True)

    def get(self, request):
        queryset = filter_audit_entries(request.query_params).select_related('actor')[:AUDIT_EXPORT_MAXIMUM]
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow([
            'id', 'date_time', 'actor_username', 'actor_name', 'action', 'outcome',
            'target_type', 'target_id', 'target', 'reason', 'details'
        ])
        for entry in queryset:
            data = serialize_audit_entry(entry)
            actor = data['actor'] or {}
            row = [
                entry.pk, data['datetime'], actor.get('username', ''), actor.get('full_name', ''),
                entry.action, entry.outcome, entry.target_type, entry.target_id, entry.target_label,
                entry.reason, json.dumps(entry.details, ensure_ascii=False, sort_keys=True)
            ]
            # Neutralise spreadsheet formulas in exported text cells.
            writer.writerow([
                "'" + value if isinstance(value, str) and value[:1] in ('=', '+', '-', '@') else value
                for value in row
            ])
        response = HttpResponse(buffer.getvalue(), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="recafco-activity-log.csv"'
        return response
