"""
DEVELOPMENT AND INTEGRATION TEST FIXTURES ONLY.

Refuses to run unless the environment variable RECAFCO_DEV_FIXTURES is "1".
Only the isolated development Compose project sets it. Never set it on the
company server.
"""
import json
import os

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError

from mayan.apps.acls.models import AccessControlList
from mayan.apps.documents.models.document_models import Document
from mayan.apps.documents.models.document_type_models import DocumentType
from mayan.apps.permissions.models import Role

from ...literals import (
    DOCUMENT_TYPE_CONFIDENTIAL_LABEL, GROUP_ADMINISTRATORS_NAME,
    GROUP_CONTROLLERS_NAME, GROUP_EMPLOYEES_NAME, ROLE_CONTROLLERS_LABEL
)
from ...permission_model import READ_PERMISSIONS
from ...services import create_document, get_upload_options
from ...fixture_pdf import make_pdf
from ...models import ConfidentialAccessGroup, Department, PortalUpload

# username: (password environment variable, first name, last name, groups)
DEV_USERS = {
    'dev_employee_a': (
        'RECAFCO_DEV_PASSWORD_EMPLOYEE_A', 'Employee', 'A',
        (GROUP_EMPLOYEES_NAME,)
    ),
    'dev_employee_b': (
        'RECAFCO_DEV_PASSWORD_EMPLOYEE_B', 'Employee', 'B',
        (GROUP_EMPLOYEES_NAME,)
    ),
    'dev_controller': (
        'RECAFCO_DEV_PASSWORD_CONTROLLER', 'Controller', 'C',
        (GROUP_CONTROLLERS_NAME,)
    ),
    'dev_admin': (
        'RECAFCO_DEV_PASSWORD_ADMIN', 'Admin', 'D',
        (GROUP_EMPLOYEES_NAME, GROUP_ADMINISTRATORS_NAME)
    )
}


class Command(BaseCommand):
    help = 'Development fixtures for integration tests. Never use on production.'

    def add_arguments(self, parser):
        subparsers = parser.add_subparsers(dest='action', required=True)

        subparsers.add_parser('users', help='Create or reset the dev users.')

        for name in ('disable', 'enable'):
            sub = subparsers.add_parser(name)
            sub.add_argument('username')

        for name in ('group-add', 'group-remove'):
            sub = subparsers.add_parser(name)
            sub.add_argument('username')
            sub.add_argument('group')

        sub = subparsers.add_parser(
            'confidential-sample',
            help='Create a confidential PDF document owned by dev_controller.'
        )
        sub.add_argument('--label', required=True)
        sub.add_argument('--text', required=True)
        sub.add_argument(
            '--department', help='Department name (default: the first).'
        )
        sub.add_argument(
            '--group-id', type=int,
            help='Confidential access group ID (default: the original group).'
        )

        sub = subparsers.add_parser(
            'restrict-acl',
            help=(
                'Add a document-level ACL for controllers only. Used to show '
                'that a document ACL cannot remove access inherited from the '
                'document type.'
            )
        )
        sub.add_argument('document_id', type=int)

        sub = subparsers.add_parser(
            'document-type', help='Print the document type of a document.'
        )
        sub.add_argument('document_id', type=int)

        subparsers.add_parser(
            'info', help='IDs of the RECAFCO document types and roles.'
        )
        subparsers.add_parser(
            'superuser-id', help='ID of one Mayan superuser, or null.'
        )

        sub = subparsers.add_parser(
            'find-label',
            help=(
                'Count ALL documents (any type, including trashed) whose '
                'label contains the text, with their metadata and file state.'
            )
        )
        sub.add_argument('text')

    def handle(self, *args, **options):
        if os.environ.get('RECAFCO_DEV_FIXTURES') != '1':
            raise CommandError(
                'Refusing to run: RECAFCO_DEV_FIXTURES is not "1". This '
                'command is for the isolated development environment only.'
            )

        action = options['action'].replace('-', '_')
        result = getattr(self, 'do_{}'.format(action))(options)
        self.stdout.write(json.dumps(result, sort_keys=True))

    def get_user(self, username):
        try:
            return get_user_model().objects.get(username=username)
        except get_user_model().DoesNotExist:
            raise CommandError('No user "{}".'.format(username))

    def do_users(self, options):
        User = get_user_model()
        result = {}
        for username, (variable, first, last, groups) in DEV_USERS.items():
            password = os.environ.get(variable)
            if not password:
                raise CommandError('{} is not set.'.format(variable))
            user, created = User.objects.get_or_create(username=username)
            user.first_name = first
            user.last_name = last
            user.is_active = True
            user.is_staff = False
            user.is_superuser = False
            user.set_password(password)
            user.save()
            user.groups.set(Group.objects.filter(name__in=groups))
            result[username] = {'groups': sorted(groups), 'id': user.pk}
        return result

    def do_disable(self, options):
        user = self.get_user(options['username'])
        user.is_active = False
        user.save(update_fields=('is_active',))
        return {'is_active': False, 'username': user.username}

    def do_enable(self, options):
        user = self.get_user(options['username'])
        user.is_active = True
        user.save(update_fields=('is_active',))
        return {'is_active': True, 'username': user.username}

    def do_group_add(self, options):
        user = self.get_user(options['username'])
        user.groups.add(Group.objects.get(name=options['group']))
        return {'groups': sorted(g.name for g in user.groups.all())}

    def do_group_remove(self, options):
        user = self.get_user(options['username'])
        user.groups.remove(Group.objects.get(name=options['group']))
        return {'groups': sorted(g.name for g in user.groups.all())}

    def do_confidential_sample(self, options):
        user = self.get_user('dev_controller')
        choices = get_upload_options()
        content = make_pdf(text=options['text'])
        if options.get('group_id'):
            document_type = ConfidentialAccessGroup.objects.get(
                pk=options['group_id']
            ).document_type
        else:
            document_type = DocumentType.objects.get(
                label=DOCUMENT_TYPE_CONFIDENTIAL_LABEL
            )
        upload = create_document(
            category=choices['categories'][0]['name'],
            department=(
                Department.objects.get(name=options['department']).name
                if options.get('department')
                else choices['departments'][0]['name']
            ),
            document_type=document_type,
            label=options['label'],
            uploaded_file=SimpleUploadedFile(
                content=content, content_type='application/pdf',
                name='{}.pdf'.format(options['label'])
            ),
            user=user
        )
        return {
            'document_id': upload.document.pk,
            'document_file_id': upload.document.file_latest.pk
        }

    def do_restrict_acl(self, options):
        document = Document.objects.get(pk=options['document_id'])
        role = Role.objects.get(label=ROLE_CONTROLLERS_LABEL)
        for permission in READ_PERMISSIONS:
            AccessControlList.objects.grant(
                obj=document, permission=permission, role=role
            )
        content_type = ContentType.objects.get_for_model(model=Document)
        return {
            'document_acl_roles': sorted(
                acl.role.label for acl in AccessControlList.objects.filter(
                    content_type=content_type, object_id=document.pk
                )
            )
        }

    def do_document_type(self, options):
        document = Document.objects.get(pk=options['document_id'])
        return {'document_type': document.document_type.label}

    def do_superuser_id(self, options):
        user = get_user_model().objects.filter(is_superuser=True).order_by('pk').first()
        return {'id': user.pk if user else None}

    def do_info(self, options):
        return {
            'document_types': {
                document_type.label: document_type.pk
                for document_type in DocumentType.objects.all()
            },
            'roles': {role.label: role.pk for role in Role.objects.all()}
        }

    def do_find_label(self, options):
        documents = Document.objects.filter(label__contains=options['text'])
        return {
            'count': documents.count(),
            'documents': [
                {
                    'document_type': document.document_type.label,
                    'id': document.pk,
                    'in_trash': document.in_trash,
                    'is_stub': document.is_stub,
                    'metadata': {
                        entry.metadata_type.name: entry.value
                        for entry in document.metadata.all()
                    },
                    'classification': (
                        {
                            'category': document.recafco_classification.category.name,
                            'department': document.recafco_classification.department.name
                        } if hasattr(document, 'recafco_classification') else None
                    ),
                    'uploader': PortalUpload.objects.filter(
                        document=document
                    ).values_list('uploader__username', flat=True).first()
                } for document in documents
            ]
        }
