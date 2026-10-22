import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import error_response, register_error_handlers
from app.logging_config import configure_logging
from app.routers import misc, persons, projects, tasks

log = logging.getLogger("app.request")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="Project To-Do Dashboard", version="1.0.0")

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
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
        try:
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
    app.include_router(misc.router)  # /health for container healthchecks
    api = "/api/v1"
    app.include_router(misc.router, prefix=api)
    app.include_router(projects.router, prefix=api)
    app.include_router(persons.router, prefix=api)
    app.include_router(tasks.router, prefix=api)
    return app


app = create_app()
