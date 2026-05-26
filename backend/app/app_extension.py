"""
DevOps Control Plane — App Extension
=======================================
Registers all new DevOps routers and startup hooks onto the existing FastAPI app.
Called ONCE from main.py via a single additive line.

CRITICAL: This file does NOT modify any existing router, service, or model.
It only ADDS new routers and a new lifespan hook.

Usage (the ONE line added to main.py):
    from app.app_extension import register_devops_extension
    register_devops_extension(app)
"""

from __future__ import annotations

import logging

from fastapi import FastAPI

logger = logging.getLogger(__name__)

_DEVOPS_ROUTERS_REGISTERED = False


def register_devops_extension(app: FastAPI) -> None:
    """
    Idempotent: safe to call multiple times (guards against double-registration).
    Must be called after the existing routers are registered in main.py.
    """
    global _DEVOPS_ROUTERS_REGISTERED
    if _DEVOPS_ROUTERS_REGISTERED:
        logger.warning("DevOps extension already registered — skipping duplicate call")
        return

    # Import new routers (lazy to avoid circular imports at module load)
    from app.api.control_plane import router as control_plane_router
    from app.api.execution     import router as execution_router
    from app.api.plugins        import router as plugins_router
    from app.api.containers     import router as containers_router
    from app.api.approvals      import router as approvals_router
    from app.api.devops_tools   import router as devops_tools_router

    app.include_router(control_plane_router, prefix="/api")
    app.include_router(execution_router,     prefix="/api")
    app.include_router(plugins_router,       prefix="/api")
    app.include_router(containers_router,    prefix="/api")
    app.include_router(approvals_router,     prefix="/api")
    app.include_router(devops_tools_router,  prefix="/api")

    _DEVOPS_ROUTERS_REGISTERED = True
    logger.info("DevOps Control Plane extension registered: 6 new routers")


async def sync_plugin_catalog_on_startup(app: FastAPI) -> None:
    """
    Called during app lifespan to load plugin manifests from disk.
    Wired in as an additional startup hook — does not replace the existing lifespan.
    """
    try:
        from app.core.database import AsyncSessionLocal
        from app.services.plugin_manager import plugin_manager
        async with AsyncSessionLocal() as db:
            plugins = await plugin_manager.sync_catalog(db)
            logger.info("Plugin catalog synced at startup: %d plugins loaded", len(plugins))
    except Exception as exc:
        logger.error("Plugin catalog sync failed at startup: %s", exc)


# ---------------------------------------------------------------------------
# RBAC extension — add DevOps-specific permissions to the existing RBAC map
# (non-destructive dict.update — existing entries preserved)
# ---------------------------------------------------------------------------

def extend_rbac() -> None:
    """
    Extend the existing RBAC PERMISSIONS dict with DevOps-specific entries.
    Called at import time. Does NOT overwrite existing permissions.
    """
    from app.core.rbac import PERMISSIONS
    from app.models.entities import Role

    devops_permissions = {
        # Job execution
        "job:read":      {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
        "job:submit":    {Role.OWNER, Role.ADMIN, Role.OPERATOR},
        "job:cancel":    {Role.OWNER, Role.ADMIN, Role.OPERATOR},
        # Approval workflow
        "approval:read":   {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
        "approval:decide": {Role.OWNER, Role.ADMIN},
        # Plugin management
        "plugin:read":     {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
        "plugin:install":  {Role.OWNER, Role.ADMIN},
        "plugin:uninstall":{Role.OWNER, Role.ADMIN},
        # Container visibility
        "container:read":  {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
        # SSL / proxy
        "ssl:read":        {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
        "ssl:manage":      {Role.OWNER, Role.ADMIN},
        "proxy:manage":    {Role.OWNER, Role.ADMIN},
        # Agent tokens
        "agent:manage":    {Role.OWNER, Role.ADMIN},
        # Devops audit
        "devops_audit:read":{Role.OWNER, Role.ADMIN},
    }

    for perm, roles in devops_permissions.items():
        if perm not in PERMISSIONS:           # never overwrite existing
            PERMISSIONS[perm] = roles

    logger.debug("DevOps RBAC permissions registered: %d new entries", len(devops_permissions))


# Extend RBAC at import time (safe — PERMISSIONS is a module-level dict)
extend_rbac()
