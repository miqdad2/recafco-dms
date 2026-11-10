"""
Idempotent portal uploads.

The browser creates a random operation ID for each upload and sends it with
every attempt of that same upload. The first attempt that gets through saves
the document; any repeat (a retry after a dropped connection, a double
click, a second tab) receives the document saved the first time.

Why: a connection can drop after the server has committed an upload but
before the reply reaches the browser (Gunicorn keeps processing a request
whose client disconnected; a browser on a weak network can lose the reply).
The browser cannot tell "not saved" from "saved, reply lost", so a plain
retry could create a second copy. With an operation ID, retrying is safe.

States (UploadOperation.state):
- pending: received; work in progress (committed before any work).
- completed: the document exists. Set in the SAME transaction that creates
  the document, so it can never be completed without a document, or have a
  document without being completed.
- failed: nothing was saved; the error is kept. A failed operation is
  final; the browser starts a new operation for a corrected upload.
"""
import hashlib
import logging
import re
import secrets
import time

from django.db import IntegrityError, transaction
from django.utils import timezone

from .literals import (
    UPLOAD_OPERATION_STALE_SECONDS, UPLOAD_OPERATION_WAIT_SECONDS
)
from .models import UploadOperation
from .services import InputRejected, create_portal_upload

logger = logging.getLogger(name=__name__)

OPERATION_ID_PATTERN = re.compile(r'^[A-Za-z0-9-]{16,64}$')


class OperationConflict(Exception):
    """The operation ID was used before for a different file or details."""


class OperationInProgress(Exception):
    """Another request is still saving this operation."""


class OperationFailed(Exception):
    def __init__(self, operation):
        super().__init__(operation.error)
        self.operation = operation


def clean_operation_id(value):
    value = (value or '').strip()
    if not OPERATION_ID_PATTERN.match(value):
        raise InputRejected(
            field='operation_id',
            message='The upload ID is missing or not valid. Reload the page and try again.'
        )
    return value


def fingerprint(uploaded_file, fields):
    """SHA-256 over the file bytes and every submitted field, in a fixed order."""
    digest = hashlib.sha256()
    for name in sorted(fields):
        value = fields[name]
        digest.update('{}={}\n'.format(name, '' if value is None else value).encode('utf-8'))
    digest.update(b'file=')
    if uploaded_file is not None:
        digest.update(str(uploaded_file.size).encode('ascii'))
        digest.update(b':' + (uploaded_file.name or '').encode('utf-8') + b':')
        for chunk in uploaded_file.chunks():
            digest.update(chunk)
        uploaded_file.seek(0)
    return digest.hexdigest()


def _is_stale(operation):
    age = (timezone.now() - operation.datetime_updated).total_seconds()
    return operation.state == UploadOperation.STATE_PENDING and age > UPLOAD_OPERATION_STALE_SECONDS


def _claim(user, operation_id, digest, filename):
    """
    Record the operation as pending (own transaction, committed at once) and
    return (operation, attempt token), or (operation, None) if it already
    exists and this request must not do the work.
    """
    attempt = secrets.token_hex(16)
    try:
        with transaction.atomic():
            operation = UploadOperation.objects.create(
                attempt=attempt, fingerprint=digest, operation_id=operation_id,
                original_filename=(filename or '')[:255],
                state=UploadOperation.STATE_PENDING, user=user
            )
        return operation, attempt
    except IntegrityError:
        pass

    with transaction.atomic():
        operation = UploadOperation.objects.select_for_update().get(
            operation_id=operation_id, user=user
        )
        if operation.fingerprint != digest:
            raise OperationConflict
        if _is_stale(operation):
            # The request that claimed it died (worker killed, server
            # restarted) before finishing; nothing was saved. Take over.
            operation.attempt = attempt
            operation.save(update_fields=('attempt', 'datetime_updated'))
            return operation, attempt
    return operation, None


def _wait_for_result(operation):
    """A concurrent request with the same ID is saving: wait for its result."""
    deadline = time.monotonic() + UPLOAD_OPERATION_WAIT_SECONDS
    while operation.state == UploadOperation.STATE_PENDING and not _is_stale(operation):
        if time.monotonic() > deadline:
            raise OperationInProgress
        time.sleep(0.5)
        operation.refresh_from_db()
    return operation


def run_upload(user, operation_id, uploaded_file, fields, confidential_group_id=None):
    """
    Returns (operation, created). `created` is False when the result of an
    earlier attempt is returned. Raises OperationConflict,
    OperationInProgress, OperationFailed, InputRejected or PermissionDenied.
    """
    operation_id = clean_operation_id(operation_id)
    digest = fingerprint(
        uploaded_file=uploaded_file,
        fields=dict(fields, confidential_group=confidential_group_id)
    )
    filename = uploaded_file.name if uploaded_file is not None else ''
    operation, attempt = _claim(
        digest=digest, filename=filename, operation_id=operation_id, user=user
    )

    if attempt is None:
        operation = _wait_for_result(operation)
        if operation.state == UploadOperation.STATE_COMPLETED:
            return operation, False
        if operation.state == UploadOperation.STATE_FAILED:
            raise OperationFailed(operation)
        # Became stale while waiting: claim it now.
        return run_upload(
            confidential_group_id=confidential_group_id, fields=fields,
            operation_id=operation_id, uploaded_file=uploaded_file, user=user
        )

    stored_files = []
    try:
        with transaction.atomic():
            # Only the request holding the current attempt token may finish
            # this operation (guards against a stale-takeover race).
            claimed = UploadOperation.objects.select_for_update().filter(
                attempt=attempt, pk=operation.pk,
                state=UploadOperation.STATE_PENDING
            ).first()
            if claimed is None:
                raise OperationInProgress
            upload = create_portal_upload(
                category=fields.get('category'),
                confidential_group_id=confidential_group_id,
                department=fields.get('department'), label=fields.get('label'),
                stored_files=stored_files, uploaded_file=uploaded_file,
                user=user
            )
            claimed.document = upload.document
            claimed.state = UploadOperation.STATE_COMPLETED
            claimed.save(update_fields=('document', 'state', 'datetime_updated'))
    except BaseException as exception:
        # Nothing was committed. Remove any file already written to storage
        # so a rolled-back upload leaves no orphan behind.
        delete_stored_files(stored_files)
        message = getattr(exception, 'message', None) or exception.__class__.__name__
        field = getattr(exception, 'field', None)
        UploadOperation.objects.filter(pk=operation.pk, attempt=attempt).update(
            error='{}: {}'.format(field, message) if field else str(message)[:500],
            state=UploadOperation.STATE_FAILED, datetime_updated=timezone.now()
        )
        raise

    claimed.refresh_from_db()
    return claimed, True


def delete_stored_files(stored_files):
    for storage, name in stored_files:
        try:
            storage.delete(name)
        except Exception:
            logger.exception('Could not delete the stored file of a failed upload: %s', name)


def get_operation(user, operation_id):
    try:
        operation_id = clean_operation_id(operation_id)
    except InputRejected:
        return None
    operation = UploadOperation.objects.filter(
        operation_id=operation_id, user=user
    ).select_related('document').first()
    if operation is not None and _is_stale(operation):
        # Report a dead attempt honestly: nothing was saved.
        operation.state = UploadOperation.STATE_FAILED
        operation.error = 'The upload was interrupted before it was saved.'
    return operation
