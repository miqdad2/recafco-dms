"""
RECAFCO application permissions and roles (Unit 5).

- System Administrator: members of the "RECAFCO Administrators" group. Every
  application permission, plus the system-only ones below. Through a Mayan
  role with ACLs on every RECAFCO document type, they can open every general
  and confidential document (see permission_model.py).
- Application roles (AppRole): named sets of the GRANTABLE permissions,
  created by System Administrators and assigned to users. They give access
  to parts of the administration area only; they never give document access
  by themselves (document operations apply only to documents the person can
  already open through Mayan's ACLs).
- Only System Administrators can manage roles or give anyone administrative
  authority (assign roles, make someone a System Administrator). These are
  not grantable, so a custom role can never escalate itself.

Every check runs on the server for every request; the portal's menus only
mirror them.
"""
from rest_framework.permissions import BasePermission

from .literals import GROUP_ADMINISTRATORS_NAME

SYSTEM_ADMINISTRATOR_KEY = 'system_administrator'

# Grantable to application roles: key -> (label, description).
GRANTABLE_PERMISSIONS = {
    'departments.manage': (
        'Manage departments',
        'Create, rename, reorder, activate, merge and delete departments.'
    ),
    'categories.manage': (
        'Manage categories',
        'Create, rename, activate, merge and delete categories.'
    ),
    'users.manage': (
        'Manage user accounts',
        'Create, edit, deactivate, delete and reset passwords of accounts '
        'that are not System Administrators. Cannot assign roles.'
    ),
    'confidential_groups.manage': (
        'Manage confidential groups',
        'Create, rename, deactivate and delete groups and change members.'
    ),
    'documents.manage': (
        'Manage documents',
        'Edit details, move, transfer responsibility and change access of '
        'documents the person can open.'
    ),
    'documents.recycle': (
        'Recycle bin',
        'Move documents the person can open to the recycle bin and restore them.'
    ),
    'documents.purge': (
        'Permanently delete documents',
        'Delete documents and their files permanently (cannot be undone).'
    ),
    'activity.view': (
        'View activity log',
        'Search, filter and export the activity log.'
    ),
}

# Never grantable: System Administrators only.
SYSTEM_ONLY_PERMISSIONS = {
    'roles.manage': ('Manage roles', 'Create, edit and delete roles and assign them.'),
}

ALL_PERMISSIONS = {**GRANTABLE_PERMISSIONS, **SYSTEM_ONLY_PERMISSIONS}


def is_system_admin(user):
    return bool(
        user and user.is_authenticated and user.is_active and
        user.groups.filter(name=GROUP_ADMINISTRATORS_NAME).exists()
    )


def get_app_permissions(user):
    """The application permissions this user has right now."""
    if not (user and user.is_authenticated and user.is_active):
        return set()
    if is_system_admin(user):
        return set(ALL_PERMISSIONS)
    from .models import AppRole

    granted = set()
    for permissions in AppRole.objects.filter(
        users=user, system_key__isnull=True
    ).values_list('permissions', flat=True):
        granted.update(p for p in (permissions or ()) if p in GRANTABLE_PERMISSIONS)
    return granted


def has_app_permission(user, permission):
    if permission not in ALL_PERMISSIONS:
        raise ValueError('Unknown application permission: {}'.format(permission))
    return permission in get_app_permissions(user)


def can_use_admin_area(user):
    return bool(get_app_permissions(user))


class AppPermission(BasePermission):
    """
    DRF permission requiring one application permission. Use
    `AppPermission.require('departments.manage')` in permission_classes.
    """
    permission = None
    message = 'You do not have permission to do this.'

    @classmethod
    def require(cls, permission):
        if permission not in ALL_PERMISSIONS:
            raise ValueError(permission)
        return type(
            'AppPermission_{}'.format(permission.replace('.', '_')), (cls,),
            {'permission': permission}
        )

    def has_permission(self, request, view):
        return has_app_permission(user=request.user, permission=self.permission)


class CanUseAdminArea(BasePermission):
    message = 'Only RECAFCO administrators can do this.'

    def has_permission(self, request, view):
        return can_use_admin_area(user=request.user)
