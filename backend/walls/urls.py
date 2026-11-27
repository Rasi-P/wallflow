from django.urls import path

from . import views, workspace_views

urlpatterns = [
    path("workspace/", workspace_views.account_workspace, name="account-workspace"),
    path("workspace/import/prepare/", workspace_views.import_prepare, name="workspace-import-prepare"),
    path("workspace/import/confirm/", workspace_views.import_confirm, name="workspace-import-confirm"),
    path("wall/link/", views.link_status, name="wall-link"),
    path("wall/link/prepare/", views.link_prepare, name="wall-link-prepare"),
    path("wall/link/confirm/", views.link_confirm, name="wall-link-confirm"),
    path("wall/link/recover/", views.link_recover, name="wall-link-recover"),
    path("wall/document/", views.wall_document, name="wall-document"),
    path("mobile/quick-capture/", views.quick_capture, name="mobile-quick-capture"),
]
