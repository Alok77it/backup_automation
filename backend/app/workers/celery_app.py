from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "backup_intelligence",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.workers.backup_tasks",
        "app.workers.monitor_tasks",
        "app.workers.maintenance_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "collect-metrics-every-5-min": {
            "task": "app.workers.monitor_tasks.collect_all_metrics",
            "schedule": crontab(minute="*/5"),
        },
        "run-scheduled-backups": {
            "task": "app.workers.backup_tasks.run_scheduled_backups",
            "schedule": crontab(minute="*/15"),
        },
        "update-health-scores": {
            "task": "app.workers.maintenance_tasks.update_all_health_scores",
            "schedule": crontab(minute="*/30"),
        },
        "storage-analytics": {
            "task": "app.workers.maintenance_tasks.record_storage_usage",
            "schedule": crontab(hour="*/1"),
        },
        "check-alerts": {
            "task": "app.workers.maintenance_tasks.check_system_alerts",
            "schedule": crontab(minute="*/10"),
        },
    },
)
