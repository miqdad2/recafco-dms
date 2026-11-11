"""
Enforces the RECAFCO password rules on every request to Mayan, not only in
the portal. Installed with Mayan's supported settings hook (no Mayan source
change):

    MAYAN_EXTRA_SETTINGS_FUNCTION_LIST=recafco_dms.settings_hooks.add_middleware

1. Pending password change. If the account must replace a temporary
   password, every request authenticated as that account is refused except
   sign-in, the password change endpoint, token revocation (portal sign-out)
   and Mayan's own logout. This covers all of Mayan's ways to authenticate:
   web session, API token and HTTP Basic.
2. Self-service password and account changes outside the policy. Mayan's
   own "change password" page and the API's /users/current/ write methods
   accept any password without the current one (and allow renaming or
   deleting one's own account). For RECAFCO accounts (not Mayan system
   accounts) they are refused; people change their password in the portal.

The middleware never decides that a request IS allowed; it only refuses.
Everything it lets through is still authenticated and authorized by Mayan.
"""
import base64
import binascii
import re

from django.contrib.auth import authenticate, get_user_model
from django.http import HttpResponse, JsonResponse
from django.urls import NoReverseMatch, reverse
from django.utils.html import escape

CHANGE_REQUIRED_CODE = 'password_change_required'
CHANGE_REQUIRED_MESSAGE = (
    'You must replace your temporary password before using the document '
    'system. Sign in to the RECAFCO employee portal to choose your own password.'
)
SELF_SERVICE_MESSAGE = (
    'Change your password in the RECAFCO employee portal. Account details '
    'are managed by RECAFCO administrators.'
)

# API endpoints that stay available while a password change is pending.
PENDING_ALLOWED_API = re.compile(
    r'^/api/(?:v[0-9]+/)?recafco/auth/(?:login|password|token/revoke)/$'
)
CURRENT_USER_API = re.compile(r'^/api/(?:v[0-9]+/)?users/current/$')
SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')


def _reverse(name):
    try:
        return reverse(viewname=name)
    except NoReverseMatch:
        return None


def _is_system_account(user):
    return bool(user.is_superuser or user.is_staff)


class PasswordPolicyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self._paths = None

    @property
    def paths(self):
        # Resolved on first use: URL configuration is not loaded yet when
        # middleware is instantiated.
        if self._paths is None:
            self._paths = {
                'logout': _reverse('authentication:logout_view'),
                'password_change': _reverse('authentication:password_change_view'),
                'password_change_done': _reverse('authentication:password_change_done')
            }
        return self._paths

    def __call__(self, request):
        refusal = self.check(request=request)
        if refusal is not None:
            return refusal
        return self.get_response(request)

    # ------------------------------------------------------------ helpers

    def _header_user(self, request):
        """
        (user, basic_password) for an Authorization header, without side
        effects. Basic credentials are verified only if they would matter.
        """
        header = request.META.get('HTTP_AUTHORIZATION', '')
        scheme, _, credentials = header.partition(' ')
        scheme = scheme.lower()
        credentials = credentials.strip()
        if scheme == 'token' and credentials:
            from rest_framework.authtoken.models import Token
            token = Token.objects.select_related('user').filter(key=credentials[:64]).first()
            if token and token.user.is_active:
                return token.user, None
        elif scheme == 'basic' and credentials:
            try:
                decoded = base64.b64decode(credentials, validate=True).decode('utf-8')
            except (binascii.Error, UnicodeDecodeError, ValueError):
                return None, None
            username, separator, password = decoded.partition(':')
            if separator:
                User = get_user_model()
                user = User.objects.filter(username=username).first()
                if user and user.is_active:
                    return user, password
        return None, None

    def _refuse(self, request, code, message):
        if request.path_info.startswith('/api/'):
            return JsonResponse({'code': code, 'detail': message}, status=403)
        logout = self.paths['logout']
        link = (
            '<p><a href="{}">Sign out of the document system</a></p>'.format(escape(logout))
            if logout else ''
        )
        return HttpResponse(
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<title>RECAFCO Documents</title></head><body style="font-family:'
            'system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;'
            'font-size:1.125rem;line-height:1.5"><h1>RECAFCO Documents</h1>'
            '<p>{}</p>{}</body></html>'.format(escape(message), link),
            content_type='text/html; charset=utf-8', status=403
        )

    # -------------------------------------------------------------- rules

    def check(self, request):
        from .passwords import must_change_password

        path = request.path_info
        candidates = []

        session_user = getattr(request, 'user', None)
        if session_user is not None and session_user.is_authenticated:
            candidates.append((session_user, None))
        header_user, basic_password = self._header_user(request=request)
        if header_user is not None:
            candidates.append((header_user, basic_password))
        if not candidates:
            return None

        pending_allowed = (
            PENDING_ALLOWED_API.match(path) or
            (self.paths['logout'] and path == self.paths['logout'])
        )
        for user, basic_password in candidates:
            if not pending_allowed and must_change_password(user=user):
                if basic_password is not None:
                    # Do not reveal anything about the account unless the
                    # caller proved the password (counted by the lockout).
                    checked = authenticate(
                        request=request, username=user.get_username(),
                        password=basic_password
                    )
                    if checked is None or checked.pk != user.pk:
                        return JsonResponse(
                            {'detail': 'Invalid username/password.'}, status=401
                        )
                return self._refuse(
                    request=request, code=CHANGE_REQUIRED_CODE,
                    message=CHANGE_REQUIRED_MESSAGE
                )

            if _is_system_account(user):
                continue
            self_service = (
                (CURRENT_USER_API.match(path) and request.method not in SAFE_METHODS) or
                path in (
                    self.paths['password_change'], self.paths['password_change_done']
                )
            )
            if self_service:
                return self._refuse(
                    request=request, code='managed_by_portal',
                    message=SELF_SERVICE_MESSAGE
                )
        return None
