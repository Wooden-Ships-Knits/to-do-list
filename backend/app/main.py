import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.auth import current_user
from app.config import get_settings
from app.errors import error_response, register_error_handlers
from app.logging_config import configure_logging
from app.routers import auth, misc, persons, projects, tasks, users

log = logging.getLogger("app.request")

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Browsers only send custom headers cross-site after a CORS preflight, so requiring one on
# every write (plus SameSite=Lax on the session cookie) blocks cross-site request forgery.
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "fetch"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="Project To-Do Dashboard", version="1.0.0")

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,  # the session cookie
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["Content-Disposition", "X-Request-ID"],
        )

    @app.middleware("http")
    async def request_logging(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        started = time.perf_counter()
        response: Response
        try:
            if (
                request.method in UNSAFE_METHODS
                and request.url.path.startswith("/api/")
                and request.headers.get(CSRF_HEADER) != CSRF_VALUE
            ):
                response = error_response(
                    403, "csrf_failed", "Request rejected: missing X-Requested-With header"
                )
            else:
                response = await call_next(request)
        except Exception:
            log.exception("unhandled exception", extra={"request_id": request_id})
            response = error_response(500, "internal_error", "Internal server error")
        response.headers["X-Request-ID"] = request_id
        log.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
        return response

    register_error_handlers(app)
    app.include_router(misc.health_router)  # /health for container healthchecks
    api = "/api/v1"
    app.include_router(misc.health_router, prefix=api)
    app.include_router(auth.router, prefix=api)  # each route picks its own guard
    app.include_router(users.router, prefix=api)  # admins only (per route)
    logged_in = [Depends(current_user)]
    for router in (misc.router, projects.router, persons.router, tasks.router):
        app.include_router(router, prefix=api, dependencies=logged_in)
    return app


app = create_app()
