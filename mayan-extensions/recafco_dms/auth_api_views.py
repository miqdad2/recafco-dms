"""
Sign-in and password change for the RECAFCO portal (Unit 4).

The portal server calls these endpoints; the Mayan token they return is
kept on the portal server and never sent to the browser.
"""
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import Throttled
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import is_portal_admin
from .passwords import (
    LoginUsernameRateThrottle, SignInLocked, SignInRejected,
    change_own_password, sign_in
)
from .services import InputRejected, user_can_upload

LOCKED_MESSAGE = (
    'Too many unsuccessful sign-in attempts for this username. Wait 15 '
    'minutes, or ask an administrator to reset the password.'
)


def _text(data, name):
    value = data.get(name) if hasattr(data, 'get') else None
    return value if isinstance(value, str) else ''


@extend_schema(exclude=True)
class APIPortalLoginView(APIView):
    """
    POST {username, password} -> 200 {token, username, full_name,
    must_change_password, can_upload, is_admin}.

    Anonymous by necessity (this is how one signs in), so it is the one
    extension view without IsAuthenticated. It sets no session cookie and
    is not subject to the per-IP anonymous rate limit; it is limited per
    username instead (LoginUsernameRateThrottle) and every attempt goes
    through Django's authenticate(), i.e. Mayan's lockout.
    """
    authentication_classes = ()
    permission_classes = (AllowAny,)
    throttle_classes = (LoginUsernameRateThrottle,)

    def throttled(self, request, wait):
        raise Throttled(
            detail='Too many sign-in attempts for this username. Wait a minute and try again.',
            wait=wait
        )

    def post(self, request):
        try:
            user, token, must_change = sign_in(
                password=request.data.get('password'), request=request,
                username=_text(request.data, 'username')
            )
        except SignInLocked:
            return Response(
                {'code': 'locked', 'detail': LOCKED_MESSAGE},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        except SignInRejected:
            return Response(
                {'code': 'invalid', 'detail': 'Username or password is not correct.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        body = {
            'full_name': user.get_full_name().strip() or user.username,
            'must_change_password': must_change,
            'token': token,
            'username': user.username
        }
        if not must_change:
            # Roles are not read while a change is pending: nothing else is
            # available to the account until then.
            body['can_upload'] = user_can_upload(user=user)
            body['is_admin'] = is_portal_admin(user=user)
        return Response(body)


@extend_schema(exclude=True)
class APIPortalPasswordChangeView(APIView):
    """
    POST {current_password, new_password} -> 200 {token}. The caller's old
    token stops working; the new token replaces it for this session only.
    Allowed while a password change is pending (see middleware).
    """
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        try:
            token = change_own_password(
                current_password=request.data.get('current_password'),
                new_password=request.data.get('new_password'),
                request=request, user=request.user
            )
        except SignInLocked:
            return Response(
                {'code': 'locked', 'detail': LOCKED_MESSAGE},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        except InputRejected as exception:
            return Response(
                {exception.field: [exception.message]},
                status=status.HTTP_400_BAD_REQUEST
            )
        return Response({'must_change_password': False, 'token': token})
