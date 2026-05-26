"""
DevOps Celery Extension
========================
Extends the existing celery_app (from celery_app.py) with:
  - new task includes
  - new beat schedules
  - new queues

ADDITIVE ONLY — celery_app.py is NOT modified.

Usage (in docker-compose.devops.yml):
  celery -A app.workers.celery_devops beat --loglevel=info
  celery -A app.workers.celery_devops worker -Q devops_low,devops_medium,devops_high

Existing workers continue running from celery_app.py without change.
"""

from celery.schedules import crontab

# Import the existing app — extend it
from app.workers.celery_app import celery_app  # noqa: F401 — re-exported

# Register new task modules (import-time side effect registers tasks)
celery_app.conf.include = list(celery_app.conf.include) + [
    "app.workers.execution_tasks",
]

# Add new beat schedules (dict.update is non-destructive to existing entries)
celery_app.conf.beat_schedule.update(
    {
        # Refresh container state every 2 minutes for all online servers
        "poll-all-containers-every-2-min": {
            "task": "app.workers.execution_tasks.poll_all_containers",
            "schedule": crontab(minute="*/2"),
        },
        # Check plugin health every 10 minutes
        "health-check-plugins-every-10-min": {
            "task": "app.workers.execution_tasks.health_check_all_plugins",
            "schedule": crontab(minute="*/10"),
        },
        # Check SSL renewals once a day at 03:00 UTC
        "check-ssl-renewals-daily": {
            "task": "app.workers.execution_tasks.check_ssl_renewals",
            "schedule": crontab(hour="3", minute="0"),
        },
    }
)

# Define separate queues so devops tasks never block backup/monitoring
celery_app.conf.task_queues = getattr(celery_app.conf, "task_queues", None) or []

# Queue routing: direct job types to appropriate risk queues
celery_app.conf.task_routes = {
    **(getattr(celery_app.conf, "task_routes", None) or {}),
    "app.workers.execution_tasks.dispatch_devops_job":       {"queue": "devops_low"},
    "app.workers.execution_tasks.poll_all_containers":       {"queue": "devops_low"},
    "app.workers.execution_tasks.poll_containers_for_server":{"queue": "devops_low"},
    "app.workers.execution_tasks.health_check_all_plugins":  {"queue": "devops_low"},
    "app.workers.execution_tasks.check_ssl_renewals":        {"queue": "devops_low"},
}
