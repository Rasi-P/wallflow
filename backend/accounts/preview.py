from django.contrib.auth import logout
from django.http import HttpResponseRedirect
from django.middleware.csrf import rotate_token
from django.shortcuts import render
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_http_methods

MESSAGES = {
    "invalid": "Google sign-in could not be verified.",
    "expired": "This sign-in attempt expired. Please try again.",
    "denied": "Google sign-in was cancelled.",
    "unavailable": "Google sign-in is temporarily unavailable.",
}


@require_GET
@never_cache
def sign_in(request):
    if request.user.is_authenticated:
        return HttpResponseRedirect("/app/")
    return render(request, "accounts/preview.html", {"message": MESSAGES.get(request.GET.get("login"))})


@require_http_methods(["GET", "POST"])
@csrf_protect
@never_cache
def workspace(request):
    if not request.user.is_authenticated:
        return HttpResponseRedirect("/sign-in")
    if request.method == "POST":
        logout(request)
        rotate_token(request)
        return HttpResponseRedirect("/sign-in", status=303)
    return render(request, "accounts/preview.html", {"account": request.user})
