"""
Stops Mayan's search-index retries for permanently deleted objects.

Why (measured, docs/performance-report.md): while a document is deleted,
Mayan's search handlers queue a re-index of the parent of every deleted
part (the document for each file, version, page and metadata entry; the
file for each file page, ...). They are queued at once, inside the deletion
transaction. Once the deletion commits, the parent no longer exists, and
Mayan's task_index_instance treats "does not exist" as a reason to retry
(up to 40 times, back-off up to 60 s): the object might simply not be
committed yet. For a permanently deleted object it never will be.

What this does, without changing Mayan's code:
- Records a small tombstone (DeletedObject) for each deleted document,
  file, file page, version, version page and metadata entry, in the same
  transaction as the deletion (a rolled-back deletion leaves none).
- Wraps Mayan's task with Celery's own Task.add_around(): if the target is
  missing AND has a tombstone, the task ends without retrying. Every other
  case runs Mayan's task unchanged, so genuine transient failures (an
  object not committed yet, a held index lock) are still retried.
- Tombstones older than RETENTION are removed (Mayan's retries end after
  about 35 minutes).
"""
import functools
import logging
from datetime import timedelta

from django.apps import apps
from django.db.models.signals import post_delete
from django.utils import timezone

logger = logging.getLogger(name=__name__)

TASK_NAME = 'mayan.apps.dynamic_search.tasks.task_index_instance'
TRACKED_MODELS = (
    ('documents', 'document'),
    ('documents', 'documentfile'),
    ('documents', 'documentfilepage'),
    ('documents', 'documentversion'),
    ('documents', 'documentversionpage'),
    ('metadata', 'documentmetadata'),
)
RETENTION = timedelta(days=1)


def record_deletion(sender, instance, **kwargs):
    from .models import DeletedObject

    if instance.pk is None:
        return
    DeletedObject.objects.bulk_create(
        [
            DeletedObject(
                app_label=sender._meta.app_label,
                model_name=sender._meta.model_name, object_id=instance.pk
            )
        ], ignore_conflicts=True
    )
    if sender._meta.model_name == 'document':
        DeletedObject.objects.filter(
            datetime_deleted__lt=timezone.now() - RETENTION
        ).delete()


def was_permanently_deleted(app_label, model_name, object_id):
    """True only if the object is gone AND its deletion was recorded."""
    from .models import DeletedObject

    if (app_label, model_name) not in TRACKED_MODELS:
        return False
    if not DeletedObject.objects.filter(
        app_label=app_label, model_name=model_name, object_id=object_id
    ).exists():
        return False
    model = apps.get_model(app_label=app_label, model_name=model_name)
    return not model._meta.default_manager.filter(pk=object_id).exists()


def around_index_instance(run):
    @functools.wraps(run)
    def run_unless_deleted(self, app_label, model_name, object_id, *args, **kwargs):
        if was_permanently_deleted(
            app_label=app_label, model_name=model_name, object_id=object_id
        ):
            logger.info(
                'Search index: %s.%s %s was permanently deleted; nothing '
                'to index, not retrying.', app_label, model_name, object_id
            )
            return None
        return run(self, app_label, model_name, object_id, *args, **kwargs)
    return run_unless_deleted


def wrap_index_task(**kwargs):
    from mayan.celery import app as celery_app

    task = celery_app.tasks.get(TASK_NAME)
    if task is None:
        logger.warning('Search index task %s not found; not wrapped.', TASK_NAME)
        return
    # Celery's own mechanism for wrapping a task method; idempotent (it
    # unwraps an earlier wrapper first).
    type(task).add_around('run', around_index_instance)


def install():
    for app_label, model_name in TRACKED_MODELS:
        post_delete.connect(
            receiver=record_deletion,
            sender=apps.get_model(app_label=app_label, model_name=model_name),
            dispatch_uid='recafco_dms_deleted_{}_{}'.format(app_label, model_name),
            weak=False
        )
    from mayan.celery import app as celery_app

    if celery_app.finalized:
        wrap_index_task()
    else:
        celery_app.on_after_finalize.connect(wrap_index_task, weak=False)
