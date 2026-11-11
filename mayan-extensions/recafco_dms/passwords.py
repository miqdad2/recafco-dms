"""
Local username/password accounts for the RECAFCO portal.

Identity source: Mayan's own Django user table. Passwords are set with
`user.set_password()` and checked with `django.contrib.auth.authenticate()`,
so they are hashed by Django's configured password hasher (PBKDF2-SHA256 by
default) and Mayan's lockout (django-axes) sees every attempt. There is no
second password store; `PasswordState` only records whether a change is
pending.

Rules (confirmed by RECAFCO, Unit 4):
- An administrator creates the account with a unique username and a
  temporary password, which may be as simple as "123".
- The person must replace a temporary password at the first sign-in and
  after every administrator reset. Until then only "change password" and
  "sign out" work (middleware.PasswordPolicyMiddleware enforces this for
  the portal and for direct Mayan access).
- A personal password needs at least PASSWORD_MIN_LENGTH characters; no
  character types are required.
- Usernames are stored in lower case and compared without regard to case.
"""
import hashlib
import logging
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.signals import user_logged_in
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from rest_framework.authtoken.models import Token
from rest_framework.throttling import BaseThrottle

from .literals import (
    LOGIN_RATE_PER_USERNAME_PER_MINUTE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH,
    PASSWORD_REASON_ADMIN_RESET, TEMPORARY_PASSWORD_MIN_LENGTH,
    USERNAME_MAX_LENGTH
)
from .models import LoginRateWindow, PasswordState
from .services import InputRejected, audit

logger = logging.getLogger(name=__name__)

User = get_user_model()


class SignInRejected(Exception):
    """Wrong username or password, or an inactive account (same answer)."""


class SignInLocked(Exception):
    """Too many failed attempts for this username (Mayan lockout)."""


# ------------------------------------------------------------- usernames

def normalize_username(value):
    return (value or '').strip().lower() if isinstance(value, str) else ''


def clean_new_username(value):
    """A new account's username: lower case, unique ignoring case."""
    username = normalize_username(value)
    if not username:
        raise InputRejected(field='username', message='Enter a username.')
    if len(username) > USERNAME_MAX_LENGTH:
        raise InputRejected(
            field='username',
            message='Use at most {} characters.'.format(USERNAME_MAX_LENGTH)
        )
    try:
        User.username_validator(username)
    except ValidationError:
        raise InputRejected(
            field='username',
            message='Use letters, numbers and . _ - @ + only, without spaces.'
        )
    if User.objects.filter(username__iexact=username).exists():
        raise InputRejected(field='username', message='This username is already used.')
    return username


def resolve_username(value):
    """
    The stored username for a sign-in name, ignoring case. Accounts created
    before Unit 4 may contain capitals. If two old accounts differ only by
    case, only the exact spelling matches. Unknown names are lower-cased so
    lockout counts "Ali" and "ali" as the same name.
    """
    value = value.strip() if isinstance(value, str) else ''
    if not value or len(value) > USERNAME_MAX_LENGTH:
        return value.lower()
    matches = list(
        User.objects.filter(username__iexact=value).values_list(
            'username', flat=True
        )[:3]
    )
    if len(matches) == 1:
        return matches[0]
    if value in matches:
        return value
    return value.lower()


# ------------------------------------------------------------- passwords

def _clean_length(password, minimum, field, too_short):
    if not isinstance(password, str) or len(password) < minimum:
        raise InputRejected(field=field, message=too_short)
    if len(password) > PASSWORD_MAX_LENGTH:
        raise InputRejected(
            field=field,
            message='Use at most {} characters.'.format(PASSWORD_MAX_LENGTH)
        )
    return password


def clean_temporary_password(password, field='password'):
    return _clean_length(
        password=password, minimum=TEMPORARY_PASSWORD_MIN_LENGTH, field=field,
        too_short='Enter a temporary password.'
    )


def clean_personal_password(password, field='new_password'):
    return _clean_length(
        password=password, minimum=PASSWORD_MIN_LENGTH, field=field,
        too_short='Use at least {} characters.'.format(PASSWORD_MIN_LENGTH)
    )


def must_change_password(user):
    if user is None or not user.pk:
        return False
    return PasswordState.objects.filter(user_id=user.pk, must_change=True).exists()


def _reset_lockout(username):
    """Clears Mayan's failed-attempt counter for this username."""
    try:
        from axes.handlers.proxy import AxesProxyHandler
        AxesProxyHandler.reset_attempts(username=username)
    except Exception:  # Lockout disabled or not installed: nothing to clear.
        logger.debug('Lockout reset skipped for a user.', exc_info=True)


def set_temporary_password(actor, user, password, reason):
    """
    Sets an administrator-chosen temporary password and requires a change
    at the next sign-in. Ends the person's existing access everywhere:
    - the Mayan API token is deleted, which ends every portal session on
      the next request;
    - Django invalidates Mayan web sessions because the password hash
      changed (session auth hash);
    - HTTP Basic access needs the new password.
    The username's lockout counter is cleared so the person can sign in.
    Call inside a transaction.
    """
    user.set_password(password)
    user.save(update_fields=['password'])
    PasswordState.objects.update_or_create(
        user=user, defaults={
            'datetime_temporary_set': timezone.now(), 'must_change': True,
            'reason': reason, 'set_by': actor
        }
    )
    Token.objects.filter(user=user).delete()
    transaction.on_commit(lambda: _reset_lockout(username=user.get_username()))


def reset_password_by_admin(actor, user, password):
    password = clean_temporary_password(password=password)
    with transaction.atomic():
        set_temporary_password(
            actor=actor, password=password, reason=PASSWORD_REASON_ADMIN_RESET,
            user=user
        )
        audit(
            action='user.password_reset', actor=actor, target=user,
            target_type='user'
        )


# ---------------------------------------------------------- signing in

def _django_request(request):
    return getattr(request, '_request', request)


def is_username_locked(request, username):
    try:
        from axes.handlers.proxy import AxesProxyHandler
        return bool(
            AxesProxyHandler.is_locked(
                request=_django_request(request), credentials={'username': username}
            )
        )
    except Exception:
        logger.debug('Lockout check unavailable.', exc_info=True)
        return False


def check_credentials(request, username, password):
    """
    Django authentication of username/password through every configured
    backend, including Mayan's lockout. Returns the user or raises.
    """
    if not isinstance(password, str) or not password or len(password) > PASSWORD_MAX_LENGTH:
        raise SignInRejected()
    canonical = resolve_username(username)
    if not canonical:
        raise SignInRejected()
    user = authenticate(
        request=_django_request(request), username=canonical, password=password
    )
    if user is None or not user.is_active:
        locked = is_username_locked(request=request, username=canonical)
        # The lockout's own middleware would replace this API's JSON answer
        # with its HTML lockout page; the caller reports the lock itself.
        _django_request(request).axes_locked_out = False
        if locked:
            raise SignInLocked()
        raise SignInRejected()
    return user


def sign_in(request, username, password):
    """Returns (user, token key, must_change)."""
    user = check_credentials(request=request, password=password, username=username)
    token, created = Token.objects.get_or_create(user=user)
    # Same signal as Mayan's own login page: updates last_login, records the
    # login event and lets the lockout reset its failure counter.
    user_logged_in.send(
        request=_django_request(request), sender=user.__class__, user=user
    )
    return user, token.key, must_change_password(user=user)


def change_own_password(request, user, current_password, new_password):
    """
    The signed-in person replaces their password. Requires the current
    password (checked through the lockout). Returns a new token: the old
    one is deleted so every other portal session and device is signed out.
    """
    if not isinstance(current_password, str) or not current_password:
        raise InputRejected(field='current_password', message='Enter your current password.')
    new_password = clean_personal_password(password=new_password)
    try:
        checked = check_credentials(
            request=request, password=current_password, username=user.get_username()
        )
    except SignInRejected:
        raise InputRejected(
            field='current_password', message='Your current password is not correct.'
        )
    if checked.pk != user.pk:
        raise InputRejected(
            field='current_password', message='Your current password is not correct.'
        )
    if new_password == current_password:
        raise InputRejected(
            field='new_password',
            message='Choose a password that is different from your current one.'
        )

    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        was_temporary = must_change_password(user=user)
        user.set_password(new_password)
        user.save(update_fields=['password'])
        PasswordState.objects.update_or_create(
            user=user, defaults={'datetime_changed': timezone.now(), 'must_change': False}
        )
        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)
        audit(
            action='user.password_changed', actor=user, target=user,
            target_type='user', details={'replaced_temporary': was_temporary}
        )
    return token.key


class LoginUsernameRateThrottle(BaseThrottle):
    """
    Limits sign-in requests per username, never per IP address: employees
    share the office's addresses, so an IP limit would block everyone.
    Counted in the database (LoginRateWindow), shared by all workers.
    """
    wait_seconds = None

    def allow_request(self, request, view):
        try:
            username = normalize_username(request.data.get('username'))
        except AttributeError:
            username = ''
        if not username:
            return True
        key = hashlib.sha256(username.encode('utf-8')).hexdigest()
        now = timezone.now()
        window = now.replace(second=0, microsecond=0)
        rows = LoginRateWindow.objects.filter(key=key, window_start=window)
        if not rows.update(count=F('count') + 1):
            try:
                with transaction.atomic():
                    LoginRateWindow.objects.create(count=1, key=key, window_start=window)
            except IntegrityError:
                rows.update(count=F('count') + 1)
        count = rows.values_list('count', flat=True).first() or 0
        if now.second == 0:
            # Housekeeping about once a minute: drop windows older than an hour.
            LoginRateWindow.objects.filter(
                window_start__lt=now - timedelta(hours=1)
            ).delete()
        if count > LOGIN_RATE_PER_USERNAME_PER_MINUTE:
            self.wait_seconds = 60 - now.second
            return False
        return True

    def wait(self):
        return self.wait_seconds
