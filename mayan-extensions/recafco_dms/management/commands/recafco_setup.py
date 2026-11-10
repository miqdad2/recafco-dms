import json

from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError

from mayan.apps.acls.models import AccessControlList
from mayan.apps.documents.models.document_models import Document
from mayan.apps.documents.models.document_type_models import DocumentType
from mayan.apps.metadata.models import DocumentTypeMetadataType, MetadataType
from mayan.apps.permissions.models import Role

from ...literals import (
    CONFIDENTIAL_GROUP_ORIGINAL_NAME, DOCUMENT_TYPE_CONFIDENTIAL_LABEL,
    DOCUMENT_TYPE_GENERAL_LABEL, GROUP_ADMINISTRATORS_NAME,
    GROUP_CONTROLLERS_NAME, GROUP_EMPLOYEES_NAME,
    METADATA_TYPE_CATEGORY_LABEL, METADATA_TYPE_CATEGORY_NAME,
    METADATA_TYPE_DEPARTMENT_LABEL, METADATA_TYPE_DEPARTMENT_NAME,
    ROLE_CONTROLLERS_LABEL, ROLE_EMPLOYEES_LABEL
)
from ...models import (
    Category, ConfidentialAccessGroup, Department, DocumentClassification
)
from ...permission_model import ACL_MAP, READ_PERMISSIONS
from ...services import InputRejected, clean_name, sync_metadata_lookups

SAMPLE_SUFFIX = '(dev sample)'


def parse_choices(value, name):
    if value is None:
        return []
    choices = [choice.strip() for choice in value.split(',')]
    choices = [choice for choice in choices if choice]
    if len(set(choices)) != len(choices):
        raise CommandError('--{} has duplicate values.'.format(name))
    for choice in choices:
        try:
            clean_name(value=choice)
        except InputRejected as exception:
            raise CommandError('--{}: "{}": {}'.format(name, choice, exception.message))
    return choices


class Command(BaseCommand):
    help = (
        'Create or update the RECAFCO document types, metadata types, roles, '
        'groups, ACLs, departments and categories. Safe to run repeatedly. '
        'Departments and categories are only ever added here (manage them '
        'in the RECAFCO administration area); nothing is removed.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--departments',
            help='Comma-separated department names to add if missing.'
        )
        parser.add_argument(
            '--categories',
            help='Comma-separated category names to add if missing.'
        )

    def handle(self, *args, **options):
        departments = parse_choices(options['departments'], 'departments')
        categories = parse_choices(options['categories'], 'categories')

        # Refuse before changing anything: a global permission on a RECAFCO
        # role would expose confidential documents.
        self.check_no_global_permissions()

        # Deliberately not wrapped in one transaction. Mayan dispatches some
        # follow-up tasks (e.g. adding required metadata to existing
        # documents) immediately on save; inside an uncommitted transaction
        # the worker cannot see the new rows. Every step is idempotent, so a
        # failed run is fixed by running the command again.
        roles = self.sync(categories=categories, departments=departments)
        self.check_no_global_permissions()

        self.stdout.write(
            json.dumps(self.report(roles=roles), indent=2, sort_keys=True)
        )

    def recafco_roles(self):
        labels = {ROLE_EMPLOYEES_LABEL, ROLE_CONTROLLERS_LABEL}
        labels.update(
            ConfidentialAccessGroup.objects.values_list('role__label', flat=True)
        )
        return Role.objects.filter(label__in=labels)

    def check_no_global_permissions(self):
        for role in self.recafco_roles():
            global_permissions = sorted(
                '{}.{}'.format(p.namespace, p.name) for p in role.permissions.all()
            )
            if global_permissions:
                raise CommandError(
                    'Role "{}" has global permissions {}. Remove them; RECAFCO '
                    'access must come from ACLs only.'.format(
                        role.label, global_permissions
                    )
                )
        # The administrators group must not carry Mayan permissions.
        group = Group.objects.filter(name=GROUP_ADMINISTRATORS_NAME).first()
        if group is not None and group.roles.exists():
            raise CommandError(
                'Group "{}" is attached to Mayan roles {}. Remove them; the '
                'RECAFCO administration area needs no Mayan permissions.'.format(
                    GROUP_ADMINISTRATORS_NAME,
                    sorted(group.roles.values_list('label', flat=True))
                )
            )

    def seed(self, model, metadata_type, names):
        # First run after Unit 1: import the existing lookup values so that
        # existing documents keep their department and category.
        if not model.objects.exists():
            names = metadata_type.get_lookup_values() + [
                name for name in names if name not in metadata_type.get_lookup_values()
            ]
        existing = {name.lower() for name in model.objects.values_list('name', flat=True)}
        for index, name in enumerate(names):
            if name.lower() in existing:
                continue
            fields = {'name': name}
            if model is Department:
                fields['is_sample'] = name.endswith(SAMPLE_SUFFIX)
                fields['sort_order'] = (model.objects.count() + 1) * 10
            model.objects.create(**fields)
            existing.add(name.lower())

    def sync(self, categories, departments):
        metadata_type_objects = {}
        for name, label in (
            (METADATA_TYPE_DEPARTMENT_NAME, METADATA_TYPE_DEPARTMENT_LABEL),
            (METADATA_TYPE_CATEGORY_NAME, METADATA_TYPE_CATEGORY_LABEL)
        ):
            metadata_type, created = MetadataType.objects.get_or_create(
                name=name, defaults={'label': label}
            )
            if metadata_type.label != label:
                metadata_type.label = label
                metadata_type.save()
            metadata_type_objects[name] = metadata_type

        self.seed(
            model=Department, names=departments,
            metadata_type=metadata_type_objects[METADATA_TYPE_DEPARTMENT_NAME]
        )
        self.seed(
            model=Category, names=categories,
            metadata_type=metadata_type_objects[METADATA_TYPE_CATEGORY_NAME]
        )
        sync_metadata_lookups()

        document_types = {}
        for label in (
            DOCUMENT_TYPE_GENERAL_LABEL, DOCUMENT_TYPE_CONFIDENTIAL_LABEL
        ):
            document_type, created = DocumentType.objects.get_or_create(
                label=label
            )
            document_types[label] = document_type

        roles = {}
        for role_label, group_name in (
            (ROLE_EMPLOYEES_LABEL, GROUP_EMPLOYEES_NAME),
            (ROLE_CONTROLLERS_LABEL, GROUP_CONTROLLERS_NAME)
        ):
            role, created = Role.objects.get_or_create(label=role_label)
            group, created = Group.objects.get_or_create(name=group_name)
            role.groups.add(group)
            roles[role_label] = role

        Group.objects.get_or_create(name=GROUP_ADMINISTRATORS_NAME)

        # The Unit 1 confidential type and its readers are the first
        # confidential access group.
        ConfidentialAccessGroup.objects.get_or_create(
            document_type=document_types[DOCUMENT_TYPE_CONFIDENTIAL_LABEL],
            defaults={
                'group': Group.objects.get(name=GROUP_CONTROLLERS_NAME),
                'name': CONFIDENTIAL_GROUP_ORIGINAL_NAME,
                'role': roles[ROLE_CONTROLLERS_LABEL]
            }
        )

        # Wanted ACLs: {role: {document type: permissions}}. Each extra
        # confidential group's role reads only its own document type.
        acl_map = {}
        for role_label, role in roles.items():
            acl_map[role] = {
                document_types[label]: permissions
                for label, permissions in ACL_MAP.get(role_label, {}).items()
            }
        for access_group in ConfidentialAccessGroup.objects.select_related(
            'document_type', 'role'
        ):
            document_types[access_group.document_type.label] = access_group.document_type
            if access_group.role.label not in roles:
                roles[access_group.role.label] = access_group.role
                acl_map[access_group.role] = {
                    access_group.document_type: READ_PERMISSIONS
                }
                access_group.role.groups.add(access_group.group)

        for document_type in document_types.values():
            for metadata_type in metadata_type_objects.values():
                link, created = DocumentTypeMetadataType.objects.get_or_create(
                    document_type=document_type, metadata_type=metadata_type,
                    defaults={'required': True}
                )
                if not link.required:
                    link.required = True
                    link.save()

        # Make each RECAFCO role's ACL on each RECAFCO document type match
        # exactly: add what is missing, remove what is not listed.
        content_type = ContentType.objects.get_for_model(model=DocumentType)
        for role in roles.values():
            for document_type in document_types.values():
                wanted = acl_map.get(role, {}).get(document_type, ())
                wanted_ids = {
                    permission.stored_permission.pk for permission in wanted
                }
                acl = AccessControlList.objects.filter(
                    content_type=content_type, object_id=document_type.pk,
                    role=role
                ).first()

                if acl:
                    for stored_permission in acl.permissions.all():
                        if stored_permission.pk not in wanted_ids:
                            acl.permissions.remove(stored_permission)

                for permission in wanted:
                    AccessControlList.objects.grant(
                        obj=document_type, permission=permission, role=role
                    )

        self.backfill_classifications(document_types=document_types.values())
        return roles

    def backfill_classifications(self, document_types):
        """Link RECAFCO documents that have no classification record yet
        (Unit 1 uploads, or documents added in Mayan's own screens) using
        their metadata values."""
        departments = {d.name: d for d in Department.objects.all()}
        categories = {c.name: c for c in Category.objects.all()}
        self.unclassified = []
        for document in Document.objects.filter(
            document_type__in=list(document_types),
            recafco_classification__isnull=True
        ):
            values = {
                entry.metadata_type.name: entry.value
                for entry in document.metadata.select_related('metadata_type')
            }
            department = departments.get(values.get(METADATA_TYPE_DEPARTMENT_NAME))
            category = categories.get(values.get(METADATA_TYPE_CATEGORY_NAME))
            if department and category:
                DocumentClassification.objects.get_or_create(
                    document=document,
                    defaults={'category': category, 'department': department}
                )
            else:
                self.unclassified.append(document.pk)

    def report(self, roles):
        content_type = ContentType.objects.get_for_model(model=DocumentType)
        result = {
            'categories': list(Category.objects.values_list('name', flat=True)),
            'confidential_groups': {
                group.name: group.document_type.label
                for group in ConfidentialAccessGroup.objects.select_related('document_type')
            },
            'departments': list(Department.objects.values_list('name', flat=True)),
            'roles': {},
            'unclassified_documents': self.unclassified
        }
        for role_label, role in roles.items():
            acls = {}
            for acl in AccessControlList.objects.filter(
                content_type=content_type, role=role
            ):
                acls[str(acl.content_object)] = sorted(
                    '{}.{}'.format(p.namespace, p.name)
                    for p in acl.permissions.all()
                )
            result['roles'][role_label] = {
                'document_type_acls': acls,
                'global_permissions': sorted(
                    '{}.{}'.format(p.namespace, p.name)
                    for p in role.permissions.all()
                ),
                'groups': sorted(group.name for group in role.groups.all())
            }
        return result
