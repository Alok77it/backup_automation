import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

from app.api import (
    ai,
    alerts,
    auth,
    backups,
    dashboard,
    incidents,
    logs,
    monitoring,
    organizations,
    policies,
    reliability,
    restore,
    security_posture,
    selfmonitor,
    servers,
    storage,
)
from app.core.config import get_settings
from app.core.database import engine

settings = get_settings()
logger = logging.getLogger(__name__)

REQUEST_COUNT = Counter("http_requests_total", "Total HTTP requests", ["method", "endpoint", "status"])
REQUEST_LATENCY = Histogram("http_request_duration_seconds", "HTTP request latency", ["method", "endpoint"])

limiter = Limiter(key_func=get_remote_address, default_limits=[settings.RATE_LIMIT_DEFAULT])


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if settings.SESSION_COOKIE_SECURE:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Backup Intelligence API")
    from app.app_extension import sync_plugin_catalog_on_startup
    await sync_plugin_catalog_on_startup(app)
    yield
    await engine.dispose()
    logger.info("Shutdown complete")


app = FastAPI(
    title="Backup Intelligence API",
    description="AI-powered Backup & Recovery Intelligence Platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-CSRF-Token"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(servers.router, prefix="/api")
app.include_router(backups.router, prefix="/api")
app.include_router(restore.router, prefix="/api")
app.include_router(organizations.router, prefix="/api")
app.include_router(policies.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
app.include_router(monitoring.router, prefix="/api")
app.include_router(storage.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(selfmonitor.router, prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(reliability.router, prefix="/api")
app.include_router(security_posture.router, prefix="/api")

# DevOps Control Plane extension (additive only - no existing code modified)
from app.app_extension import register_devops_extension  # noqa: E402
register_devops_extension(app)


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "backup-intelligence-api"}


_LOCALHOST_IPS = {"127.0.0.1", "::1", "localhost"}


def _is_private_ip(host: str) -> bool:
    import ipaddress
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return host in _LOCALHOST_IPS


@app.get("/metrics")
async def prometheus_metrics(request: Request):
    """Prometheus scrape endpoint -- restricted to internal network or Bearer token."""
    from fastapi import HTTPException as _HTTPException

    metrics_token = settings.METRICS_TOKEN
    if metrics_token:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer ") or auth_header[7:] != metrics_token:
            raise _HTTPException(status_code=401, detail="Unauthorized")
    else:
        client_host = request.client.host if request.client else ""
        if not _is_private_ip(client_host):
            raise _HTTPException(status_code=403, detail="Metrics endpoint restricted to internal network")
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
