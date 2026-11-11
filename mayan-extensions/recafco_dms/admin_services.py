"""
RECAFCO administration operations. Callers (admin API views) have already
checked that the actor is a RECAFCO administrator (access.IsPortalAdmin).

Rules kept here:
- Nothing is deleted. Departments and categories are deactivated; users are
  deactivated; documents keep their department, category and history.
- Mayan superusers and staff accounts are system accounts and cannot be
  viewed or changed from here.
- No Mayan global permission is ever granted. Confidential access is a
  document-type ACL for a dedicated role (see docs/permission-model.md).
- Every change is recorded in AuditEntry.
"""
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.core.validators import validate_email
from django.db.models import Count, Q

from rest_framework.authtoken.models import Token

from mayan.apps.acls.models import AccessControlList
from mayan.apps.documents.models.document_type_models import DocumentType
from mayan.apps.metadata.models import (
    DocumentMetadata, DocumentTypeMetadataType
)
from mayan.apps.authentication.lockouts import is_user_locked
from mayan.apps.permissions.models import Role

from .access import is_system_account
from .literals import (
    ADMIN_PAGE_SIZE, CONFIDENTIAL_GROUP_NAME_MAX_LENGTH, CONFIDENTIAL_GROUP_PREFIX, DEPARTMENT_ICONS,
    GROUP_ADMINISTRATORS_NAME, GROUP_EMPLOYEES_NAME,
    METADATA_TYPE_CATEGORY_NAME, METADATA_TYPE_DEPARTMENT_NAME,
    PASSWORD_REASON_CREATED, QUERY_MAX_LENGTH
)
from mayan.apps.documents.models.document_models import Document

from .models import (
    AuditEntry, Category, ConfidentialAccessGroup, ControllerAssignment,
    Department, DepartmentAssignment, DocumentResponsibility, PasswordState,
    PortalUpload
)
from .passwords import (
    clean_new_username, clean_temporary_password, set_temporary_password
)
from .permission_model import READ_PERMISSIONS
from .services import (
    InputRejected, audit, clean_name, get_metadata_type,
    serialize_category, serialize_department, sync_metadata_lookups,
    user_display
)

User = get_user_model()


def paginate(queryset, page, page_size=ADMIN_PAGE_SIZE):
    count = queryset.count()
    start = (page - 1) * page_size
    return count, queryset[start:start + page_size]


def _unique_name(model, name, exclude_pk=None, field='name'):
    queryset = model.objects.filter(name__iexact=name)
    if exclude_pk:
        queryset = queryset.exclude(pk=exclude_pk)
    if queryset.exists():
        raise InputRejected(
            field=field, message='This name is already used.'
        )


def _rename_metadata_values(actor, metadata_name, old, new):
    """Rewrite stored metadata values, one by one, so Mayan records the
    event and re-indexes each document for search."""
    metadata_type = get_metadata_type(name=metadata_name)
    for entry in DocumentMetadata.objects.filter(
        metadata_type=metadata_type, value=old
    ):
        entry.value = new
        entry._event_actor = actor
        entry.save()


# ------------------------------------------------------------ departments

def list_departments():
    """All departments with their total document count (any access level).
    Only the count is exposed here, never confidential titles."""
    counts = dict(
        Department.objects.annotate(total=Count('classifications')).values_list(
            'pk', 'total'
        )
    )
    controllers = {}
    for assignment in ControllerAssignment.objects.select_related('user').order_by(
        'user__username'
    ):
        controllers.setdefault(assignment.department_id, []).append(
            user_display(assignment.user)
        )
    return [
        dict(
            serialize_department(department=department),
            controllers=controllers.get(department.pk, []),
            total_documents=counts.get(department.pk, 0)
        ) for department in Department.objects.all()
    ]


def _clean_icon(icon):
    if icon not in DEPARTMENT_ICONS:
        raise InputRejected(field='icon', message='Choose an icon from the list.')
    return icon


def create_department(actor, name, icon='folder', is_sample=False):
    name = clean_name(value=name)
    _unique_name(model=Department, name=name)
    last = Department.objects.order_by('-sort_order').first()
    with transaction.atomic():
        department = Department.objects.create(
            icon=_clean_icon(icon), is_sample=bool(is_sample), name=name,
            sort_order=(last.sort_order + 10) if last else 10
        )
        sync_metadata_lookups()
        audit(action='department.created', actor=actor, target=department)
    return department


def update_department(actor, department, name=None, icon=None, is_active=None, is_sample=None):
    changes = {}
    with transaction.atomic():
        department = Department.objects.select_for_update().get(pk=department.pk)
        if name is not None:
            name = clean_name(value=name)
            if name != department.name:
                _unique_name(model=Department, name=name, exclude_pk=department.pk)
                changes['name'] = [department.name, name]
        if icon is not None and icon != department.icon:
            changes['icon'] = [department.icon, _clean_icon(icon)]
            department.icon = icon
        if is_active is not None and bool(is_active) != department.is_active:
            changes['is_active'] = [department.is_active, bool(is_active)]
            department.is_active = bool(is_active)
        if is_sample is not None and bool(is_sample) != department.is_sample:
            changes['is_sample'] = [department.is_sample, bool(is_sample)]
            department.is_sample = bool(is_sample)
        if not changes:
            return department, changes
        if 'name' in changes:
            department.name = name
        department.save()
        if 'name' in changes:
            sync_metadata_lookups()
            # DocumentMetadata.save() does not re-check the lookup list, so
            # the stored values can be rewritten after the list changed.
            _rename_metadata_values(
                actor=actor, metadata_name=METADATA_TYPE_DEPARTMENT_NAME,
                new=name, old=changes['name'][0]
            )
        audit(
            action='department.changed', actor=actor, details=changes,
            target=department
        )
    return department, changes


def reorder_departments(actor, ids):
    existing = list(Department.objects.values_list('pk', flat=True))
    try:
        ids = [int(value) for value in ids]
    except (TypeError, ValueError):
        raise InputRejected(field='ids', message='Department IDs must be numbers.')
    if sorted(ids) != sorted(existing) or len(set(ids)) != len(ids):
        raise InputRejected(
            field='ids', message='Send every department exactly once.'
        )
    with transaction.atomic():
        for index, department_id in enumerate(ids):
            Department.objects.filter(pk=department_id).update(
                sort_order=(index + 1) * 10
            )
        AuditEntry.objects.create(
            action='department.reordered', actor=actor,
            details={'order': ids}, target_id=0, target_label='Departments',
            target_type='department'
        )


# ------------------------------------------------------------- categories

def list_categories():
    totals = dict(
        Category.objects.annotate(total=Count('classifications')).values_list(
            'pk', 'total'
        )
    )
    return [
        dict(serialize_category(category), total_documents=totals.get(category.pk, 0))
        for category in Category.objects.all()
    ]


def create_category(actor, name):
    name = clean_name(value=name)
    _unique_name(model=Category, name=name)
    with transaction.atomic():
        category = Category.objects.create(name=name)
        sync_metadata_lookups()
        audit(action='category.created', actor=actor, target=category)
    return category


def update_category(actor, category, name=None, is_active=None):
    changes = {}
    with transaction.atomic():
        category = Category.objects.select_for_update().get(pk=category.pk)
        if name is not None:
            name = clean_name(value=name)
            if name != category.name:
                _unique_name(model=Category, name=name, exclude_pk=category.pk)
                changes['name'] = [category.name, name]
        if is_active is not None and bool(is_active) != category.is_active:
            changes['is_active'] = [category.is_active, bool(is_active)]
            category.is_active = bool(is_active)
        if not changes:
            return category, changes
        if 'name' in changes:
            category.name = name
        category.save()
        if 'name' in changes:
            sync_metadata_lookups()
            _rename_metadata_values(
                actor=actor, metadata_name=METADATA_TYPE_CATEGORY_NAME,
                new=name, old=changes['name'][0]
            )
        audit(
            action='category.changed', actor=actor, details=changes,
            target=category
        )
    return category, changes


# ------------------------------------------------------------------ users

def manageable_users():
    return User.objects.filter(is_staff=False, is_superuser=False)


def serialize_user(user):
    group_names = set(user.groups.values_list('name', flat=True))
    return {
        'date_joined': user.date_joined.isoformat(),
        'confidential_groups': [
            {'id': group.pk, 'name': group.name}
            for group in ConfidentialAccessGroup.objects.filter(
                group__user=user
            )
        ],
        'controller_department_ids': sorted(
            ControllerAssignment.objects.filter(user=user).values_list(
                'department_id', flat=True
            )
        ),
        'department_ids': sorted(
            DepartmentAssignment.objects.filter(user=user).values_list(
                'department_id', flat=True
            )
        ),
        'email': user.email,
        'first_name': user.first_name,
        'full_name': user.get_full_name().strip() or user.username,
        'id': user.pk,
        'is_active': user.is_active,
        'is_administrator': GROUP_ADMINISTRATORS_NAME in group_names,
        'is_employee': GROUP_EMPLOYEES_NAME in group_names,
        'last_login': user.last_login.isoformat() if user.last_login else None,
        'last_name': user.last_name,
        'locked_out': is_user_locked(user=user),
        'must_change_password': PasswordState.objects.filter(
            user=user, must_change=True
        ).exists(),
        'username': user.username
    }


def list_users(page, query=''):
    queryset = manageable_users().order_by('username')
    query = (query or '').strip()[:QUERY_MAX_LENGTH]
    if query:
        queryset = queryset.filter(
            Q(username__icontains=query) | Q(first_name__icontains=query) |
            Q(last_name__icontains=query) | Q(email__icontains=query)
        )
    count, users = paginate(queryset=queryset, page=page)
    return {
        'count': count, 'page': page, 'page_size': ADMIN_PAGE_SIZE,
        'results': [serialize_user(user) for user in users]
    }


def get_manageable_user(user_id):
    try:
        return manageable_users().get(pk=int(user_id))
    except (User.DoesNotExist, TypeError, ValueError):
        return None


def _clean_ids(model, ids, field):
    if ids is None:
        return None
    try:
        ids = {int(value) for value in ids}
    except (TypeError, ValueError):
        raise InputRejected(field=field, message='IDs must be numbers.')
    queryset = model.objects.filter(pk__in=ids)
    found = set(queryset.values_list('pk', flat=True))
    if found != ids:
        raise InputRejected(field=field, message='Choose from the list.')
    return ids


def _set_assignments(model, user, ids):
    """Replace the user's assignments with `ids`. Returns [before, after]."""
    before = set(model.objects.filter(user=user).values_list('department_id', flat=True))
    if before == ids:
        return None
    model.objects.filter(user=user).exclude(department_id__in=ids).delete()
    for department_id in ids - before:
        model.objects.create(department_id=department_id, user=user)
    return [sorted(before), sorted(ids)]


def _set_group(user, name, value):
    group, created = Group.objects.get_or_create(name=name)
    has = user.groups.filter(pk=group.pk).exists()
    if bool(value) == has:
        return None
    if value:
        user.groups.add(group)
    else:
        user.groups.remove(group)
    return [has, bool(value)]


def _validate_new_assignment_ids(ids, field, user=None, model=None):
    """New assignments must be active departments; existing ones may stay."""
    if ids is None:
        return None
    ids = _clean_ids(model=Department, ids=ids, field=field)
    existing = set()
    if user is not None:
        existing = set(model.objects.filter(user=user).values_list('department_id', flat=True))
    inactive = set(
        Department.objects.filter(pk__in=ids - existing, is_active=False).values_list('pk', flat=True)
    )
    if inactive:
        raise InputRejected(field=field, message='Inactive departments cannot be assigned.')
    return ids


def create_user(
    actor, username, password, first_name='', last_name='', email='',
    is_employee=True, is_administrator=False, department_ids=(),
    controller_department_ids=()
):
    # Stored in lower case; unique ignoring case. Names, email and phone
    # are optional: a username and a temporary password are enough.
    username = clean_new_username(username)
    email = (email or '').strip()
    if email:
        try:
            validate_email(email)
        except ValidationError:
            raise InputRejected(field='email', message='Enter a valid email address.')
    password = clean_temporary_password(password=password)
    department_ids = _validate_new_assignment_ids(
        ids=department_ids or (), field='department_ids'
    )
    controller_department_ids = _validate_new_assignment_ids(
        ids=controller_department_ids or (), field='controller_department_ids'
    )

    try:
        with transaction.atomic():
            user = User.objects.create_user(
                email=email, first_name=(first_name or '').strip()[:150],
                last_name=(last_name or '').strip()[:150], password=None,
                username=username
            )
            set_temporary_password(
                actor=actor, password=password, reason=PASSWORD_REASON_CREATED,
                user=user
            )
            _set_group(user=user, name=GROUP_EMPLOYEES_NAME, value=is_employee)
            _set_group(user=user, name=GROUP_ADMINISTRATORS_NAME, value=is_administrator)
            _set_assignments(model=DepartmentAssignment, user=user, ids=department_ids)
            _set_assignments(model=ControllerAssignment, user=user, ids=controller_department_ids)
            audit(
                action='user.created', actor=actor, target=user,
                target_type='user', details={
                    'controller_department_ids': sorted(controller_department_ids),
                    'department_ids': sorted(department_ids),
                    'is_administrator': bool(is_administrator),
                    'is_employee': bool(is_employee)
                }
            )
    except IntegrityError:
        raise InputRejected(field='username', message='This username is already used.')
    return user


def update_user(
    actor, user, first_name=None, last_name=None, email=None, is_active=None,
    is_employee=None, is_administrator=None, department_ids=None,
    controller_department_ids=None
):
    if is_system_account(user):
        raise InputRejected(field='form', message='System accounts are managed elsewhere.')
    if user.pk == actor.pk:
        if is_active is False:
            raise InputRejected(field='is_active', message='You cannot deactivate your own account.')
        if is_administrator is False:
            raise InputRejected(
                field='is_administrator',
                message='You cannot remove your own administrator role.'
            )

    department_ids = _validate_new_assignment_ids(
        ids=department_ids, field='department_ids', model=DepartmentAssignment, user=user
    )
    controller_department_ids = _validate_new_assignment_ids(
        ids=controller_department_ids, field='controller_department_ids',
        model=ControllerAssignment, user=user
    )
    changes = {}
    with transaction.atomic():
        for field, value in (('first_name', first_name), ('last_name', last_name)):
            if value is not None:
                value = value.strip()[:150]
                if value != getattr(user, field):
                    changes[field] = [getattr(user, field), value]
                    setattr(user, field, value)
        if email is not None:
            email = email.strip()
            if email:
                try:
                    validate_email(email)
                except ValidationError:
                    raise InputRejected(field='email', message='Enter a valid email address.')
            if email != user.email:
                changes['email'] = [user.email, email]
                user.email = email
        if is_active is not None and bool(is_active) != user.is_active:
            changes['is_active'] = [user.is_active, bool(is_active)]
            user.is_active = bool(is_active)
        user.save()
        if changes.get('is_active') == [True, False]:
            # Ends every portal session of this user on the next request.
            Token.objects.filter(user=user).delete()

        for key, name, value in (
            ('is_employee', GROUP_EMPLOYEES_NAME, is_employee),
            ('is_administrator', GROUP_ADMINISTRATORS_NAME, is_administrator)
        ):
            if value is not None:
                change = _set_group(user=user, name=name, value=value)
                if change:
                    changes[key] = change
        if department_ids is not None:
            change = _set_assignments(model=DepartmentAssignment, user=user, ids=department_ids)
            if change:
                changes['department_ids'] = change
        if controller_department_ids is not None:
            change = _set_assignments(
                model=ControllerAssignment, user=user, ids=controller_department_ids
            )
            if change:
                changes['controller_department_ids'] = change
        if changes:
            audit(
                action='user.changed', actor=actor, details=changes,
                target=user, target_type='user'
            )
    return user, changes


# --------------------------------------------------- confidential groups

def serialize_confidential_group(group, include_members=False):
    data = {
        'document_type': group.document_type.label,
        'id': group.pk,
        'member_count': group.group.user_set.count(),
        'name': group.name
    }
    if include_members:
        data['members'] = [
            dict(user_display(user), is_active=user.is_active)
            for user in group.group.user_set.order_by('username')
        ]
    return data


def create_confidential_group(actor, name):
    name = clean_name(value=name)
    if len(name) > CONFIDENTIAL_GROUP_NAME_MAX_LENGTH:
        raise InputRejected(
            field='name', message='Use at most {} characters.'.format(
                CONFIDENTIAL_GROUP_NAME_MAX_LENGTH
            )
        )
    _unique_name(model=ConfidentialAccessGroup, name=name)
    mayan_name = '{}{}'.format(CONFIDENTIAL_GROUP_PREFIX, name)
    if (
        DocumentType.objects.filter(label=mayan_name).exists() or
        Role.objects.filter(label=mayan_name).exists() or
        Group.objects.filter(name=mayan_name).exists()
    ):
        raise InputRejected(field='name', message='This name is already used.')

    with transaction.atomic():
        document_type = DocumentType.objects.create(label=mayan_name)
        # bulk_create: no post_save signal. Mayan's handler would queue a task
        # (before this transaction commits) to add metadata to existing
        # documents of the type; a new type has none, and the early task
        # only logged "DocumentType matching query does not exist".
        DocumentTypeMetadataType.objects.bulk_create([
            DocumentTypeMetadataType(
                document_type=document_type,
                metadata_type=get_metadata_type(name=metadata_name),
                required=True
            ) for metadata_name in (
                METADATA_TYPE_DEPARTMENT_NAME, METADATA_TYPE_CATEGORY_NAME
            )
        ])
        role = Role.objects.create(label=mayan_name)
        group = Group.objects.create(name=mayan_name)
        role.groups.add(group)
        for permission in READ_PERMISSIONS:
            AccessControlList.objects.grant(
                obj=document_type, permission=permission, role=role
            )
        access_group = ConfidentialAccessGroup.objects.create(
            document_type=document_type, group=group, name=name, role=role
        )
        audit(
            action='confidential_group.created', actor=actor,
            target=access_group, target_type='confidential_group'
        )
    return access_group


def rename_confidential_group(actor, access_group, name):
    """Changes the display name only; the Mayan objects keep their labels."""
    name = clean_name(value=name)
    if name == access_group.name:
        return access_group
    _unique_name(model=ConfidentialAccessGroup, name=name, exclude_pk=access_group.pk)
    with transaction.atomic():
        old = access_group.name
        access_group.name = name
        access_group.save()
        audit(
            action='confidential_group.renamed', actor=actor,
            details={'name': [old, name]}, target=access_group,
            target_type='confidential_group'
        )
    return access_group


def set_confidential_membership(actor, access_group, user, value):
    if is_system_account(user):
        raise InputRejected(field='user_id', message='System accounts are managed elsewhere.')
    with transaction.atomic():
        has = access_group.group.user_set.filter(pk=user.pk).exists()
        if has == bool(value):
            return False
        if value:
            access_group.group.user_set.add(user)
        else:
            access_group.group.user_set.remove(user)
        audit(
            action='confidential_group.member_added' if value
            else 'confidential_group.member_removed',
            actor=actor, details={'user': user.username}, target=access_group,
            target_type='confidential_group'
        )
    return True


# -------------------------------------------------------------- documents

def set_responsible_person(actor, document, user):
    """
    Transfer responsibility for a document (audited). The original uploader
    (PortalUpload) is never changed.
    """
    if is_system_account(user):
        raise InputRejected(field='user_id', message='Choose an employee account.')
    with transaction.atomic():
        current = DocumentResponsibility.objects.select_for_update().filter(
            document=document
        ).select_related('person').first()
        upload = PortalUpload.objects.filter(document=document).select_related('uploader').first()
        before = current.person if current else (upload.uploader if upload else None)
        if before is not None and before.pk == user.pk:
            return False
        DocumentResponsibility.objects.update_or_create(
            document=document, defaults={'assigned_by': actor, 'person': user}
        )
        audit(
            action='document.responsible_changed', actor=actor,
            details={'responsible': [before.username if before else None, user.username]},
            target=document
        )
    return True


def reclassify_document(actor, document, access_group):
    """
    Move a document into a confidential group (from general, or from another
    group). The caller has checked that `actor` is an administrator AND can
    currently view the document. Confidential-to-general release is not
    supported.

    One UPDATE of the document type inside a transaction: before the commit
    the old audience has access, after it only the new group does. There is
    no moment in which the document is general or readable by both groups
    beyond that single switch.
    """
    target_type = access_group.document_type
    if document.document_type_id == target_type.pk:
        return False
    needed = {
        get_metadata_type(name=METADATA_TYPE_DEPARTMENT_NAME).pk,
        get_metadata_type(name=METADATA_TYPE_CATEGORY_NAME).pk
    }
    linked = set(
        DocumentTypeMetadataType.objects.filter(document_type=target_type).values_list(
            'metadata_type_id', flat=True
        )
    )
    if not needed <= linked:
        # Mayan would delete the department/category values. Refuse.
        raise InputRejected(
            field='confidential_group',
            message='This group is not set up correctly. Ask IT to run recafco_setup.'
        )
    with transaction.atomic():
        document = Document.objects.select_for_update().get(pk=document.pk)
        before = document.document_type.label
        document._document_type_change(document_type=target_type, user=actor)
        audit(
            action='document.reclassified', actor=actor,
            details={'access': [before, target_type.label], 'group': access_group.name},
            target=document
        )
    return True


def get_audit_entries(page, target_type=None, target_id=None):
    queryset = AuditEntry.objects.select_related('actor')
    if target_type:
        queryset = queryset.filter(target_type=target_type)
    if target_id is not None:
        queryset = queryset.filter(target_id=target_id)
    return paginate(queryset=queryset, page=page)
