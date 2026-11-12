"""
LOAD TEST FIXTURES AND PROBES. DEVELOPMENT ONLY.

Refuses to run unless RECAFCO_DEV_FIXTURES is "1" (set only by the isolated
development Compose project). Never set it on the company server.

Subcommands (all print one JSON object):

- users --count N
    Synthetic employee accounts lt_emp_001..N (group RECAFCO Employees).
    Password from the RECAFCO_LOADTEST_PASSWORD environment variable; it is
    never printed.
- seed --count N [--confidential-every K]
    N synthetic documents through the same create_document() path portal
    uploads use (classification, metadata, uploader record, file in one
    transaction; Mayan's processing chain starts after commit). Every K-th
    document is confidential (first active confidential group, uploaded by
    dev_admin). Labels contain words from a fixed vocabulary so searches
    return realistic result counts. Labels of confidential documents contain
    the marker LTCONF, which the load test uses to detect leaks.
- purge-uploads
    Permanently deletes documents uploaded BY THE LOAD TEST DRIVER (labels
    starting with "LTUP "), so every run starts from the same dataset.
- status
    Dataset size and processing state (how many documents are still
    waiting for page detection / OCR).
- queries --username U
    Calls each read endpoint once in-process (DRF test client, the user is
    force-authenticated) and reports the number of SQL queries and the time.
"""
import json
import os
import random
import time

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.test.utils import CaptureQueriesContext

from mayan.apps.documents.models.document_models import Document
from mayan.apps.documents.models.document_version_page_models import (
    DocumentVersionPage
)

from ...fixture_pdf import make_pdf
from ...literals import GROUP_EMPLOYEES_NAME
from ...models import (
    Category, ConfidentialAccessGroup, Department, PasswordState
)
from ...passwords import _reset_lockout
from ...services import create_document, get_document_type_general

PREFIX = 'lt_emp_'
LABEL_PREFIX = 'LT'

# Search vocabulary. Frequencies differ on purpose: common words match many
# documents, rare words few.
COMMON = ('invoice', 'purchase', 'order', 'steel', 'delivery', 'report')
MEDIUM = (
    'rebar', 'cement', 'aluminium', 'glazing', 'facade', 'warranty',
    'inspection', 'quotation', 'contract', 'shipment', 'payment', 'drawing'
)
RARE = (
    'anodized', 'mullion', 'silicone', 'transom', 'louver', 'spandrel',
    'curtainwall', 'gasket', 'extrusion', 'powdercoat'
)


def synthetic_text(rng, sequence):
    words = [
        rng.choice(COMMON), rng.choice(MEDIUM), rng.choice(MEDIUM),
        rng.choice(RARE) if rng.random() < 0.3 else rng.choice(MEDIUM)
    ]
    return '{} {:06d} {}'.format(LABEL_PREFIX, sequence, ' '.join(words))


class Command(BaseCommand):
    help = 'Load test fixtures and probes. Development only.'

    def add_arguments(self, parser):
        subparsers = parser.add_subparsers(dest='action', required=True)
        sub = subparsers.add_parser('users')
        sub.add_argument('--count', type=int, required=True)
        sub = subparsers.add_parser('seed')
        sub.add_argument('--count', type=int, required=True)
        sub.add_argument('--confidential-every', type=int, default=10)
        sub.add_argument('--seed', type=int, default=1)
        subparsers.add_parser('status')
        subparsers.add_parser('purge-uploads')
        sub = subparsers.add_parser(
            'deletion-sample',
            help='Creates COUNT general documents titled "PREFIX nnnn" whose '
            'file contains the word PREFIXbody (lower case).'
        )
        sub.add_argument('--count', type=int, required=True)
        sub.add_argument('--prefix', required=True)
        sub = subparsers.add_parser(
            'purge-prefix',
            help='Moves documents titled "PREFIX ..." to the recycle bin and '
            'deletes them permanently, as an administrator does (the '
            'production trash_document and purge_document path).'
        )
        sub.add_argument('--prefix', required=True)
        subparsers.add_parser(
            'missing-objects',
            help='Reads [[app_label, model_name, id], ...] as JSON on stdin; '
            'prints the entries whose object no longer exists.'
        )
        sub = subparsers.add_parser('queries')
        sub.add_argument('--username', required=True)

    def handle(self, *args, **options):
        if os.environ.get('RECAFCO_DEV_FIXTURES') != '1':
            raise CommandError(
                'Refusing to run: RECAFCO_DEV_FIXTURES is not "1". This '
                'command is for the isolated development environment only.'
            )
        result = getattr(self, 'do_{}'.format(options['action'].replace('-', '_')))(options)
        self.stdout.write(json.dumps(result, sort_keys=True))

    # ------------------------------------------------------------- users

    def do_users(self, options):
        password = os.environ.get('RECAFCO_LOADTEST_PASSWORD')
        if not password:
            raise CommandError('RECAFCO_LOADTEST_PASSWORD is not set.')
        User = get_user_model()
        group = Group.objects.get(name=GROUP_EMPLOYEES_NAME)
        created = 0
        for index in range(1, options['count'] + 1):
            username = '{}{:03d}'.format(PREFIX, index)
            user, is_new = User.objects.get_or_create(username=username)
            created += int(is_new)
            user.first_name = 'Load'
            user.last_name = 'Test {:03d}'.format(index)
            user.is_active = True
            user.is_staff = False
            user.is_superuser = False
            user.set_password(password)
            user.save()
            user.groups.set([group])
            PasswordState.objects.filter(user=user).delete()
            _reset_lockout(username=username)
        return {'created': created, 'total': options['count']}

    # -------------------------------------------------------------- seed

    def do_seed(self, options):
        User = get_user_model()
        employees = list(User.objects.filter(username__startswith=PREFIX))
        if not employees:
            raise CommandError('Run "users" first.')
        admin = User.objects.get(username='dev_admin')
        departments = list(Department.objects.filter(is_active=True))
        categories = list(Category.objects.filter(is_active=True))
        group = ConfidentialAccessGroup.objects.filter(is_active=True).order_by('pk').first()
        general = get_document_type_general()
        start = Document.objects.filter(label__startswith=LABEL_PREFIX + ' ').count()
        rng = random.Random(options['seed'] * 1_000_003 + start)
        every = options['confidential_every']

        started = time.monotonic()
        confidential = 0
        for offset in range(options['count']):
            sequence = start + offset + 1
            text = synthetic_text(rng=rng, sequence=sequence)
            is_confidential = bool(every and group and sequence % every == 0)
            if is_confidential:
                text = text + ' LTCONF'
                confidential += 1
            create_document(
                category=rng.choice(categories).name,
                department=rng.choice(departments).name,
                document_type=group.document_type if is_confidential else general,
                label=text,
                uploaded_file=SimpleUploadedFile(
                    content=make_pdf(text=text), content_type='application/pdf',
                    name='{}.pdf'.format(text.replace(' ', '_'))
                ),
                user=admin if is_confidential else rng.choice(employees)
            )
        return {
            'confidential': confidential, 'created': options['count'],
            'seconds': round(time.monotonic() - started, 1),
            'synthetic_total': start + options['count']
        }

    # ------------------------------------------- deletion-sample / purge

    def _check_prefix(self, prefix):
        if not prefix.isalnum() or prefix.upper() in ('LT', 'LTUP'):
            raise CommandError('Use a new alphanumeric prefix (not LT or LTUP).')
        return prefix

    def do_deletion_sample(self, options):
        prefix = self._check_prefix(options['prefix'])
        employee = get_user_model().objects.filter(username__startswith=PREFIX).order_by('pk').first()
        if employee is None:
            raise CommandError('Run "users" first.')
        department = Department.objects.filter(is_active=True).order_by('pk').first()
        category = Category.objects.filter(is_active=True).order_by('pk').first()
        ids = []
        for index in range(1, options['count'] + 1):
            label = '{} {:04d}'.format(prefix, index)
            upload = create_document(
                category=category.name, department=department.name,
                document_type=get_document_type_general(), label=label,
                uploaded_file=SimpleUploadedFile(
                    content=make_pdf(text='{} {}body'.format(label, prefix.lower())),
                    content_type='application/pdf', name='{}.pdf'.format(label.replace(' ', '_'))
                ),
                user=employee
            )
            ids.append(upload.document.pk)
        return {'document_ids': ids}

    def do_purge_prefix(self, options):
        from ...admin_operations import purge_document, trash_document

        prefix = self._check_prefix(options['prefix'])
        admin = get_user_model().objects.get(username='dev_admin')
        started = time.monotonic()
        ids = []
        for document in Document.objects.filter(label__startswith=prefix + ' '):
            trash_document(actor=admin, document=document, reason='deletion measurement')
            document = Document.objects.get(pk=document.pk)
            purge_document(actor=admin, document=document, reason='deletion measurement')
            ids.append(document.pk)
        return {'purged_ids': ids, 'seconds': round(time.monotonic() - started, 2)}

    # ----------------------------------------------------- purge-uploads

    def do_purge_uploads(self, options):
        removed = 0
        for document in Document.objects.filter(label__startswith='LTUP '):
            document.delete(to_trash=False)
            removed += 1
        return {'removed': removed}

    # --------------------------------------------------- missing-objects

    def do_missing_objects(self, options):
        import sys

        from django.apps import apps

        wanted = {}
        for app_label, model_name, object_id in json.load(sys.stdin):
            wanted.setdefault((app_label, model_name), set()).add(int(object_id))
        missing = []
        for (app_label, model_name), ids in wanted.items():
            model = apps.get_model(app_label=app_label, model_name=model_name)
            manager = getattr(model, '_base_manager', model.objects)
            existing = set(manager.filter(pk__in=ids).values_list('pk', flat=True))
            missing.extend([app_label, model_name, pk] for pk in sorted(ids - existing))
        return {'missing': missing}

    # ------------------------------------------------------------ status

    def do_status(self, options):
        valid = Document.valid.all()
        with_pages = valid.filter(
            version_active__version_pages__isnull=False
        ).distinct().count()
        try:
            from mayan.apps.ocr.models import DocumentVersionPageOCRContent
            ocr_pages = DocumentVersionPageOCRContent.objects.count()
        except ImportError:
            ocr_pages = None
        return {
            'documents': valid.count(),
            'documents_with_pages': with_pages,
            'documents_waiting_for_pages': valid.count() - with_pages,
            'pages': DocumentVersionPage.objects.count(),
            'pages_with_ocr': ocr_pages,
            'synthetic_documents': valid.filter(label__startswith=LABEL_PREFIX + ' ').count(),
            'users': get_user_model().objects.count()
        }

    # ----------------------------------------------------------- queries

    def do_queries(self, options):
        from rest_framework.test import APIClient

        user = get_user_model().objects.get(username=options['username'])
        client = APIClient(SERVER_NAME='localhost')
        client.force_authenticate(user=user)

        department = Department.objects.filter(is_active=True).order_by('pk').first()
        ids = list(
            Document.valid.filter(
                document_type=get_document_type_general()
            ).order_by('-pk').values_list('pk', flat=True)[:20]
        )
        id_query = '&'.join('id={}'.format(pk) for pk in ids)
        paths = {
            'me': '/api/v4/recafco/me/',
            'departments': '/api/v4/recafco/departments/',
            'department_detail': '/api/v4/recafco/departments/{}/'.format(department.pk),
            'department_documents_p1': '/api/v4/recafco/departments/{}/documents/?page=1&page_size=20'.format(department.pk),
            'department_documents_p20': '/api/v4/recafco/departments/{}/documents/?page=20&page_size=20'.format(department.pk),
            'department_documents_q': '/api/v4/recafco/departments/{}/documents/?q=invoice&page=1&page_size=20'.format(department.pk),
            'mayan_search': '/api/v4/search/documents.documentsearchresult/?q=invoice&page=1&page_size=20',
            'recafco_search': '/api/v4/recafco/search/?q=invoice&page=1&page_size=20',
            'recafco_search_p3': '/api/v4/recafco/search/?q=invoice&page=3&page_size=20',
            'my_uploads': '/api/v4/recafco/uploads/mine/?limit=50',
            'favorites': '/api/v4/recafco/favorites/',
            'summaries_20': '/api/v4/recafco/documents/?{}'.format(id_query),
            'document_detail': '/api/v4/recafco/documents/{}/'.format(ids[0]),
            'options': '/api/v4/recafco/options/',
        }
        result = {}
        for name, path in paths.items():
            client.get(path)  # warm-up (imports, caches)
            with CaptureQueriesContext(connection) as context:
                started = time.monotonic()
                response = client.get(path)
                elapsed = time.monotonic() - started
            result[name] = {
                'ms': round(elapsed * 1000, 1),
                'queries': len(context.captured_queries),
                'sql_ms': round(sum(float(q['time']) for q in context.captured_queries) * 1000, 1),
                'status': response.status_code
            }
        result['_dataset'] = {
            'department_id': department.pk,
            'documents_visible': Document.valid.count()
        }
        return result
