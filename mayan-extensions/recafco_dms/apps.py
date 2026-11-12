from django.apps import apps
from django.utils.translation import gettext_lazy as _

from mayan.apps.acls.classes import ModelPermission
from mayan.apps.app_manager.apps import MayanAppConfig


class RecafcoDmsApp(MayanAppConfig):
    app_namespace = 'recafco_dms'
    # None: no web UI URLs. The REST endpoints are registered via api_urls.
    app_url = None
    has_rest_api = True
    has_tests = False
    name = 'recafco_dms'
    verbose_name = _(message='RECAFCO portal integration')

    def ready(self):
        super().ready()

        from .permissions import permission_portal_document_upload

        DocumentType = apps.get_model(
            app_label='documents', model_name='DocumentType'
        )

        ModelPermission.register(
            model=DocumentType,
            permissions=(permission_portal_document_upload,)
        )

        # End Mayan's search-index retries for permanently deleted objects
        # (see search_cleanup.py). Mayan's code is not changed.
        from .search_cleanup import install as install_search_cleanup
        install_search_cleanup()
