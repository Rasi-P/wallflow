class ApiResponseHeaders:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path_info.startswith("/api/"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
        return response
