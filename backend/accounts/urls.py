from django.urls import path

from . import views

urlpatterns = [
    path("csrf/", views.csrf_token, name="auth-csrf"),
    path("google/start/", views.google_start, name="auth-google-start"),
    path("google/callback/", views.google_callback, name="auth-google-callback"),
    path("me/", views.current_user, name="auth-me"),
    path("logout/", views.logout_session, name="auth-logout"),
]
