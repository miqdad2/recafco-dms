"""
Unit 5: full administrator control (delete, merge, recycle bin, roles,
confidential group deletion). This supersedes the Unit 2/3 rules "nothing is
deleted" and "administrators need confidential-group membership".

Every operation:
- is authorized by the caller (app_permissions) before it is called, and
  document operations are limited to documents the actor can open through
  Mayan's ACLs (System Administrators can open every RECAFCO document);
- re-reads and locks its rows inside a transaction, so concurrent changes
  are detected instead of overwritten;
- is recorded in the activity log with the outcome. A failure is recorded
  as "failed" after the rollback, so the log is truthful;
- never deletes document files as a side effect: documents are moved, sent
  to the recycle bin, or (only from the recycle bin) permanently deleted by
  an explicit action, which verifies the stored files are gone.
"""
import logging
from contextlib import contextmanager

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q, ProtectedError
from django.http import Http404

from rest_framework.authtoken.models import Token

from mayan.apps.acls.models import AccessControlList
from mayan.apps.documents.models.document_models import Document
from mayan.apps.documents.models.trashed_document_models import TrashedDocument
from mayan.apps.documents.permissions import permission_document_view

from .access import is_system_account
from .app_permissions import (
    GRANTABLE_PERMISSIONS, SYSTEM_ADMINISTRATOR_KEY, has_app_permission,
    is_system_admin
)
from .literals import (
    CONFIDENTIAL_GROUP_ORIGINAL_NAME, GROUP_ADMINISTRATORS_NAME,
    GROUP_CONTROLLERS_NAME, METADATA_TYPE_CATEGORY_NAME,
    METADATA_TYPE_DEPARTMENT_NAME, ROLE_CONTROLLERS_LABEL
)
from .models import (
    AppRole, AuditEntry, Category, ConfidentialAccessGroup,
    ControllerAssignment, Department, DepartmentAssignment,
    DocumentClassification, DocumentResponsibility, PortalUpload
)
from .services import (
    InputRejected, _set_metadata_value, audit, clean_name,
    get_document_type_general, sync_metadata_lookups
)

logger = logging.getLogger(name=__name__)
User = get_user_model()

REASON_MAX_LENGTH = 500
BULK_MAXIMUM = 200


def clean_reason(value):
    return ' '.join(str(value or '').split())[:REASON_MAX_LENGTH]


@contextmanager
def recorded(actor, action, target_type, target_id, target_label, reason='', details=None):
    """
    Records a failed operation in the activity log (outcome "failed") after
    its transaction rolled back. Validation and permission refusals are not
    operations and are not logged as failures.
    """
    try:
        yield
    except (InputRejected, PermissionDenied, Http404):
        raise
    except Exception as exception:
        logger.exception('Administrator operation %s failed.', action)
        try:
            AuditEntry.objects.create(
                action=action, actor=actor, details=dict(details or {}, error=str(exception)[:500]),
                outcome=AuditEntry.OUTCOME_FAILED, reason=reason, target_id=target_id or 0,
                target_label=str(target_label)[:255], target_type=target_type
            )
        except Exception:
            logger.exception('Could not record the failed operation.')
        raise


# ------------------------------------------------------------- documents

def admin_documents(user, trashed=None):
    """Documents (optionally only trashed / not trashed) the user can open."""
    queryset = Document.objects.filter(is_stub=False)
    if trashed is True:
        queryset = queryset.filter(in_trash=True)
    elif trashed is False:
        queryset = queryset.filter(in_trash=False)
    return AccessControlList.objects.restrict_queryset(
        permission=permission_document_view, queryset=queryset, user=user
    )


def get_admin_document(user, document_id, trashed=None):
    try:
        return admin_documents(user=user, trashed=trashed).get(pk=int(document_id))
    except (Document.DoesNotExist, TypeError, ValueError):
        raise Http404


def _reclassify(actor, document, department=None, category=None):
    """Set department and/or category: classification record and the Mayan
    metadata values change together (search re-indexes on metadata save)."""
    classification, created = DocumentClassification.objects.select_for_update().get_or_create(
        document=document, defaults={'category': category, 'department': department}
    )
    changes = {}
    if department is not None and classification.department_id != department.pk:
        changes['department'] = [
            classification.department.name if classification.department else None, department.name
        ]
        classification.department = department
        _set_metadata_value(
            actor=actor, document=document, metadata_name=METADATA_TYPE_DEPARTMENT_NAME,
            value=department.name
        )
    if category is not None and classification.category_id != category.pk:
        changes['category'] = [
            classification.category.name if classification.category else None, category.name
        ]
        classification.category = category
        _set_metadata_value(
            actor=actor, document=document, metadata_name=METADATA_TYPE_CATEGORY_NAME,
            value=category.name
        )
    if changes or created:
        classification.save()
    return changes


def move_document(actor, document, department=None, category=None, reason=''):
    if department is not None and not department.is_active:
        raise InputRejected(field='department_id', message='Choose an active department.')
    if category is not None and not category.is_active:
        raise InputRejected(field='category_id', message='Choose an active category.')
    with recorded(actor, 'document.moved', 'document', document.pk, document.label, reason):
        with transaction.atomic():
            document = Document.objects.select_for_update().get(pk=document.pk)
            changes = _reclassify(actor=actor, document=document, department=department, category=category)
            if changes:
                audit(action='document.moved', actor=actor, details=changes, reason=reason, target=document)
    return changes


def set_document_access(actor, document, access_group, reason=''):
    """
    General (access_group None) or a confidential group. One change of the
    Mayan document type inside a transaction: there is no moment in which
    both audiences can open it. Superseding Unit 3, confidential documents
    may be made general again, but only by this explicit action.
    """
    if access_group is not None and not access_group.is_active:
        raise InputRejected(field='confidential_group', message='This confidential group is deactivated.')
    target_type = access_group.document_type if access_group else get_document_type_general()
    if document.document_type_id == target_type.pk:
        return False
    with recorded(actor, 'document.access_changed', 'document', document.pk, document.label, reason):
        with transaction.atomic():
            document = Document.objects.select_for_update().get(pk=document.pk)
            before = document.document_type.label
            document._document_type_change(document_type=target_type, user=actor)
            audit(
                action='document.access_changed', actor=actor, reason=reason, target=document,
                details={
                    'access': [before, target_type.label],
                    'group': access_group.name if access_group else None
                }
            )
    return True


def trash_document(actor, document, reason=''):
    if document.in_trash:
        return False
    with recorded(actor, 'document.trashed', 'document', document.pk, document.label, reason):
        with transaction.atomic():
            document = Document.objects.select_for_update().get(pk=document.pk)
            if document.in_trash:
                return False
            document._event_actor = actor
            document.delete()
            audit(action='document.trashed', actor=actor, reason=reason, target=document)
    return True


def restore_document(actor, document, reason=''):
    if not document.in_trash:
        return False
    with recorded(actor, 'document.restored', 'document', document.pk, document.label, reason):
        with transaction.atomic():
            trashed = TrashedDocument.objects.select_for_update().get(pk=document.pk)
            trashed.restore(user=actor)
            classification = DocumentClassification.objects.filter(document_id=document.pk).first()
            details = {}
            if classification is None or classification.department_id is None or classification.category_id is None:
                details['needs_classification'] = True
            audit(action='document.restored', actor=actor, details=details, reason=reason, target=document)
    return True


def _stored_files(document):
    names = []
    for document_file in document.files.all():
        names.append((document_file.file.storage, document_file.file.name))
    return names


def purge_document(actor, document, reason=''):
    """
    Permanently delete a document from the recycle bin: its files in
    storage, its file and version page caches, all versions and records.
    Returns only after the stored files are confirmed gone.
    """
    if not document.in_trash:
        raise InputRejected(
            field='form', message='Move the document to the recycle bin first. Only documents in the recycle bin can be deleted permanently.'
        )
    label = document.label
    document_id = document.pk
    with recorded(actor, 'document.purged', 'document', document_id, label, reason):
        with transaction.atomic():
            document = Document.objects.select_for_update().get(pk=document_id)
            files = _stored_files(document)
            # Delete versions one by one so each clears its page-image cache
            # (a cascading delete would skip DocumentVersion.delete()).
            for version in document.versions.all():
                version.delete()
            document._event_actor = actor
            document.delete(to_trash=False)
            # The instance has no primary key any more: log by the saved ID.
            AuditEntry.objects.create(
                action='document.purged', actor=actor, reason=reason,
                details={'files_deleted': len(files)}, target_id=document_id,
                target_label=label[:255], target_type='document'
            )
        remaining = [name for storage, name in files if storage.exists(name)]
        if remaining:
            raise RuntimeError(
                'The document records were deleted but {} stored file(s) could not be removed.'.format(len(remaining))
            )
    return True


def set_responsible(actor, document, person, reason=''):
    with recorded(actor, 'document.responsible_changed', 'document', document.pk, document.label, reason):
        with transaction.atomic():
            current = DocumentResponsibility.objects.select_for_update().filter(document=document).select_related('person').first()
            upload = PortalUpload.objects.filter(document=document).first()
            before = current.person.username if current else (upload.uploader_username if upload else None)
            if before == person.username:
                return False
            DocumentResponsibility.objects.update_or_create(
                document=document, defaults={'assigned_by': actor, 'person': person}
            )
            audit(
                action='document.responsible_changed', actor=actor, reason=reason, target=document,
                details={'responsible': [before, person.username]}
            )
    return True


BULK_ACTIONS = {
    # action: required application permission, documents in recycle bin?
    'move': ('documents.manage', False),
    'responsible': ('documents.manage', False),
    'access': ('documents.manage', False),
    'trash': ('documents.recycle', False),
    'restore': ('documents.recycle', True),
    'purge': ('documents.purge', True),
}


def bulk_documents(actor, action, ids, department=None, category=None, person=None,
                   access_group=None, make_general=False, reason=''):
    """
    Apply one action to many documents. Each document is its own transaction
    and gets its own result, so a failure or a concurrent change affects
    only that document. Documents the actor cannot open are "not found".
    """
    if action not in BULK_ACTIONS:
        raise InputRejected(field='action', message='Unknown action.')
    permission, in_trash = BULK_ACTIONS[action]
    if not has_app_permission(user=actor, permission=permission):
        raise PermissionDenied
    try:
        ids = sorted({int(value) for value in ids})
    except (TypeError, ValueError):
        raise InputRejected(field='ids', message='Document IDs must be numbers.')
    if not ids:
        raise InputRejected(field='ids', message='Select at least one document.')
    if len(ids) > BULK_MAXIMUM:
        raise InputRejected(field='ids', message='Select at most {} documents at a time.'.format(BULK_MAXIMUM))
    if action == 'move' and department is None and category is None:
        raise InputRejected(field='department_id', message='Choose a department or a category.')
    if action == 'responsible' and person is None:
        raise InputRejected(field='user_id', message='Choose a person.')
    if action == 'access' and access_group is None and not make_general:
        raise InputRejected(field='confidential_group', message='Choose general access or a confidential group.')

    reason = clean_reason(reason)
    visible = {d.pk: d for d in admin_documents(user=actor, trashed=in_trash).filter(pk__in=ids)}
    results = []
    for document_id in ids:
        document = visible.get(document_id)
        if document is None:
            results.append({'id': document_id, 'ok': False, 'error': 'Not found or not available for this action.'})
            continue
        try:
            if action == 'move':
                changed = bool(move_document(actor, document, department, category, reason))
            elif action == 'responsible':
                changed = set_responsible(actor, document, person, reason)
            elif action == 'access':
                changed = set_document_access(actor, document, None if make_general else access_group, reason)
            elif action == 'trash':
                changed = trash_document(actor, document, reason)
            elif action == 'restore':
                changed = restore_document(actor, document, reason)
            else:
                changed = purge_document(actor, document, reason)
            results.append({'id': document_id, 'ok': True, 'changed': bool(changed)})
        except InputRejected as exception:
            results.append({'id': document_id, 'ok': False, 'error': exception.message})
        except Exception as exception:  # recorded as failed by recorded()
            results.append({'id': document_id, 'ok': False, 'error': str(exception)[:300]})
    return {
        'action': action, 'results': results,
        'succeeded': sum(1 for r in results if r['ok']),
        'failed': sum(1 for r in results if not r['ok'])
    }


# ----------------------------------------------------------- departments

def department_usage(department):
    documents = Document.objects.filter(recafco_classification__department=department)
    return {
        'documents': documents.filter(in_trash=False).count(),
        'documents_in_recycle_bin': documents.filter(in_trash=True).count(),
        'members': DepartmentAssignment.objects.filter(department=department).count(),
        'controllers': ControllerAssignment.objects.filter(department=department).count(),
    }


def delete_department(actor, department, mode=None, target=None, reason=''):
    """
    mode None: only when the department has no documents at all.
    mode "move": every document (including those in the recycle bin) moves
      to `target`, then the department is deleted (this is also "merge").
    mode "trash": its active documents go to the recycle bin; documents in
      the recycle bin keep the old name in their metadata and have no
      department until restored and reassigned. Files are never deleted.
    Member and controller assignments of the department are removed.
    """
    reason = clean_reason(reason)
    if mode not in (None, 'move', 'trash'):
        raise InputRejected(field='mode', message='Choose what happens to the documents.')
    if mode == 'move':
        if target is None or target.pk == department.pk:
            raise InputRejected(field='target_id', message='Choose another department to move the documents to.')
        if not target.is_active:
            raise InputRejected(field='target_id', message='Choose an active department.')
    with recorded(actor, 'department.deleted', 'department', department.pk, department.name, reason):
        with transaction.atomic():
            department = Department.objects.select_for_update().get(pk=department.pk)
            usage = department_usage(department)
            documents = list(Document.objects.filter(recafco_classification__department=department))
            if documents and mode is None:
                raise InputRejected(
                    field='mode', message='This department has {} document(s) ({} in the recycle bin). Choose what happens to them.'.format(
                        usage['documents'] + usage['documents_in_recycle_bin'], usage['documents_in_recycle_bin']
                    )
                )
            for document in documents:
                if mode == 'move':
                    _reclassify(actor=actor, document=document, department=target)
                else:
                    if not document.in_trash:
                        document._event_actor = actor
                        document.delete()
                    DocumentClassification.objects.filter(document=document).update(department=None)
            DepartmentAssignment.objects.filter(department=department).delete()
            ControllerAssignment.objects.filter(department=department).delete()
            name = department.name
            department_id = department.pk
            department.delete()
            sync_metadata_lookups()
            AuditEntry.objects.create(
                action='department.merged' if mode == 'move' else 'department.deleted', actor=actor,
                details=dict(usage, mode=mode, target=target.name if target else None),
                reason=reason, target_id=department_id, target_label=name, target_type='department'
            )
    return usage


def delete_category(actor, category, target=None, reason=''):
    """Documents of the category (including the recycle bin) must be
    reassigned to `target` first; then the category is deleted (merge)."""
    reason = clean_reason(reason)
    if target is not None:
        if target.pk == category.pk:
            raise InputRejected(field='target_id', message='Choose another category.')
        if not target.is_active:
            raise InputRejected(field='target_id', message='Choose an active category.')
    with recorded(actor, 'category.deleted', 'category', category.pk, category.name, reason):
        with transaction.atomic():
            category = Category.objects.select_for_update().get(pk=category.pk)
            documents = list(Document.objects.filter(recafco_classification__category=category))
            if documents and target is None:
                raise InputRejected(
                    field='target_id', message='{} document(s) use this category. Choose the category they move to.'.format(len(documents))
                )
            for document in documents:
                _reclassify(actor=actor, document=document, category=target)
            name = category.name
            category_id = category.pk
            category.delete()
            sync_metadata_lookups()
            AuditEntry.objects.create(
                action='category.merged' if documents else 'category.deleted', actor=actor,
                details={'documents': len(documents), 'target': target.name if target else None},
                reason=reason, target_id=category_id, target_label=name, target_type='category'
            )
    return len(documents)


# ----------------------------------------------------------------- users

def active_system_admins():
    return User.objects.filter(
        groups__name=GROUP_ADMINISTRATORS_NAME, is_active=True, is_staff=False, is_superuser=False
    ).distinct()


def ensure_not_last_admin(user, field='form'):
    if is_system_admin(user) and not active_system_admins().exclude(pk=user.pk).exists():
        raise InputRejected(
            field=field, message='This is the last active System Administrator. Make someone else a System Administrator first.'
        )


def ensure_may_manage(actor, user):
    """users.manage holders may not change System Administrators."""
    if is_system_account(user):
        raise InputRejected(field='form', message='System accounts are managed elsewhere.')
    if is_system_admin(user) and not is_system_admin(actor):
        raise PermissionDenied


def user_usage(user):
    return {
        'uploaded_documents': PortalUpload.objects.filter(uploader=user).count(),
        'responsible_for': DocumentResponsibility.objects.filter(person=user).count(),
        'activity_entries': AuditEntry.objects.filter(actor=user).count(),
    }


def delete_user(actor, user, transfer_to=None, reason=''):
    """
    Delete an account. Documents stay; the uploader name and the activity
    log keep the deleted person's name (snapshots). Responsibilities move to
    `transfer_to` when given (including documents the person uploaded),
    otherwise they fall back to each document's original uploader.
    Sessions end immediately: the API token and the account are gone.
    """
    reason = clean_reason(reason)
    ensure_may_manage(actor, user)
    if user.pk == actor.pk:
        raise InputRejected(field='form', message='You cannot delete your own account.')
    ensure_not_last_admin(user)
    if transfer_to is not None and (transfer_to.pk == user.pk or not transfer_to.is_active):
        raise InputRejected(field='transfer_to', message='Choose another active person.')
    username = user.username
    user_id = user.pk
    with recorded(actor, 'user.deleted', 'user', user_id, username, reason):
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=user_id)
            usage = user_usage(user)
            transferred = 0
            if transfer_to is not None:
                document_ids = set(
                    DocumentResponsibility.objects.filter(person=user).values_list('document_id', flat=True)
                ) | set(
                    PortalUpload.objects.filter(uploader=user).exclude(
                        document__recafco_responsibility__isnull=False
                    ).values_list('document_id', flat=True)
                )
                for document_id in document_ids:
                    DocumentResponsibility.objects.update_or_create(
                        document_id=document_id, defaults={'assigned_by': actor, 'person': transfer_to}
                    )
                transferred = len(document_ids)
            Token.objects.filter(user=user).delete()
            try:
                user.delete()
            except ProtectedError as exception:
                raise InputRejected(
                    field='form', message='Mayan still references this account ({}). Nothing was deleted.'.format(
                        ', '.join(sorted({obj._meta.verbose_name.title() for obj in exception.protected_objects}))[:200]
                    )
                )
            AuditEntry.objects.create(
                action='user.deleted', actor=actor, reason=reason, target_id=user_id, target_label=username,
                target_type='user', details=dict(
                    usage, transferred_to=transfer_to.username if transfer_to else None,
                    transferred_documents=transferred
                )
            )
    return usage


# ----------------------------------------------------------------- roles

def serialize_role(role):
    system = role.system_key == SYSTEM_ADMINISTRATOR_KEY
    if system:
        members = User.objects.filter(groups__name=GROUP_ADMINISTRATORS_NAME).order_by('username')
        permissions = sorted(GRANTABLE_PERMISSIONS) + ['roles.manage']
    else:
        members = role.users.order_by('username')
        permissions = sorted(role.permissions or [])
    return {
        'id': role.pk, 'name': role.name, 'description': role.description,
        'permissions': permissions, 'is_protected': system,
        'member_count': members.count(),
        'members': [
            {'id': u.pk, 'username': u.username, 'full_name': u.get_full_name().strip() or u.username, 'is_active': u.is_active}
            for u in members[:500]
        ],
    }


def _clean_permissions(values):
    if not isinstance(values, list):
        raise InputRejected(field='permissions', message='Choose permissions from the list.')
    unknown = [value for value in values if value not in GRANTABLE_PERMISSIONS]
    if unknown:
        raise InputRejected(field='permissions', message='These permissions cannot be granted: {}.'.format(', '.join(map(str, unknown))))
    return sorted(set(values))


def save_role(actor, role=None, name=None, description=None, permissions=None):
    if not is_system_admin(actor):
        raise PermissionDenied
    if role is not None and role.system_key:
        raise InputRejected(field='form', message='The System Administrator role is protected and cannot be changed.')
    changes = {}
    with transaction.atomic():
        if role is None:
            name = clean_name(value=name)
            if AppRole.objects.filter(name__iexact=name).exists():
                raise InputRejected(field='name', message='This name is already used.')
            role = AppRole.objects.create(
                description=(description or '').strip()[:255], name=name,
                permissions=_clean_permissions(permissions or [])
            )
            audit(action='role.created', actor=actor, details={'permissions': role.permissions}, target=role, target_type='role')
            return role, {'created': True}
        role = AppRole.objects.select_for_update().get(pk=role.pk)
        if name is not None:
            name = clean_name(value=name)
            if name != role.name:
                if AppRole.objects.filter(name__iexact=name).exclude(pk=role.pk).exists():
                    raise InputRejected(field='name', message='This name is already used.')
                changes['name'] = [role.name, name]
                role.name = name
        if description is not None and description.strip() != role.description:
            changes['description'] = [role.description, description.strip()[:255]]
            role.description = description.strip()[:255]
        if permissions is not None:
            cleaned = _clean_permissions(permissions)
            if cleaned != sorted(role.permissions or []):
                changes['permissions'] = [sorted(role.permissions or []), cleaned]
                role.permissions = cleaned
        if changes:
            role.save()
            audit(action='role.changed', actor=actor, details=changes, target=role, target_type='role')
    return role, changes


def delete_role(actor, role, reason=''):
    if not is_system_admin(actor):
        raise PermissionDenied
    if role.system_key:
        raise InputRejected(field='form', message='The System Administrator role is protected and cannot be deleted.')
    with transaction.atomic():
        role = AppRole.objects.select_for_update().get(pk=role.pk)
        members = list(role.users.values_list('username', flat=True))
        name, role_id = role.name, role.pk
        role.delete()
        AuditEntry.objects.create(
            action='role.deleted', actor=actor, details={'members': members}, reason=clean_reason(reason),
            target_id=role_id, target_label=name, target_type='role'
        )
    return len(members)


def set_user_roles(actor, user, role_ids, system_administrator=None):
    """
    Assign application roles (and System Administrator membership). Only
    System Administrators may do this: it grants administrative authority.
    """
    if not is_system_admin(actor):
        raise PermissionDenied
    ensure_may_manage(actor, user)
    changes = {}
    with transaction.atomic():
        if role_ids is not None:
            try:
                wanted = {int(value) for value in role_ids}
            except (TypeError, ValueError):
                raise InputRejected(field='role_ids', message='Role IDs must be numbers.')
            roles = AppRole.objects.filter(pk__in=wanted, system_key__isnull=True)
            if roles.count() != len(wanted):
                raise InputRejected(field='role_ids', message='Choose roles from the list.')
            before = sorted(user.recafco_app_roles.filter(system_key__isnull=True).values_list('name', flat=True))
            current = set(user.recafco_app_roles.filter(system_key__isnull=True).values_list('pk', flat=True))
            if current != wanted:
                for role in AppRole.objects.filter(pk__in=current - wanted):
                    role.users.remove(user)
                for role in roles.filter(pk__in=wanted - current):
                    role.users.add(user)
                changes['roles'] = [before, sorted(roles.values_list('name', flat=True))]
        if system_administrator is not None:
            group, created = Group.objects.get_or_create(name=GROUP_ADMINISTRATORS_NAME)
            has = user.groups.filter(pk=group.pk).exists()
            if bool(system_administrator) != has:
                if not system_administrator:
                    if user.pk == actor.pk:
                        raise InputRejected(field='is_administrator', message='You cannot remove your own System Administrator role.')
                    ensure_not_last_admin(user, field='is_administrator')
                    user.groups.remove(group)
                else:
                    user.groups.add(group)
                changes['system_administrator'] = [has, bool(system_administrator)]
        if changes:
            audit(action='user.roles_changed', actor=actor, details=changes, target=user, target_type='user')
    return changes


# --------------------------------------------------- confidential groups

def is_builtin_group(access_group):
    return access_group.name == CONFIDENTIAL_GROUP_ORIGINAL_NAME or access_group.group.name == GROUP_CONTROLLERS_NAME


def confidential_group_usage(access_group):
    documents = Document.objects.filter(document_type=access_group.document_type)
    return {
        'documents': documents.filter(in_trash=False).count(),
        'documents_in_recycle_bin': documents.filter(in_trash=True).count(),
        'members': access_group.group.user_set.count(),
    }


def set_confidential_group_active(actor, access_group, value, reason=''):
    with transaction.atomic():
        access_group = ConfidentialAccessGroup.objects.select_for_update().get(pk=access_group.pk)
        if access_group.is_active == bool(value):
            return False
        access_group.is_active = bool(value)
        access_group.save()
        audit(
            action='confidential_group.activated' if value else 'confidential_group.deactivated',
            actor=actor, reason=clean_reason(reason), target=access_group, target_type='confidential_group'
        )
    return True


def delete_confidential_group(actor, access_group, mode=None, target=None, reason=''):
    """
    mode None: only when the group has no documents (none in the recycle bin
      either: deleting a Mayan document type deletes its documents).
    mode "move": every document (including the recycle bin) moves to the
      `target` confidential group first.
    mode "purge": its documents are permanently deleted (explicit decision,
      cannot be undone). Documents are never made general by this.
    Then the group's ACLs, Mayan role, members group and document type go.
    The built-in original group shares the controllers' role and is not
    deletable (it can be renamed or deactivated).
    """
    reason = clean_reason(reason)
    if is_builtin_group(access_group):
        raise InputRejected(
            field='form', message='The built-in original confidential group cannot be deleted. Rename or deactivate it instead.'
        )
    if mode not in (None, 'move', 'purge'):
        raise InputRejected(field='mode', message='Choose what happens to the documents.')
    if mode == 'move':
        if target is None or target.pk == access_group.pk:
            raise InputRejected(field='target_id', message='Choose another confidential group.')
        if not target.is_active:
            raise InputRejected(field='target_id', message='Choose an active confidential group.')
    usage = confidential_group_usage(access_group)
    total = usage['documents'] + usage['documents_in_recycle_bin']
    if total and mode is None:
        raise InputRejected(
            field='mode', message='This group has {} document(s) ({} in the recycle bin). Move them to another confidential group or delete them permanently.'.format(
                total, usage['documents_in_recycle_bin']
            )
        )
    name, group_id = access_group.name, access_group.pk
    with recorded(actor, 'confidential_group.deleted', 'confidential_group', group_id, name, reason):
        documents = list(Document.objects.filter(document_type=access_group.document_type))
        if mode == 'move':
            with transaction.atomic():
                for document in documents:
                    document = Document.objects.select_for_update().get(pk=document.pk)
                    document._document_type_change(document_type=target.document_type, user=actor)
        elif mode == 'purge':
            for document in documents:
                if not document.in_trash:
                    trash_document(actor, document, reason)
                    document.refresh_from_db()
                purge_document(actor, document, reason)
        with transaction.atomic():
            access_group = ConfidentialAccessGroup.objects.select_for_update().get(pk=group_id)
            if Document.objects.filter(document_type=access_group.document_type).exists():
                raise InputRejected(field='form', message='Documents were added to this group meanwhile. Nothing was deleted; try again.')
            document_type, role, group = access_group.document_type, access_group.role, access_group.group
            access_group.delete()
            AccessControlList.objects.filter(
                content_type__model='documenttype', object_id=document_type.pk
            ).delete()
            document_type.delete()
            if role.label != ROLE_CONTROLLERS_LABEL:
                role.delete()
            if group.name not in (GROUP_CONTROLLERS_NAME, GROUP_ADMINISTRATORS_NAME):
                group.delete()
            AuditEntry.objects.create(
                action='confidential_group.deleted', actor=actor, reason=reason, target_id=group_id,
                target_label=name, target_type='confidential_group',
                details=dict(usage, mode=mode, target=target.name if target else None)
            )
    return usage


# --------------------------------------------------------------- activity

def filter_audit_entries(params):
    queryset = AuditEntry.objects.all()
    q = (params.get('q') or '').strip()[:200]
    if q:
        queryset = queryset.filter(
            Q(target_label__icontains=q) | Q(actor_username__icontains=q) |
            Q(actor_full_name__icontains=q) | Q(action__icontains=q) | Q(reason__icontains=q)
        )
    for field, name in (('action', 'action'), ('target_type', 'target_type'), ('outcome', 'outcome')):
        value = (params.get(name) or '').strip()
        if value:
            queryset = queryset.filter(**{field: value[:64]})
    actor = (params.get('actor') or '').strip()
    if actor:
        queryset = queryset.filter(actor_username__iexact=actor[:150])
    for name, lookup in (('date_from', 'datetime_created__date__gte'), ('date_to', 'datetime_created__date__lte')):
        value = (params.get(name) or '').strip()
        if value:
            try:
                from datetime import date
                queryset = queryset.filter(**{lookup: date.fromisoformat(value[:10])})
            except ValueError:
                raise InputRejected(field=name, message='Use a date like 2026-11-30.')
    return queryset

