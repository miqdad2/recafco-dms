"""
RECAFCO portal roles, resolved on the server for every request.

- Employee: member of the "RECAFCO Employees" group. Views general documents
  through Mayan ACLs; uploads into any active department.
- Department controller: has ControllerAssignment rows. May correct the
  details of documents in those departments. Not an administrator.
- Administrator: member of the "RECAFCO Administrators" group. May use the
  administration endpoints. Sees only the documents Mayan lets them see.

Mayan superusers and staff accounts are system accounts. They are not
managed from the RECAFCO administration area.
"""
from rest_framework.permissions import BasePermission

from .literals import GROUP_ADMINISTRATORS_NAME, GROUP_EMPLOYEES_NAME
from .models import ControllerAssignment


def is_portal_admin(user):
    return bool(
        user and user.is_authenticated and user.is_active and
        user.groups.filter(name=GROUP_ADMINISTRATORS_NAME).exists()
    )


def is_employee(user):
    return bool(
        user and user.is_authenticated and
        user.groups.filter(name=GROUP_EMPLOYEES_NAME).exists()
    )


def is_system_account(user):
    return bool(user.is_superuser or user.is_staff)


def get_controller_department_ids(user):
    if not (user and user.is_authenticated):
        return set()
    return set(
        ControllerAssignment.objects.filter(user=user).values_list(
            'department_id', flat=True
        )
    )


class IsPortalAdmin(BasePermission):
    message = 'Only RECAFCO administrators can do this.'

    def has_permission(self, request, view):
        return is_portal_admin(user=request.user)
