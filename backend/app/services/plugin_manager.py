"""
Plugin Manager Service
=======================
Manages the DevOps plugin lifecycle: catalog sync, install requests,
health checks, uninstall.

Plugin architecture:
  backend/app/plugins/<plugin_id>/plugin.json   — manifest
  backend/app/plugins/<plugin_id>/install.sh    — install script
  backend/app/plugins/<plugin_id>/uninstall.sh  — uninstall script
  backend/app/plugins/<plugin_id>/docker-compose.yml.j2  — template
  backend/app/plugins/<plugin_id>/health_check.py        — health probe

ADDITIVE — no modification to backup/monitoring services.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.devops_entities import (
    DevOpsAuditLog,
    DevOpsPlugin,
    DevOpsJob,
    JobStatus,
    PluginInstallation,
    PluginStatus,
    RiskLevel,
)

logger = logging.getLogger(__name__)

PLUGINS_DIR = Path(__file__).parent.parent / "plugins"


class PluginNotFoundError(Exception):
    pass


class PluginAlreadyInstalledError(Exception):
    pass


class PluginManager:
    """
    Catalog & lifecycle management for DevOps plugins.
    Heavy lifting (actual install) is delegated to Celery via ExecutionEngine.
    """

    # ------------------------------------------------------------------
    # Catalog sync — reads plugin.json files from disk
    # ------------------------------------------------------------------

    async def sync_catalog(self, db: AsyncSession) -> list[DevOpsPlugin]:
        """
        Scan backend/app/plugins/ directory and upsert DevOpsPlugin records.
        Called at app startup (via lifespan) or manually via API.
        """
        plugins: list[DevOpsPlugin] = []
        if not PLUGINS_DIR.exists():
            logger.warning("Plugins directory not found: %s", PLUGINS_DIR)
            return plugins

        for plugin_dir in sorted(PLUGINS_DIR.iterdir()):
            if not plugin_dir.is_dir():
                continue
            manifest_path = plugin_dir / "plugin.json"
            if not manifest_path.exists():
                continue

            try:
                manifest = json.loads(manifest_path.read_text())
                plugin = await self._upsert_plugin(db, manifest)
                plugins.append(plugin)
            except Exception as exc:
                logger.error("Failed to load plugin from %s: %s", plugin_dir, exc)

        await db.commit()
        logger.info("Plugin catalog synced: %d plugins", len(plugins))
        return plugins

    async def _upsert_plugin(self, db: AsyncSession, manifest: dict) -> DevOpsPlugin:
        plugin_id = manifest["id"]
        result = await db.execute(
            select(DevOpsPlugin).where(DevOpsPlugin.id == plugin_id)
        )
        plugin = result.scalar_one_or_none()

        data = {
            "name": manifest.get("name", plugin_id),
            "description": manifest.get("description"),
            "version": manifest.get("version", "1.0.0"),
            "category": manifest.get("category", "tool"),
            "icon_url": manifest.get("icon_url"),
            "docs_url": manifest.get("docs_url"),
            "manifest": manifest,
            "requires_docker": manifest.get("requires_docker", True),
            "min_memory_mb": manifest.get("min_memory_mb", 512),
            "supported_os": manifest.get("supported_os", ["ubuntu", "debian"]),
            "risk_level": RiskLevel(manifest.get("risk_level", "high")),
            "is_active": True,
        }

        if plugin:
            for k, v in data.items():
                setattr(plugin, k, v)
        else:
            plugin = DevOpsPlugin(id=plugin_id, **data)
            db.add(plugin)

        return plugin

    # ------------------------------------------------------------------
    # Installation management
    # ------------------------------------------------------------------

    async def get_catalog(
        self,
        db: AsyncSession,
        category: str | None = None,
    ) -> list[DevOpsPlugin]:
        stmt = select(DevOpsPlugin).where(DevOpsPlugin.is_active == True)
        if category:
            stmt = stmt.where(DevOpsPlugin.category == category)
        result = await db.execute(stmt.order_by(DevOpsPlugin.name))
        return list(result.scalars().all())

    async def get_installation_status(
        self,
        db: AsyncSession,
        *,
        organization_id: uuid.UUID,
        server_id: uuid.UUID,
    ) -> list[PluginInstallation]:
        result = await db.execute(
            select(PluginInstallation).where(
                PluginInstallation.organization_id == organization_id,
                PluginInstallation.server_id == server_id,
            )
        )
        return list(result.scalars().all())

    async def request_install(
        self,
        db: AsyncSession,
        *,
        organization_id: uuid.UUID,
        server_id: uuid.UUID,
        plugin_id: str,
        config: dict[str, Any] | None = None,
        installed_by: uuid.UUID,
        ip_address: str | None = None,
    ) -> PluginInstallation:
        """
        Create a PluginInstallation record. The caller submits the execution job.
        Returns the installation record — job is created separately by the caller
        via ExecutionEngine.submit_job().
        """
        # Verify plugin exists
        plugin = await db.get(DevOpsPlugin, plugin_id)
        if not plugin:
            raise PluginNotFoundError(f"Plugin '{plugin_id}' not found in catalog")

        # Check for an existing row. The DB enforces one row per server/plugin,
        # so failed/uninstalled/stale installing rows are reused for retries.
        existing = await db.execute(
            select(PluginInstallation).where(
                PluginInstallation.organization_id == organization_id,
                PluginInstallation.server_id == server_id,
                PluginInstallation.plugin_id == plugin_id,
            )
        )
        existing_install = existing.scalar_one_or_none()
        if existing_install:
            if existing_install.status == PluginStatus.INSTALLED:
                raise PluginAlreadyInstalledError(
                    f"Plugin '{plugin_id}' is already installed on this server"
                )
            if existing_install.status == PluginStatus.INSTALLING and existing_install.install_job_id:
                job = await db.get(DevOpsJob, existing_install.install_job_id)
                if job and job.status not in (
                    JobStatus.FAILED,
                    JobStatus.CANCELLED,
                    JobStatus.TIMEOUT,
                    JobStatus.COMPLETED,
                ):
                    raise PluginAlreadyInstalledError(
                        f"Plugin '{plugin_id}' is already being installed on this server"
                    )

            existing_install.status = PluginStatus.INSTALLING
            existing_install.config = config or {}
            existing_install.error_message = None
            existing_install.health_status = None
            existing_install.access_url = None
            existing_install.install_job_id = None
            existing_install.uninstalled_at = None
            db.add(existing_install)
            install = existing_install
        else:
            install = PluginInstallation(
                organization_id=organization_id,
                server_id=server_id,
                plugin_id=plugin_id,
                installed_by=installed_by,
                status=PluginStatus.INSTALLING,
                config=config or {},
            )
            db.add(install)

        install.installed_by = installed_by

        audit = DevOpsAuditLog(
            organization_id=organization_id,
            user_id=installed_by,
            server_id=server_id,
            action="plugin.install_requested",
            resource_type="plugin",
            resource_id=plugin_id,
            details={"config_keys": list((config or {}).keys())},
            ip_address=ip_address,
            risk_level="medium",
        )
        db.add(audit)

        await db.commit()
        await db.refresh(install)
        return install

    async def update_installation_status(
        self,
        db: AsyncSession,
        *,
        installation_id: uuid.UUID,
        status: PluginStatus,
        error_message: str | None = None,
        access_url: str | None = None,
        install_path: str | None = None,
    ) -> PluginInstallation:
        result = await db.execute(
            select(PluginInstallation).where(PluginInstallation.id == installation_id)
        )
        install = result.scalar_one_or_none()
        if not install:
            raise PluginNotFoundError(f"Installation {installation_id} not found")

        install.status = status
        if error_message is not None:
            install.error_message = error_message
        if access_url is not None:
            install.access_url = access_url
        if install_path is not None:
            install.install_path = install_path
        if status == PluginStatus.INSTALLED:
            install.installed_at = datetime.now(timezone.utc)
        elif status == PluginStatus.UNINSTALLED:
            install.uninstalled_at = datetime.now(timezone.utc)

        await db.commit()
        await db.refresh(install)
        return install

    def get_plugin_script_path(self, plugin_id: str, script: str) -> Path | None:
        """Returns the absolute path to a plugin's script file, or None if not found."""
        p = PLUGINS_DIR / plugin_id / script
        return p if p.exists() else None

    def get_compose_template(self, plugin_id: str) -> str | None:
        """Returns raw Jinja2 docker-compose template string."""
        p = PLUGINS_DIR / plugin_id / "docker-compose.yml.j2"
        if p.exists():
            return p.read_text()
        return None


plugin_manager = PluginManager()
