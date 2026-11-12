from django.core.exceptions import ImproperlyConfigured
from django.urls import re_path

from . import admin_api_views as admin
from .auth_api_views import APIPortalLoginView, APIPortalPasswordChangeView
from .api_views import (
    APIPortalDepartmentDetailView, APIPortalDepartmentDocumentsView,
    APIPortalDepartmentListView, APIPortalDocumentDetailsView,
    APIPortalDocumentDetailView, APIPortalDocumentFavoriteView,
    APIPortalDocumentSummaryListView, APIPortalFavoritesView, APIPortalMeView,
    APIPortalMyUploadsView, APIPortalOptionsView,
    APIPortalRecentDocumentsView, APIPortalSearchView, APIPortalTokenRevokeView,
    APIPortalUploadOperationView, APIPortalUploadView
)

urlpatterns = []

ID = r'(?P<{}>[0-9]{{1,12}})'

api_urls = [
    re_path(
        route=r'^recafco/me/$', name='recafco-portal-me',
        view=APIPortalMeView.as_view()
    ),
    re_path(
        route=r'^recafco/options/$', name='recafco-portal-options',
        view=APIPortalOptionsView.as_view()
    ),
    re_path(
        route=r'^recafco/uploads/$', name='recafco-portal-upload',
        view=APIPortalUploadView.as_view()
    ),
    re_path(
        route=r'^recafco/uploads/operations/(?P<operation_id>[A-Za-z0-9-]{1,64})/$',
        name='recafco-portal-upload-operation',
        view=APIPortalUploadOperationView.as_view()
    ),
    re_path(
        route=r'^recafco/uploads/mine/$', name='recafco-portal-my-uploads',
        view=APIPortalMyUploadsView.as_view()
    ),
    re_path(
        route=r'^recafco/favorites/$', name='recafco-portal-favorites',
        view=APIPortalFavoritesView.as_view()
    ),
    re_path(
        route=r'^recafco/departments/$', name='recafco-portal-departments',
        view=APIPortalDepartmentListView.as_view()
    ),
    re_path(
        route=r'^recafco/departments/{}/$'.format(ID.format('department_id')),
        name='recafco-portal-department-detail',
        view=APIPortalDepartmentDetailView.as_view()
    ),
    re_path(
        route=r'^recafco/departments/{}/documents/$'.format(ID.format('department_id')),
        name='recafco-portal-department-documents',
        view=APIPortalDepartmentDocumentsView.as_view()
    ),
    re_path(
        route=r'^recafco/search/$', name='recafco-portal-search',
        view=APIPortalSearchView.as_view()
    ),
    re_path(
        route=r'^recafco/documents/recent/$', name='recafco-portal-recent-documents',
        view=APIPortalRecentDocumentsView.as_view()
    ),
    re_path(
        route=r'^recafco/documents/$',
        name='recafco-portal-document-summaries',
        view=APIPortalDocumentSummaryListView.as_view()
    ),
    re_path(
        route=r'^recafco/documents/{}/$'.format(ID.format('document_id')),
        name='recafco-portal-document-detail',
        view=APIPortalDocumentDetailView.as_view()
    ),
    re_path(
        route=r'^recafco/documents/{}/details/$'.format(ID.format('document_id')),
        name='recafco-portal-document-details',
        view=APIPortalDocumentDetailsView.as_view()
    ),
    re_path(
        route=r'^recafco/documents/{}/favorite/$'.format(ID.format('document_id')),
        name='recafco-portal-document-favorite',
        view=APIPortalDocumentFavoriteView.as_view()
    ),
    re_path(
        route=r'^recafco/auth/login/$', name='recafco-portal-login',
        view=APIPortalLoginView.as_view()
    ),
    re_path(
        route=r'^recafco/auth/password/$', name='recafco-portal-password-change',
        view=APIPortalPasswordChangeView.as_view()
    ),
    re_path(
        route=r'^recafco/auth/token/revoke/$',
        name='recafco-portal-token-revoke',
        view=APIPortalTokenRevokeView.as_view()
    ),

    # Administration (RECAFCO administrators only).
    re_path(
        route=r'^recafco/admin/overview/$', name='recafco-admin-overview',
        view=admin.APIAdminOverviewView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/departments/$', name='recafco-admin-departments',
        view=admin.APIAdminDepartmentListView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/departments/order/$',
        name='recafco-admin-department-order',
        view=admin.APIAdminDepartmentOrderView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/departments/{}/$'.format(ID.format('department_id')),
        name='recafco-admin-department-detail',
        view=admin.APIAdminDepartmentDetailView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/categories/$', name='recafco-admin-categories',
        view=admin.APIAdminCategoryListView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/categories/{}/$'.format(ID.format('category_id')),
        name='recafco-admin-category-detail',
        view=admin.APIAdminCategoryDetailView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/users/$', name='recafco-admin-users',
        view=admin.APIAdminUserListView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/users/choices/$',
        name='recafco-admin-user-choices',
        view=admin.APIAdminUserChoicesView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/users/{}/$'.format(ID.format('user_id')),
        name='recafco-admin-user-detail',
        view=admin.APIAdminUserDetailView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/users/{}/password/$'.format(ID.format('user_id')),
        name='recafco-admin-user-password',
        view=admin.APIAdminUserPasswordView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/confidential-groups/$',
        name='recafco-admin-confidential-groups',
        view=admin.APIAdminConfidentialGroupListView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/confidential-groups/{}/$'.format(ID.format('group_id')),
        name='recafco-admin-confidential-group-detail',
        view=admin.APIAdminConfidentialGroupDetailView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/confidential-groups/{}/members/$'.format(ID.format('group_id')),
        name='recafco-admin-confidential-group-members',
        view=admin.APIAdminConfidentialGroupMembersView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/documents/$', name='recafco-admin-documents',
        view=admin.APIAdminDocumentListView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/documents/{}/$'.format(ID.format('document_id')),
        name='recafco-admin-document-detail',
        view=admin.APIAdminDocumentDetailView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/documents/{}/responsible/$'.format(ID.format('document_id')),
        name='recafco-admin-document-responsible',
        view=admin.APIAdminDocumentResponsibleView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/documents/{}/reclassify/$'.format(ID.format('document_id')),
        name='recafco-admin-document-reclassify',
        view=admin.APIAdminDocumentReclassifyView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/audit/$', name='recafco-admin-audit',
        view=admin.APIAdminAuditView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/audit/export/$', name='recafco-admin-audit-export',
        view=admin.APIAdminAuditExportView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/users/{}/roles/$'.format(ID.format('user_id')),
        name='recafco-admin-user-roles', view=admin.APIAdminUserRolesView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/roles/$', name='recafco-admin-roles',
        view=admin.APIAdminRoleListView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/roles/{}/$'.format(ID.format('role_id')),
        name='recafco-admin-role-detail', view=admin.APIAdminRoleDetailView.as_view()
    ),
    re_path(
        route=r'^recafco/admin/documents/bulk/$', name='recafco-admin-documents-bulk',
        view=admin.APIAdminDocumentBulkView.as_view()
    )
]

# Every admin route must be guarded by the application permissions (Unit 5).
# Checked at import time so a new admin view without them fails loudly
# instead of being exposed.
for _pattern in api_urls:
    if _pattern.name.startswith('recafco-admin-'):
        _view = _pattern.callback.view_class
        if not issubclass(_view, admin.AdminAPIView) or admin.CanUseAdminArea not in _view.permission_classes:
            raise ImproperlyConfigured(_pattern.name + " is not an application-permission guarded admin view")
