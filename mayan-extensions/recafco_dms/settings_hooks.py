"""
Settings hook for Mayan's MAYAN_EXTRA_SETTINGS_FUNCTION_LIST (supported by
mayan/settings/base.py). Adds RECAFCO middleware without changing Mayan.

    MAYAN_EXTRA_SETTINGS_FUNCTION_LIST=recafco_dms.settings_hooks.add_middleware

Runs while Django settings are being built: do not import Django models or
anything that needs configured settings here.
"""
PASSWORD_POLICY_MIDDLEWARE = 'recafco_dms.middleware.PasswordPolicyMiddleware'
AUTHENTICATION_MIDDLEWARE = 'django.contrib.auth.middleware.AuthenticationMiddleware'


def add_middleware(installed_apps, middleware):
    middleware = list(middleware)
    if PASSWORD_POLICY_MIDDLEWARE not in middleware:
        # Directly after Django's authentication middleware: the session
        # user is known, and no Mayan view or later middleware has run.
        if AUTHENTICATION_MIDDLEWARE in middleware:
            position = middleware.index(AUTHENTICATION_MIDDLEWARE) + 1
        else:
            position = len(middleware)
        middleware.insert(position, PASSWORD_POLICY_MIDDLEWARE)
    return installed_apps, tuple(middleware)
